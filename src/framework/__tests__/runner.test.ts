import { describe, it, expect, vi, beforeEach } from 'vitest';
import { z } from 'zod';

// ---------------------------------------------------------------------------
// Mocks — must be declared before importing modules that use them
// ---------------------------------------------------------------------------

vi.mock('@earendil-works/pi-coding-agent', () => ({
  createAgentSession: vi.fn(),
  SessionManager: { open: vi.fn((p: string) => ({ file: p })) },
  AuthStorage: { create: vi.fn(() => ({})) },
  ModelRegistry: { create: vi.fn(() => ({})) },
  getAgentDir: vi.fn(() => '/mock/agent'),
}));

vi.mock('node:fs/promises', () => ({
  mkdir: vi.fn().mockResolvedValue(undefined),
  writeFile: vi.fn().mockResolvedValue(undefined),
}));

import { createAgentSession } from '@earendil-works/pi-coding-agent';
import { writeFile } from 'node:fs/promises';
import { runMission } from '../runner.ts';
import { mission } from '../mission.ts';
import { phase } from '../phase.ts';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Create a mock Pi session that emits responses in order for each prompt() call.
 *
 * @param responses - Strings emitted as text_delta events, one per prompt() call.
 */
function createMockSession(responses: string[]) {
  let subscriber: ((event: unknown) => void) | null = null;
  let callIndex = 0;

  return {
    subscribe: vi.fn((listener: (event: unknown) => void) => {
      subscriber = listener;
      return () => {
        subscriber = null;
      };
    }),
    prompt: vi.fn(async (_text: string) => {
      const response = responses[callIndex++] ?? '';
      subscriber?.({
        type: 'message_update',
        assistantMessageEvent: { type: 'text_delta', delta: response },
      });
    }),
    dispose: vi.fn(),
  };
}

/** Parse meta.json from the mocked writeFile calls. */
function getCapturedMeta(): Record<string, unknown> {
  const call = vi.mocked(writeFile).mock.calls.find((c) => c[0].toString().includes('meta.json'));
  if (!call) throw new Error('meta.json was not written');
  return JSON.parse(call[1] as string);
}

const BASE_CONFIG = {
  name: 'test-mission',
  parameters: z.object({}),
  tools: [] as string[],
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks();
});

describe('phase()', () => {
  it('throws when called outside a mission() callback', () => {
    expect(() =>
      phase(async ({ prompt }) => {
        await prompt('test');
      }),
    ).toThrow('phase() must be called inside a mission() callback');
  });
});

describe('mission()', () => {
  it('collects phases in declaration order', () => {
    const def = mission(BASE_CONFIG, ({ parameters: _ }) => {
      phase(async ({ prompt }) => {
        await prompt('one');
      });
      phase(async ({ prompt }) => {
        await prompt('two');
      });
      phase(async ({ prompt }) => {
        await prompt('three');
      });
    });

    def.run({});
    expect(def.phases).toHaveLength(3);
  });
});

