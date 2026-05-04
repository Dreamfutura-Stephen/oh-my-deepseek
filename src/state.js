/**
 * State persistence — saves and loads session state to .omd/ directory.
 *
 * Integrates patterns from:
 *  - OMC/OMX: session state + message history + project memory
 *  - autoapp-toolkit: MEMORY.md auto-maintenance + ADR decision log
 *
 * Directory layout:
 *   .omd/
 *   ├── config.json          # Project-level config
 *   ├── sessions/
 *   │   └── {sessionId}/
 *   │       ├── messages.json  # Full message history
 *   │       ├── summary.md     # Human-readable summary
 *   │       └── state.json     # Runtime state
 *   ├── memory/
 *   │   └── project.json       # Long-term project memory
 *   ├── decisions.md           # Architecture Decision Record (ADR)
 *   ├── state.yml              # Key runtime state for cross-session continuity
 *   └── logs/
 *       └── {date}.log         # Execution logs
 */
import {
  writeFileSync, readFileSync, existsSync, mkdirSync,
  appendFileSync, readdirSync, statSync,
} from 'node:fs';
import { join } from 'node:path';
import { ensureOmdDir } from './config.js';

/**
 * Generate a unique session ID.
 */
function generateSessionId() {
  const ts = Date.now().toString(36);
  const rand = Math.random().toString(36).substring(2, 8);
  return `${ts}-${rand}`;
}

/**
 * Save a session to .omd/sessions/{id}/
 */
export function saveSession(sessionId, data) {
  const dir = ensureOmdDir(`sessions/${sessionId}`);
  writeFileSync(join(dir, 'state.json'), JSON.stringify(data, null, 2), 'utf-8');
}

/**
 * Load a session from disk.
 */
export function loadSession(sessionId) {
  const path = join(process.cwd(), '.omd', 'sessions', sessionId, 'state.json');
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, 'utf-8'));
  } catch {
    return null;
  }
}

/**
 * Save message history for a session.
 */
export function saveMessages(sessionId, messages) {
  const dir = ensureOmdDir(`sessions/${sessionId}`);
  writeFileSync(join(dir, 'messages.json'), JSON.stringify(messages, null, 2), 'utf-8');
}

/**
 * Load message history.
 */
export function loadMessages(sessionId) {
  const path = join(process.cwd(), '.omd', 'sessions', sessionId, 'messages.json');
  if (!existsSync(path)) return [];
  try {
    return JSON.parse(readFileSync(path, 'utf-8'));
  } catch {
    return [];
  }
}

/**
 * Create a new session and return its ID.
 */
export function createSession(task) {
  const id = generateSessionId();
  saveSession(id, {
    id,
    task,
    createdAt: new Date().toISOString(),
    status: 'created',
  });
  return id;
}

/**
 * Save project-level memory entry.
 */
export function saveMemory(key, value) {
  const dir = ensureOmdDir('memory');
  const path = join(dir, 'project.json');
  let memory = {};
  if (existsSync(path)) {
    try { memory = JSON.parse(readFileSync(path, 'utf-8')); } catch { /* reset */ }
  }
  memory[key] = { value, updatedAt: new Date().toISOString() };
  writeFileSync(path, JSON.stringify(memory, null, 2), 'utf-8');
}

/**
 * Load project memory.
 */
export function loadMemory() {
  const path = join(process.cwd(), '.omd', 'memory', 'project.json');
  if (!existsSync(path)) return {};
  try { return JSON.parse(readFileSync(path, 'utf-8')); } catch { return {}; }
}

/**
 * Append to the execution log.
 */
export function logEvent(event) {
  const dir = ensureOmdDir('logs');
  const date = new Date().toISOString().split('T')[0];
  const line = JSON.stringify({ ts: new Date().toISOString(), ...event });
  appendFileSync(join(dir, `${date}.log`), line + '\n', 'utf-8');
}

/**
 * List recent sessions.
 */
export function listRecentSessions(limit = 10) {
  const dir = join(process.cwd(), '.omd', 'sessions');
  if (!existsSync(dir)) return [];
  try {
    return readdirSync(dir)
      .map(name => {
        const statePath = join(dir, name, 'state.json');
        if (!existsSync(statePath)) return null;
        try {
          const state = JSON.parse(readFileSync(statePath, 'utf-8'));
          return { id: name, ...state };
        } catch { return null; }
      })
      .filter(Boolean)
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
      .slice(0, limit);
  } catch { return []; }
}

