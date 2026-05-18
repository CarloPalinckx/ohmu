import Link from "next/link";
import { notFound } from "next/navigation";
import { loadSession, loadTranscript, loadForkedSessions } from "@/lib/data";
import { fmtDate, fmtDuration } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { ChevronLeft, Clock } from "lucide-react";
import { TranscriptView } from "@/components/TranscriptView";

interface Props {
  params: Promise<{ id: string }>;
}

export async function generateMetadata({ params }: Props) {
  const { id } = await params;
  const session = await loadSession(id);
  if (!session) return { title: "Session — Mission Control" };
  return { title: `${session.workspace} · ${id.slice(0, 8)} — Mission Control` };
}

export default async function RunPage({ params }: Props) {
  const { id } = await params;
  const [session, events] = await Promise.all([loadSession(id), loadTranscript(id)]);
  if (!session) notFound();
  const forkedSessions = await loadForkedSessions(session.file);

  return (
    <div className="space-y-6">
      {/* Back link */}
      <div>
        <Link
          href={`/mission/${encodeURIComponent(session.workspace)}`}
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors mb-4"
        >
          <ChevronLeft className="h-4 w-4" />
          {session.workspace}
        </Link>

        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <h1 className="text-2xl font-bold tracking-tight">{session.workspace}</h1>
              <Badge
                variant={
                  session.outcome === "pass"
                    ? "success"
                    : session.outcome === "fail"
                    ? "destructive"
                    : "secondary"
                }
              >
                {session.outcome}
              </Badge>
            </div>
            <p className="text-muted-foreground text-sm font-mono">{session.id}</p>
            <p className="text-muted-foreground text-xs mt-0.5">{session.cwd}</p>
          </div>

          <div className="flex items-center gap-4 text-sm text-muted-foreground">
            {session.durationMs !== null && (
              <span className="flex items-center gap-1.5">
                <Clock className="h-4 w-4" />
                {fmtDuration(session.durationMs)}
              </span>
            )}
            <span>{fmtDate(session.startedAt)}</span>
          </div>
        </div>
      </div>

      <Separator />

      {/* Forked retry sessions */}
      {forkedSessions.length > 0 && (
        <div className="space-y-2">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
            ⎇ Verify retry branches ({forkedSessions.length})
          </h2>
          {forkedSessions.map((fork) => (
            <Link
              key={fork.id}
              href={`/run/${fork.id}`}
              className="flex items-center gap-3 px-4 py-2.5 rounded-lg border border-amber-500/30 bg-amber-950/10 hover:bg-amber-950/20 transition-colors text-sm"
            >
              <span className="text-amber-400">⎇</span>
              <span className="font-mono text-xs text-muted-foreground">{fork.id.slice(0, 8)}…</span>
              <Badge variant={fork.outcome === "pass" ? "success" : fork.outcome === "fail" ? "destructive" : "secondary"}>
                {fork.outcome}
              </Badge>
              <span className="text-xs text-muted-foreground ml-auto">{fmtDate(fork.startedAt)}</span>
            </Link>
          ))}
        </div>
      )}

      {/* Transcript */}
      <div>
        <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground mb-4">
          Transcript · {session.messageCount} messages
        </h2>
        <div className="rounded-lg border border-border overflow-hidden">
          <TranscriptView events={events} />
        </div>
      </div>
    </div>
  );
}
