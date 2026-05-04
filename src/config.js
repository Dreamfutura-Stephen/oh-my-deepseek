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
 * Get DeepSeek API key. Checks OMD_API_KEY first, then DEEPSEEK_API_KEY.
 * Validates that the key is ASCII-safe for use in HTTP headers.
 */
export function getApiKey() {
  const key = process.env.OMD_API_KEY || process.env.DEEPSEEK_API_KEY || null;
  if (key && !/^[\x00-\x7F]+$/.test(key)) {
    throw new Error(
      'API key contains non-ASCII characters. DeepSeek API keys use only ASCII. ' +
      `First non-ASCII at index ${[...key].findIndex(c => c.charCodeAt(0) > 127)}.`
    );
  }
  return key;
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
