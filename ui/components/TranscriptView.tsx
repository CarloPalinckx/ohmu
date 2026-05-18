"use client";

import * as React from "react";
import { ChevronDown, Terminal, User, Bot, Wrench, AlertCircle, GitBranch, Cpu, Zap, ShieldCheck, ShieldX, ClipboardCheck } from "lucide-react";
import { cn, truncate } from "@/lib/utils";
import { buildSessionTree } from "@/lib/tree";
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
 * Renders a pi session as a structured conversation view, preserving the
 * session tree. In-file branches (off-path entries from the same JSONL) are
 * shown as collapsed ⎇ Branch sections at the point of divergence.
 */
export function TranscriptView({ events }: Props) {
  const tree = buildSessionTree(events);
  const mainMessages = tree.mainPath.filter((e) => e.type === "message" && e.message);

  if (mainMessages.length === 0) {
    return (
      <p className="px-4 py-6 text-sm text-muted-foreground text-center">
        No messages in transcript.
      </p>
    );
  }

  return (
    <div className="divide-y divide-border">
      {tree.mainPath.map((event) => (
        <React.Fragment key={event.id}>
          {/* Render the event itself */}
          <EventRow event={event} />

          {/* Render off-path branches that diverge after this entry */}
          {tree.branchesAt.get(event.id)?.map((branch, i) => (
            <BranchSection key={i} index={i} events={branch} />
          ))}
        </React.Fragment>
      ))}
    </div>
  );
}

// ── Event router ─────────────────────────────────────────────────────────────

function EventRow({ event }: { event: TranscriptEvent }) {
  if (event.type === "message" && event.message) {
    const msg = event.message;
    if (msg.role === "user") return <UserTurn message={msg as UserMessage} />;
    if (msg.role === "assistant") return <AssistantTurn message={msg as AssistantMessage} />;
    if (msg.role === "toolResult") return <ToolResultTurn message={msg as ToolResultMessage} />;
  }
  if (event.type === "branch_summary") return <BranchSummaryRow event={event} />;
  if (event.type === "compaction") return <CompactionRow event={event} />;
  if (event.type === "model_change") return <ModelChangeRow event={event} />;
  if (event.type === "thinking_level_change") return <ThinkingLevelRow event={event} />;
  return null;
}

// ── Turn components ──────────────────────────────────────────────────────────

/** Extract plain text from a user or assistant message. */
function messageText(content: UserMessage["content"] | AssistantMessage["content"]): string {
  if (typeof content === "string") return content;
  return (content as ContentBlock[])
    .filter((b): b is Extract<ContentBlock, { type: "text" }> => b.type === "text")
    .map((b) => b.text)
    .join("\n\n");
}

function UserTurn({ message }: { message: UserMessage }) {
  const text = messageText(message.content);
  const isVerify = text.includes('End your response with exactly one of:');

  if (isVerify) return <VerifyPromptTurn text={text} />;

  return (
    <div className="px-4 py-3 bg-blue-950/20 border-l-2 border-blue-600/40">
      <div className="flex items-center gap-2 mb-2">
        <User className="h-3.5 w-3.5 text-blue-400 shrink-0" />
        <span className="text-xs font-semibold text-blue-400 uppercase tracking-wider">User</span>
      </div>
      <ExpandableText text={text} max={MAX_TEXT_PREVIEW} className="text-sm text-foreground/80 whitespace-pre-wrap font-mono" />
    </div>
  );
}

function VerifyPromptTurn({ text }: { text: string }) {
  // Strip the injected VERDICT instructions from the displayed text
  const body = text.replace(/\n*End your response with exactly one of:[\s\S]*$/, "").trim();
  return (
    <div className="px-4 py-3 bg-violet-950/20 border-l-2 border-violet-500/60">
      <div className="flex items-center gap-2 mb-2">
        <ClipboardCheck className="h-3.5 w-3.5 text-violet-400 shrink-0" />
        <span className="text-xs font-semibold text-violet-400 uppercase tracking-wider">Verify</span>
      </div>
      <ExpandableText text={body} max={MAX_TEXT_PREVIEW} className="text-sm text-foreground/80 whitespace-pre-wrap" />
    </div>
  );
}

