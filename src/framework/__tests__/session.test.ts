import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks — must be declared before importing modules that use them
// ---------------------------------------------------------------------------

vi.mock('@earendil-works/pi-coding-agent', () => ({
  createAgentSessionRuntime: vi.fn(),
  createAgentSessionFromServices: vi.fn(),
  createAgentSessionServices: vi.fn(),
  getAgentDir: vi.fn(() => '/agent'),
  SessionManager: {
    create: vi.fn(() => ({})),
    open: vi.fn(),
  },
  isToolCallEventType: (toolName: string, event: any) => event.toolName === toolName,
}));

vi.mock('../worktree.ts', () => ({
  createWorktree: vi.fn(),
}));

import {
  createAgentSessionRuntime,
  createAgentSessionFromServices,
  createAgentSessionServices,
  SessionManager,
} from '@earendil-works/pi-coding-agent';
import { createWorktree } from '../worktree.ts';
import { createSession } from '../session.ts';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build a text_delta event as emitted by the pi SDK. */
function textDelta(delta: string) {
  return { type: 'message_update', assistantMessageEvent: { type: 'text_delta', delta } };
}

/** Build a non-matching event to exercise the false branch in streamStdout. */
function otherEvent() {
  return { type: 'other' };
}

interface MockSession {
  abort: ReturnType<typeof vi.fn>;
  subscribe: ReturnType<typeof vi.fn>;
  prompt: ReturnType<typeof vi.fn>;
  setModel: ReturnType<typeof vi.fn>;
  sessionFile: string | undefined;
}

interface MockRuntime {
  session: MockSession;
  fork: ReturnType<typeof vi.fn>;
  dispose: ReturnType<typeof vi.fn>;
}

function buildMockRuntime(sessionFile: string | undefined = '/tmp/test.json'): MockRuntime {
  const session: MockSession = {
    abort: vi.fn(),
    subscribe: vi.fn(),
    prompt: vi.fn(),
    setModel: vi.fn(),
    sessionFile,
  };
  return { session, fork: vi.fn(), dispose: vi.fn() };
}

// ---------------------------------------------------------------------------
// Shared state
// ---------------------------------------------------------------------------

let mockRuntime: MockRuntime;
/** Tracks the most-recently subscribed callback (set by the subscribe mock). */
let lastSubscribeCb: ((e: unknown) => void) | undefined;

// ---------------------------------------------------------------------------
// Default test setup
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
  vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
  vi.spyOn(console, 'log').mockImplementation(() => {});

  lastSubscribeCb = undefined;
  mockRuntime = buildMockRuntime();

  // subscribe: track last callback; immediately fire both event types for branch coverage
  mockRuntime.session.subscribe.mockImplementation((cb: (e: unknown) => void) => {
    lastSubscribeCb = cb;
    cb(otherEvent()); // false branch in streamStdout
    cb(textDelta('')); // true branch in streamStdout
    return vi.fn(); // unsub
  });

  // prompt: fire the current lastSubscribeCb with an empty delta (neutral default)
  mockRuntime.session.prompt.mockImplementation(async () => {
    lastSubscribeCb?.(textDelta(''));
  });

  // createAgentSessionRuntime: call the factory to exercise factory code paths
  vi.mocked(createAgentSessionRuntime).mockImplementation(async (factory: any, opts: any) => {
    await factory({ cwd: opts.cwd, sessionManager: opts.sessionManager, sessionStartEvent: {} });
    return mockRuntime as any;
  });

  vi.mocked(createAgentSessionServices).mockResolvedValue({ diagnostics: {} } as any);
  vi.mocked(createAgentSessionFromServices).mockResolvedValue({} as any);

  vi.mocked(SessionManager.open).mockReturnValue({
    getLeafEntry: vi.fn(() => ({ id: 'chk-1' })),
  } as any);
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('createSession()', () => {
  it('creates a session and returns a MissionSession with the expected shape', async () => {
    const session = await createSession('/cwd');
    expect(session).toMatchObject({
      prompt: expect.any(Function),
      verify: expect.any(Function),
      getSessionFile: expect.any(Function),
      dispose: expect.any(Function),
    });
    await session.dispose();
  });

  it('invokes the SDK factory, exercising createAgentSessionServices and createAgentSessionFromServices', async () => {
    await createSession('/cwd');
    expect(createAgentSessionServices).toHaveBeenCalledWith({
      cwd: '/cwd',
      agentDir: expect.any(String),
      resourceLoaderOptions: {
        systemPromptOverride: expect.any(Function),
        extensionFactories: expect.any(Array),
      },
    });
    expect(createAgentSessionFromServices).toHaveBeenCalled();
  });

  it('attaches an abort listener when a signal is provided', async () => {
    const ac = new AbortController();
    const session = await createSession('/cwd', ac.signal);
    expect(mockRuntime.session.abort).not.toHaveBeenCalled();
    ac.abort();
    expect(mockRuntime.session.abort).toHaveBeenCalledTimes(1);
    await session.dispose();
  });
});