// ─── autoapp-toolkit: ADR Decision Log ──────────────────────

/**
 * Append an architecture or review decision to .omd/decisions.md.
 * This builds an Architecture Decision Record (ADR) over time.
 */
export function appendDecision(agent, topic, summary) {
  const dir = ensureOmdDir();
  const path = join(dir, 'decisions.md');

  const entry = `\n## ${new Date().toISOString()}\n` +
    `**Agent:** ${agent}\n` +
    `**Topic:** ${topic}\n` +
    `**Summary:** ${summary}\n`;

  if (existsSync(path)) {
    appendFileSync(path, entry, 'utf-8');
  } else {
    writeFileSync(path, `# OMD Architecture Decisions\n${entry}`, 'utf-8');
  }
}

/**
 * Read recent decisions (last N entries).
 */
export function readDecisions(limit = 20) {
  const path = join(process.cwd(), '.omd', 'decisions.md');
  if (!existsSync(path)) return [];
  try {
    const content = readFileSync(path, 'utf-8');
    const entries = content.split('\n## ');
    return entries.slice(-limit).map(e => e.trim()).filter(Boolean);
  } catch { return []; }
}

// ─── autoapp-toolkit: MEMORY.md maintenance ─────────────────

/**
 * Update or create a MEMORY.md entry for cross-session continuity.
 * Each entry is a timestamped key-value block.
 *
 * @param {string} section - section name (e.g. 'project', 'preferences', 'decisions')
 * @param {string} content - the memory content
 */
export function updateMemoryMd(section, content) {
  const dir = ensureOmdDir();
  const path = join(dir, 'MEMORY.md');

  const entry = `\n### ${section} — ${new Date().toISOString()}\n${content}\n`;

  if (existsSync(path)) {
    const existing = readFileSync(path, 'utf-8');
    // Replace existing section or append
    const sectionMarker = `### ${section} `;
    const idx = existing.indexOf(sectionMarker);
    if (idx !== -1) {
      // Find end of this section (next ### or end of file)
      const nextIdx = existing.indexOf('\n### ', idx + sectionMarker.length);
      const before = existing.substring(0, idx);
      const after = nextIdx !== -1 ? existing.substring(nextIdx) : '';
      writeFileSync(path, before + entry + after, 'utf-8');
    } else {
      appendFileSync(path, entry, 'utf-8');
    }
  } else {
    writeFileSync(path, `# OMD Memory\n\n> Auto-maintained by oh-my-deepseek. Survives session restarts.\n${entry}`, 'utf-8');
  }
}

/**
 * Read all MEMORY.md content.
 */
export function readMemoryMd() {
  const path = join(process.cwd(), '.omd', 'MEMORY.md');
  if (!existsSync(path)) return '';
  try { return readFileSync(path, 'utf-8'); } catch { return ''; }
}

// ─── Runtime state.yml (autoapp-toolkit cross-session state) ─

/**
 * Save key runtime state to .omd/state.yml for cross-session continuity.
 * Simple YAML-like format (key: value pairs).
 */
export function saveRuntimeState(updates) {
  const dir = ensureOmdDir();
  const path = join(dir, 'state.yml');

  let current = {};
  if (existsSync(path)) {
    try {
      const lines = readFileSync(path, 'utf-8').split('\n');
      for (const line of lines) {
        const colonIdx = line.indexOf(':');
        if (colonIdx !== -1) {
          current[line.substring(0, colonIdx).trim()] = line.substring(colonIdx + 1).trim();
        }
      }
    } catch { /* reset */ }
  }

  Object.assign(current, updates);
  const yaml = Object.entries(current)
    .map(([k, v]) => `${k}: ${v}`)
    .join('\n');
  writeFileSync(path, yaml, 'utf-8');
}

/**
 * Load runtime state from .omd/state.yml.
 */
export function loadRuntimeState() {
  const path = join(process.cwd(), '.omd', 'state.yml');
  if (!existsSync(path)) return {};
  try {
    const state = {};
    const lines = readFileSync(path, 'utf-8').split('\n');
    for (const line of lines) {
      const colonIdx = line.indexOf(':');
      if (colonIdx !== -1) {
        state[line.substring(0, colonIdx).trim()] = line.substring(colonIdx + 1).trim();
      }
    }
    return state;
  } catch { return {}; }
}
