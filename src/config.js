/**
 * Configuration management for oh-my-deepseek.
 * Priority: env vars > project .omd/config.json > user ~/.omd/config.json > defaults
 */
import { readFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, dirname } from 'node:path';

const DEFAULTS = {
  model: 'deepseek-v4-flash',
  reasonerModel: 'deepseek-v4-pro',
  maxTokens: 8192,
  temperature: 0.7,
  baseUrl: 'https://api.deepseek.com',
  // Orchestration
  defaultMode: 'autopilot',
  maxAgentRetries: 3,
  maxParallelAgents: 4,
  // Tools
  allowedTools: ['bash', 'read', 'write', 'edit', 'glob', 'grep'],
  sandboxRoot: process.cwd(),
};

/**
 * Deep-merge two objects. Arrays are replaced, not merged.
 */
function deepMerge(base, override) {
  const result = { ...base };
  for (const key of Object.keys(override)) {
    if (override[key] && typeof override[key] === 'object' && !Array.isArray(override[key])) {
      result[key] = deepMerge(base[key] || {}, override[key]);
    } else {
      result[key] = override[key];
    }
  }
  return result;
}

let cachedConfig = null;

/**
 * Load and merge configuration from all sources.
 * @returns {object}
 */
export function loadConfig() {
  if (cachedConfig) return cachedConfig;

  let config = { ...DEFAULTS };

  // 1. User-level config (~/.omd/config.json)
  const userConfigPath = join(homedir(), '.omd', 'config.json');
  if (existsSync(userConfigPath)) {
    try {
      const userConfig = JSON.parse(readFileSync(userConfigPath, 'utf-8'));
      config = deepMerge(config, userConfig);
    } catch { /* ignore parse errors */ }
  }

  // 2. Project-level config (.omd/config.json)
  const projectConfigPath = join(process.cwd(), '.omd', 'config.json');
  if (existsSync(projectConfigPath)) {
    try {
      const projectConfig = JSON.parse(readFileSync(projectConfigPath, 'utf-8'));
      config = deepMerge(config, projectConfig);
    } catch { /* ignore parse errors */ }
  }

  // 3. Environment variables (highest priority)
  if (process.env.OMD_MODEL) config.model = process.env.OMD_MODEL;
  if (process.env.OMD_REASONER_MODEL) config.reasonerModel = process.env.OMD_REASONER_MODEL;
  if (process.env.OMD_BASE_URL) config.baseUrl = process.env.OMD_BASE_URL;
  if (process.env.OMD_MAX_TOKENS) config.maxTokens = parseInt(process.env.OMD_MAX_TOKENS, 10);
  if (process.env.OMD_TEMPERATURE) config.temperature = parseFloat(process.env.OMD_TEMPERATURE);
  if (process.env.OMD_DEFAULT_MODE) config.defaultMode = process.env.OMD_DEFAULT_MODE;

  cachedConfig = config;
  return config;
}

/**
 * Get DeepSeek API key. Priority:
 *   1. OMD_API_KEY env var
 *   2. DEEPSEEK_API_KEY env var (shared with Claude Code / Codex)
 *   3. ~/.claude/claude.json mcpServers.omd.env (Claude Code MCP config)
 *   4. null
 * Validates that the key is ASCII-safe for use in HTTP headers.
 */
export function getApiKey() {
  // 1-2. Environment variables
  let key = process.env.OMD_API_KEY || process.env.DEEPSEEK_API_KEY || null;

  // 3. Fallback: read from Claude Code's MCP config (if OMD is registered there)
  if (!key) {
    try {
      const claudeConfigPath = join(homedir(), '.claude', 'claude.json');
      if (existsSync(claudeConfigPath)) {
        const claudeConfig = JSON.parse(readFileSync(claudeConfigPath, 'utf-8'));
        const omdEnv = claudeConfig?.mcpServers?.omd?.env;
        if (omdEnv) {
          key = omdEnv.OMD_API_KEY || omdEnv.DEEPSEEK_API_KEY || null;
        }
      }
    } catch { /* ignore read/parse errors */ }
  }

  if (key && !/^[\x00-\x7F]+$/.test(key)) {
    throw new Error(
      'API key contains non-ASCII characters. DeepSeek API keys use only ASCII. ' +
      `First non-ASCII at index ${[...key].findIndex(c => c.charCodeAt(0) > 127)}.`
    );
  }
  return key;
}

/**
 * Check if OMD is configured as an MCP server in Claude Code.
 * @returns {{ configured: boolean, configPath: string, omdEntry: object|null }}
 */
export function checkClaudeCodeMcpConfig() {
  const configPath = join(homedir(), '.claude', 'claude.json');
  const result = { configured: false, configPath, omdEntry: null };

  if (!existsSync(configPath)) return result;

  try {
    const config = JSON.parse(readFileSync(configPath, 'utf-8'));
    result.omdEntry = config?.mcpServers?.omd || null;
    result.configured = !!result.omdEntry;
  } catch { /* ignore */ }

  return result;
}

/**
 * Register OMD as an MCP server in Claude Code's config (~/.claude/claude.json).
 * Automatically detects the API key from the environment and includes it.
 * @returns {{ success: boolean, message: string }}
 */
export function setupClaudeCodeMcp() {
  const configPath = join(homedir(), '.claude', 'claude.json');

  // Detect API key from env
  const apiKey = process.env.OMD_API_KEY || process.env.DEEPSEEK_API_KEY || null;

  // Determine the path to OMD's index.js
  let omdPath = new URL('index.js', import.meta.url).pathname;
  // Convert file:// URL to path if needed
  if (omdPath.startsWith('/')) {
    // already a path
  } else if (omdPath.startsWith('file://')) {
    omdPath = omdPath.slice(7);
  }

  const mcpEntry = {
    command: 'node',
    args: [omdPath, 'mcp'],
  };

  // Only add env if we have a key to pass
  if (apiKey) {
    mcpEntry.env = { OMD_API_KEY: apiKey };
  }

  // Read existing config or create new
  let config = {};
  if (existsSync(configPath)) {
    try {
      config = JSON.parse(readFileSync(configPath, 'utf-8'));
    } catch { /* start fresh if corrupt */ }
  }

  if (!config.mcpServers) config.mcpServers = {};
  config.mcpServers.omd = mcpEntry;

  // Ensure directory exists
  const dir = join(homedir(), '.claude');
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

  writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf-8');

  const keyMsg = apiKey
    ? `API key (${apiKey.substring(0, 8)}...)`
    : 'no API key (will inherit from parent env)';

  return {
    success: true,
    message: `OMD registered in Claude Code config.\n  Config: ${configPath}\n  Key: ${keyMsg}`,
  };
}

/**
 * Ensure the .omd directory structure exists.
 */
export function ensureOmdDir(subpath = '') {
  const dir = join(process.cwd(), '.omd', subpath);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  return dir;
}

/**
 * Save project-level configuration.
 */
export function saveProjectConfig(config) {
  const dir = ensureOmdDir();
  const path = join(dir, 'config.json');
  writeFileSync(path, JSON.stringify(config, null, 2), 'utf-8');
  cachedConfig = null;
}