function AssistantTurn({ message }: { message: AssistantMessage }) {
  const text = messageText(message.content);
  const verdictMatch = text.match(/VERDICT:\s*(PASS|FAIL[:\s].*)$/im);

  if (verdictMatch) return <VerdictTurn message={message} text={text} verdictRaw={verdictMatch[0]} />;

  return (
    <div className="px-4 py-3 border-l-2 border-indigo-600/40">
      <div className="flex items-center gap-2 mb-2">
        <Bot className="h-3.5 w-3.5 text-indigo-400 shrink-0" />
        <span className="text-xs font-semibold text-indigo-400 uppercase tracking-wider">Assistant</span>
        {message.model && (
          <span className="text-xs text-muted-foreground font-mono">{message.model}</span>
        )}
        {message.usage?.cost?.total !== undefined && (
          <span className="ml-auto text-xs text-muted-foreground">
            ${message.usage.cost.total.toFixed(4)}
          </span>
        )}
      </div>
      <div className="space-y-2">
        {message.content.map((block, i) => {
          if (block.type === "thinking") return <ThinkingBlock key={i} text={block.thinking} />;
          if (block.type === "text") return (
            <ExpandableText key={i} text={block.text} max={MAX_TEXT_PREVIEW} className="text-sm text-foreground/90 whitespace-pre-wrap" />
          );
          if (block.type === "toolCall") return (
            <ToolCallBlock key={i} name={block.name} args={block.arguments} />
          );
          return null;
        })}
      </div>
    </div>
  );
}

function VerdictTurn({
  message,
  text,
  verdictRaw,
}: {
  message: AssistantMessage;
  text: string;
  verdictRaw: string;
}) {
  const isPass = /VERDICT:\s*PASS/i.test(verdictRaw);
  const failReason = verdictRaw.replace(/VERDICT:\s*FAIL[:\s]*/i, "").trim();
  const body = text.slice(0, text.lastIndexOf(verdictRaw)).trim();

  return (
    <div className={cn(
      "border-l-2",
      isPass ? "border-green-500/60 bg-green-950/10" : "border-red-500/60 bg-red-950/10"
    )}>
      {/* Verdict banner */}
      <div className={cn(
        "px-4 py-2.5 flex items-center gap-2.5",
        isPass ? "bg-green-900/20" : "bg-red-900/20"
      )}>
        {isPass
          ? <ShieldCheck className="h-4 w-4 text-green-400 shrink-0" />
          : <ShieldX className="h-4 w-4 text-red-400 shrink-0" />}
        <span className={cn(
          "text-sm font-bold tracking-wide",
          isPass ? "text-green-400" : "text-red-400"
        )}>
          {isPass ? "VERDICT: PASS" : "VERDICT: FAIL"}
        </span>
        {!isPass && failReason && (
          <span className="text-xs text-red-300/80 truncate">{failReason}</span>
        )}
        {message.usage?.cost?.total !== undefined && (
          <span className="ml-auto text-xs text-muted-foreground">
            ${message.usage.cost.total.toFixed(4)}
          </span>
        )}
      </div>

      {/* Body (collapsible) */}
      {body && (
        <details className="group">
          <summary className="px-4 py-2 flex items-center gap-2 cursor-pointer list-none hover:bg-muted/20 transition-colors">
            <Bot className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
            <span className="text-xs text-muted-foreground">Review details</span>
            <ChevronDown className="h-3.5 w-3.5 text-muted-foreground shrink-0 ml-auto transition-transform group-open:rotate-180" />
          </summary>
          <div className="px-4 pb-3 pt-1 border-t border-border/40 space-y-2">
            {message.content.map((block, i) => {
              if (block.type === "thinking") return <ThinkingBlock key={i} text={block.thinking} />;
              if (block.type === "text") return (
                <ExpandableText key={i} text={block.text} max={MAX_TEXT_PREVIEW} className="text-sm text-foreground/80 whitespace-pre-wrap" />
              );
              return null;
            })}
          </div>
        </details>
      )}
    </div>
  );
}

