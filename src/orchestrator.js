/**
 * Orchestrator — multi-agent execution engine.
 *
 * Integrates patterns from:
 *  - OMC/OMX: autopilot, team, ralph loop, intent gate
 *  - AgentSys: phase gates between pipeline stages (validate before proceeding)
 *  - Claude Nexus: adversarial review dynamic (reviewer assumes problems exist)
 *  - autoapp-toolkit: decision logging after each key stage
 *
 * Modes:
 *  - autopilot: explore → [gate] → plan → [gate] → execute → [gate] → review → fix loop
 *  - team: leader plans → [gate] → N workers parallel → [gate] → reviewer merges
 *  - chat: intent classification → route to best single agent
 */
import { runAgent } from './agent.js';
import { loadConfig } from './config.js';
import { appendDecision, saveRuntimeState } from './state.js';

// ─── AgentSys Phase Gates ───────────────────────────────────

/**
 * Phase gate: check that a stage's output is valid before proceeding.
 * Each gate returns { pass: boolean, reason: string }.
 *
 * AgentSys insight: 77% fewer wasted tokens by catching bad outputs early.
 */
const PHASE_GATES = {
  /**
   * Gate after exploration: did we actually find relevant files?
   */
  explore(output) {
    const text = output.result || '';
    const hasFiles = text.includes('.js') || text.includes('.ts') ||
                     text.includes('.py') || text.includes('/') ||
                     text.includes('file');
    const minLength = text.length > 100;

    if (!minLength) {
      return { pass: false, reason: 'Exploration output too short — likely failed to find relevant code.' };
    }
    if (!hasFiles) {
      return { pass: false, reason: 'Exploration did not reference any files — may have missed the codebase.' };
    }
    return { pass: true, reason: 'Exploration found relevant files.' };
  },

  /**
   * Gate after planning: does the plan have the required structure?
   */
  plan(output) {
    const text = output.result || '';
    const hasSteps = /\d+\./.test(text) || /step/i.test(text) || /implementation/i.test(text);
    const hasArchitecture = /architect/i.test(text) || /component/i.test(text) ||
                            /module/i.test(text) || /design/i.test(text);
    const minLength = text.length > 200;

    if (!minLength) {
      return { pass: false, reason: 'Plan too short — insufficient detail for execution.' };
    }
    if (!hasSteps && !hasArchitecture) {
      return { pass: false, reason: 'Plan lacks implementation steps or architecture breakdown.' };
    }
    return { pass: true, reason: 'Plan has sufficient structure.' };
  },

  /**
   * Gate after execution: did we actually change anything?
   */
  execute(output) {
    const text = output.result || '';
    if (text.includes('no changes') || text.includes('nothing to do')) {
      return { pass: false, reason: 'Executor reported no changes made.' };
    }
    return { pass: true, reason: 'Executor completed changes.' };
  },

  /**
   * Gate after review: was a clear verdict reached?
   */
  review(output) {
    const text = output.result || '';
    const hasVerdict = /APPROVED|NEEDS_CHANGES|REJECTED/i.test(text);
    if (!hasVerdict) {
      return { pass: false, reason: 'Review lacks a clear verdict.' };
    }
    return { pass: true, reason: 'Review complete with verdict.' };
  },

  /**
   * Gate for team plan: did we get valid sub-tasks?
   */
  teamPlan(output, expectedWorkers) {
    const text = output.result || '';
    const subTaskMatches = text.match(/sub-task\s*\d+/ig) || [];
    if (subTaskMatches.length < 2) {
      return { pass: false, reason: `Plan produced fewer than 2 sub-tasks (got ${subTaskMatches.length}).` };
    }
    return { pass: true, reason: `Plan produced ${subTaskMatches.length} sub-tasks.` };
  },
};

/**
 * Run a phase gate check. If it fails, emit a warning but continue
 * (soft gate — AgentSys uses hard gates in production, MVP uses soft).
 * Returns true if passed, false if failed.
 */
function checkGate(gateName, output, extra, onEvent) {
  const gate = PHASE_GATES[gateName];
  if (!gate) return true;

  const result = gate(output, extra);
  if (!result.pass && onEvent) {
    onEvent({ type: 'gate_fail', gate: gateName, reason: result.reason });
  }
  return result.pass;
}

// ─── Intent classification (OMC Intent Gate) ───────────────

