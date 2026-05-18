import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@earendil-works/pi-ai', () => ({
  getModel: vi.fn((provider: string, id: string) => {
    if (provider !== 'anthropic') return undefined;
    const known: Record<string, { id: string; name: string }> = {
      'claude-haiku-4-5': { id: 'claude-haiku-4-5', name: 'Haiku' },
      'claude-sonnet-4-5': { id: 'claude-sonnet-4-5', name: 'Sonnet' },
      'claude-opus-4-5': { id: 'claude-opus-4-5', name: 'Opus' },
    };
    return known[id] ?? undefined;
  }),
}));

import { resolveEscalation, subscribeEscalation } from '../escalation.ts';
import type { ResolvedEscalation } from '../escalation.ts';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function toolStart(toolName: string, args: unknown = {}) {
  return { type: 'tool_execution_start', toolCallId: '1', toolName, args };
}

function toolEnd(toolName: string) {
  return { type: 'tool_execution_end', toolCallId: '1', toolName, result: {}, isError: false };
}

function buildMockSession() {
  let listener: ((event: unknown) => void) | undefined;
  return {
    setModel: vi.fn(),
    subscribe: vi.fn((cb: (event: unknown) => void) => {
      listener = cb;
      return vi.fn();
    }),
    emit(event: unknown) {
      listener?.(event);
    },
  };
}

// ---------------------------------------------------------------------------
// resolveEscalation
// ---------------------------------------------------------------------------

describe('resolveEscalation()', () => {
  it('uses haiku → sonnet defaults when called with no config', () => {
    const resolved = resolveEscalation();
    expect(resolved.models).toHaveLength(2);
    expect(resolved.models[0].model.id).toBe('claude-haiku-4-5');
    expect(resolved.models[1].model.id).toBe('claude-sonnet-4-5');
  });

  it('defaults threshold to 4 for each step', () => {
    const resolved = resolveEscalation();
    expect(resolved.models[0].threshold).toBe(4);
    expect(resolved.models[1].threshold).toBe(4);
  });

  it('resolves a custom models array', () => {
    const resolved = resolveEscalation({
      models: [{ id: 'claude-haiku-4-5', threshold: 2 }, { id: 'claude-sonnet-4-5' }],
    });
    expect(resolved.models[0].threshold).toBe(2);
    expect(resolved.models[1].threshold).toBe(4); // default
  });

  it('resolves a three-step ladder', () => {
    const resolved = resolveEscalation({
      models: [
        { id: 'claude-haiku-4-5', threshold: 1 },
        { id: 'claude-sonnet-4-5', threshold: 3 },
        { id: 'claude-opus-4-5' },
      ],
    });
    expect(resolved.models).toHaveLength(3);
    expect(resolved.models[2].model.id).toBe('claude-opus-4-5');
  });

  it('throws when fewer than 2 models are provided', () => {
    expect(() => resolveEscalation({ models: [{ id: 'claude-haiku-4-5' }] })).toThrow(
      'at least 2 entries',
    );
  });

  it('throws when a model ID is not found', () => {
    expect(() =>
      resolveEscalation({ models: [{ id: 'claude-haiku-4-5' }, { id: 'does-not-exist' }] }),
    ).toThrow('model not found: "does-not-exist"');
  });
});

// ---------------------------------------------------------------------------
// subscribeEscalation
// ---------------------------------------------------------------------------

describe('subscribeEscalation()', () => {
  let session: ReturnType<typeof buildMockSession>;
  let escalation: ResolvedEscalation;

  beforeEach(() => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    session = buildMockSession();
    escalation = resolveEscalation({
      models: [
        { id: 'claude-haiku-4-5', threshold: 2 },
        { id: 'claude-sonnet-4-5', threshold: 3 },
        { id: 'claude-opus-4-5' },
      ],
    });
  });

  it('returns an unsubscribe function', () => {
    const unsub = subscribeEscalation(session as any, escalation);
    expect(unsub).toBeTypeOf('function');
  });

  it('does not escalate when tool calls vary', () => {
    subscribeEscalation(session as any, escalation);
    session.emit(toolStart('bash', { command: 'ls' }));
    session.emit(toolEnd('bash'));
    session.emit(toolStart('read', { path: '/foo' }));
    session.emit(toolEnd('read'));
    expect(session.setModel).not.toHaveBeenCalled();
  });

  it('escalates from haiku to sonnet after threshold identical calls', () => {
    subscribeEscalation(session as any, escalation);
    // threshold is 2 — two identical calls should trigger
    session.emit(toolStart('bash', { command: 'ls' }));
    session.emit(toolEnd('bash'));
    session.emit(toolStart('bash', { command: 'ls' }));
    session.emit(toolEnd('bash'));
    expect(session.setModel).toHaveBeenCalledOnce();
    expect(session.setModel).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'claude-sonnet-4-5' }),
    );
  });

  it('does not escalate on threshold - 1 identical calls', () => {
    subscribeEscalation(session as any, escalation);
    session.emit(toolStart('bash', { command: 'ls' }));
    session.emit(toolEnd('bash'));
    expect(session.setModel).not.toHaveBeenCalled();
  });

  it('resets the window after escalation and can escalate again', () => {
    subscribeEscalation(session as any, escalation);

    // Trigger haiku → sonnet (threshold 2)
    session.emit(toolStart('bash', { command: 'ls' }));
    session.emit(toolEnd('bash'));
    session.emit(toolStart('bash', { command: 'ls' }));
    session.emit(toolEnd('bash'));
    expect(session.setModel).toHaveBeenCalledOnce();

    // Now on sonnet (threshold 3) — three identical calls trigger again
    session.emit(toolStart('read', { path: '/x' }));
    session.emit(toolEnd('read'));
    session.emit(toolStart('read', { path: '/x' }));
    session.emit(toolEnd('read'));
    session.emit(toolStart('read', { path: '/x' }));
    session.emit(toolEnd('read'));
    expect(session.setModel).toHaveBeenCalledTimes(2);
    expect(session.setModel).toHaveBeenLastCalledWith(
      expect.objectContaining({ id: 'claude-opus-4-5' }),
    );
  });

  it('does not escalate once already at the top of the ladder', () => {
    const twoStep = resolveEscalation({
      models: [{ id: 'claude-haiku-4-5', threshold: 1 }, { id: 'claude-sonnet-4-5' }],
    });
    subscribeEscalation(session as any, twoStep);

    // Escalate to sonnet
    session.emit(toolStart('bash', { command: 'ls' }));
    session.emit(toolEnd('bash'));
    expect(session.setModel).toHaveBeenCalledOnce();

    // Further identical calls should not escalate beyond sonnet
    session.emit(toolStart('bash', { command: 'ls' }));
    session.emit(toolEnd('bash'));
    session.emit(toolStart('bash', { command: 'ls' }));
    session.emit(toolEnd('bash'));
    expect(session.setModel).toHaveBeenCalledOnce();
  });

  it('logs the stuck reason on escalation', () => {
    subscribeEscalation(session as any, escalation);
    session.emit(toolStart('bash', { command: 'ls' }));
    session.emit(toolEnd('bash'));
    session.emit(toolStart('bash', { command: 'ls' }));
    session.emit(toolEnd('bash'));
    expect(console.log).toHaveBeenCalledWith(expect.stringContaining('stuck detected'));
    expect(console.log).toHaveBeenCalledWith(expect.stringContaining('Sonnet'));
  });

  it('unsubscribes cleanly', () => {
    const unsub = subscribeEscalation(session as any, escalation);
    unsub();
    expect(session.subscribe).toHaveReturnedWith(expect.any(Function));
  });
});
