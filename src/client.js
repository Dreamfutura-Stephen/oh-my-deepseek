/**
 * DeepSeek API client. Uses OpenAI-compatible /v1/chat/completions endpoint.
 * Pure Node.js — no external dependencies, native fetch (Node 18+).
 */
import { loadConfig, getApiKey } from './config.js';

/**
 * Send a chat completion request to DeepSeek.
 *
 * @param {object} opts
 * @param {Array<{role:string, content:string|Array}>} opts.messages
 * @param {Array<object>} [opts.tools] - OpenAI-format tool definitions
 * @param {string} [opts.model] - override default model
 * @param {number} [opts.maxTokens]
 * @param {number} [opts.temperature]
 * @param {AbortSignal} [opts.signal]
 * @returns {Promise<object>} - OpenAI-format response
 */
export async function chatCompletion({
  messages,
  tools,
  model: modelOverride,
  maxTokens,
  temperature,
  signal,
}) {
  const apiKey = getApiKey();
  if (!apiKey) {
    throw new Error(
      'No API key found. Set OMD_API_KEY or DEEPSEEK_API_KEY environment variable.'
    );
  }

  const config = loadConfig();
  const url = `${config.baseUrl}/v1/chat/completions`;

  const body = {
    model: modelOverride || config.model,
    messages,
    max_tokens: maxTokens ?? config.maxTokens,
    temperature: temperature ?? config.temperature,
    stream: false,
  };

  if (tools && tools.length > 0) {
    body.tools = tools;
    body.tool_choice = 'auto';
  }

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
    signal,
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`DeepSeek API error ${response.status}: ${errorText}`);
  }

  return response.json();
}

/**
 * Extract text content from an assistant message in the response.
 */
export function extractText(choice) {
  return choice.message?.content || '';
}

/**
 * Extract tool calls from an assistant message.
 */
export function extractToolCalls(choice) {
  return choice.message?.tool_calls || [];
}

/**
 * Parse a tool call's arguments (which come as a JSON string).
 */
export function parseToolArgs(toolCall) {
  try {
    return JSON.parse(toolCall.function.arguments);
  } catch {
    return {};
  }
}
