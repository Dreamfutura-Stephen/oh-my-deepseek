#!/usr/bin/env node
/**
 * omd — oh-my-deepseek CLI
 *
 * Usage:
 *   omd run "build a REST API"       # Autopilot mode
 *   omd team 3 "refactor auth"       # Team mode with 3 workers
 *   omd chat                          # Interactive chat
 *   omd mcp                           # Start MCP server (for Claude Code / Codex / Cursor)
 *   omd setup                         # Initialize .omd/ and config
 *   omd doctor                        # Environment check
 *   omd sessions                      # List recent sessions
 *
 * Magic keywords (work in chat or run):
 *   $autopilot "task"                 # Force autopilot mode
 *   $team 4 "task"                    # Team mode with N workers
 *   $ralph "task"                     # Autopilot with persistent verify loop
 */
import { loadConfig, getApiKey, ensureOmdDir, saveProjectConfig, detectEnvironment } from './config.js';
import { autopilot, teamMode, chatMode, resolveMode } from './orchestrator.js';
import { createSession, saveMessages, saveSession, listRecentSessions } from './state.js';
import { listAgents } from './agent.js';
import { startMcpServer } from './mcp.js';
import { existsSync, readFileSync, appendFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { createRequire } from 'node:module';
const pkg = createRequire(import.meta.url)('../package.json');
import { createInterface } from 'node:readline';

// ─── Terminal colors (ANSI escape codes) ────────────────────

const C = {
  r: '\x1b[0m',
  b: '\x1b[1m',
  d: '\x1b[2m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
};

function log(...args) { process.stdout.write(args.join(' ') + '\n'); }

// ─── Shared event handler ────────────────────────────────────

function makeEventHandler(verbose = true) {
  return (evt) => {
    switch (evt.type) {
      case 'mode':
        log(`${C.cyan}▶ Mode: ${evt.mode}${C.r}`);
        break;
      case 'stage':
        if (evt.stage === 'ralph_rethink' || evt.stage === 'ralph_cycle') {
          log(`${C.magenta}⟳ ${evt.stage}${evt.message ? ` — ${evt.message}` : ''}${C.r}`);
        } else {
          log(`${C.yellow}⚡ ${evt.stage}${evt.message ? ` — ${evt.message}` : ''}${C.r}`);
        }
        break;
      case 'text': {
        if (!verbose) break;
        const text = evt.content || '';
        log(text.length > 800 ? text.substring(0, 800) + `\n${C.d}... (truncated)${C.r}` : text);
        break;
      }
      case 'tool_call':
        if (verbose) {
          log(`${C.d}  🔧 ${evt.tool}(${JSON.stringify(evt.args).substring(0, 80)})${C.r}`);
        }
        break;
      case 'tool_result':
        if (evt.result && !evt.result.success) {
          log(`${C.red}  ✗ ${evt.tool}: ${evt.result.error}${C.r}`);
        }
        break;
      case 'error':
        log(`${C.red}Error: ${evt.error}${C.r}`);
        break;
      case 'agent_done':
        log(`${C.green}✓ ${evt.agent} done (${evt.steps} steps, ${evt.toolCalls} tool calls)${C.r}`);
        break;
      case 'workers_done':
        log(`${C.green}✓ ${evt.message}${C.r}`);
        break;
      case 'complete':
        log(`${C.green}${C.b}✓ ${evt.message || 'Done.'}${C.r}`);
        break;
    }
  };
}

// ─── Commands ────────────────────────────────────────────────

async function cmdRun(task) {
  const { mode, workers, task: resolvedTask, ralph } = resolveMode(task, loadConfig().defaultMode);
  if (!resolvedTask) {
    log(`${C.red}No task provided.${C.r}`);
    process.exit(1);
  }

  const sessionId = createSession(resolvedTask);
  const messages = [];
  const onEvent = (evt) => {
    makeEventHandler(true)(evt);
    if (evt.type === 'text') messages.push({ role: 'assistant', content: evt.content });
  };

  let result;
  if (mode === 'autopilot') {
    result = await autopilot({ task: resolvedTask, onEvent, ralph });
  } else if (mode === 'team') {
    result = await teamMode({ task: resolvedTask, workers, onEvent });
  } else {
    result = await chatMode({ task: resolvedTask, onEvent });
  }

  saveSession(sessionId, { ...result, status: 'completed', completedAt: new Date().toISOString() });
  if (messages.length > 0) saveMessages(sessionId, messages);

  log(`\n${C.d}Session: ${sessionId}${C.r}`);
  return result;
}

async function cmdChat() {
  log(banner());
  log(`${C.cyan}Chat mode — ask questions, explore code, or use magic keywords.${C.r}`);
  log(`${C.d}Magic: $autopilot <task>  |  $team <N> <task>  |  $ralph <task>${C.r}`);
  log(`${C.d}Commands: /exit  /help  /sessions  /agents${C.r}\n`);

  const sessionId = createSession('chat');
  const context = [];
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const ask = () => new Promise(resolve => rl.question(`${C.green}▸ ${C.r}`, a => resolve(a.trim())));

  while (true) {
    const input = await ask();
    if (!input || input === '/exit' || input === '/quit') break;

    if (input === '/help') {
      log(`${C.d}Magic: $autopilot <task> — full autonomous execution`);
      log(`       $team <N> <task>   — parallel team of N workers`);
      log(`       $ralph <task>      — persistent verify loop`);
      log(`Commands: /exit, /sessions, /agents${C.r}`);
      continue;
    }
    if (input === '/sessions') {
      const sessions = listRecentSessions(5);
      if (sessions.length === 0) { log(`${C.d}No recent sessions.${C.r}`); continue; }
      sessions.forEach(s => log(`${C.d}  ${s.id.substring(0, 12)}  ${s.status}  ${(s.task || '').substring(0, 60)}${C.r}`));
      continue;
    }
    if (input === '/agents') {
      log(`${C.d}Agents: ${listAgents().join(', ')}${C.r}`);
      continue;
    }

    const { mode, workers, task, ralph } = resolveMode(input, 'chat');
    if (mode !== 'chat') {
      log(`${C.d}(executing in ${ralph ? 'ralph' : mode} mode)${C.r}`);
    }

    if (mode === 'autopilot') {
      await autopilot({ task, onEvent: makeEventHandler(true), ralph });
    } else if (mode === 'team') {
      await teamMode({ task, workers, onEvent: makeEventHandler(false) });
    } else {
      const result = await chatMode({ task, context, onEvent: makeEventHandler(true) });
      if (result.result) {
        context.push({ role: 'user', content: task });
        context.push({ role: 'assistant', content: result.result });
        if (context.length > 12) context.splice(0, 2);
      }
    }
    log(''); // blank line between turns
  }

  rl.close();
  log(`${C.d}Session: ${sessionId}${C.r}`);
}

async function cmdSetup() {
  log(banner());
  log(`${C.cyan}oh-my-deepseek Setup Wizard${C.r}`);
  log(`${C.d}Choose how you want to use OMD. Let's check your environment first.${C.r}\n`);

  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const ask = (q) => new Promise(resolve => rl.question(q, a => resolve(a.trim())));

  // ─── Step 1: Environment detection ───────────────────────
  log(`${C.b}Environment Detection${C.r}`);
  const env = detectEnvironment();
  printEnvSummary(env);

  // ─── Step 2: Mode selection ──────────────────────────────
  log(`\n${C.b}How do you want to use OMD?${C.r}\n`);
  log(`  ${C.cyan}1${C.r}  Via MCP with Claude Code / Codex / Cursor`);
  log(`     ${C.d}OMD runs as a tool provider behind your coding agent.${C.r}`);
  log(`     ${C.d}Best for daily coding — your agent calls OMD for DeepSeek tasks.${C.r}\n`);
  log(`  ${C.cyan}2${C.r}  Standalone CLI mode`);
  log(`     ${C.d}Use omd run / omd chat directly from terminal.${C.r}`);
  log(`     ${C.d}No coding agent needed — just an API key.${C.r}\n`);
  log(`  ${C.cyan}3${C.r}  Manual MCP configuration`);
  log(`     ${C.d}Show the JSON config to add OMD to any MCP client.${C.r}\n`);

  const choice = (await ask(`${C.green}Enter choice (1-3) [default: 1]: ${C.r}`)) || '1';

  log(''); // spacer

  if (choice === '1') {
    await setupMcpWithAgent(env, rl, ask);
  } else if (choice === '2') {
    await setupStandalone(env, rl, ask);
  } else if (choice === '3') {
    await setupManualMcp(env, rl, ask);
  } else {
    log(`${C.red}Invalid choice.${C.r}`);
  }

  rl.close();

  // ─── Final summary ─────────────────────────────────────────
  log(`\n${C.green}${C.b}✓ Setup complete!${C.r}`);
  log(`  ${C.d}Run ${C.r}omd doctor${C.d} to verify connectivity.${C.r}`);
  log(`  ${C.d}Run ${C.r}omd chat${C.d} to start interactive mode.${C.r}`);
  log(`  ${C.d}Run ${C.r}omd run "task"${C.d} for one-shot execution.${C.r}`);
}

// ─── Mode 1: MCP with coding agent ───────────────────────────

async function setupMcpWithAgent(env, rl, ask) {
  log(`${C.b}MCP Mode — Configure OMD as a tool provider${C.r}\n`);

  // Detect installed coding agents
  const agents = Object.entries(env.agents).filter(([, info]) => info.installed);

  if (agents.length > 0) {
    log(`${C.green}Detected coding agents:${C.r}`);
    for (const [name, info] of agents) {
      const providerLabel = info.provider === 'deepseek'
        ? `${C.green}DeepSeek${C.r}`
        : info.provider
          ? `${C.yellow}${info.provider}${C.r}`
          : `${C.yellow}unknown provider${C.r}`;
      log(`  · ${C.d}${name}:${C.r} installed, API provider: ${providerLabel}`);

      // Warn if agent is not using DeepSeek
      if (info.installed && info.provider && info.provider !== 'deepseek') {
        log(`    ${C.yellow}⚠ This agent is configured for ${info.provider}, not DeepSeek.${C.r}`);
        log(`    ${C.d}  OMD requires DeepSeek. Check your agent's API provider settings.${C.r}`);
        const proceed = await ask(`    ${C.yellow}Proceed anyway? (Y/n): ${C.r}`);
        if (proceed?.toLowerCase() === 'n') {
          log(`    ${C.d}Skipping ${name}.${C.r}`);
          continue;
        }
      }
    }
  } else {
    log(`${C.yellow}No coding agent detected.${C.r}`);
    log(`  ${C.d}I can still configure OMD as an MCP server.${C.r}`);
    log(`  ${C.d}Supported: Claude Code, Codex CLI, Cursor, any MCP client.${C.r}\n`);
  }

  // API key check
  await ensureApiKey(env, rl, ask);

  // Configure for detected agents
  if (env.agents['claude-code']?.installed) {
    log('');
    await configureClaudeCodeMcp(rl, ask);
  }

  if (env.agents['codex']?.installed) {
    log(`\n  ${C.cyan}Codex CLI${C.r} — add OMD to your ~/.codex/config.json:`);
    printMcpJson('codex');
  }

  if (env.agents['cursor']?.installed) {
    log(`\n  ${C.cyan}Cursor${C.r} — add OMD to your .cursor/mcp.json:`);
    printMcpJson('cursor');
  }

  // If no agents detected, show generic config
  if (agents.length === 0) {
    log(`\n  ${C.cyan}Generic MCP config${C.r} — add to your client's MCP config:`);
    printMcpJson('generic');
  }

  log(`\n${C.green}✓ MCP mode configured. Restart your coding agent to activate.${C.r}`);
}

// ─── Mode 2: Standalone CLI ──────────────────────────────────

async function setupStandalone(env, rl, ask) {
  log(`${C.b}Standalone Mode — Use OMD directly from terminal${C.r}\n`);

  // Create .omd/ structure
  ensureOmdDir('sessions');
  ensureOmdDir('memory');
  ensureOmdDir('logs');
  log(`${C.green}✓ Created .omd/ directory structure${C.r}`);

  // API key
  await ensureApiKey(env, rl, ask);

  // Save config
  saveProjectConfig(loadConfig());
  log(`${C.green}✓ Config saved to .omd/config.json${C.r}`);

  // Verify API connectivity
  log(`\n${C.yellow}Verifying DeepSeek API connectivity...${C.r}`);
  try {
    const { chatCompletion } = await import('./client.js');
    await chatCompletion({
      messages: [{ role: 'user', content: 'ping' }],
      maxTokens: 10,
      temperature: 0,
    });
    log(`${C.green}✓ DeepSeek API connected successfully${C.r}`);
  } catch (e) {
    log(`${C.red}✗ DeepSeek API: ${e.message}${C.r}`);
    log(`  ${C.d}Check your API key and base URL (.omd/config.json or OMD_BASE_URL).${C.r}`);
  }

  log(`\n${C.green}✓ Standalone mode ready!${C.r}`);
  log(`  ${C.d}Try it: ${C.r}omd run "hello world"${C.d} or ${C.r}omd chat${C.d}.${C.r}`);
}

// ─── Mode 3: Manual MCP config ───────────────────────────────

async function setupManualMcp(env, rl, ask) {
  log(`${C.b}Manual MCP Configuration${C.r}\n`);

  // Ensure API key is available
  await ensureApiKey(env, rl, ask);

  // Ask which client
  log(`Which client are you configuring?\n`);
  log(`  ${C.cyan}1${C.r}  Claude Code (auto-configure)`);
  log(`  ${C.cyan}2${C.r}  Cursor`);
  log(`  ${C.cyan}3${C.r}  Codex CLI`);
  log(`  ${C.cyan}4${C.r}  Show all / Other\n`);

  const clientChoice = (await ask(`${C.green}Enter choice (1-4) [default: 4]: ${C.r}`)) || '4';

  if (clientChoice === '1') {
    await configureClaudeCodeMcp(rl, ask);
  } else if (clientChoice === '2') {
    log(`\n  ${C.cyan}Cursor${C.r} — add to .cursor/mcp.json:`);
    printMcpJson('cursor');
  } else if (clientChoice === '3') {
    log(`\n  ${C.cyan}Codex CLI${C.r} — add to ~/.codex/config.json:`);
    printMcpJson('codex');
  } else {
    log(`\n  ${C.cyan}Claude Code${C.r} (edit ~/.claude/claude.json):`);
    printMcpJson('claude-code');
    log(`\n  ${C.cyan}Codex CLI${C.r} (edit ~/.codex/config.json):`);
    printMcpJson('codex');
    log(`\n  ${C.cyan}Cursor${C.r} (edit .cursor/mcp.json):`);
    printMcpJson('cursor');
  }

  log(`\n${C.green}✓ Manual config displayed. Copy the JSON to your client's config file.${C.r}`);
}

// ─── Shared helpers ─────────────────────────────────────────

function printEnvSummary(env) {
  // API keys
  const foundKeys = Object.entries(env.apiKeys).filter(([, info]) => info.found);
  if (foundKeys.length > 0) {
    const keyStr = foundKeys
      .map(([name, info]) => `${C.green}${name}${C.r} ${C.d}(${info.prefix})${C.r}`)
      .join(', ');
    log(`  ${C.d}API keys:${C.r} ${keyStr}`);
  } else {
    log(`  ${C.d}API keys:${C.r} ${C.yellow}none found${C.r}`);
  }

  // Coding agents
  for (const [name, info] of Object.entries(env.agents)) {
    if (!info.installed) continue;
    const providerStr = info.provider === 'deepseek'
      ? `${C.green}DeepSeek${C.r}`
      : info.provider
        ? `${C.yellow}${info.provider}${C.r}`
        : `${C.yellow}unknown${C.r}`;
    const mcpTag = name === 'claude-code' && env.omdMcpConfigured
      ? ` ${C.green}(OMD MCP registered)${C.r}`
      : '';
    log(`  ${C.d}${name}:${C.r} installed, API: ${providerStr}${mcpTag}`);
  }

  if (Object.values(env.agents).every(a => !a.installed)) {
    log(`  ${C.d}Coding agents:${C.r} ${C.yellow}none detected${C.r}`);
  }
}

async function ensureApiKey(env, rl, ask) {
  let apiKey = (() => { try { return getApiKey(); } catch { return null; } })();

  if (apiKey) {
    log(`${C.green}✓ API key found${C.r} ${C.d}(${apiKey.substring(0, 10)}...)${C.r}`);
    return apiKey;
  }

  log(`${C.yellow}⚠ No DeepSeek API key found.${C.r}`);
  log(`  ${C.d}Get your key from https://platform.deepseek.com${C.r}`);
  const key = await ask(`\n${C.green}Enter your DeepSeek API key (sk-...): ${C.r}`);

  if (!key || !key.startsWith('sk-')) {
    log(`  ${C.yellow}No valid key entered. You can set it later with:${C.r}`);
    log(`  ${C.d}export OMD_API_KEY=sk-your-key-here${C.r}`);
    return null;
  }

  // Set for this session
  process.env.OMD_API_KEY = key;

  // Offer to save to shell profile
  const profilePath = join(homedir(), env.shellProfile);
  const saveProfile = await ask(`${C.green}Save to ${env.shellProfile}? (Y/n): ${C.r}`);
  if (saveProfile?.toLowerCase() !== 'n') {
    // Check if already has OMD_API_KEY in profile
    try {
      const profileContent = existsSync(profilePath) ? readFileSync(profilePath, 'utf-8') : '';
      if (profileContent.includes('OMD_API_KEY=')) {
        log(`  ${C.yellow}⚠ OMD_API_KEY already set in ${env.shellProfile} — not duplicating.${C.r}`);
        log(`  ${C.d}  Update it manually if needed.${C.r}`);
      } else {
        appendFileSync(profilePath, `\n# oh-my-deepseek\nexport OMD_API_KEY=${key}\n`);
        log(`${C.green}✓ Saved to ${env.shellProfile}${C.r}`);
        log(`  ${C.d}Run: source ${env.shellProfile} to apply.${C.r}`);
      }
    } catch (e) {
      log(`  ${C.red}✗ Could not write to ${env.shellProfile}: ${e.message}${C.r}`);
    }
  }

  return key;
}

async function configureClaudeCodeMcp(rl, ask) {
  const { checkClaudeCodeMcpConfig, setupClaudeCodeMcp } = await import('./config.js');

  const existing = checkClaudeCodeMcpConfig();
  if (existing.configured) {
    log(`  ${C.green}✓ OMD already registered in Claude Code${C.r}`);
    log(`  ${C.d}  Config: ${existing.configPath}${C.r}`);
    const overwrite = await ask(`  ${C.yellow}Overwrite? (y/N): ${C.r}`);
    if (overwrite?.toLowerCase() !== 'y') {
      log(`  ${C.d}Skipping Claude Code config.${C.r}`);
      return;
    }
  }

  const result = setupClaudeCodeMcp();
  if (result.success) {
    log(`${C.green}✓${C.r} ${result.message.split('\n')[0]}`);
    log(`  ${C.d}Restart Claude Code to activate. Then use /mcp to see OMD's tools.${C.r}`);
  } else {
    log(`${C.red}✗ ${result.message}${C.r}`);
  }
}

function getMcpEntry() {
  const omdPath = new URL('index.js', import.meta.url).pathname;
  const entry = { command: 'node', args: [omdPath, 'mcp'] };
  const apiKey = (() => { try { return getApiKey(); } catch { return null; } })();
  if (apiKey) entry.env = { OMD_API_KEY: apiKey };
  return entry;
}

function printMcpJson(client) {
  const entry = getMcpEntry();
  const json = JSON.stringify({ mcpServers: { omd: entry } }, null, 2);
  const lines = json.split('\n');

  if (client === 'codex') {
    log(`  ${C.d}${lines.slice(0, -1).join('\n  ')}${C.r}`);
    log(`  ${C.d}  }${C.r}`);
    log(`  ${C.d}}${C.r}`);
  } else {
    log(`  ${C.d}${lines.join('\n  ')}${C.r}`);
  }
}
async function cmdSetupMcp() {
  log(banner());
  log(`${C.cyan}Setting up MCP server for Claude Code...${C.r}
`);

  const { setupClaudeCodeMcp, checkClaudeCodeMcpConfig } = await import('./config.js');
  
  // Check if already configured
  const existing = checkClaudeCodeMcpConfig();
  if (existing.configured) {
    log(`${C.yellow}⚠ OMD is already registered in Claude Code.${C.r}`);
    log(`  Config: ${C.d}${existing.configPath}${C.r}
`);
    log(`${C.d}Run again to overwrite.${C.r}`);
    return;
  }

  const result = setupClaudeCodeMcp();
  if (result.success) {
    log(`${C.green}✓${C.r} ${result.message.split('\n')[0]}`);
    log(`  ${C.d}${result.message.split('\n')[1]}${C.r}`);
    log(`  ${C.d}${result.message.split('\n')[2]}${C.r}`);
    log(`\n${C.d}Restart Claude Code to activate.${C.r}`);
    log(`${C.d}Then use /mcp to see OMD's tools.${C.r}`);
  } else {
    log(`${C.red}✗ ${result.message}${C.r}`);
  }
}




async function cmdDoctor() {
  log(banner());
  log(`${C.cyan}Environment check...${C.r}\n`);

  const checks = [];

  // Node version
  const nodeVersion = process.version;
  const nodeOk = parseInt(nodeVersion.slice(1)) >= 18;
  checks.push([`Node.js ${nodeVersion}`, nodeOk]);

  // API key
  const apiKey = (() => { try { return getApiKey(); } catch (e) { return null; } })();
  checks.push(['API key', !!apiKey, apiKey ? `${apiKey.substring(0, 8)}...` : 'not set']);

  // .omd directory
  const omdExists = existsSync(`${process.cwd()}/.omd`);
  checks.push(['.omd/ directory', omdExists]);

  // Claude Code MCP integration
  const { checkClaudeCodeMcpConfig } = await import('./config.js');
  const mcpStatus = checkClaudeCodeMcpConfig();
  checks.push(['Claude Code MCP', mcpStatus.configured, mcpStatus.configured ? 'OMD registered' : 'not configured']);

  // Config
  try {
    const config = loadConfig();
    checks.push(['Config loaded', true, `model: ${config.model}`]);
  } catch (e) {
    checks.push(['Config loaded', false, e.message]);
  }

  // DeepSeek API connectivity
  try {
    const { chatCompletion } = await import('./client.js');
    const resp = await chatCompletion({
      messages: [{ role: 'user', content: 'ping' }],
      maxTokens: 10,
      temperature: 0,
    });
    checks.push(['DeepSeek API', true, 'connected']);
  } catch (e) {
    checks.push(['DeepSeek API', false, e.message]);
  }

  // Print results
  for (const [name, ok, detail] of checks) {
    const icon = ok ? `${C.green}✓${C.r}` : `${C.red}✗${C.r}`;
    log(`  ${icon} ${name}${detail ? ` ${C.d}— ${detail}${C.r}` : ''}`);
  }
}

function cmdSessions() {
  const sessions = listRecentSessions(20);
  if (sessions.length === 0) {
    log(`${C.d}No sessions found.${C.r}`);
    return;
  }
  log(`${C.cyan}Recent sessions:${C.r}\n`);
  for (const s of sessions) {
    const date = new Date(s.createdAt).toLocaleString();
    const task = (s.task || 'chat').substring(0, 70);
    const statusIcon = s.status === 'completed' ? `${C.green}✓${C.r}` : `${C.yellow}…${C.r}`;
    log(`  ${statusIcon} ${C.d}${s.id.substring(0, 12)}${C.r}  ${date}  ${task}`);
  }
}

function banner() {
  // ▀ "DEEPSEEK" pixel text (left) overlaid on full whale pixel art
  // Whale loaded from banner-pixels.txt, DEEPSEEK rendered in bright blue on top.

  const R = '\x1b[0m';

  // 256-color palette indices
  const COL = {
    '.': 0,       // background = black
    '1': 236,     // darkest gray
    '2': 60,      // dark blue-gray
    '3': 25,      // medium blue
    '4': 27,      // bright blue
    '5': 45,      // lightest blue (cyan-ish)
    'w': 109,     // belly shadow (gray-blue)
    'W': 188,     // belly (light gray)
    'e': 15,      // eye = white
  };

  const W = 64, H = 30;
  const g = Array.from({length: H}, () => Array(W).fill('.'));

  // ─── Load whale pixel art from banner-pixels.txt ──────────
  try {
    const bp = readFileSync(
      new URL('./banner-pixels.txt', import.meta.url), 'utf-8'
    ).split('\n').filter(l => l.trim());
    for (let y = 0; y < Math.min(bp.length, H); y++) {
      const line = bp[y];
      for (let x = 0; x < Math.min(line.length, W); x++) {
        if (line[x] !== '.') g[y][x] = line[x];
      }
    }
  } catch { /* use blank grid */ }

  // ─── Clear DEEPSEEK text area and draw text ──────────────
  // Pixel font: 4 wide x 6 tall, drawn in bright blue ('5')
  const font = {
    D: [[1,1,1,0],[1,0,0,1],[1,0,0,1],[1,0,0,1],[1,0,0,1],[1,1,1,0]],
    E: [[1,1,1,1],[1,0,0,0],[1,1,1,0],[1,0,0,0],[1,0,0,0],[1,1,1,1]],
    P: [[1,1,1,1],[1,0,0,1],[1,0,0,1],[1,1,1,1],[1,0,0,0],[1,0,0,0]],
    S: [[0,1,1,1],[1,0,0,0],[0,1,1,0],[0,0,0,1],[0,0,0,1],[1,1,1,0]],
    K: [[1,0,0,1],[1,0,1,0],[1,1,0,0],[1,0,1,0],[1,0,1,0],[1,0,0,1]],
  };
  let cx = 2;
  const cy = 12;
  for (const ch of 'DEEPSEEK') {
    const px = font[ch];
    for (let r = 0; r < 6; r++)
      for (let c = 0; c < 4; c++)
        if (px[r][c]) g[cy + r][cx + c] = '5';
    cx += 5;
  }

  // ─── Render half-block \u2580 lines with 256-color ANSI ──────
  const out = [];
  for (let r = 0; r < H - 1; r += 2) {
    let line = '';
    for (let c = 0; c < W; c++) {
      const top = COL[g[r][c]] !== undefined ? COL[g[r][c]] : COL['.'];
      const bot = COL[g[r + 1][c]] !== undefined ? COL[g[r + 1][c]] : COL['.'];
      line += '\x1b[38;5;' + top + 'm\x1b[48;5;' + bot + 'm\u2580';
    }
    out.push(line + R);
  }

  const DM = '\x1b[2m';
  const tagline = `${DM}oh-my-deepseek v${pkg.version}  \u00b7  DeepSeek-powered coding agent framework${R}`;
  return out.join('\n') + '\n' + tagline;
}



// ─── Main CLI router ─────────────────────────────────────────

async function main() {
  // Graceful shutdown on SIGINT / SIGTERM
  process.on('SIGINT', () => {
    log(`\n${C.yellow}⚠ Interrupted${C.r}`);
    process.exit(130);
  });
  process.on('SIGTERM', () => process.exit(143));

  const args = process.argv.slice(2);
  const command = args[0];
  const rest = args.slice(1).join(' ');

  switch (command) {
    case 'run':
      if (!rest) {
        log(`${C.red}Usage: omd run "task description"${C.r}`);
        process.exit(1);
      }
      await cmdRun(rest);
      break;

    case 'team': {
      const workers = parseInt(args[1], 10) || 3;
      const task = args.slice(2).join(' ');
      if (!task) {
        log(`${C.red}Usage: omd team <N> "task description"${C.r}`);
        process.exit(1);
      }
      log(`${C.cyan}▶ Team mode: ${workers} workers${C.r}`);
      const sessionId = createSession(task);
      const result = await teamMode({ task, workers, onEvent: makeEventHandler(true) });
      saveSession(sessionId, { ...result, status: 'completed' });
      log(`\n${C.d}Session: ${sessionId}${C.r}`);
      break;
    }

    case 'chat':
      await cmdChat();
      break;

    case 'mcp':
      // MCP protocol requires stdout to be pure JSON-RPC.
      // All human-readable messages go to stderr.
      process.stderr.write(`${C.d}Starting MCP server on stdio...${C.r}\n`);
      process.stderr.write(`${C.d}Clients can connect via: omd mcp${C.r}\n`);
      await startMcpServer();
      break;

    case 'setup':
      await cmdSetup();
      break;
    case 'setup-mcp':
      await cmdSetupMcp();
      break;

    case 'doctor':
      await cmdDoctor();
      break;

    case 'sessions':
    case 'history':
      if (args.includes('--json') || args.includes('-j')) {
        const sessions = listRecentSessions(200);
        log(JSON.stringify(sessions, null, 2));
      } else {
        cmdSessions();
      }
      break;

    case 'agents':
      log(`${C.d}Available agents: ${listAgents().join(', ')}${C.r}`);
      break;

    case '--version':
    case '-v':
      log(`omd v${pkg.version}`);
      break;

    case '--help':
    case '-h':
    default:
      log(banner());
      log(`${C.b}Usage:${C.r}  omd <command> [options]\n`);
      log(`  ${C.cyan}run${C.r} "task"       Run a task (autopilot by default)`);
      log(`  ${C.cyan}team${C.r} <N> "task"  Run with N parallel workers`);
      log(`  ${C.cyan}chat${C.r}             Start interactive chat mode`);
      log(`  ${C.cyan}mcp${C.r}              Start MCP server (for Claude Code / Codex / Cursor)`);
      
      log(`  ${C.cyan}setup${C.r}            Interactive setup wizard (mode selection)`);
      log(`  ${C.cyan}setup-mcp${C.r}        Quick MCP registration for Claude Code (no prompts)`);
      log(`  ${C.cyan}doctor${C.r}           Check environment and API connectivity`);
      log(`  ${C.cyan}sessions${C.r}         List recent sessions`);
      log(`  ${C.cyan}agents${C.r}           List available agents\n`);
      log(`${C.b}Magic keywords${C.r} (use in chat or run):`);
      log(`  $autopilot "task"   Full autonomous execution`);
      log(`  $team <N> "task"    Parallel team of N workers`);
      log(`  $ralph "task"       Persistent verify-fix loop\n`);
      log(`${C.b}Config:${C.r}  .omd/config.json  |  OMD_API_KEY  |  OMD_MODEL`);
      break;
  }
}

main().catch(err => {
  log(`${C.red}Fatal: ${err.message}${C.r}`);
  process.exit(1);
});