describe('prompt()', () => {
  it('delegates to the runtime session and captures a checkpoint', async () => {
    const session = await createSession('/cwd');
    await session.prompt('do something');
    expect(mockRuntime.session.prompt).toHaveBeenCalledWith('do something');
    expect(SessionManager.open).toHaveBeenCalledWith('/tmp/test.json');
    await session.dispose();
  });

  it('swallows the error when the abort signal has fired', async () => {
    const ac = new AbortController();
    const session = await createSession('/cwd', ac.signal);

    mockRuntime.session.prompt.mockImplementation(async () => {
      ac.abort(); // mark signal as aborted
      throw new Error('AbortError');
    });

    // Should not throw
    await expect(session.prompt('task')).resolves.toBeUndefined();
    await session.dispose();
  });

  it('rethrows errors unrelated to an abort signal', async () => {
    const session = await createSession('/cwd');
    mockRuntime.session.prompt.mockRejectedValue(new Error('network error'));
    await expect(session.prompt('task')).rejects.toThrow('network error');
    await session.dispose();
  });
});

describe('verify()', () => {
  it('resolves when the verifier outputs VERDICT: PASS', async () => {
    const session = await createSession('/cwd');
    await session.prompt('do work');

    mockRuntime.session.prompt.mockImplementationOnce(async () => {
      lastSubscribeCb?.(textDelta('VERDICT: PASS'));
    });

    await expect(session.verify('check the work')).resolves.toBeUndefined();
    await session.dispose();
  });

  it('throws when the verifier produces no recognisable verdict', async () => {
    const session = await createSession('/cwd');
    await session.prompt('do work');
    // Default prompt fires empty delta — no verdict token

    await expect(session.verify('check it')).rejects.toThrow('verifier did not produce a verdict');
    await session.dispose();
  });

  it('throws after exhausting all retries', async () => {
    const session = await createSession('/cwd');
    await session.prompt('do work');

    // Every verify prompt returns FAIL; retry prompts return empty output
    let callIdx = 0;
    mockRuntime.session.prompt.mockImplementation(async () => {
      const idx = callIdx++;
      // Odd calls (0, 2, …) are verify prompts; even calls (1, 3, …) are retry prompts.
      // With maxRetries=2: verify call 0 → FAIL, retry call 1 → '', verify call 2 → FAIL → throw
      if (idx % 2 === 0) {
        lastSubscribeCb?.(textDelta('VERDICT: FAIL: always broken'));
      }
    });

    await expect(session.verify('check', { maxRetries: 2 })).rejects.toThrow(
      'verification failed after 2 attempt(s)',
    );
    await session.dispose();
  });

  it('throws when there is no checkpoint to fork back to', async () => {
    // Mutate sessionFile on the shared mockRuntime so getCheckpointId returns undefined
    mockRuntime.session.sessionFile = undefined;

    const session = await createSession('/cwd');
    await session.prompt('do work'); // checkpointId captured as undefined

    mockRuntime.session.prompt.mockImplementationOnce(async () => {
      lastSubscribeCb?.(textDelta('VERDICT: FAIL: no checkpoint'));
    });

    await expect(session.verify('check', { maxRetries: 2 })).rejects.toThrow(
      'cannot retry — no checkpoint entry',
    );
    await session.dispose();
  });

  it('forks the session and retries on VERDICT: FAIL, then resolves on VERDICT: PASS', async () => {
    const session = await createSession('/cwd');
    await session.prompt('do work');

    // Call sequence after initial prompt():
    //   0 → verify attempt 0: FAIL
    //   1 → retry main prompt (fires to streamStdout cb): empty
    //   2 → verify attempt 1: PASS
    let callIdx = 0;
    mockRuntime.session.prompt.mockImplementation(async () => {
      const responses = ['VERDICT: FAIL: first try', '', 'VERDICT: PASS'];
      lastSubscribeCb?.(textDelta(responses[callIdx++] ?? ''));
    });

    await expect(session.verify('check', { maxRetries: 2 })).resolves.toBeUndefined();
    expect(mockRuntime.fork).toHaveBeenCalledWith('chk-1');
    expect(console.log).toHaveBeenCalledWith(expect.stringContaining('forking and retrying'));
    await session.dispose();
  });
});

