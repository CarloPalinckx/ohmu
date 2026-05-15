"use client";

import * as React from "react";
import { ChevronDown, Terminal, User, Bot, Wrench, AlertCircle } from "lucide-react";
import { cn, truncate } from "@/lib/utils";
import type {
  TranscriptEvent,
  ContentBlock,
  UserMessage,
  AssistantMessage,
  ToolResultMessage,
} from "@/lib/types";

const MAX_TEXT_PREVIEW = 600;
const MAX_TOOL_OUTPUT = 2000;

interface Props {
  events: TranscriptEvent[];
}

/**
 * Renders a JSONL session transcript as a structured conversation view.
 * Handles user messages, assistant messages (with thinking + tool calls),
 * and tool results.
 */
export function TranscriptView({ events }: Props) {
  const messages = events.filter((e) => e.type === "message" && e.message);

  if (messages.length === 0) {
    return (
      <p className="px-4 py-6 text-sm text-muted-foreground text-center">
        No messages in transcript.
      </p>
    );
  }

  return (
    <div className="divide-y divide-border">
      {messages.map((event) => {
        const msg = event.message!;
        if (msg.role === "user") {
          return (
            <UserTurn key={event.id} message={msg as UserMessage} />
          );
        }
        if (msg.role === "assistant") {
          return (
            <AssistantTurn
              key={event.id}
              message={msg as AssistantMessage}
            />
          );
        }
        if (msg.role === "toolResult") {
          return (
            <ToolResultTurn
              key={event.id}
              message={msg as ToolResultMessage}
            />
          );
        }
        return null;
      })}
    </div>
  );
}

// ── Turn components ──────────────────────────────────────────────────────────

function UserTurn({ message }: { message: UserMessage }) {
  const textBlocks = message.content.filter(
    (b): b is Extract<ContentBlock, { type: "text" }> => b.type === "text"
  );
  const text = textBlocks.map((b) => b.text).join("\n\n");

  return (
    <div className="px-4 py-3 bg-blue-950/20 border-l-2 border-blue-600/40">
      <div className="flex items-center gap-2 mb-2">
        <User className="h-3.5 w-3.5 text-blue-400 shrink-0" />
        <span className="text-xs font-semibold text-blue-400 uppercase tracking-wider">
          User
        </span>
      </div>
      <ExpandableText text={text} max={MAX_TEXT_PREVIEW} className="text-sm text-foreground/80 whitespace-pre-wrap font-mono" />
    </div>
  );
}

function AssistantTurn({ message }: { message: AssistantMessage }) {
  const blocks = message.content;

  return (
    <div className="px-4 py-3 border-l-2 border-indigo-600/40">
      <div className="flex items-center gap-2 mb-2">
        <Bot className="h-3.5 w-3.5 text-indigo-400 shrink-0" />
        <span className="text-xs font-semibold text-indigo-400 uppercase tracking-wider">
          Assistant
        </span>
        {message.model && (
          <span className="text-xs text-muted-foreground font-mono">
            {message.model}
          </span>
        )}
        {message.usage?.cost?.total !== undefined && (
          <span className="ml-auto text-xs text-muted-foreground">
            ${message.usage.cost.total.toFixed(4)}
          </span>
        )}
      </div>

      <div className="space-y-2">
        {blocks.map((block, i) => {
          if (block.type === "thinking") {
            return (
              <ThinkingBlock key={i} text={block.thinking} />
            );
          }
          if (block.type === "text") {
            return (
              <ExpandableText
                key={i}
                text={block.text}
                max={MAX_TEXT_PREVIEW}
                className="text-sm text-foreground/90 whitespace-pre-wrap"
              />
            );
          }
          if (block.type === "toolCall") {
            return (
              <ToolCallBlock
                key={i}
                name={block.name}
                args={block.arguments}
              />
            );
          }
          return null;
        })}
      </div>
    </div>
  );
}