describe('runMission()', () => {
  it('calls prompt with the phase text', async () => {
    const session = createMockSession(['done']);
    vi.mocked(createAgentSession).mockResolvedValue({ session } as never);

    const def = mission(BASE_CONFIG, () => {
      phase(async ({ prompt }) => {
        await prompt('Explore the codebase');
      });
    });

    await runMission(def, {}, '/cwd', '/logs');

    expect(session.prompt).toHaveBeenCalledWith('Explore the codebase');
  });

  it('injects prior phase output as cache into the next phase', async () => {
    const session1 = createMockSession(['phase 1 output']);
    const session2 = createMockSession(['phase 2 output']);
    vi.mocked(createAgentSession)
      .mockResolvedValueOnce({ session: session1 } as never)
      .mockResolvedValueOnce({ session: session2 } as never);

    const def = mission(BASE_CONFIG, () => {
      phase({ name: 'prepare' }, async ({ prompt }) => {
        await prompt('Do prepare work');
      });
      phase({ name: 'execute' }, async ({ prompt }) => {
        await prompt('Do execute work');
      });
    });

    await runMission(def, {}, '/cwd', '/logs');

    const executePrompt = vi.mocked(session2.prompt).mock.calls[0][0];
    expect(executePrompt).toContain('--- Phase: prepare ---');
    expect(executePrompt).toContain('phase 1 output');
    expect(executePrompt).toContain('Do execute work');
  });

  it('disposes the session after each phase attempt', async () => {
    const session = createMockSession(['done']);
    vi.mocked(createAgentSession).mockResolvedValue({ session } as never);

    const def = mission(BASE_CONFIG, () => {
      phase(async ({ prompt }) => {
        await prompt('Do work');
      });
    });

    await runMission(def, {}, '/cwd', '/logs');

    expect(session.dispose).toHaveBeenCalledOnce();
  });

  it('writes meta.json with success outcome when all phases pass', async () => {
    const session = createMockSession(['done']);
    vi.mocked(createAgentSession).mockResolvedValue({ session } as never);

    const def = mission(BASE_CONFIG, () => {
      phase(async ({ prompt }) => {
        await prompt('Do work');
      });
    });

    await runMission(def, {}, '/cwd', '/logs');

    const meta = getCapturedMeta();
    expect(meta.outcome).toBe('success');
    expect(meta.mission).toBe('test-mission');
  });

  describe('verdict', () => {
    it('passes when promptWithVerdict response contains VERDICT:PASS', async () => {
      const session = createMockSession(['work done', 'looks good VERDICT:PASS']);
      vi.mocked(createAgentSession).mockResolvedValue({ session } as never);

      const def = mission(BASE_CONFIG, () => {
        phase(async ({ prompt }) => {
          await prompt('Do the work');
          return (promptWithVerdict) => {
            return promptWithVerdict('Review the work');
          };
        });
      });

      await runMission(def, {}, '/cwd', '/logs');

      const meta = getCapturedMeta();
      expect(meta.outcome).toBe('success');
      expect((meta.phases as Array<{ verdict: string }>)[0].verdict).toBe('pass');
    });

    it('retries the phase on VERDICT:FAIL and passes on second attempt', async () => {
      const session1 = createMockSession(['attempt 1 work', 'VERDICT:FAIL']);
      const session2 = createMockSession(['attempt 2 work', 'VERDICT:PASS']);
      vi.mocked(createAgentSession)
        .mockResolvedValueOnce({ session: session1 } as never)
        .mockResolvedValueOnce({ session: session2 } as never);

      const def = mission(BASE_CONFIG, () => {
        phase({ name: 'execute', maxAttempts: 3 }, async ({ prompt }) => {
          await prompt('Do the work');
          return (promptWithVerdict) => {
            return promptWithVerdict('Review the work');
          };
        });
      });

      await runMission(def, {}, '/cwd', '/logs');

      expect(createAgentSession).toHaveBeenCalledTimes(2);
      const meta = getCapturedMeta();
      expect(meta.outcome).toBe('success');
      const attempts = (meta.phases as Array<{ attempts: Array<{ verdict: string }> }>)[0].attempts;
      expect(attempts).toHaveLength(2);
      expect(attempts[0].verdict).toBe('fail');
      expect(attempts[1].verdict).toBe('pass');
    });

    it('marks mission as error when phase exhausts all attempts', async () => {
      const session = createMockSession(['work done', 'VERDICT:FAIL']);
      vi.mocked(createAgentSession).mockResolvedValue({ session } as never);

      const def = mission(BASE_CONFIG, () => {
        phase({ name: 'execute', maxAttempts: 2 }, async ({ prompt }) => {
          await prompt('Do the work');
          return (promptWithVerdict) => {
            return promptWithVerdict('Review the work');
          };
        });
      });

      await runMission(def, {}, '/cwd', '/logs');

      expect(createAgentSession).toHaveBeenCalledTimes(2);
      const meta = getCapturedMeta();
      expect(meta.outcome).toBe('error');
      expect((meta.phases as Array<{ verdict: string }>)[0].verdict).toBe('fail');
    });

    it('skips remaining phases after a phase fails', async () => {
      const session = createMockSession(['work done', 'VERDICT:FAIL']);
      vi.mocked(createAgentSession).mockResolvedValue({ session } as never);

      const def = mission(BASE_CONFIG, () => {
        phase({ name: 'execute', maxAttempts: 1 }, async ({ prompt }) => {
          await prompt('Do the work');
          return (promptWithVerdict) => {
            return promptWithVerdict('Review the work');
          };
        });
        phase({ name: 'cleanup' }, async ({ prompt }) => {
          await prompt('Clean up');
        });
      });

      await runMission(def, {}, '/cwd', '/logs');

      // Only 1 session created — cleanup phase never ran
      expect(createAgentSession).toHaveBeenCalledTimes(1);
    });
  });
});