describe('getSessionFile()', () => {
  it('returns the path of the active session file', async () => {
    const session = await createSession('/cwd');
    expect(session.getSessionFile()).toBe('/tmp/test.json');
    await session.dispose();
  });

  it('returns undefined when there is no session file', async () => {
    mockRuntime.session.sessionFile = undefined;

    const session = await createSession('/cwd');
    expect(session.getSessionFile()).toBeUndefined();
    await session.dispose();
  });
});

describe('dispose()', () => {
  it('calls runtime.dispose and logs the saved session path', async () => {
    const session = await createSession('/cwd');
    await session.dispose();
    expect(mockRuntime.dispose).toHaveBeenCalledTimes(1);
    expect(console.log).toHaveBeenCalledWith(expect.stringContaining('/tmp/test.json'));
  });

  it('calls runtime.dispose without logging when there is no session file', async () => {
    mockRuntime.session.sessionFile = undefined;

    const session = await createSession('/cwd');
    await session.dispose();
    expect(mockRuntime.dispose).toHaveBeenCalledTimes(1);
    expect(console.log).not.toHaveBeenCalled();
  });
});

describe('getCheckpointId (internal, exercised via prompt)', () => {
  it('returns undefined when getLeafEntry returns null', async () => {
    vi.mocked(SessionManager.open).mockReturnValueOnce({
      getLeafEntry: vi.fn(() => undefined),
    } as any);

    const session = await createSession('/cwd');
    // prompt() calls getCheckpointId; with getLeafEntry returning undefined the checkpoint is undefined
    await session.prompt('task');

    // Verify that a subsequent fork attempt throws "no checkpoint"
    mockRuntime.session.prompt.mockImplementationOnce(async () => {
      lastSubscribeCb?.(textDelta('VERDICT: FAIL: no entry'));
    });

    await expect(session.verify('check', { maxRetries: 2 })).rejects.toThrow(
      'cannot retry — no checkpoint entry',
    );
    await session.dispose();
  });
});

// ---------------------------------------------------------------------------
// streamStdout event handling
// ---------------------------------------------------------------------------

