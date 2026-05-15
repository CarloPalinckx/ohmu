import type { AgentSession } from '@earendil-works/pi-coding-agent';

/**
 * Subscribe to a session and accumulate assistant text output.
 * Streams output to stdout in real time.
 * Returns a getter for the text captured since the last reset, and a reset fn.
 *
 * @param session - Active Pi session to subscribe to.
 */
export function captureOutput(session: AgentSession) {
  let buffer = '';
  const unsubscribe = session.subscribe((event) => {
    if (
      event.type === 'message_update' &&
      event.assistantMessageEvent.type === 'text_delta'
    ) {
      process.stdout.write(event.assistantMessageEvent.delta);
      buffer += event.assistantMessageEvent.delta;
    }
  });
  return {
    latest: () => buffer,
    reset: () => { buffer = ''; },
    unsubscribe,
  };
}
