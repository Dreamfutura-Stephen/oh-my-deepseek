/**
 * MCP (Model Context Protocol) Server — makes OMD callable by any MCP client.
 *
 * Protocol: JSON-RPC 2.0 over stdio
 * Clients: Claude Code, Codex CLI, Cursor, any MCP-compatible tool
 *
 * Exposed tools:
 *   omd_autopilot  — full autonomous execution pipeline
 *   omd_team       — parallel team of N workers
 *   omd_chat       — single-turn chat with intent routing
 *   omd_explore    — read-only codebase exploration
 *   omd_sessions   — list recent sessions
 *   omd_decisions  — read architecture decision log
 *   omd_memory     — search project memory
 */
import { createInterface } from 'node:readline';
import { createRequire } from 'node:module';
import { autopilot, teamMode, chatMode } from './orchestrator.js';
import { listAgents } from './agent.js';
import { listRecentSessions, readDecisions, readMemoryMd } from './state.js';
import { loadConfig, getApiKey } from './config.js';

const pkg = createRequire(import.meta.url)('../package.json');

// ─── JSON-RPC protocol ──────────────────────────────────────

let nextId = 0;

function jsonrpc(method, params, id = null) {
  return JSON.stringify({ jsonrpc: '2.0', method, params, id: id ?? ++nextId });
}

function jsonrpcResult(id, result) {
  return JSON.stringify({ jsonrpc: '2.0', result, id });
}

function jsonrpcError(id, code, message) {
  return JSON.stringify({ jsonrpc: '2.0', error: { code, message }, id });
}

// ─── Tool definitions ───────────────────────────────────────

const TOOLS = [
  {
    name: 'omd_autopilot',
    description:
      'Run a task through the full autonomous pipeline: explore codebase → architect designs plan → ' +
      'executor implements → reviewer adversarially checks. Returns the final result with review verdict. ' +
      'Use this for: implementing features, fixing bugs, refactoring, or any task that needs end-to-end execution.',
    inputSchema: {
      type: 'object',
      properties: {
        task: {
          type: 'string',
          description: 'The task description. Be specific about what to build, fix, or change.',
        },
      },
      required: ['task'],
    },
  },
  {
    name: 'omd_team',
    description:
      'Run a task with a team of N parallel workers. An architect breaks the task into independent ' +
      'sub-tasks, workers execute in parallel, and a reviewer checks the combined result. ' +
      'Use this for: large refactors, multi-file changes, or any task that can be parallelized.',
    inputSchema: {
      type: 'object',
      properties: {
        task: {
          type: 'string',
          description: 'The task description.',
        },
        workers: {
          type: 'number',
          description: 'Number of parallel workers. Default 3.',
        },
      },
      required: ['task'],
    },
  },
  {
    name: 'omd_chat',
    description:
      'Single-turn chat with a coding agent. The system automatically routes your question to ' +
      'the right specialist: executor for implementation, debugger for bugs, architect for design, ' +
      'explore for codebase questions, reviewer for code review. Use this for: quick questions, ' +
      'code explanations, finding things in the codebase.',
    inputSchema: {
      type: 'object',
      properties: {
        message: {
          type: 'string',
          description: 'Your question or task.',
        },
      },
      required: ['message'],
    },
  },
  {
    name: 'omd_explore',
    description:
      'Explore the codebase — search for files, read code, find patterns. Read-only, no files are modified. ' +
      'Use this for: understanding existing code, finding where something is defined, tracing dependencies.',
    inputSchema: {
      type: 'object',
      properties: {
        question: {
          type: 'string',
          description: 'What to find or understand in the codebase.',
        },
      },
      required: ['question'],
    },
  },
  {
    name: 'omd_sessions',
    description:
      'List recent OMD sessions with their status and task summaries.',
    inputSchema: {
      type: 'object',
      properties: {
        limit: {
          type: 'number',
          description: 'Number of sessions to return. Default 10.',
        },
      },
    },
  },
  {
    name: 'omd_decisions',
    description:
      'Read the Architecture Decision Record (ADR) log. Shows past design decisions, ' +
      'review verdicts, and their rationales. Use for: understanding why something was built a certain way.',
    inputSchema: {
      type: 'object',
      properties: {
        limit: {
          type: 'number',
          description: 'Number of decisions to return. Default 20.',
        },
      },
    },
  },
  {
    name: 'omd_memory',
    description:
      'Read the project memory (MEMORY.md). Contains accumulated knowledge about the codebase ' +
      'that persists across sessions — project structure, conventions, key decisions.',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
];

// ─── Request handlers ───────────────────────────────────────

async function handleInitialize(params) {
  return {
    protocolVersion: '2024-11-05',
    capabilities: {
      tools: {},
    },
    serverInfo: {
      name: 'oh-my-deepseek',
      version: pkg.version,
    },
  };
}

async function handleToolsList() {
  return { tools: TOOLS };
}

async function handleToolsCall(params) {
  const { name, arguments: args } = params;

  try {
    switch (name) {
      case 'omd_autopilot': {
        const result = await autopilot({
          task: args.task,
          onEvent: (evt) => {
            // Log events to stderr so they don't interfere with JSON-RPC on stdout
            if (evt.type === 'stage') {
              process.stderr.write(`[omd] ${evt.stage}: ${evt.message || ''}\n`);
            } else if (evt.type === 'complete') {
              process.stderr.write(`[omd] ${evt.message || 'Done.'}\n`);
            } else if (evt.type === 'gate_fail') {
              process.stderr.write(`[omd] ⚠ Gate ${evt.gate} failed: ${evt.reason}\n`);
            }
          },
        });
        const lastStage = result.stages?.[result.stages.length - 1];
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              approved: result.approved,
              iterations: result.iterations,
              gateFailures: result.gateFailures,
              stages: result.stages?.length || 0,
              summary: lastStage?.result?.substring(0, 500) || 'No output',
            }, null, 2),
          }],
        };
      }

      case 'omd_team': {
        const result = await teamMode({
          task: args.task,
          workers: args.workers || 3,
          onEvent: (evt) => {
            if (evt.type === 'stage') {
              process.stderr.write(`[omd] ${evt.stage}: ${evt.message || ''}\n`);
            }
          },
        });
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              subTasks: result.subTasks,
              plan: result.plan?.substring(0, 300),
              review: result.review?.substring(0, 500),
            }, null, 2),
          }],
        };
      }

      case 'omd_chat': {
        const result = await chatMode({
          task: args.message,
          onEvent: (evt) => {
            if (evt.type === 'text') {
              process.stderr.write(`[omd] ${(evt.content || '').substring(0, 200)}\n`);
            }
          },
        });
        return {
          content: [{
            type: 'text',
            text: result.result || '(no output)',
          }],
        };
      }

      case 'omd_explore': {
        const result = await chatMode({
          task: args.question,
          onEvent: () => {},
        });
        return {
          content: [{
            type: 'text',
            text: result.result || 'No results found.',
          }],
        };
      }

      case 'omd_sessions': {
        const sessions = listRecentSessions(args.limit || 10);
        return {
          content: [{
            type: 'text',
            text: sessions.length === 0
              ? 'No sessions found.'
              : sessions.map(s =>
                  `[${s.status}] ${s.id?.substring(0, 12)} — ${(s.task || 'chat').substring(0, 80)} (${s.createdAt})`
                ).join('\n'),
          }],
        };
      }

      case 'omd_decisions': {
        const decisions = readDecisions(args.limit || 20);
        return {
          content: [{
            type: 'text',
            text: decisions.length === 0
              ? 'No decisions recorded yet.'
              : decisions.join('\n\n'),
          }],
        };
      }

      case 'omd_memory': {
        const memory = readMemoryMd();
        return {
          content: [{
            type: 'text',
            text: memory || 'No project memory yet. It builds up as you use OMD.',
          }],
        };
      }

      default:
        return { content: [{ type: 'text', text: `Unknown tool: ${name}` }], isError: true };
    }
  } catch (error) {
    return {
      content: [{ type: 'text', text: `Error: ${error.message}` }],
      isError: true,
    };
  }
}

