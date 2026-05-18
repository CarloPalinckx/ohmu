export interface Session {
  /** UUID from the session filename (after the underscore). */
  id: string;
  /** Absolute path to the JSONL file. */
  file: string;
  /** Working directory stored in the session header. */
  cwd: string;
  /** Human-readable workspace name — basename of cwd. */
  workspace: string;
  /** ISO timestamp from the session header. */
  startedAt: string;
  /** ISO timestamp of the last message, or null if empty. */
  endedAt: string | null;
  /** Duration in ms, or null if endedAt is unavailable. */
  durationMs: number | null;
  /** Derived from VERDICT lines in assistant messages. */
  outcome: "pass" | "fail" | "unknown";
  /** Total number of message entries in the session. */
  messageCount: number;
  /**
   * Absolute path of the parent session file, if this session was forked
   * from another (e.g. a verify() retry branch).
   */
  parentSession: string | null;
}

// ── Transcript ──────────────────────────────────────────────────────────────

export type ContentBlock =
  | { type: "text"; text: string }
  | { type: "thinking"; thinking: string; thinkingSignature?: string }
  | { type: "toolCall"; id: string; name: string; arguments: Record<string, unknown> }
  | { type: "image"; source: unknown };

export interface UserMessage {
  role: "user";
  content: ContentBlock[];
}

export interface AssistantMessage {
  role: "assistant";
  content: ContentBlock[];
  usage?: { input: number; output: number; totalTokens: number; cost?: { total: number } };
  model?: string;
}

export interface ToolResultMessage {
  role: "toolResult";
  toolCallId: string;
  toolName: string;
  content: Array<{ type: string; text: string }>;
  isError: boolean;
}

export type AnyMessage = UserMessage | AssistantMessage | ToolResultMessage;

export interface TranscriptEvent {
  type: "session" | "message" | "model_change" | "thinking_level_change" | string;
  id: string;
  parentId: string | null;
  timestamp: string;
  message?: AnyMessage;
  modelId?: string;
  provider?: string;
  thinkingLevel?: string;
  [key: string]: unknown;
}
