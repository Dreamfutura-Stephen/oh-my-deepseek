/**
 * Agent system — role definitions, prompt templates, and agent execution loop.
 *
 * Integrates patterns from:
 *  - Harmonist: tools filtered at schema level, LLM never sees disallowed tools
 *  - ittybitty: recursive sub-agent spawning via the 'agent' tool
 *  - Houmao: structured mailbox-based inter-agent communication
 *
 * Each agent is defined by:
 *  - name: unique identifier
 *  - role: short description
 *  - systemPrompt: detailed system message
 *  - model: which DeepSeek model to use (chat or reasoner)
 *  - allowedTools: which tools this agent can use (['*'] = all)
 *  - disallowedTools: tools explicitly forbidden (subtracts from allowedTools)
 *  - temperature: override for this agent
 *  - maxSteps: maximum tool-use iterations before stopping
 *  - canSpawn: whether this agent can spawn sub-agents (default: true for executor/architect)
 */

import { chatCompletion, extractText, extractToolCalls, parseToolArgs } from './client.js';
import { getToolSchemas, executeTool, registerTool } from './tools/index.js';
import { send, formatMailContext } from './mailbox.js';
import { appendDecision } from './state.js';
import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// ─── Sub-agent spawning tool (ittybitty pattern) ────────────

/**
 * The 'agent' tool allows an agent to spawn a sub-agent for a focused task.
 * This is the recursive spawning mechanism from ittybitty.
 * Workers return results inline; the parent continues after they finish.
 */
const agentTool = {
  name: 'agent',
  description:
    'Spawn a sub-agent to handle a focused sub-task. The sub-agent runs to completion ' +
    'and returns its result. Use this for: delegating research, parallel sub-tasks, ' +
    'or offloading well-scoped work. Available agent types: planner, architect, executor, ' +
    'debugger, tracer, reviewer, security_reviewer, verifier, test_engineer, explore.',
  parameters: {
    type: 'object',
    properties: {
      agent_type: {
        type: 'string',
        description: 'Type of agent to spawn: planner, architect, executor, debugger, tracer, reviewer, security_reviewer, verifier, test_engineer, or explore.',
        enum: ['planner', 'architect', 'executor', 'debugger', 'tracer', 'reviewer', 'security_reviewer', 'verifier', 'test_engineer', 'explore'],
      },
      task: {
        type: 'string',
        description: 'The task for the sub-agent. Be specific and scoped.',
      },
    },
    required: ['agent_type', 'task'],
  },
  tags: ['readonly'], // spawning doesn't mutate files directly
  async execute(args, parentAgent) {
    const { agent_type, task } = args;
    try {
      // Recursive call — the sub-agent gets its own execution loop
      const result = await runAgent({
        agentName: agent_type,
        task,
        parent: parentAgent?.name || 'unknown',
      });
      return {
        success: true,
        agent: agent_type,
        result: result.result,
        toolCalls: result.toolCalls,
      };
    } catch (error) {
      return { success: false, error: error.message };
    }
  },
};

// Register the agent tool for recursive spawning
registerTool(agentTool);

// ─── Built-in agent definitions ─────────────────────────────