function ToolResultTurn({ message }: { message: ToolResultMessage }) {
  const text = message.content.map((c) => c.text ?? "").join("\n");
  return (
    <div className={cn(
      "px-4 py-3 border-l-2",
      message.isError ? "bg-red-950/20 border-red-600/40" : "bg-zinc-900/40 border-zinc-600/30"
    )}>
      <div className="flex items-center gap-2 mb-2">
        {message.isError
          ? <AlertCircle className="h-3.5 w-3.5 text-red-400 shrink-0" />
          : <Terminal className="h-3.5 w-3.5 text-zinc-400 shrink-0" />}
        <span className={cn(
          "text-xs font-semibold uppercase tracking-wider font-mono",
          message.isError ? "text-red-400" : "text-zinc-400"
        )}>
          {message.toolName}
        </span>
        {message.isError && <span className="text-xs text-red-400">error</span>}
      </div>
      <ExpandableText text={text} max={MAX_TOOL_OUTPUT} className="text-xs text-muted-foreground whitespace-pre-wrap font-mono" />
    </div>
  );
}

// ── Meta rows ────────────────────────────────────────────────────────────────

function BranchSummaryRow({ event }: { event: TranscriptEvent }) {
  const summary = event.summary as string | undefined;
  return (
    <div className="px-4 py-2 bg-amber-950/20 border-l-2 border-amber-500/40 flex items-start gap-2">
      <GitBranch className="h-3.5 w-3.5 text-amber-400 shrink-0 mt-0.5" />
      <div className="space-y-0.5">
        <span className="text-xs font-semibold text-amber-400 uppercase tracking-wider">Branch summary</span>
        {summary && <p className="text-xs text-muted-foreground whitespace-pre-wrap">{summary}</p>}
      </div>
    </div>
  );
}

function CompactionRow({ event }: { event: TranscriptEvent }) {
  const summary = event.summary as string | undefined;
  const tokens = event.tokensBefore as number | undefined;
  return (
    <details className="group border-l-2 border-zinc-600/30">
      <summary className="px-4 py-2 flex items-center gap-2 cursor-pointer list-none hover:bg-muted/20 transition-colors">
        <Cpu className="h-3.5 w-3.5 text-zinc-500 shrink-0" />
        <span className="text-xs text-zinc-500 uppercase tracking-wider font-semibold">
          Context compacted{tokens !== undefined ? ` (${tokens.toLocaleString()} tokens)` : ""}
        </span>
        <ChevronDown className="h-3.5 w-3.5 text-zinc-600 shrink-0 ml-auto transition-transform group-open:rotate-180" />
      </summary>
      {summary && (
        <div className="px-4 pb-3 pt-1 text-xs text-muted-foreground whitespace-pre-wrap border-t border-border">
          {summary}
        </div>
      )}
    </details>
  );
}

function ModelChangeRow({ event }: { event: TranscriptEvent }) {
  return (
    <div className="px-4 py-1.5 flex items-center gap-2 bg-muted/10">
      <Cpu className="h-3 w-3 text-zinc-500 shrink-0" />
      <span className="text-xs text-zinc-500">
        Model changed to <span className="font-mono">{event.provider}/{event.modelId}</span>
      </span>
    </div>
  );
}

function ThinkingLevelRow({ event }: { event: TranscriptEvent }) {
  return (
    <div className="px-4 py-1.5 flex items-center gap-2 bg-muted/10">
      <Zap className="h-3 w-3 text-zinc-500 shrink-0" />
      <span className="text-xs text-zinc-500">
        Thinking level → <span className="font-mono">{event.thinkingLevel}</span>
      </span>
    </div>
  );
}

// ── Branch section ───────────────────────────────────────────────────────────

/**
 * A collapsible section showing an off-path (abandoned) branch.
 */