function classifyIntent(task) {
  const t = task.toLowerCase();
  if (t.includes('fix') || t.includes('bug') || t.includes('debug') || t.includes('error')) return 'debug';
  if (t.includes('review') || t.includes('check') || t.includes('audit')) return 'review';
  if (t.includes('plan') || t.includes('design') || t.includes('architect')) return 'plan';
  if (t.includes('explain') || t.includes('what') || t.includes('how') || t.includes('find')) return 'explore';
  return 'implement';
}

// ─── Autopilot mode ─────────────────────────────────────────

/**
 * Autopilot — end-to-end autonomous execution with phase gates.
 *
 * Pipeline:
 *   explore → [gate:explore] → plan → [gate:plan] →
 *   execute → [gate:execute] → review → [gate:review] →
 *   fix loop (max 3 iterations)
 */
export async function autopilot({ task, onEvent }) {
  const emit = (type, data) => onEvent?.(data ? { ...data, type } : { type });
  emit('mode', { mode: 'autopilot', task });

  const fullLog = [];
  let gateFailures = 0;

  // ── Stage 0: Exploration ──
  emit('stage', { stage: 'explore', message: 'Exploring codebase...' });
  const exploreResult = await runAgent({
    agentName: 'explore',
    task: `Understand the codebase context for: "${task}". Search for relevant files, read key modules. Be thorough.`,
    onEvent,
  });
  fullLog.push({ stage: 'explore', ...exploreResult });
  checkGate('explore', exploreResult, null, onEvent);

  // ── Stage 1: Architecture & Planning ──
  emit('stage', { stage: 'plan', message: 'Designing solution...' });
  const planResult = await runAgent({
    agentName: 'architect',
    task: `Design a solution for: "${task}"\n\nExploration findings:\n${exploreResult.result}`,
    onEvent,
  });
  fullLog.push({ stage: 'plan', ...planResult });

  if (!checkGate('plan', planResult, null, onEvent)) {
    gateFailures++;
    emit('stage', { stage: 'gate_fail', message: 'Plan gate failed. Proceeding with caution.' });
  }

  appendDecision('architect', task, planResult.result?.substring(0, 300) || '');

  // ── Stage 2-4: Execute-Review-Fix loop (OMC Ralph + Claude Nexus adversarial review) ──
  let approved = false;
  let iterations = 0;
  let currentPlan = planResult.result;

  while (!approved && iterations < 3) {
    // Stage 2: Execute
    emit('stage', { stage: 'execute', iteration: iterations + 1, message: 'Implementing...' });
    const execResult = await runAgent({
      agentName: 'executor',
      task: `Execute the following plan:\n\n${currentPlan}\n\nImplement changes. After each, verify it works.`,
      onEvent,
    });
    fullLog.push({ stage: 'execute', iteration: iterations + 1, ...execResult });
    checkGate('execute', execResult, null, onEvent);

    // Stage 3: Review (Claude Nexus adversarial — reviewer assumes problems exist)
    emit('stage', { stage: 'review', iteration: iterations + 1, message: 'Adversarial review...' });
    const reviewResult = await runAgent({
      agentName: 'reviewer',
      task: `Adversarially review the changes for: "${task}". ` +
            `Assume every change has hidden problems. Check correctness, edge cases, ` +
            `security, performance, and style. Provide verdict: APPROVED / NEEDS_CHANGES / REJECTED.`,
      onEvent,
    });
    fullLog.push({ stage: 'review', iteration: iterations + 1, ...reviewResult });
    checkGate('review', reviewResult, null, onEvent);

    appendDecision('reviewer', `Review iteration ${iterations + 1}`, reviewResult.result?.substring(0, 300) || '');

    if (reviewResult.result.includes('APPROVED')) {
      approved = true;
      emit('stage', { stage: 'complete', message: 'All changes approved.' });
    } else if (reviewResult.result.includes('REJECTED')) {
      approved = true; // Stop — too broken to fix automatically
      emit('stage', { stage: 'complete', message: 'Changes rejected. Manual intervention needed.' });
    } else {
      iterations++;
      currentPlan = `Original task: ${task}\n\nPrevious attempt was reviewed. Fix these issues:\n\n${reviewResult.result}\n\nRe-implement with fixes.`;
      emit('stage', { stage: 'fix', iteration: iterations, message: 'Applying fixes from review...' });
    }
  }

  // Save cross-session state
  saveRuntimeState({
    lastTask: task.substring(0, 80),
    lastStatus: approved ? 'approved' : (iterations >= 3 ? 'max_iterations' : 'rejected'),
    lastSession: new Date().toISOString(),
  });

  return { task, stages: fullLog, approved, iterations, gateFailures };
}