describe('streamStdout event handling', () => {
  function fire(event: unknown) {
    lastSubscribeCb?.(event);
  }

  it('handles all message_update sub-types (verbose=true)', async () => {
    const session = await createSession('/cwd');
    await session.prompt('task'); // sets lastSubscribeCb via subscribe mock

    fire({ type: 'message_update', assistantMessageEvent: { type: 'text_start' } });
    fire({ type: 'message_update', assistantMessageEvent: { type: 'thinking_start' } });
    fire({
      type: 'message_update',
      assistantMessageEvent: { type: 'toolcall_start', contentIndex: 2 },
    });
    fire({ type: 'message_update', assistantMessageEvent: { type: 'unrecognised' } });

    expect(process.stderr.write).toHaveBeenCalledWith(
      expect.stringContaining('generating response'),
    );
    expect(process.stderr.write).toHaveBeenCalledWith(expect.stringContaining('thinking'));
    expect(process.stderr.write).toHaveBeenCalledWith(expect.stringContaining('calling tool'));
    await session.dispose();
  });

  it('suppresses verbose-only message_update events when verbose=false', async () => {
    const session = await createSession('/cwd', undefined, undefined, undefined, false);
    await session.prompt('task');

    fire({ type: 'message_update', assistantMessageEvent: { type: 'text_start' } });
    fire({ type: 'message_update', assistantMessageEvent: { type: 'thinking_start' } });
    fire({
      type: 'message_update',
      assistantMessageEvent: { type: 'toolcall_start', contentIndex: 1 },
    });

    expect(process.stderr.write).not.toHaveBeenCalledWith(
      expect.stringContaining('generating response'),
    );
    await session.dispose();
  });

  it('handles tool_execution_start with short and long args', async () => {
    const session = await createSession('/cwd');
    await session.prompt('task');

    fire({ type: 'tool_execution_start', toolName: 'bash', args: { command: 'ls' } });
    fire({ type: 'tool_execution_start', toolName: 'bash', args: { command: 'x'.repeat(100) } });

    expect(process.stderr.write).toHaveBeenCalledWith(expect.stringContaining('executing bash'));
    await session.dispose();
  });

  it('handles tool_execution_update with and without text content', async () => {
    const session = await createSession('/cwd');
    await session.prompt('task');

    fire({
      type: 'tool_execution_update',
      partialResult: { content: [{ type: 'text', text: 'hello world' }] },
    });
    fire({ type: 'tool_execution_update', partialResult: { content: [{ type: 'image' }] } });
    fire({ type: 'tool_execution_update', partialResult: null });

    expect(process.stderr.write).toHaveBeenCalledWith(
      expect.stringContaining('output: hello world'),
    );
    await session.dispose();
  });

  it('handles tool_execution_end for success and error', async () => {
    const session = await createSession('/cwd');
    await session.prompt('task');

    fire({ type: 'tool_execution_end', isError: false, toolName: 'bash' });
    fire({ type: 'tool_execution_end', isError: true, toolName: 'bash' });

    expect(process.stderr.write).toHaveBeenCalledWith(expect.stringContaining('✓ bash done'));
    expect(process.stderr.write).toHaveBeenCalledWith(expect.stringContaining('✗ bash failed'));
    await session.dispose();
  });

  it('handles turn_start and turn_end (verbose=true)', async () => {
    const session = await createSession('/cwd');
    await session.prompt('task');

    fire({ type: 'turn_start' });
    fire({ type: 'turn_end' });

    expect(process.stderr.write).toHaveBeenCalledWith('[pi] turn start\n');
    expect(process.stderr.write).toHaveBeenCalledWith('[pi] turn complete\n');
    await session.dispose();
  });

  it('suppresses turn_start and turn_end when verbose=false', async () => {
    const session = await createSession('/cwd', undefined, undefined, undefined, false);
    await session.prompt('task');

    fire({ type: 'turn_start' });
    fire({ type: 'turn_end' });

    expect(process.stderr.write).not.toHaveBeenCalledWith('[pi] turn start\n');
    await session.dispose();
  });

  it('handles compaction_start and all compaction_end variants', async () => {
    const session = await createSession('/cwd');
    await session.prompt('task');

    fire({ type: 'compaction_start', reason: 'context full' });
    fire({ type: 'compaction_end', result: { tokensBefore: 1000, summary: 'x'.repeat(200) } });
    fire({ type: 'compaction_end', result: null, aborted: true });
    fire({ type: 'compaction_end', result: null, aborted: false });

    expect(process.stderr.write).toHaveBeenCalledWith(
      expect.stringContaining('compacting context'),
    );
    expect(process.stderr.write).toHaveBeenCalledWith(expect.stringContaining('compaction done'));
    expect(process.stderr.write).toHaveBeenCalledWith(
      expect.stringContaining('compaction aborted'),
    );
    expect(process.stderr.write).toHaveBeenCalledWith(expect.stringContaining('compaction failed'));
    await session.dispose();
  });

  it('handles auto_retry_start and auto_retry_end', async () => {
    const session = await createSession('/cwd');
    await session.prompt('task');

    fire({ type: 'auto_retry_start', attempt: 1, maxAttempts: 3, delayMs: 500 });
    fire({ type: 'auto_retry_end', success: true, attempt: 1 });
    fire({ type: 'auto_retry_end', success: false, attempt: 2 });

    expect(process.stderr.write).toHaveBeenCalledWith(expect.stringContaining('retrying'));
    expect(process.stderr.write).toHaveBeenCalledWith(expect.stringContaining('retry succeeded'));
    expect(process.stderr.write).toHaveBeenCalledWith(expect.stringContaining('retry failed'));
    await session.dispose();
  });

  it('handles agent_start and agent_end (verbose=true and false)', async () => {
    const session = await createSession('/cwd');
    await session.prompt('task');

    fire({ type: 'agent_start' });
    fire({ type: 'agent_end' });

    expect(process.stderr.write).toHaveBeenCalledWith(expect.stringContaining('agent starting'));
    expect(process.stderr.write).toHaveBeenCalledWith(expect.stringContaining('agent done'));
    await session.dispose();

    const session2 = await createSession('/cwd', undefined, undefined, undefined, false);
    vi.mocked(process.stderr.write).mockClear();
    await session2.prompt('task');
    fire({ type: 'agent_start' });
    fire({ type: 'agent_end' });
    expect(process.stderr.write).not.toHaveBeenCalledWith(
      expect.stringContaining('agent starting'),
    );
    await session2.dispose();
  });
});

