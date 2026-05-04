/**
 * Tool registry — manages all available tools, their schemas, and execution.
 *
 * @typedef {object} ToolDefinition
 * @property {string} name
 * @property {string} description
 * @property {object} parameters - JSON Schema for the tool's arguments
 * @property {(args: object) => Promise<object>} execute
 */

import { bashTool } from './bash.js';
import { readTool, writeTool, editTool } from './file.js';
import { globTool, grepTool } from './search.js';

/** @type {Map<string, ToolDefinition>} */
const registry = new Map();

const builtinTools = [bashTool, readTool, writeTool, editTool, globTool, grepTool];

for (const tool of builtinTools) {
  registry.set(tool.name, tool);
}

/**
 * Register a custom tool.
 */
export function registerTool(tool) {
  registry.set(tool.name, tool);
}

/**
 * Get a tool definition by name.
 */
export function getTool(name) {
  return registry.get(name) || null;
}

/**
 * Get all registered tool names.
 */
export function getToolNames() {
  return [...registry.keys()];
}

/**
 * Get OpenAI-format tool schemas, filtered by agent capabilities (Harmonist).
 *
 * Can be called with:
 * - An agent definition object: { allowedTools: ['*'] | string[], disallowedTools: string[] }
 * - An array of tool name strings (direct filter)
 * - null/undefined: return all tools
 */
export function getToolSchemas(agentOrNames = null) {
  let allowed = null;   // null = all, ['*'] = all, [] = none
  let disallowed = [];
  let includeAgentTool = true;

  if (agentOrNames && typeof agentOrNames.allowedTools !== 'undefined') {
    // Agent object (Harmonist pattern)
    if (agentOrNames.allowedTools === '*' || agentOrNames.allowedTools[0] === '*') {
      allowed = null; // all tools
    } else {
      allowed = new Set(agentOrNames.allowedTools);
    }
    disallowed = new Set(agentOrNames.disallowedTools || []);
    includeAgentTool = agentOrNames.canSpawn !== false;
  } else if (Array.isArray(agentOrNames)) {
    // Raw name array
    allowed = new Set(agentOrNames);
  }

  const tools = [];
  for (const [name, tool] of registry) {
    // Skip the 'agent' tool for agents that can't spawn
    if (name === 'agent' && !includeAgentTool) continue;

    // Allowed check
    if (allowed && !allowed.has(name)) continue;

    // Disallowed check
    if (disallowed.has(name)) continue;

    tools.push({
      type: 'function',
      function: {
        name: tool.name,
        description: tool.description,
        parameters: tool.parameters,
      },
    });
  }
  return tools;
}

/**
 * Execute a tool by name with arguments.
 */
export async function executeTool(name, args) {
  const tool = registry.get(name);
  if (!tool) {
    return { success: false, error: `Unknown tool: ${name}` };
  }
  try {
    return await tool.execute(args);
  } catch (error) {
    return { success: false, error: error.message };
  }
}
