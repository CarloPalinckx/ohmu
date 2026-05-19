import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { isToolCallEventType } from "@earendil-works/pi-coding-agent";

/**
 * Rejects bash tool calls that use `grep` or `find`, forcing the agent
 * to use `ag` and `fd` instead. The block message tells the agent exactly
 * what to use so it can reformulate without getting stuck.
 */
export default function (pi: ExtensionAPI) {
  pi.on("tool_call", async (event, _ctx) => {
    if (!isToolCallEventType("bash", event)) return;

    const cmd = event.input.command;

    // Match standalone `grep` / `find` — skip if they appear only in comments or strings.
    // A simple word-boundary check is enough; false negatives are fine.
    const usesGrep = /\bgrep\b/.test(cmd);
    const usesFind = /\bfind\b/.test(cmd);

    if (!usesGrep && !usesFind) return;

    const reasons: string[] = [];
    if (usesGrep) reasons.push("`grep` is not allowed — use `ag <pattern> [path]` instead");
    if (usesFind) reasons.push("`find` is not allowed — use `fd <pattern> [path]` instead");

    return { block: true, reason: reasons.join("; ") };
  });
}