function ToolResultTurn({ message }: { message: ToolResultMessage }) {
  const text = message.content.map((c) => c.text).join("\n");

  return (
    <div className={cn(
      "px-4 py-3 border-l-2",
      message.isError
        ? "bg-red-950/20 border-red-600/40"
        : "bg-zinc-900/40 border-zinc-600/30"
    )}>
      <div className="flex items-center gap-2 mb-2">
        {message.isError ? (
          <AlertCircle className="h-3.5 w-3.5 text-red-400 shrink-0" />
        ) : (
          <Terminal className="h-3.5 w-3.5 text-zinc-400 shrink-0" />
        )}
        <span className={cn(
          "text-xs font-semibold uppercase tracking-wider font-mono",
          message.isError ? "text-red-400" : "text-zinc-400"
        )}>
          {message.toolName}
        </span>
        {message.isError && (
          <span className="text-xs text-red-400">error</span>
        )}
      </div>
      <ExpandableText
        text={text}
        max={MAX_TOOL_OUTPUT}
        className="text-xs text-muted-foreground whitespace-pre-wrap font-mono"
      />
    </div>
  );
}

// ── Sub-components ───────────────────────────────────────────────────────────

/** Collapsible thinking block. */
function ThinkingBlock({ text }: { text: string }) {
  const [open, setOpen] = React.useState(false);
  const preview = truncate(text, 120);

  return (
    <div className="rounded border border-border bg-muted/30 text-xs">
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between gap-2 px-3 py-2 text-left hover:bg-muted/50 transition-colors"
      >
        <span className="text-muted-foreground italic">
          {open ? "Thinking" : preview}
        </span>
        <ChevronDown
          className={cn(
            "h-3.5 w-3.5 text-muted-foreground shrink-0 transition-transform",
            open && "rotate-180"
          )}
        />
      </button>
      {open && (
        <div className="px-3 pb-3 text-muted-foreground whitespace-pre-wrap italic border-t border-border pt-2">
          {text}
        </div>
      )}
    </div>
  );
}

/** Tool call display block with collapsible arguments. */
function ToolCallBlock({
  name,
  args,
}: {
  name: string;
  args: Record<string, unknown>;
}) {
  const [open, setOpen] = React.useState(false);
  const argStr = JSON.stringify(args, null, 2);

  // For bash/read, show the command/path inline
  const inlinePreview =
    name === "bash" && typeof args.command === "string"
      ? truncate(args.command as string, 80)
      : name === "read" && typeof args.path === "string"
      ? (args.path as string)
      : null;

  return (
    <div className="rounded border border-border bg-muted/20 text-xs font-mono">
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-muted/40 transition-colors"
      >
        <Wrench className="h-3.5 w-3.5 text-amber-400 shrink-0" />
        <span className="text-amber-400 font-semibold">{name}</span>
        {inlinePreview && !open && (
          <span className="text-muted-foreground truncate">{inlinePreview}</span>
        )}
        <ChevronDown
          className={cn(
            "h-3.5 w-3.5 text-muted-foreground shrink-0 ml-auto transition-transform",
            open && "rotate-180"
          )}
        />
      </button>
      {open && (
        <pre className="px-3 pb-3 text-muted-foreground overflow-x-auto border-t border-border pt-2 text-[11px]">
          {argStr}
        </pre>
      )}
    </div>
  );
}

/** Text that shows a truncated preview with a "Show more" toggle. */
function ExpandableText({
  text,
  max,
  className,
}: {
  text: string;
  max: number;
  className?: string;
}) {
  const [expanded, setExpanded] = React.useState(false);
  const needsTruncation = text.length > max;

  const displayed = needsTruncation && !expanded ? text.slice(0, max) + "…" : text;

  return (
    <div>
      <p className={className}>{displayed}</p>
      {needsTruncation && (
        <button
          onClick={() => setExpanded((v) => !v)}
          className="mt-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
        >
          {expanded ? "Show less" : `Show ${text.length - max} more chars`}
        </button>
      )}
    </div>
  );
}
