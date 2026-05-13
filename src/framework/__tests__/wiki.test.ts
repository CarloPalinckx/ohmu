import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks — must be declared before importing modules that use them
// ---------------------------------------------------------------------------

vi.mock('@earendil-works/pi-coding-agent', () => ({
  defineTool: vi.fn((def: unknown) => def),
}));

vi.mock('node:fs/promises', () => ({
  access: vi.fn(),
  readdir: vi.fn(),
  readFile: vi.fn(),
}));

import { access, readdir, readFile } from 'node:fs/promises';
import { wikiDirExists, createWikiTools } from '../wiki.ts';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type ToolResult = { content: Array<{ text: string }>; details: Record<string, unknown> };
type ListFn = () => Promise<ToolResult>;
type ReadFn = (id: string, params: { path: string }) => Promise<ToolResult>;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Extract typed execute functions from createWikiTools, bypassing the
 * ToolDefinition signature (which requires 5 args) via unknown.
 */
function getTools(rootDir: string, wikiDir: string): { list: ListFn; read: ReadFn } {
  const tools = createWikiTools(rootDir, wikiDir) as unknown as [
    { execute: ListFn },
    { execute: ReadFn },
  ];
  return { list: tools[0].execute, read: tools[1].execute };
}

/**
 * Create a mock dirent-like entry for readdir({ withFileTypes: true }).
 */
function entry(name: string, type: 'file' | 'dir') {
  return {
    name,
    isDirectory: () => type === 'dir',
    isFile: () => type === 'file',
  };
}

const ROOT = '/repo';
const WIKI = '/repo/wiki/proj';

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks();
});

describe('wikiDirExists()', () => {
  it('returns true when the directory is accessible', async () => {
    vi.mocked(access).mockResolvedValue(undefined);
    expect(await wikiDirExists(WIKI)).toBe(true);
    expect(access).toHaveBeenCalledWith(WIKI);
  });

  it('returns false when access throws', async () => {
    vi.mocked(access).mockRejectedValue(new Error('ENOENT'));
    expect(await wikiDirExists(WIKI)).toBe(false);
  });
});

describe('createWikiTools()', () => {
  it('returns exactly two tool definitions', () => {
    const tools = createWikiTools(ROOT, WIKI);
    expect(tools).toHaveLength(2);
    expect(tools[0]).toMatchObject({ name: 'wiki_list' });
    expect(tools[1]).toMatchObject({ name: 'wiki_read' });
  });

  describe('wiki_list execute', () => {
    it('returns a no-articles message when the wiki dir is empty', async () => {
      vi.mocked(readdir).mockResolvedValue([] as never);
      const { list } = getTools(ROOT, WIKI);
      const result = await list();
      expect(result.content[0].text).toBe('No wiki articles found.');
    });

    it('returns a formatted index when markdown files are present', async () => {
      vi.mocked(readdir).mockResolvedValue([entry('auth.md', 'file')] as never);
      vi.mocked(readFile).mockResolvedValue(
        '---\ntitle: Auth Guide\ntags: [auth, jwt]\n---\n# Auth' as never,
      );
      const { list } = getTools(ROOT, WIKI);
      const result = await list();
      const line = result.content[0].text;
      expect(line).toContain('wiki/proj/auth.md');
      expect(line).toContain('Auth Guide');
      expect(line).toContain('auth, jwt');
    });

    it('uses (no title) and (no tags) when frontmatter is absent', async () => {
      vi.mocked(readdir).mockResolvedValue([entry('notes.md', 'file')] as never);
      vi.mocked(readFile).mockResolvedValue('# No frontmatter here' as never);
      const { list } = getTools(ROOT, WIKI);
      const result = await list();
      const line = result.content[0].text;
      expect(line).toContain('(no title)');
      expect(line).toContain('(no tags)');
    });

    it('recurses into subdirectories and skips hidden dirs', async () => {
      vi.mocked(readdir)
        .mockResolvedValueOnce([
          entry('.hidden', 'dir'),
          entry('sub', 'dir'),
          entry('root.md', 'file'),
        ] as never)
        .mockResolvedValueOnce([entry('nested.md', 'file')] as never);
      vi.mocked(readFile).mockResolvedValue('' as never);

      const { list } = getTools(ROOT, WIKI);
      const result = await list();
      const text = result.content[0].text;
      expect(text).toContain('root.md');
      expect(text).toContain('nested.md');
      expect(text).not.toContain('.hidden');
    });

    it('skips non-markdown files', async () => {
      vi.mocked(readdir).mockResolvedValue([
        entry('readme.txt', 'file'),
        entry('guide.md', 'file'),
      ] as never);
      vi.mocked(readFile).mockResolvedValue('' as never);
      const { list } = getTools(ROOT, WIKI);
      const result = await list();
      const text = result.content[0].text;
      expect(text).not.toContain('readme.txt');
      expect(text).toContain('guide.md');
    });
  });

  describe('wiki_read execute', () => {
    it('returns article content for a valid path', async () => {
      vi.mocked(readFile).mockResolvedValue('# Auth\nSome content.' as never);
      const { read } = getTools(ROOT, WIKI);
      const result = await read('id', { path: 'wiki/proj/auth.md' });
      expect(result.content[0].text).toBe('# Auth\nSome content.');
    });

    it('returns an error when path is outside the wiki dir', async () => {
      const { read } = getTools(ROOT, WIKI);
      const result = await read('id', { path: '../../etc/passwd' });
      expect(result.content[0].text).toContain('Error: path is outside');
    });

    it('returns an error when the article file does not exist', async () => {
      vi.mocked(readFile).mockRejectedValue(new Error('ENOENT') as never);
      const { read } = getTools(ROOT, WIKI);
      const result = await read('id', { path: 'wiki/proj/missing.md' });
      expect(result.content[0].text).toContain('Error: article not found');
    });
  });
});
