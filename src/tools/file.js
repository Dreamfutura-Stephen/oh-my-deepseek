/**
 * File tools — Read, Write, Edit files.
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync, renameSync } from 'node:fs';
import { dirname, resolve, relative } from 'node:path';
import { loadConfig } from '../config.js';

function sandboxPath(relativePath) {
  const config = loadConfig();
  const root = config.sandboxRoot || process.cwd();
  return resolve(root, relativePath);
}

/** @type {import('./index.js').ToolDefinition} */
export const readTool = {
  name: 'read',
  description:
    'Read a file from the filesystem. Returns the file contents with line numbers.',
  parameters: {
    type: 'object',
    properties: {
      file_path: {
        type: 'string',
        description: 'Absolute path to the file to read.',
      },
      offset: {
        type: 'number',
        description: 'Line number to start reading from (1-based).',
      },
      limit: {
        type: 'number',
        description: 'Maximum lines to read.',
      },
    },
    required: ['file_path'],
  },
  async execute(args) {
    const filePath = sandboxPath(args.file_path);
    if (!existsSync(filePath)) {
      return { success: false, error: `File not found: ${filePath}` };
    }
    try {
      const content = readFileSync(filePath, 'utf-8');
      let lines = content.split('\n');
      const totalLines = lines.length;
      if (args.offset) {
        lines = lines.slice(args.offset - 1);
      }
      if (args.limit) {
        lines = lines.slice(0, args.limit);
      }
      const numbered = lines
        .map((line, i) => `${String(i + (args.offset || 1)).padStart(4, ' ')}\t${line}`)
        .join('\n');
      return {
        success: true,
        output: numbered,
        totalLines,
        path: relative(process.cwd(), filePath),
      };
    } catch (error) {
      return { success: false, error: error.message };
    }
  },
};

/** @type {import('./index.js').ToolDefinition} */
export const writeTool = {
  name: 'write',
  description:
    'Write content to a file. Creates parent directories if needed. Overwrites existing files — use read first if you need the existing content.',
  parameters: {
    type: 'object',
    properties: {
      file_path: {
        type: 'string',
        description: 'Path to the file to write (absolute or relative to sandbox root).',
      },
      content: {
        type: 'string',
        description: 'The content to write.',
      },
    },
    required: ['file_path', 'content'],
  },
  async execute(args) {
    const filePath = sandboxPath(args.file_path);
    try {
      const dir = dirname(filePath);
      if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true });
      }
      writeFileSync(filePath, args.content, 'utf-8');
      return {
        success: true,
        path: relative(process.cwd(), filePath),
        bytes: Buffer.byteLength(args.content, 'utf-8'),
      };
    } catch (error) {
      return { success: false, error: error.message };
    }
  },
};

/** @type {import('./index.js').ToolDefinition} */
export const editTool = {
  name: 'edit',
  description:
    'Make a precise string replacement in an existing file. ' +
    'old_str must match exactly (including whitespace). Use this instead of write for small, targeted changes.',
  parameters: {
    type: 'object',
    properties: {
      file_path: {
        type: 'string',
        description: 'Path to the file to edit.',
      },
      old_string: {
        type: 'string',
        description: 'The exact text to replace.',
      },
      new_string: {
        type: 'string',
        description: 'The replacement text.',
      },
      replace_all: {
        type: 'boolean',
        description: 'Replace all occurrences. Default false.',
      },
    },
    required: ['file_path', 'old_string', 'new_string'],
  },
  async execute(args) {
    const filePath = sandboxPath(args.file_path);
    if (!existsSync(filePath)) {
      return { success: false, error: `File not found: ${filePath}` };
    }
    try {
      const content = readFileSync(filePath, 'utf-8');
      if (!content.includes(args.old_string)) {
        return {
          success: false,
          error: `old_string not found in file. This may be due to whitespace differences — use read tool first to get exact text.`,
        };
      }
      const occurrences = content.split(args.old_string).length - 1;
      if (occurrences > 1 && !args.replace_all) {
        return {
          success: false,
          error: `old_string appears ${occurrences} times in the file. Use replace_all: true to replace all, or provide more context to make it unique.`,
        };
      }
      const newContent = args.replace_all
        ? content.replaceAll(args.old_string, args.new_string)
        : content.replace(args.old_string, args.new_string);
      writeFileSync(filePath, newContent, 'utf-8');
      return {
        success: true,
        path: relative(process.cwd(), filePath),
        replacements: args.replace_all ? occurrences : 1,
      };
    } catch (error) {
      return { success: false, error: error.message };
    }
  },
};