function BranchSection({ index, events }: { index: number; events: TranscriptEvent[] }) {
  const messageCount = events.filter((e) => e.type === "message").length;

  // Detect if the branch contained a VERDICT
  const verdict = events.reduce<string | null>((acc, e) => {
    if (acc) return acc;
    if (e.type === "message" && e.message?.role === "assistant") {
      const text = (e.message.content as Array<{ type: string; text?: string }>)
        .filter((b) => b.type === "text")
        .map((b) => b.text ?? "")
        .join(" ");
      if (/VERDICT:\s*PASS/i.test(text)) return "pass";
      if (/VERDICT:\s*FAIL/i.test(text)) return "fail";
    }
    return null;
  }, null);

  return (
    <details className="group border-l-4 border-amber-500/30 bg-amber-950/10">
      <summary className="px-4 py-2.5 flex items-center gap-2 cursor-pointer list-none hover:bg-amber-950/20 transition-colors">
        <GitBranch className="h-3.5 w-3.5 text-amber-400 shrink-0" />
        <span className="text-xs font-semibold text-amber-400">
          ⎇ Branch {index + 1}
        </span>
        <span className="text-xs text-muted-foreground">{messageCount} messages</span>
        {verdict && (
          <span className={cn(
            "text-xs font-mono px-1.5 py-0.5 rounded",
            verdict === "pass" ? "bg-green-900/40 text-green-400" : "bg-red-900/40 text-red-400"
          )}>
            VERDICT: {verdict.toUpperCase()}
          </span>
        )}
        <ChevronDown className="h-3.5 w-3.5 text-amber-400/60 shrink-0 ml-auto transition-transform group-open:rotate-180" />
      </summary>
      <div className="divide-y divide-border/50 border-t border-amber-500/20">
        {events.map((e) => (
          <EventRow key={e.id} event={e} />
        ))}
      </div>
    </details>
  );
}

// ── Sub-components ───────────────────────────────────────────────────────────

function ThinkingBlock({ text }: { text: string }) {
  const preview = truncate(text, 120);
  return (
    <details className="group rounded border border-border bg-muted/30 text-xs">
      <summary className="flex items-center justify-between gap-2 px-3 py-2 cursor-pointer list-none hover:bg-muted/50 transition-colors">
        <span className="text-muted-foreground italic group-open:hidden">{preview}</span>
        <span className="text-muted-foreground italic hidden group-open:block">Thinking</span>
        <ChevronDown className="h-3.5 w-3.5 text-muted-foreground shrink-0 transition-transform group-open:rotate-180" />
      </summary>
      <div className="px-3 pb-3 text-muted-foreground whitespace-pre-wrap italic border-t border-border pt-2">
        {text}
      </div>
    </details>
  );
}

function ToolCallBlock({ name, args }: { name: string; args: Record<string, unknown> }) {
  const argStr = JSON.stringify(args, null, 2);
  const inlinePreview =
    name === "bash" && typeof args.command === "string"
      ? truncate(args.command as string, 80)
      : name === "read" && typeof args.path === "string"
      ? (args.path as string)
      : null;

  return (
    <details className="group rounded border border-border bg-muted/20 text-xs font-mono">
      <summary className="flex items-center gap-2 px-3 py-2 cursor-pointer list-none hover:bg-muted/40 transition-colors">
        <Wrench className="h-3.5 w-3.5 text-amber-400 shrink-0" />
        <span className="text-amber-400 font-semibold">{name}</span>
        {inlinePreview && (
          <span className="text-muted-foreground truncate group-open:hidden">{inlinePreview}</span>
        )}
        <ChevronDown className="h-3.5 w-3.5 text-muted-foreground shrink-0 ml-auto transition-transform group-open:rotate-180" />
      </summary>
      <pre className="px-3 pb-3 text-muted-foreground overflow-x-auto border-t border-border pt-2 text-[11px]">
        {argStr}
      </pre>
    </details>
  );
}

function ExpandableText({ text, max, className }: { text: string; max: number; className?: string }) {
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