// ─── Main server loop ───────────────────────────────────────

/**
 * Start the MCP server on stdio. This is a blocking call.
 * Reads JSON-RPC requests from stdin, writes responses to stdout.
 */
export async function startMcpServer() {
  process.stdin.setEncoding('utf8');
  const rl = createInterface({ input: process.stdin });

  // Pre-flight check: warn if no API key configured
  try {
    const key = getApiKey();
    if (!key) {
      process.stderr.write('[omd] ⚠ No API key found. Set OMD_API_KEY or DEEPSEEK_API_KEY.\n');
      process.stderr.write('[omd] Tools that call DeepSeek will fail until a key is set.\n');
    }
  } catch (e) {
    process.stderr.write(`[omd] ⚠ ${e.message}\n`);
    process.stderr.write('[omd] Tools that call DeepSeek will fail until a valid key is set.\n');
  }

  process.stderr.write(`[omd] MCP server starting (oh-my-deepseek v${pkg.version})...\n`);
  process.stderr.write('[omd] Listening on stdin/stdout (JSON-RPC 2.0)\n');
  process.stderr.write('[omd] Connect from Claude Code: npx omd mcp\n');

  for await (const line of rl) {
    if (!line.trim()) continue;

    let request;
    try {
      request = JSON.parse(line);
    } catch {
      process.stderr.write(`[omd] Invalid JSON: ${line.substring(0, 100)}\n`);
      continue;
    }

    const { method, params, id } = request;

    try {
      // Handle notifications (no id)
      if (id === undefined || id === null) {
        if (method === 'notifications/initialized') {
          process.stderr.write('[omd] Client initialized. Ready for requests.\n');
        }
        continue;
      }

      let result;

      switch (method) {
        case 'initialize':
          result = await handleInitialize(params);
          break;
        case 'tools/list':
          result = await handleToolsList();
          break;
        case 'tools/call':
          result = await handleToolsCall(params);
          break;
        default:
          process.stdout.write(jsonrpcError(id, -32601, `Method not found: ${method}`) + '\n');
          continue;
      }

      process.stdout.write(jsonrpcResult(id, result) + '\n');
    } catch (error) {
      process.stderr.write(`[omd] Error handling ${method}: ${error.message}\n`);
      process.stdout.write(jsonrpcError(id, -32603, error.message) + '\n');
    }
  }

  process.stderr.write('[omd] MCP server stopped.\n');
}
