#!/usr/bin/env node
/**
 * MCP client tester — sends JSON-RPC requests to OMD's MCP server and prints responses.
 *
 * Usage:
 *   node test/mcp-test.js                          # Protocol test only (no API key needed)
 *   node test/mcp-test.js --live "查找所有TODO"     # Full test with real API call (needs API key)
 */
import { spawn } from 'node:child_process';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const serverPath = resolve(__dirname, '..', 'src', 'index.js');

const C = { r: '\x1b[0m', b: '\x1b[1m', g: '\x1b[32m', y: '\x1b[33m', c: '\x1b[36m', d: '\x1b[2m' };

function log(...args) { process.stdout.write(args.join(' ') + '\n'); }

/**
 * Start the MCP server as a subprocess and return a client handle.
 */
function startServer() {
  const proc = spawn('node', [serverPath, 'mcp'], {
    stdio: ['pipe', 'pipe', 'pipe'],
    env: { ...process.env },
  });

  // Forward server stderr for visibility
  proc.stderr.on('data', (data) => {
    process.stderr.write(`${C.d}[server] ${data}${C.r}`);
  });

  let buffer = '';
  let resolver = null;

  proc.stdout.on('data', (data) => {
    buffer += data.toString();
    // Try to extract complete JSON-RPC messages (newline-delimited)
    const lines = buffer.split('\n');
    buffer = lines.pop(); // keep incomplete last line
    for (const line of lines) {
      if (line.trim() && resolver) {
        resolver(line.trim());
        resolver = null;
      }
    }
  });

  proc.on('close', (code) => {
    log(`${C.y}Server exited with code ${code}${C.r}`);
  });

  return {
    /**
     * Send a JSON-RPC request and wait for the response.
     */
    async send(method, params = {}) {
      const id = Math.floor(Math.random() * 10000);
      const request = JSON.stringify({ jsonrpc: '2.0', method, params, id });
      log(`${C.c}→ ${method}${params && Object.keys(params).length > 0 ? ' ' + JSON.stringify(params).substring(0, 60) : ''}${C.r}`);
      proc.stdin.write(request + '\n');

      // Wait for response
      const response = await new Promise((resolve, reject) => {
        resolver = resolve;
        setTimeout(() => reject(new Error('Timeout waiting for response')), 15000);
      });

      try {
        const parsed = JSON.parse(response);
        if (parsed.error) {
          log(`${C.y}← ERROR: ${parsed.error.message}${C.r}`);
        } else {
          const resultStr = JSON.stringify(parsed.result).substring(0, 300);
          log(`${C.g}← ${resultStr}${resultStr.length >= 300 ? '...' : ''}${C.r}`);
        }
        return parsed;
      } catch (e) {
        log(`${C.y}← (raw) ${response.substring(0, 200)}${C.r}`);
        return response;
      }
    },

    close() {
      proc.kill();
    },
  };
}

// ─── Test cases ─────────────────────────────────────────────

async function runProtocolTest() {
  log(`\n${C.b}═══ MCP Protocol Test ═══${C.r}\n`);

  const client = startServer();
  await new Promise(r => setTimeout(r, 300)); // wait for server startup

  // Test 1: Initialize
  log(`${C.b}[1/4] Initialize${C.r}`);
  const initResult = await client.send('initialize', {
    protocolVersion: '2024-11-05',
    capabilities: {},
  });
  const passed1 = initResult?.result?.serverInfo?.name === 'oh-my-deepseek';
  log(passed1 ? `${C.g}✓ PASS${C.r}` : `${C.y}✗ FAIL${C.r}`);

  // Test 2: tools/list
  log(`\n${C.b}[2/4] List tools${C.r}`);
  const toolsResult = await client.send('tools/list');
  const toolCount = toolsResult?.result?.tools?.length || 0;
  log(`  Found ${toolCount} tools`);
  if (toolsResult?.result?.tools) {
    for (const t of toolsResult.result.tools) {
      log(`    ${C.d}• ${t.name}${C.r}`);
    }
  }
  const passed2 = toolCount === 7;
  log(passed2 ? `${C.g}✓ PASS${C.r}` : `${C.y}✗ FAIL (expected 7, got ${toolCount})${C.r}`);

  // Test 3: omd_sessions (no API key needed)
  log(`\n${C.b}[3/4] Call omd_sessions${C.r}`);
  const sessionsResult = await client.send('tools/call', {
    name: 'omd_sessions',
    arguments: { limit: 3 },
  });
  const passed3 = sessionsResult?.result?.content?.[0]?.type === 'text';
  log(passed3 ? `${C.g}✓ PASS${C.r}` : `${C.y}✗ FAIL${C.r}`);

  // Test 4: omd_memory (no API key needed)
  log(`\n${C.b}[4/4] Call omd_memory${C.r}`);
  const memoryResult = await client.send('tools/call', {
    name: 'omd_memory',
    arguments: {},
  });
  const passed4 = memoryResult?.result?.content?.[0]?.type === 'text';
  log(passed4 ? `${C.g}✓ PASS${C.r}` : `${C.y}✗ FAIL${C.r}`);

  client.close();

  // Summary
  const passed = [passed1, passed2, passed3, passed4].filter(Boolean).length;
  log(`\n${C.b}═══ Result: ${passed}/4 passed ═══${C.r}\n`);
}

async function runLiveTest(task) {
  log(`\n${C.b}═══ Live Test: "${task}" ═══${C.r}\n`);

  const apiKey = process.env.OMD_API_KEY || process.env.DEEPSEEK_API_KEY;
  if (!apiKey) {
    log(`${C.y}No API key found. Set OMD_API_KEY or DEEPSEEK_API_KEY.${C.r}`);
    log(`  export OMD_API_KEY=sk-your-key`);
    return;
  }

  const client = startServer();
  await new Promise(r => setTimeout(r, 300));

  // Initialize
  await client.send('initialize', { protocolVersion: '2024-11-05', capabilities: {} });

  // Call omd_explore — read-only, fast
  log(`\n${C.b}Calling omd_explore...${C.r}`);
  const result = await client.send('tools/call', {
    name: 'omd_explore',
    arguments: { question: task },
  });

  log(`\n${C.b}Response:${C.r}`);
  if (result?.result?.content?.[0]?.text) {
    log(result.result.content[0].text);
  }

  client.close();
}

// ─── Main ───────────────────────────────────────────────────

const args = process.argv.slice(2);
const liveIndex = args.indexOf('--live');

if (liveIndex !== -1) {
  const task = args[liveIndex + 1] || 'Find all JavaScript files in this project';
  await runLiveTest(task);
} else {
  await runProtocolTest();
}
