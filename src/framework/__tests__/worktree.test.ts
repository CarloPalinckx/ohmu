import { describe, it, expect, vi, beforeEach } from 'vitest';
import fs from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { createWorktree } from '../worktree.ts';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock('node:child_process');
vi.mock('node:fs/promises');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Build a mock process that returns a given output on successful exit.
 */
function buildMockProc(output: string = '', exitCode: number = 0, stderrOutput?: string) {
  const proc = {
    stdout: { on: vi.fn() },
    stderr: { on: vi.fn() },
    on: vi.fn((event: string, cb: Function) => {
      if (event === 'data') {
        cb(Buffer.from(output));
      }
      if (event === 'close') {
        setImmediate(() => cb(exitCode));
      }
    }),
  };

  // Simulate piping stdout to accumulate output
  proc.stdout.on.mockImplementation((event: string, cb: (data: Buffer) => void) => {
    if (event === 'data') {
      cb(Buffer.from(output));
    }
  });

  // Simulate stderr output
  if (stderrOutput) {
    proc.stderr.on.mockImplementation((event: string, cb: (data: Buffer) => void) => {
      if (event === 'data') {
        cb(Buffer.from(stderrOutput));
      }
    });
  }

  return proc;
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('createWorktree()', () => {
  it('throws when cwd is not a git repository', async () => {
    // First call (rev-parse --git-dir) should fail
    vi.mocked(spawn).mockReturnValueOnce(buildMockProc('', 128) as any);

    await expect(createWorktree('/not-a-repo')).rejects.toThrow('Not a git repository');
  });

  it('creates a worktree with a unique name in a sibling directory', async () => {
    let callCount = 0;
    vi.mocked(spawn).mockImplementation(() => {
      // rev-parse --git-dir returns .git path, --show-toplevel returns root
      const outputs = ['/path/to/.git', '/path/to', ''];
      const output = outputs[callCount]?.trim() || '';
      callCount++;
      return buildMockProc(output, 0) as any;
    });
    vi.mocked(fs.access).mockResolvedValue(undefined);

    const handle = await createWorktree('/path/to/repo');

    expect(handle.path).toMatch(/_worktree_\d+_[a-z0-9]+$/);
    expect(handle).toHaveProperty('cleanup');
  });

  it('uses a custom ref when provided', async () => {
    let callCount = 0;
    vi.mocked(spawn).mockImplementation(() => {
      const outputs = ['/path/to/.git', '/path/to', ''];
      const output = outputs[callCount]?.trim() || '';
      callCount++;
      return buildMockProc(output, 0) as any;
    });
    vi.mocked(fs.access).mockResolvedValue(undefined);

    await createWorktree('/path/to/repo', { ref: 'develop' });

    // Check that git worktree add was called with 'develop'
    const calls = vi.mocked(spawn).mock.calls;
    const worktreeCall = calls.find((call) => {
      return call[0] === 'git' && call[1]?.[0] === 'worktree' && call[1]?.[1] === 'add';
    });
    expect(worktreeCall?.[1]).toContain('develop');
  });

  it('throws if the worktree directory was not created', async () => {
    let callCount = 0;
    vi.mocked(spawn).mockImplementation(() => {
      const outputs = ['/path/to/.git', '/path/to', ''];
      const output = outputs[callCount]?.trim() || '';
      callCount++;
      return buildMockProc(output, 0) as any;
    });
    // fs.access rejects to simulate directory not existing
    vi.mocked(fs.access).mockRejectedValue(new Error('ENOENT'));

    await expect(createWorktree('/path/to/repo')).rejects.toThrow(
      'Worktree directory was not created',
    );
  });

  it('returns a handle with a cleanup() function', async () => {
    let callCount = 0;
    vi.mocked(spawn).mockImplementation(() => {
      const outputs = ['/path/to/.git', '/path/to', ''];
      const output = outputs[callCount]?.trim() || '';
      callCount++;
      return buildMockProc(output, 0) as any;
    });
    vi.mocked(fs.access).mockResolvedValue(undefined);

    const handle = await createWorktree('/path/to/repo');

    expect(handle).toHaveProperty('path');
    expect(handle).toHaveProperty('cleanup');
    expect(handle.cleanup).toBeTypeOf('function');
  });

  it('cleanup removes the worktree via git worktree remove', async () => {
    let callCount = 0;
    vi.mocked(spawn).mockImplementation(() => {
      const outputs = ['/path/to/.git', '/path/to', '', ''];
      const output = outputs[callCount]?.trim() || '';
      callCount++;
      return buildMockProc(output, 0) as any;
    });
    vi.mocked(fs.access).mockResolvedValue(undefined);

    const handle = await createWorktree('/path/to/repo');
    await handle.cleanup();

    const calls = vi.mocked(spawn).mock.calls;
    const removeCall = calls.find(
      (call) => call[0] === 'git' && call[1]?.[0] === 'worktree' && call[1]?.[1] === 'remove',
    );
    expect(removeCall).toBeDefined();
  });

  it('cleanup falls back to rm + prune on failure', async () => {
    let callCount = 0;
    vi.mocked(spawn).mockImplementation(() => {
      // git worktree remove (callCount >= 3) should fail
      const shouldFail = callCount >= 3;
      const outputs = ['/path/to/.git', '/path/to', '', '', 'error'];
      const output = outputs[Math.min(callCount, 4)]?.trim() || '';
      callCount++;
      return buildMockProc(output, shouldFail ? 1 : 0) as any;
    });
    vi.mocked(fs.access).mockResolvedValue(undefined);
    vi.mocked(fs.rm).mockResolvedValue(undefined);

    const handle = await createWorktree('/path/to/repo');
    await handle.cleanup();

    expect(fs.rm).toHaveBeenCalled();
  });

  it('throws when git worktree add fails with stderr output', async () => {
    let callCount = 0;
    vi.mocked(spawn).mockImplementation(() => {
      // First two calls succeed (git checks), third call (git worktree add) fails
      const exitCode = callCount >= 2 ? 1 : 0;
      const outputs = ['/path/to/.git', '/path/to', '', 'fatal error'];
      const output = outputs[Math.min(callCount, 3)]?.trim() || '';
      callCount++;
      return buildMockProc(output, exitCode, 'error message') as any;
    });
    vi.mocked(fs.access).mockResolvedValue(undefined);

    await expect(createWorktree('/path/to/repo')).rejects.toThrow('Failed to create git worktree');
  });
});
