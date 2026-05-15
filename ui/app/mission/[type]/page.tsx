import Link from "next/link";
import { notFound } from "next/navigation";
import { loadAllMissions } from "@/lib/data";
import { fmtDate, fmtDuration } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { CheckCircle, XCircle, ChevronLeft, Clock, Layers } from "lucide-react";
import type { Mission } from "@/lib/types";

interface Props {
  params: Promise<{ type: string }>;
}

export async function generateMetadata({ params }: Props) {
  const { type } = await params;
  return { title: `${decodeURIComponent(type)} — Mission Control` };
}

export default async function MissionTypePage({ params }: Props) {
  const { type } = await params;
  const missionType = decodeURIComponent(type);

  const all = await loadAllMissions();
  const runs = all.filter((m) => m.mission === missionType);

  if (runs.length === 0) notFound();

  const successes = runs.filter((r) => r.outcome === "success").length;
  const avgDuration = Math.round(
    runs.reduce((s, r) => s + (r.durationMs ?? 0), 0) / runs.length
  );

  return (
    <div className="space-y-6">
      {/* Back link + heading */}
      <div>
        <Link
          href="/"
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors mb-4"
        >
          <ChevronLeft className="h-4 w-4" />
          Mission Control
        </Link>
        <h1 className="text-2xl font-bold tracking-tight capitalize">{missionType}</h1>
        <p className="text-muted-foreground text-sm mt-1">
          {runs.length} run{runs.length !== 1 ? "s" : ""} · {successes} succeeded · avg{" "}
          {fmtDuration(avgDuration)}
        </p>
      </div>

      {/* Run list */}
      <div className="space-y-3">
        {runs.map((run) => (
          <RunRow key={run.missionId} run={run} />
        ))}
      </div>
    </div>
  );
}

/** A single run row card linking to the run detail page. */
function RunRow({ run }: { run: Mission }) {
  const passedPhases = run.phases?.filter((p) => p.verdict === "pass").length ?? 0;
  const totalPhases = run.phases?.length ?? 0;

  return (
    <Link href={`/run/${run.missionId}`}>
      <Card className="hover:border-ring transition-colors cursor-pointer group">
        <CardContent className="p-4">
          <div className="flex items-start gap-4">
            {/* Outcome icon */}
            <div className="mt-0.5 shrink-0">
              {run.outcome === "success" ? (
                <CheckCircle className="h-5 w-5 text-green-400" />
              ) : (
                <XCircle className="h-5 w-5 text-red-400" />
              )}
            </div>

            {/* Main content */}
            <div className="flex-1 min-w-0 space-y-1.5">
              <div className="flex items-center gap-2 flex-wrap">
                <OutcomeBadge outcome={run.outcome} />
                <span className="text-xs text-muted-foreground font-mono">
                  {run.missionId.slice(0, 8)}…
                </span>
              </div>

              <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                <span className="flex items-center gap-1">
                  <Clock className="h-3.5 w-3.5" />
                  {fmtDuration(run.durationMs)}
                </span>
                <span className="flex items-center gap-1">
                  <Layers className="h-3.5 w-3.5" />
                  {passedPhases}/{totalPhases} phases passed
                </span>
                <span>{fmtDate(run.startedAt)}</span>
              </div>

              {/* Phase pills */}
              {run.phases && run.phases.length > 0 && (
                <div className="flex flex-wrap gap-1.5 pt-1">
                  {run.phases.map((phase) => (
                    <span
                      key={phase.name}
                      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${
                        phase.verdict === "pass"
                          ? "bg-green-900/40 text-green-400"
                          : "bg-red-900/40 text-red-400"
                      }`}
                    >
                      {phase.name}
                      {phase.attempts.length > 1 && (
                        <span className="opacity-60">×{phase.attempts.length}</span>
                      )}
                    </span>
                  ))}
                </div>
              )}
            </div>

            <ChevronLeft className="h-4 w-4 text-muted-foreground rotate-180 shrink-0 mt-0.5 group-hover:translate-x-0.5 transition-transform" />
          </div>
        </CardContent>
      </Card>
    </Link>
  );
}

function OutcomeBadge({ outcome }: { outcome: Mission["outcome"] }) {
  return (
    <Badge variant={outcome === "success" ? "success" : "destructive"}>
      {outcome}
    </Badge>
  );
}
