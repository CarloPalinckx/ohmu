import { readdir, readFile, access } from 'node:fs/promises';
import path from 'node:path';
import { Type } from 'typebox';
import { defineTool, type ToolDefinition } from '@earendil-works/pi-coding-agent';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Recursively collect all .md file paths under a directory.
 * Hidden directories (names starting with '.') are skipped.
 * Results are sorted alphabetically.
 *
 * @param dir - Absolute path to the directory to search.
 * @returns    Sorted array of absolute file paths.
 */
async function findMarkdownFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const results: string[] = [];

  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue;
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...(await findMarkdownFiles(fullPath)));
    } else if (entry.isFile() && entry.name.endsWith('.md')) {
      results.push(fullPath);
    }
  }

  return results.sort();
}

/**
 * Extract title and tags from a markdown file's YAML frontmatter block.
 * Returns null/empty if frontmatter is absent or the fields are missing.
 *
 * @param content - Raw markdown file content.
 */
function parseFrontmatter(content: string): { title: string | null; tags: string[] } {
  const match = content.match(/^---\n([\s\S]*?)\n---/);
  if (!match) return { title: null, tags: [] };

  const yaml = match[1];
  const titleMatch = yaml.match(/^title:\s*(.+)$/m);
  const tagsMatch = yaml.match(/^tags:\s*\[(.+)\]$/m);

  const title = titleMatch ? titleMatch[1].trim() : null;
  const tags = tagsMatch ? tagsMatch[1].split(',').map((t) => {return t.trim()}) : [];

  return { title, tags };
}

// ---------------------------------------------------------------------------
// Tools
// ---------------------------------------------------------------------------

/**
 * Check whether a directory exists and is accessible.
 *
 * @param dir - Absolute path to check.
 */
export async function wikiDirExists(dir: string): Promise<boolean> {
  try {
    await access(dir);
    return true;
  } catch {
    return false;
  }
}

/**
 * Create wiki_list and wiki_read tools scoped to a specific wiki subdirectory.
 *
 * wiki_list — returns a compact index of all articles under wikiDir:
 *             one line per article with relative path, title, and tags.
 *
 * wiki_read — reads a single article by the relative path shown by wiki_list.
 *             Rejects paths that escape wikiDir.
 *
 * Both tools use rootDir as the base for relative path display and resolution,
 * so paths are stable references like `wiki/juice-shop/auth-and-jwt.md`.
 *
 * @param rootDir - Absolute repo root (parent of the `wiki/` directory).
 * @param wikiDir - Absolute path to the scoped wiki subdirectory (e.g. `<rootDir>/wiki/juice-shop`).
 * @returns         Array of two ToolDefinition objects ready for `customTools`.
 */
export function createWikiTools(rootDir: string, wikiDir: string): ToolDefinition[] {
  const wikiList = defineTool({
    name: 'wiki_list',
    label: 'Wiki List',
    description:
      'List all articles in the codebase wiki. Returns one line per article: relative path, title, and tags.',
    parameters: Type.Object({}),
    execute: async () => {
      const files = await findMarkdownFiles(wikiDir);

      if (files.length === 0) {
        return { content: [{ type: 'text', text: 'No wiki articles found.' }], details: {} };
      }

      const lines = await Promise.all(
        files.map(async (file) => {
          const content = await readFile(file, 'utf-8');
          const { title, tags } = parseFrontmatter(content);
          const rel = path.relative(rootDir, file);
          return `${rel} | ${title ?? '(no title)'} | ${tags.join(', ') || '(no tags)'}`;
        }),
      );

      return { content: [{ type: 'text', text: lines.join('\n') }], details: {} };
    },
  });

  const wikiRead = defineTool({
    name: 'wiki_read',
    label: 'Wiki Read',
    description:
      'Read the full content of a wiki article. Use the relative path returned by wiki_list (e.g. wiki/juice-shop/auth-and-jwt.md).',
    parameters: Type.Object({
      path: Type.String({
        description: 'Relative path to the wiki article as shown by wiki_list.',
      }),
    }),
    execute: async (_id, params) => {
      const abs = path.resolve(rootDir, params.path);

      if (!abs.startsWith(wikiDir + path.sep) && abs !== wikiDir) {
        return {
          content: [{ type: 'text', text: 'Error: path is outside the wiki directory.' }],
          details: {},
        };
      }

      try {
        const content = await readFile(abs, 'utf-8');
        return { content: [{ type: 'text', text: content }], details: {} };
      } catch {
        return {
          content: [{ type: 'text', text: `Error: article not found at ${params.path}` }],
          details: {},
        };
      }
    },
  });

  return [wikiList, wikiRead];
}
