import Link from "next/link";
import { notFound } from "next/navigation";
import { loadWorkspaceSessions } from "@/lib/data";
import { fmtDate, fmtDuration } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { CheckCircle, XCircle, ChevronLeft, Clock } from "lucide-react";
import type { Session } from "@/lib/types";

interface Props {
  params: Promise<{ type: string }>;
}

export async function generateMetadata({ params }: Props) {
  const { type } = await params;
  return { title: `${decodeURIComponent(type)} — Mission Control` };
}

export default async function WorkspacePage({ params }: Props) {
  const { type } = await params;
  const workspace = decodeURIComponent(type);

  const sessions = await loadWorkspaceSessions(workspace);
  if (sessions.length === 0) notFound();

  const passes = sessions.filter((s) => s.outcome === "pass").length;
  const durations = sessions.map((s) => s.durationMs ?? 0).filter((d) => d > 0);
  const avgDuration = durations.length
    ? Math.round(durations.reduce((s, d) => s + d, 0) / durations.length)
    : 0;

  return (
    <div className="space-y-6">
      <div>
        <Link
          href="/"
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors mb-4"
        >
          <ChevronLeft className="h-4 w-4" />
          Mission Control
        </Link>
        <h1 className="text-2xl font-bold tracking-tight">{workspace}</h1>
        <p className="text-muted-foreground text-sm mt-1">
          {sessions.length} session{sessions.length !== 1 ? "s" : ""} · {passes} passed
          {durations.length > 0 && ` · avg ${fmtDuration(avgDuration)}`}
        </p>
      </div>

      <div className="space-y-3">
        {sessions.map((session) => (
          <SessionRow key={session.id} session={session} />
        ))}
      </div>
    </div>
  );
}

function SessionRow({ session }: { session: Session }) {
  return (
    <Link href={`/run/${session.id}`}>
      <Card className="hover:border-ring transition-colors cursor-pointer group">
        <CardContent className="p-4">
          <div className="flex items-start gap-4">
            <div className="mt-0.5 shrink-0">
              {session.outcome === "pass" ? (
                <CheckCircle className="h-5 w-5 text-green-400" />
              ) : session.outcome === "fail" ? (
                <XCircle className="h-5 w-5 text-red-400" />
              ) : (
                <div className="h-5 w-5 rounded-full border-2 border-zinc-500" />
              )}
            </div>

            <div className="flex-1 min-w-0 space-y-1">
              <div className="flex items-center gap-2 flex-wrap">
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
                <span className="text-xs text-muted-foreground font-mono">
                  {session.id.slice(0, 8)}…
                </span>
              </div>

              <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                {session.durationMs !== null && (
                  <span className="flex items-center gap-1">
                    <Clock className="h-3.5 w-3.5" />
                    {fmtDuration(session.durationMs)}
                  </span>
                )}
                <span>{session.messageCount} messages</span>
                <span>{fmtDate(session.startedAt)}</span>
              </div>
            </div>

            <ChevronLeft className="h-4 w-4 text-muted-foreground rotate-180 shrink-0 mt-0.5 group-hover:translate-x-0.5 transition-transform" />
          </div>
        </CardContent>
      </Card>
    </Link>
  );
}