// ─── Team mode ──────────────────────────────────────────────

/**
 * Team mode — Leader + N parallel workers with phase gates.
 */
export async function teamMode({ task, workers = 3, onEvent }) {
  const emit = (type, data) => onEvent?.(data ? { ...data, type } : { type });
  emit('mode', { mode: 'team', task, workers });

  // Stage 1: Leader plans
  emit('stage', { stage: 'plan', message: 'Team leader planning...' });
  const planResult = await runAgent({
    agentName: 'architect',
    task: `Break down: "${task}" into ${workers} independent, parallel sub-tasks. ` +
          `Format: "Sub-task 1: ..." "Sub-task 2: ..." etc. Each must be self-contained.`,
    onEvent,
  });

  if (!checkGate('teamPlan', planResult, workers, onEvent)) {
    emit('stage', { stage: 'gate_fail', message: 'Plan did not produce enough sub-tasks. Running single-threaded.' });
  }

  // Parse sub-tasks
  const subTasks = planResult.result
    .split(/Sub-task \d+:/i)
    .map(s => s.trim())
    .filter(s => s.length > 20);

  const tasks = subTasks.length >= 2 ? subTasks.slice(0, workers) : [planResult.result];

  // Stage 2: Execute in parallel
  emit('stage', { stage: 'execute', message: `${tasks.length} workers executing in parallel...` });

  const workerPromises = tasks.map((subTask, i) =>
    runAgent({
      agentName: 'executor',
      task: `Sub-task ${i + 1}: ${subTask}`,
      onEvent: (evt) => onEvent?.({ ...evt, worker: i + 1 }),
    })
  );

  const workerResults = await Promise.all(workerPromises);
  emit('stage', { stage: 'workers_done', message: `${workerResults.length} workers finished.` });

  // Stage 3: Review merged results
  emit('stage', { stage: 'review', message: 'Reviewing combined changes...' });
  const reviewInput = workerResults
    .map((r, i) => `Worker ${i + 1}:\n${r.result}`)
    .join('\n\n---\n\n');

  const reviewResult = await runAgent({
    agentName: 'reviewer',
    task: `Review combined changes from ${tasks.length} parallel workers:\n\n${reviewInput}\n\n` +
          `Check for cross-worker consistency, integration issues, quality. Verdict required.`,
    onEvent,
  });

  appendDecision('team-review', task, reviewResult.result?.substring(0, 300) || '');

  return { task, plan: planResult.result, subTasks: tasks.length, workerResults, review: reviewResult.result };
}

// ─── Chat mode ──────────────────────────────────────────────

export async function chatMode({ task, context = [], onEvent }) {
  const intent = classifyIntent(task);
  const agentMap = {
    debug: 'debugger', review: 'reviewer', plan: 'architect',
    explore: 'explore', implement: 'executor',
  };
  return runAgent({ agentName: agentMap[intent] || 'executor', task, context, onEvent });
}

// ─── Mode resolver ──────────────────────────────────────────

export function resolveMode(input, configMode) {
  const trimmed = input.trim();

  if (trimmed.startsWith('$autopilot ')) {
    return { mode: 'autopilot', task: trimmed.slice('$autopilot '.length) };
  }
  const teamMatch = trimmed.match(/^\$team\s+(\d+)?\s*(.*)/);
  if (teamMatch) {
    return { mode: 'team', workers: teamMatch[1] ? parseInt(teamMatch[1], 10) : 3, task: teamMatch[2] || '' };
  }
  if (trimmed.startsWith('$ralph ')) {
    return { mode: 'autopilot', task: trimmed.slice('$ralph '.length), ralph: true };
  }
  if (trimmed.startsWith('$')) {
    return { mode: 'chat', task: input };
  }

  if (configMode === 'team') return { mode: 'team', task: input, workers: 3 };
  if (configMode === 'chat') return { mode: 'chat', task: input };

  const intent = classifyIntent(input);
  if (intent === 'implement' || intent === 'debug') return { mode: 'autopilot', task: input };
  return { mode: 'chat', task: input };
}
