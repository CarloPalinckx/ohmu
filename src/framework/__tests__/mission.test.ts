import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks — declared before importing modules that use them
// ---------------------------------------------------------------------------

vi.mock('../session.ts', () => ({
  createSession: vi.fn(),
}));

import { createSession } from '../session.ts';
import { mission } from '../mission.ts';
import { z } from 'zod';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function buildMockSession() {
  return {
    prompt: vi.fn(),
    verify: vi.fn(),
    getSessionFile: vi.fn(() => '/tmp/test.json'),
    dispose: vi.fn(),
  };
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

let mockSession: ReturnType<typeof buildMockSession>;

beforeEach(() => {
  vi.clearAllMocks();
  mockSession = buildMockSession();
  vi.mocked(createSession).mockResolvedValue(mockSession as any);
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('mission()', () => {
  it('returns a run function with the config attached', () => {
    const config = { parameters: z.object({ name: z.string() }) };
    const run = mission(config, async () => {});

    expect(run.config).toBe(config);
    expect(run).toBeTypeOf('function');
  });

  it('creates a session, calls the mission body with typed context, then disposes', async () => {
    const config = { parameters: z.object({ repo: z.string() }) };
    const fn = vi.fn();
    const run = mission(config, fn);

    await run({ repo: 'myrepo' }, '/workspace');

    expect(createSession).toHaveBeenCalledWith('/workspace', undefined, undefined, undefined);
    expect(fn).toHaveBeenCalledWith({
      params: { repo: 'myrepo' },
      session: mockSession,
      cwd: '/workspace',
    });
    expect(mockSession.dispose).toHaveBeenCalledTimes(1);
  });

  it('disposes the session even when the mission body throws', async () => {
    const config = { parameters: z.object({}) };
    const run = mission(config, async () => {
      throw new Error('mission failed');
    });

    await expect(run({}, '/workspace')).rejects.toThrow('mission failed');
    expect(mockSession.dispose).toHaveBeenCalledTimes(1);
  });

  it('forwards the AbortSignal to createSession', async () => {
    const config = { parameters: z.object({}) };
    const run = mission(config, async () => {});
    const ac = new AbortController();

    await run({}, '/workspace', ac.signal);

    expect(createSession).toHaveBeenCalledWith('/workspace', ac.signal, undefined, undefined);
  });

  it('forwards worktree config to createSession', async () => {
    const config = {
      parameters: z.object({}),
      worktree: { ref: 'main' },
    };
    const run = mission(config, async () => {});

    await run({}, '/workspace');

    expect(createSession).toHaveBeenCalledWith('/workspace', undefined, undefined, { ref: 'main' });
  });
});