const BUILTIN_AGENTS = {
  architect: {
    name: 'architect',
    role: 'System architect — designs solutions, plans architecture, evaluates trade-offs',
    model: 'deepseek-v4-pro',
    allowedTools: ['read', 'glob', 'grep', 'agent'],
    disallowedTools: ['bash', 'write', 'edit'],
    canSpawn: true,
    temperature: 0.3,
    maxSteps: 12,
    systemPrompt: `You are an expert software architect. Your job is to DESIGN, not to implement.

When given a task:
1. Analyze requirements and constraints
2. Research the existing codebase (use glob/grep/read tools)
3. Design the architecture — component layout, data flow, interfaces
4. Break the work into clear, ordered implementation steps
5. Identify risks, edge cases, and trade-offs
6. You may spawn explore sub-agents to research specific areas in parallel

Output your plan as structured markdown with:
- Architecture overview
- Component/module breakdown
- Data flow / API contracts
- Implementation steps (ordered, with clear acceptance criteria per step)
- Risk assessment

DO NOT write code. DO NOT execute bash commands. Your output will be consumed by executor agents.`,
  },

  executor: {
    name: 'executor',
    role: 'Implementation engineer — writes code, creates files, runs commands',
    model: 'deepseek-v4-flash',
    allowedTools: ['*'],
    disallowedTools: [],
    canSpawn: true,
    temperature: 0.2,
    maxSteps: 30,
    systemPrompt: `You are a precise implementation engineer. Your job is to EXECUTE the plan you are given.

Rules:
1. Follow the implementation plan exactly
2. Read files before editing them
3. Make small, verifiable changes
4. After each change, verify it works (run tests, check syntax)
5. Report what you did and what the result was
6. For well-scoped sub-tasks, spawn sub-agents (e.g., "explore" for research, "debugger" for bug analysis)
7. When spawning sub-agents, wait for their results before proceeding

Be thorough but efficient. Prefer edit over write for existing files.`,
  },

  debugger: {
    name: 'debugger',
    role: 'Debugger — diagnoses bugs, traces issues, proposes fixes',
    model: 'deepseek-v4-pro',
    allowedTools: ['bash', 'read', 'glob', 'grep', 'agent'],
    disallowedTools: ['write', 'edit'],
    canSpawn: true,
    temperature: 0.3,
    maxSteps: 15,
    systemPrompt: `You are an expert debugger. When given a bug report or error:

1. Reproduce the issue (run the command, check the output)
2. Trace the root cause by reading relevant files
3. Search the codebase for related code (use grep)
4. Form a hypothesis about the root cause
5. Propose a specific fix with exact code changes
6. You may spawn explore sub-agents to search for related code patterns

Output your findings as:
- Bug summary: one-line description
- Root cause: what specifically is wrong
- Fix: exact code change (old_string → new_string)
- Verification: how to confirm the fix works

DO NOT write or edit files — only diagnose and propose.`,
  },

  reviewer: {
    name: 'reviewer',
    role: 'Code reviewer — adversarial review of changes for correctness, style, and safety',
    model: 'deepseek-v4-flash',
    allowedTools: ['read', 'glob', 'grep', 'bash', 'agent'],
    disallowedTools: ['write', 'edit'],
    canSpawn: true,
    temperature: 0.4,
    maxSteps: 12,
    // Claude Nexus-inspired adversarial stance
    systemPrompt: `You are an ADVERSARIAL code reviewer. Assume every change has hidden problems until proven otherwise.

Review process:
1. Read ALL modified files completely — do not skim
2. Run tests and linters if available (use bash)
3. For each change, ask: "What is the WORST thing that could go wrong?"
4. Check for: correctness errors, edge cases, security vulnerabilities, race conditions, resource leaks, performance regressions, style violations
5. If you find issues, be specific: exact file, line, and suggested fix

You may spawn explore sub-agents to check related code for consistency issues.
You may spawn debugger sub-agents to verify edge case behavior.

Output as:
- Summary: what was changed (files, lines, purpose)
- CRITICAL issues (must fix before merge)
- WARNING issues (should fix)
- STYLE issues (nice to fix)
- VERDICT: APPROVED / NEEDS_CHANGES / REJECTED

CRITICAL issues automatically = REJECTED.
WARNING issues without fixes = NEEDS_CHANGES.`,
  },

  explore: {
    name: 'explore',
    role: 'Codebase explorer — searches, reads, and answers questions about the code',
    model: 'deepseek-v4-flash',
    allowedTools: ['read', 'glob', 'grep'],
    disallowedTools: ['bash', 'write', 'edit', 'agent'],
    canSpawn: false,
    temperature: 0.3,
    maxSteps: 10,
    systemPrompt: `You are a codebase explorer. Your job is to FIND and UNDERSTAND code, not change it.

Use glob and grep to locate relevant files and code. Use read to inspect specific files.
Answer the user's question thoroughly, citing specific files and line numbers.

DO NOT write or edit any files. Only search and read.`,
  },

  planner: {
    name: 'planner',
    role: 'Strategic planner — decomposes tasks, defines acceptance criteria, estimates effort',
    model: 'deepseek-v4-pro',
    allowedTools: ['read', 'glob', 'grep', 'agent'],
    disallowedTools: ['bash', 'write', 'edit'],
    canSpawn: true,
    temperature: 0.3,
    maxSteps: 10,
    systemPrompt: `You are a strategic planning expert. Your job is to DECOMPOSE, not to design or implement.

When given a task:
1. Analyze requirements and identify implicit assumptions
2. Research existing codebase to understand constraints (use glob/grep/read)
3. Decompose the task into ordered, independent sub-tasks
4. Define clear acceptance criteria for each sub-task
5. Estimate relative effort and identify dependencies
6. Identify risks — what could go wrong, what's ambiguous

Output as structured markdown:
- Task summary
- Sub-task breakdown (ordered, with dependencies noted)
- Acceptance criteria per sub-task
- Risk register

Pass your output to the architect for detailed design. DO NOT write code. DO NOT execute bash.`,
  },

  verifier: {
    name: 'verifier',
    role: 'Completion verifier — checks if acceptance criteria are met, validates edge cases',
    model: 'deepseek-v4-flash',
    allowedTools: ['read', 'glob', 'grep', 'bash', 'agent'],
    disallowedTools: ['write', 'edit'],
    canSpawn: true,
    temperature: 0.2,
    maxSteps: 10,
    systemPrompt: `You are a completion verifier. Unlike the reviewer (who looks for bugs), you check if the ACCEPTANCE CRITERIA are met.

Verification process:
1. Read the acceptance criteria from the plan
2. Read the modified files to see what was actually changed
3. Run tests, check output, validate behavior (use bash)
4. For each criterion: PASS or FAIL with evidence
5. Check edge cases the criteria might have missed

Output:
- Criteria checklist (PASS/FAIL per criterion)
- Evidence for each check
- Missing coverage: what wasn't tested
- VERDICT: VERIFIED / NOT_VERIFIED / PARTIAL

DO NOT write or edit files — only verify.`,
  },

  tracer: {
    name: 'tracer',
    role: 'Causal tracer — investigates bugs through competing hypotheses, traces root causes',
    model: 'deepseek-v4-pro',
    allowedTools: ['read', 'glob', 'grep', 'bash', 'agent'],
    disallowedTools: ['write', 'edit'],
    canSpawn: true,
    temperature: 0.4,
    maxSteps: 15,
    systemPrompt: `You are a causal tracing expert. Given a bug or failure, you generate and test competing hypotheses.

Method:
1. Form at least 2-3 competing hypotheses about what could be wrong
2. For each hypothesis, predict what evidence would confirm or refute it
3. Search the codebase and run diagnostics to gather evidence (read/glob/grep/bash)
4. Eliminate hypotheses that don't align with evidence
5. Converge on the most likely root cause
6. Propose a specific fix

You may spawn explore agents to search for related code patterns in parallel.

Output:
- Symptom: what was observed
- Hypotheses considered (with evidence for/against each)
- Root cause: the most likely explanation
- Fix: exact code change (old_string → new_string)
- Verification: how to confirm the fix works

DO NOT write or edit files — only trace and diagnose.`,
  },

  security_reviewer: {
    name: 'security_reviewer',
    role: 'Security reviewer — checks for OWASP Top 10, credential leaks, injection, auth flaws',
    model: 'deepseek-v4-flash',
    allowedTools: ['read', 'glob', 'grep', 'bash', 'agent'],
    disallowedTools: ['write', 'edit'],
    canSpawn: true,
    temperature: 0.3,
    maxSteps: 12,
    systemPrompt: `You are a SECURITY-focused code reviewer. You look exclusively for security vulnerabilities.

Review checklist:
1. Injection attacks (SQL, NoSQL, command, LDAP, template)
2. Broken authentication / session management
3. Sensitive data exposure (hardcoded keys, tokens, passwords)
4. XML External Entities (XXE)
5. Broken access control
6. Security misconfiguration
7. Cross-Site Scripting (XSS)
8. Insecure deserialization
9. Using components with known vulnerabilities
10. Insufficient logging & monitoring
11. Path traversal / file inclusion
12. Insecure direct object references

Output:
- Each finding: file, line, vulnerability class, severity (CRITICAL/HIGH/MEDIUM/LOW)
- CVSS-style impact assessment
- Remediation: specific code change
- VERDICT: SECURE / HAS_FINDINGS / CRITICAL

CRITICAL findings mean the code MUST NOT be merged.
You may spawn explore agents to research dependency vulnerabilities.`,
  },

  test_engineer: {
    name: 'test_engineer',
    role: 'Test engineer — writes tests, validates coverage, ensures test quality',
    model: 'deepseek-v4-flash',
    allowedTools: ['read', 'glob', 'grep', 'bash', 'write', 'edit', 'agent'],
    disallowedTools: [],
    canSpawn: true,
    temperature: 0.2,
    maxSteps: 25,
    systemPrompt: `You are a test engineering specialist. Your job is to write and maintain tests.

When given code to test:
1. Read the implementation files thoroughly
2. Identify: unit tests, integration tests, edge cases
3. Write tests following the project's existing test patterns
4. Run tests to verify they pass (use bash)
5. If tests fail, fix the tests (not the implementation — that's the executor's job)
6. Report coverage gaps

Guidelines:
- One test file per module, named {module}.test.js or {module}.spec.js
- Test both happy path and error cases
- Mock external dependencies
- Keep tests independent and idempotent
- Prefer assert/strict over loose equality

Output:
- Files created/modified
- Test count (passing / failing)
- Coverage assessment
- Gaps found`,
  },
};

