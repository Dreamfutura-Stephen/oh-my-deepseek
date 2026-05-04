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
import { loadConfig, getApiKey, ensureOmdDir, saveProjectConfig } from './config.js';
import { autopilot, teamMode, chatMode, resolveMode } from './orchestrator.js';
import { createSession, saveMessages, saveSession, listRecentSessions } from './state.js';
import { listAgents } from './agent.js';
import { startMcpServer } from './mcp.js';
import { existsSync, readFileSync } from 'node:fs';
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

function cmdSetup() {
  log(banner());
  log(`${C.cyan}Setting up oh-my-deepseek...${C.r}\n`);

  // Create .omd/ structure
  ensureOmdDir('sessions');
  ensureOmdDir('memory');
  ensureOmdDir('logs');
  log(`${C.green}✓ Created .omd/ directory structure${C.r}`);

  // Check API key
  try {
    const apiKey = getApiKey();
    if (!apiKey) {
      log(`${C.yellow}⚠ No API key found.${C.r}`);
      log(`  Export OMD_API_KEY or DEEPSEEK_API_KEY:`);
      log(`  ${C.d}export OMD_API_KEY=sk-your-key-here${C.r}`);
    } else {
      log(`${C.green}✓ API key found (${apiKey.substring(0, 8)}...)${C.r}`);
    }
  } catch (e) {
    log(`${C.red}✗ ${e.message}${C.r}`);
  }

  // Save default project config
  saveProjectConfig(loadConfig());
  log(`${C.green}✓ Config saved to .omd/config.json${C.r}`);

  log(`\n${C.d}Setup complete. Run 'omd chat' to start interactive mode.${C.r}`);
  log(`${C.d}Or 'omd run "your task"' for one-shot autonomous execution.${C.r}`);
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
  // ▀ half-block pixel whale + standard ANSI blue, works in any ANSI terminal
  // Unified silhouette with upward-sweeping tail

  const R = '\x1b[0m';

  // Standard ANSI colors (8-color, universally supported)
  // Using bright variants where available
  const C = {
    // foreground; background pairs (as funcs)
    bg: (top, bot) => `\x1b[38;5;${top}m\x1b[48;5;${bot}m▀`,
  };

  // 256-color palette indices for blue tones (widely supported)
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
  function set(x, y, ch) {
    if (x >= 0 && x < W && y >= 0 && y < H) g[y][x] = ch;
  }

  // ─── "DEEPSEEK" pixel text (left) + whale (right) ──────────
  // Pixel font: 4 wide × 6 tall bitmap, drawn in bright blue ('5')
  const font = {
    D: [[0,1,1,0],[1,0,0,1],[1,0,0,1],[1,0,0,1],[1,0,0,1],[0,1,1,0]],
    E: [[1,1,1,1],[1,0,0,0],[1,1,1,0],[1,0,0,0],[1,0,0,0],[1,1,1,1]],
    P: [[1,1,1,1],[1,0,0,1],[1,0,0,1],[1,1,1,1],[1,0,0,0],[1,0,0,0]],
    S: [[0,1,1,1],[1,0,0,0],[0,1,1,0],[0,0,0,1],[0,0,0,1],[1,1,1,0]],
    K: [[1,0,0,1],[1,0,1,0],[1,1,0,0],[1,0,1,0],[1,0,1,0],[1,0,0,1]],
  };
  const chars = 'DEEPSEEK';
  let cx = 2; // left padding
  const cy = 12; // vertically center 6 rows in 30
  for (const ch of chars) {
    const px = font[ch];
    for (let r = 0; r < 6; r++)
      for (let c = 0; c < 4; c++)
        if (px[r][c]) set(cx + c, cy + r, '5');
    cx += 5; // 4 wide + 1 gap
  }

  // ─── Right-side whale (columns 42-63) ──────────────────────────
  function smoothstep(t) { return t * t * (3 - 2 * t); }
  function interpolate(pts, x) {
    if (x <= pts[0][0]) return pts[0][1];
    if (x >= pts[pts.length - 1][0]) return pts[pts.length - 1][1];
    for (let i = 0; i < pts.length - 1; i++) {
      if (x >= pts[i][0] && x <= pts[i + 1][0]) {
        const t = (x - pts[i][0]) / (pts[i + 1][0] - pts[i][0]);
        return Math.round(pts[i][1] + (pts[i + 1][1] - pts[i][1]) * smoothstep(t));
      }
    }
    return pts[pts.length - 1][1];
  }

  // Whale body: head at left (col 42), tail sweeping up at right (col 63)
  const topPts = [[42,11],[44,9],[46,8],[48,8],[50,8],[52,9],[54,11],[56,13],[58,14],[60,15],[62,15],[63,14]];
  const botPts = [[42,19],[44,21],[47,22],[50,23],[53,22],[56,20],[58,18],[60,17],[62,16],[63,15]];

  for (let x = 42; x < W; x++) {
    const t = interpolate(topPts, x);
    const b = interpolate(botPts, x);
    if (t >= b) continue;
    for (let y = t; y <= b; y++) set(x, y, '3');
  }

  // ─── 3D shading gradient ──────────────────────────────────
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (g[y][x] === '.') continue;
      if (x >= 42) {
        // Whale shading
        const dx = (x - 50) / 10, dy = (y - 15) / 8;
        const d = Math.hypot(dx, dy);
        if (d < 0.25)       g[y][x] = '5';
        else if (d < 0.45)  g[y][x] = '4';
        else if (d < 0.65)  g[y][x] = '3';
        else                g[y][x] = '2';
      }
    }
  }

  // ─── Whale belly ─────────────────────────────────────────
  for (let x = 42; x < W; x++) {
    let topY = -1, botY = -1;
    for (let sy = 0; sy < H; sy++) { if (g[sy][x] !== '.') { topY = sy; break; } }
    for (let sy = H - 1; sy >= 0; sy--) { if (g[sy][x] !== '.') { botY = sy; break; } }
    if (topY < 0 || botY < 0) continue;
    const bellyY = topY + Math.round((botY - topY) * 0.68);
    for (let y = bellyY; y <= botY; y++) {
      if (g[y][x] === '.') continue;
      const rel = (y - bellyY) / (botY - bellyY);
      g[y][x] = rel < 0.40 ? 'W' : 'w';
    }
  }

  // ─── Whale eye (2x2) ────────────────────────────────────
  set(44, 12, 'e'); set(45, 12, 'e');
  set(44, 13, 'e'); set(45, 13, 'e');

  // ─── Top edge highlight on tail ──────────────────────────
  for (let x = 54; x < 62; x++) {
    for (let sy = 0; sy < H; sy++) {
      if (g[sy][x] !== '.') {
        for (let y = sy; y <= Math.min(H - 1, sy + 1); y++) {
          if (g[y][x] !== '.' && g[y][x] !== '2') g[y][x] = '5';
        }
        break;
      }
    }
  }

// ─── Render half-block ▀ lines with 256-color ANSI ────────
  const out = [];
  for (let r = 0; r < H - 1; r += 2) {
    let line = '';
    for (let c = 0; c < W; c++) {
      const top = COL[g[r][c]] !== undefined ? COL[g[r][c]] : COL['.'];
      const bot = COL[g[r + 1][c]] !== undefined ? COL[g[r + 1][c]] : COL['.'];
      line += `\x1b[38;5;${top}m\x1b[48;5;${bot}m▀`;
    }
    out.push(line + R);
  }

  const DM = '\x1b[2m';
  const tagline = `${DM}oh-my-deepseek v${pkg.version}  ·  DeepSeek-powered coding agent framework${R}`;
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
      cmdSetup();
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
      log(`  ${C.cyan}setup${C.r}            Initialize .omd/ and config`);
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
