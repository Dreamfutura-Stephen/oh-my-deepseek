/**
 * Search tools — Glob pattern matching and Grep content search.
 */
import { readdirSync, statSync, readFileSync } from 'node:fs';
import { resolve, relative, basename, dirname, join } from 'node:path';
import { loadConfig } from '../config.js';

/**
 * Simple glob matching. Supports **, *, and ?.
 */
function matchGlob(pattern, filepath) {
  // Convert glob pattern to regex
  const regexStr = pattern
    .replace(/\./g, '\\.')
    .replace(/\*\*/g, '<<GLOBSTAR>>')
    .replace(/\*/g, '[^/]*')
    .replace(/<<GLOBSTAR>>/g, '.*')
    .replace(/\?/g, '.');
  try {
    return new RegExp(`^${regexStr}$`).test(filepath);
  } catch {
    return false;
  }
}

function walkDir(dir, pattern, baseDir, results = []) {
  try {
    const entries = readdirSync(dir);
    for (const entry of entries) {
      // Skip hidden files and common ignores
      if (entry.startsWith('.') && entry !== '.') continue;
      if (entry === 'node_modules' || entry === 'dist' || entry === '.git') continue;

      const fullPath = join(dir, entry);
      let stat;
      try {
        stat = statSync(fullPath);
      } catch {
        continue;
      }
      const relativePath = relative(baseDir, fullPath);

      if (stat.isDirectory()) {
        walkDir(fullPath, pattern, baseDir, results);
      } else if (matchGlob(pattern, relativePath)) {
        results.push(relativePath);
      }
    }
  } catch {
    // Permission errors etc.
  }
  return results;
}

/** @type {import('./index.js').ToolDefinition} */
export const globTool = {
  name: 'glob',
  description:
    'Fast file pattern matching. Supports **, *, and ? wildcards. ' +
    'Returns matching file paths sorted by modification time.',
  parameters: {
    type: 'object',
    properties: {
      pattern: {
        type: 'string',
        description: 'The glob pattern, e.g. "src/**/*.js"',
      },
      path: {
        type: 'string',
        description: 'Directory to search in. Defaults to sandbox root.',
      },
    },
    required: ['pattern'],
  },
  async execute(args) {
    const config = loadConfig();
    const baseDir = args.path
      ? resolve(config.sandboxRoot || process.cwd(), args.path)
      : (config.sandboxRoot || process.cwd());

    try {
      const results = walkDir(baseDir, args.pattern, baseDir);
      // Sort by modification time (newest first)
      results.sort((a, b) => {
        const statA = statSync(join(baseDir, a));
        const statB = statSync(join(baseDir, b));
        return statB.mtimeMs - statA.mtimeMs;
      });
      return {
        success: true,
        matches: results.slice(0, 200),
        count: results.length,
      };
    } catch (error) {
      return { success: false, error: error.message };
    }
  },
};

/** @type {import('./index.js').ToolDefinition} */
export const grepTool = {
  name: 'grep',
  description:
    'Search file contents using regular expressions. Returns matching file paths and line content.',
  parameters: {
    type: 'object',
    properties: {
      pattern: {
        type: 'string',
        description: 'The regex pattern to search for.',
      },
      path: {
        type: 'string',
        description: 'File or directory to search. Defaults to sandbox root.',
      },
      glob: {
        type: 'string',
        description: 'Optional glob filter for files, e.g. "*.js"',
      },
      ignore_case: {
        type: 'boolean',
        description: 'Case-insensitive search. Default false.',
      },
    },
    required: ['pattern'],
  },
  async execute(args) {
    const config = loadConfig();
    const searchPath = args.path
      ? resolve(config.sandboxRoot || process.cwd(), args.path)
      : (config.sandboxRoot || process.cwd());

    const results = [];
    const flags = args.ignore_case ? 'gi' : 'g';

    try {
      const stat = statSync(searchPath);
      let files = [];

      if (stat.isFile()) {
        files = [searchPath];
      } else {
        const allFiles = walkDir(searchPath, args.glob || '**/*', searchPath);
        files = allFiles.map(f => join(searchPath, f));
      }

      for (const file of files) {
        try {
          const content = readFileSync(file, 'utf-8');
          const regex = new RegExp(args.pattern, flags);
          const lines = content.split('\n');
          for (let i = 0; i < lines.length; i++) {
            if (regex.test(lines[i])) {
              results.push({
                file: relative(process.cwd(), file),
                line: i + 1,
                content: lines[i].substring(0, 200),
              });
            }
            // Reset lastIndex for global regex
            regex.lastIndex = 0;
          }
        } catch {
          // Binary file or permission error
        }
      }

      return {
        success: true,
        matches: results.slice(0, 200),
        count: results.length,
      };
    } catch (error) {
      return { success: false, error: error.message };
    }
  },
};
