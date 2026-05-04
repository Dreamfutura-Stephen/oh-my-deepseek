/**
 * Bash tool — execute shell commands in a sandboxed environment.
 */
import { execSync } from 'node:child_process';
import { loadConfig } from '../config.js';

/** @type {import('./index.js').ToolDefinition} */
export const bashTool = {
  name: 'bash',
  description:
    'Execute a shell command. Returns stdout and stderr. Commands run in a sandbox — use absolute paths. ' +
    'For long-running commands, set timeout_ms. The command must be non-interactive.',
  parameters: {
    type: 'object',
    properties: {
      command: {
        type: 'string',
        description: 'The shell command to execute (bash -c).',
      },
      timeout_ms: {
        type: 'number',
        description: 'Timeout in milliseconds. Default 30000.',
      },
    },
    required: ['command'],
  },
  async execute(args) {
    const config = loadConfig();
    const command = args.command;
    const timeout = args.timeout_ms || 30000;

    try {
      const stdout = execSync(command, {
        cwd: config.sandboxRoot || process.cwd(),
        timeout,
        encoding: 'utf-8',
        maxBuffer: 10 * 1024 * 1024, // 10MB
        shell: '/bin/bash',
      });
      return {
        success: true,
        output: stdout,
        exitCode: 0,
      };
    } catch (error) {
      return {
        success: false,
        output: error.stdout || '',
        error: error.stderr || error.message,
        exitCode: error.status || 1,
      };
    }
  },
};
