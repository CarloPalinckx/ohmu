export interface MissionAttempt {
  sessionFile: string;
  durationMs: number;
  verdict: "pass" | "fail";
}

export interface MissionPhase {
  name: string;
  startedAt: string;
  completedAt: string;
  durationMs: number;
  verdict: "pass" | "fail";
  attempts: MissionAttempt[];
}

export interface Mission {
  missionId: string;
  mission: string;
  parameters: Record<string, unknown>;
  startedAt: string;
  completedAt: string;
  durationMs: number;
  outcome: "success" | "error";
  phases: MissionPhase[];
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
  /** anthropic-messages metadata */
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
  type: "session" | "model_change" | "thinking_level_change" | "message";
  id: string;
  parentId: string | null;
  timestamp: string;
  message?: AnyMessage;
  /** present on model_change */
  modelId?: string;
  provider?: string;
  /** present on thinking_level_change */
  thinkingLevel?: string;
  [key: string]: unknown;
}