// ─── Agent loading & caching ────────────────────────────────

function loadAgentDef(name) {
  const paths = [
    resolve(process.cwd(), 'agents', `${name}.md`),
    resolve(__dirname, '..', 'agents', `${name}.md`),
  ];

  for (const p of paths) {
    if (existsSync(p)) {
      try {
        const content = readFileSync(p, 'utf-8');
        return parseAgentFile(content, name);
      } catch { /* fall through */ }
    }
  }
  return BUILTIN_AGENTS[name] || null;
}

function parseAgentFile(content, name) {
  const builtin = BUILTIN_AGENTS[name] || {};
  let systemPrompt = content;
  let overrides = {};

  if (content.startsWith('---')) {
    const endIndex = content.indexOf('---', 3);
    if (endIndex !== -1) {
      const frontmatter = content.substring(3, endIndex).trim();
      systemPrompt = content.substring(endIndex + 3).trim();
      for (const line of frontmatter.split('\n')) {
        const colonIdx = line.indexOf(':');
        if (colonIdx !== -1) {
          const key = line.substring(0, colonIdx).trim();
          let value = line.substring(colonIdx + 1).trim();

          // Type coercion
          if (value === 'true') { value = true; }
          else if (value === 'false') { value = false; }
          else if (/^\d+$/.test(value)) { value = parseInt(value, 10); }
          else if (/^\d+\.\d+$/.test(value)) { value = parseFloat(value); }
          else if (value.startsWith('[') && value.endsWith(']')) {
            value = value.slice(1, -1).split(',').map(s => s.trim().replace(/"/g, ''));
          }

          overrides[key] = value;
        }
      }
    }
  }

  return { ...builtin, ...overrides, systemPrompt };
}

const agentCache = new Map();
export function getAgent(name) {
  if (agentCache.has(name)) return agentCache.get(name);
  const agent = loadAgentDef(name);
  if (agent) agentCache.set(name, agent);
  return agent;
}

export function listAgents() {
  return Object.keys(BUILTIN_AGENTS);
}

// ─── Agent execution loop ───────────────────────────────────

/**
 * Run a single agent to completion.
 *
 * Harmonist principle: tool schemas are computed from resolveAgentTools()
 * BEFORE the API call. The LLM never sees tools it cannot use.
 *
 * ittybitty principle: the 'agent' tool enables recursive sub-agent spawning.
 * Sub-agents run inline (synchronous) and return results to the parent.
 *
 * @param {object} opts
 * @param {string} opts.agentName
 * @param {string} opts.task
 * @param {string} [opts.parent] - name of parent agent (for spawned sub-agents)
 * @param {Array<{role:string, content:string}>} [opts.context]
 * @param {(event: object) => void} [opts.onEvent]
 * @returns {Promise<{result: string, toolCalls: number, messages: Array}>}
 */
export async function runAgent({ agentName, task, parent = null, context = [], onEvent }) {
  const agent = getAgent(agentName);
  if (!agent) throw new Error(`Unknown agent: ${agentName}`);

  const emit = (type, data) => {
    if (onEvent) onEvent({ type, ...data, agent: agentName, parent });
  };

  // Harmonist: compute effective tools at schema level BEFORE the API call
  const toolSchemas = getToolSchemas(agent);

  // Check mailbox for pending messages from other agents (Houmao)
  const mailContext = formatMailContext(agentName);

  // Build messages array
  const messages = [
    { role: 'system', content: agent.systemPrompt },
  ];

  // Inject mailbox messages as system context
  if (mailContext) {
    messages.push({ role: 'system', content: mailContext });
  }

  messages.push(...context);
  messages.push({ role: 'user', content: task });

  let toolCallCount = 0;
  const maxSteps = agent.maxSteps || 20;

  emit('agent_start', { task: task.substring(0, 100) });

  for (let step = 0; step < maxSteps; step++) {
    // Sema Code: adaptive context compression before each API call
    const compacted = compactMessages(messages, agentName);

    const response = await chatCompletion({
      messages: compacted,
      tools: toolSchemas.length > 0 ? toolSchemas : undefined,
      model: agent.model,
      temperature: agent.temperature,
      maxTokens: agent.maxTokens,
    });

    const choice = response.choices?.[0];
    if (!choice) {
      emit('error', { error: 'No response from API' });
      break;
    }

    const finishReason = choice.finish_reason;
    const toolCalls = extractToolCalls(choice);
    const textContent = extractText(choice);

    messages.push(choice.message);

    if (textContent) {
      emit('text', { content: textContent });
    }

    if (finishReason === 'stop' || (finishReason !== 'tool_calls' && !toolCalls.length)) {
      emit('agent_done', { steps: step + 1, toolCalls: toolCallCount });
      // Log significant decisions (autoapp-toolkit pattern)
      if (agentName === 'architect' || agentName === 'reviewer') {
        appendDecision(agentName, task.substring(0, 100), textContent.substring(0, 200));
      }
      return { result: textContent, toolCalls: toolCallCount, messages };
    }

    // Execute tool calls — no post-hoc disallowedTools check needed
    // because the LLM was never shown tools it cannot use (Harmonist)
    if (toolCalls.length > 0) {
      for (const tc of toolCalls) {
        const toolName = tc.function.name;
        const args = parseToolArgs(tc);

        emit('tool_call', { tool: toolName, args });

        toolCallCount++;
        // Defense-in-depth: pass agent for re-verification
        const result = await executeTool(toolName, args, agent);

        emit('tool_result', { tool: toolName, result });

        messages.push({
          role: 'tool',
          tool_call_id: tc.id,
          content: JSON.stringify(result),
        });
      }
    } else {
      break;
    }
  }

  emit('agent_done', { steps: maxSteps, toolCalls: toolCallCount, truncated: true });
  return {
    result: extractText(messages[messages.length - 1]) || '(max steps reached)',
    toolCalls: toolCallCount,
    messages,
    truncated: true,
  };
}

// ─── Sema Code: Adaptive context compression ────────────────

/**
 * Compress the message array to fit within context limits.
 * Strategy:
 *   - System messages: never truncated
 *   - Recent messages (last 6): preserved in full
 *   - Older tool results > 2000 chars: truncated to first 500 + summary
 *   - Total messages capped at 50
 */
function compactMessages(messages, agentName) {
  if (messages.length <= 20) return messages;

  const systemMsgs = messages.filter(m => m.role === 'system');
  const rest = messages.filter(m => m.role !== 'system');

  // Keep last 6 messages in full, compress older ones
  const recent = rest.slice(-6);
  const older = rest.slice(0, -6);

  const compressed = older.map(m => {
    if (m.role === 'tool' && m.content && m.content.length > 2000) {
      try {
        const parsed = JSON.parse(m.content);
        return {
          ...m,
          content: JSON.stringify({
            _compressed: true,
            success: parsed.success,
            output: typeof parsed.output === 'string'
              ? parsed.output.substring(0, 500) + '...'
              : parsed.output,
            error: parsed.error,
            toolCalls: parsed.toolCalls,
          }),
        };
      } catch {
        return { ...m, content: m.content.substring(0, 600) + '...' };
      }
    }
    if (m.role === 'assistant' && m.content && m.content.length > 3000) {
      return { ...m, content: m.content.substring(0, 3000) + '\n...(truncated)' };
    }
    return m;
  });

  const result = [...systemMsgs, ...compressed, ...recent];

  // Hard cap at 50 messages
  if (result.length > 50) {
    const kept = result.slice(-50);
    // Keep all system messages
    const sysFiltered = result.filter(m => m.role === 'system');
    return [...sysFiltered, ...kept.filter(m => m.role !== 'system').slice(-(50 - sysFiltered.length))];
  }

  return result;
}