// ---------------------------------------------------------------------------
// enforceSearchTools extension
// ---------------------------------------------------------------------------

describe('enforceSearchTools extension', () => {
  let piHandlers: Record<string, (...args: any[]) => any> = {};

  beforeEach(async () => {
    piHandlers = {};

    vi.mocked(createAgentSessionServices).mockImplementation(async (opts: any) => {
      const factories: Array<(pi: any) => void> =
        opts?.resourceLoaderOptions?.extensionFactories ?? [];
      const mockPi = {
        on: (event: string, handler: (...args: any[]) => any) => {
          piHandlers[event] = handler;
        },
      };
      for (const factory of factories) factory(mockPi);
      return { diagnostics: {} } as any;
    });

    await createSession('/cwd');
  });

  it('blocks the native grep tool', async () => {
    const result = await piHandlers['tool_call']?.({ toolName: 'grep', input: {} }, {});
    expect(result).toEqual({ block: true, reason: expect.stringContaining('ag') });
  });

  it('blocks the native find tool', async () => {
    const result = await piHandlers['tool_call']?.({ toolName: 'find', input: {} }, {});
    expect(result).toEqual({ block: true, reason: expect.stringContaining('fd') });
  });

  it('blocks grep inside a bash command', async () => {
    const result = await piHandlers['tool_call']?.(
      {
        toolName: 'bash',
        input: { command: 'grep foo bar.ts' },
      },
      {},
    );
    expect(result).toEqual({ block: true, reason: expect.stringContaining('ag') });
  });

  it('blocks find inside a bash command', async () => {
    const result = await piHandlers['tool_call']?.(
      {
        toolName: 'bash',
        input: { command: 'find . -name "*.ts"' },
      },
      {},
    );
    expect(result).toEqual({ block: true, reason: expect.stringContaining('fd') });
  });

  it('blocks bash commands using both grep and find', async () => {
    const result = await piHandlers['tool_call']?.(
      {
        toolName: 'bash',
        input: { command: 'grep foo . && find . -name bar' },
      },
      {},
    );
    expect(result).toMatchObject({ block: true });
    expect((result as any).reason).toContain('ag');
    expect((result as any).reason).toContain('fd');
  });

  it('passes through bash commands without grep or find', async () => {
    const result = await piHandlers['tool_call']?.(
      {
        toolName: 'bash',
        input: { command: 'ls -la && cat file.ts' },
      },
      {},
    );
    expect(result).toBeUndefined();
  });

  it('passes through other tool calls', async () => {
    const result = await piHandlers['tool_call']?.({ toolName: 'read', input: {} }, {});
    expect(result).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// verify() — error recovery (catch block on non-last attempt)
// ---------------------------------------------------------------------------

describe('verify() prompt error on a non-last attempt', () => {
  it('falls through to retry when the verify prompt throws before the final attempt', async () => {
    const session = await createSession('/cwd');
    await session.prompt('do work');

    let callIdx = 0;
    mockRuntime.session.prompt.mockImplementation(async () => {
      const idx = callIdx++;
      if (idx === 0) throw new Error('transient network error');
      if (idx === 1) lastSubscribeCb?.(textDelta('')); // retry main prompt
      if (idx === 2) lastSubscribeCb?.(textDelta('VERDICT: PASS'));
    });

    await expect(session.verify('check', { maxRetries: 2 })).resolves.toBeUndefined();
    await session.dispose();
  });

  it('rethrows on the final attempt when the verify prompt errors', async () => {
    const session = await createSession('/cwd');
    await session.prompt('do work');

    mockRuntime.session.prompt.mockRejectedValue(new Error('fatal error'));

    await expect(session.verify('check', { maxRetries: 1 })).rejects.toThrow('fatal error');
    await session.dispose();
  });
});

// ---------------------------------------------------------------------------
// Worktree integration
// ---------------------------------------------------------------------------

describe('worktree integration', () => {
  it('creates a worktree and cleans it up on dispose', async () => {
    const mockCleanup = vi.fn();
    vi.mocked(createWorktree).mockResolvedValue({ path: '/tmp/wt-1', cleanup: mockCleanup });

    const session = await createSession('/cwd', undefined, undefined, { ref: 'main' });
    await session.dispose();

    expect(createWorktree).toHaveBeenCalledWith('/cwd', { ref: 'main' });
    expect(mockCleanup).toHaveBeenCalledTimes(1);
    expect(console.log).toHaveBeenCalledWith(expect.stringContaining('/tmp/wt-1'));
  });
});
