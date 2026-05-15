import Link from "next/link";
import { notFound } from "next/navigation";
import { loadMission, loadTranscript } from "@/lib/data";
import { fmtDate, fmtDuration } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { ChevronLeft, Clock, CheckCircle, XCircle, ChevronDown } from "lucide-react";
import { TranscriptView } from "@/components/TranscriptView";
import type { MissionPhase, MissionAttempt, TranscriptEvent } from "@/lib/types";

interface Props {
  params: Promise<{ id: string }>;
}

export async function generateMetadata({ params }: Props) {
  const { id } = await params;
  const mission = await loadMission(id);
  if (!mission) return { title: "Run — Mission Control" };
  return { title: `${mission.mission} · ${id.slice(0, 8)} — Mission Control` };
}

export default async function RunPage({ params }: Props) {
  const { id } = await params;
  const mission = await loadMission(id);
  if (!mission) notFound();

  // Pre-load all transcripts for this run so the page is fully server-rendered
  const transcripts: Record<string, TranscriptEvent[]> = {};
  for (const phase of mission.phases ?? []) {
    for (const attempt of phase.attempts ?? []) {
      if (attempt.sessionFile) {
        transcripts[attempt.sessionFile] = await loadTranscript(id, attempt.sessionFile);
      }
    }
  }

  return (
    <div className="space-y-6">
      {/* Back link */}
      <div>
        <Link
          href={`/mission/${encodeURIComponent(mission.mission)}`}
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors mb-4"
        >
          <ChevronLeft className="h-4 w-4" />
          {mission.mission}
        </Link>

        {/* Run header */}
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <h1 className="text-2xl font-bold tracking-tight capitalize">
                {mission.mission}
              </h1>
              <Badge variant={mission.outcome === "success" ? "success" : "destructive"}>
                {mission.outcome}
              </Badge>
            </div>
            <p className="text-muted-foreground text-sm font-mono">{mission.missionId}</p>
          </div>
          <div className="flex items-center gap-4 text-sm text-muted-foreground">
            <span className="flex items-center gap-1.5">
              <Clock className="h-4 w-4" />
              {fmtDuration(mission.durationMs)}
            </span>
            <span>{fmtDate(mission.startedAt)}</span>
          </div>
        </div>
      </div>

      <Separator />

      {/* Phases */}
      <div className="space-y-4">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
          Phases
        </h2>

        {(mission.phases ?? []).length === 0 ? (
          <p className="text-sm text-muted-foreground">No phases recorded.</p>
        ) : (
          <div className="space-y-4">
            {mission.phases.map((phase, phaseIdx) => (
              <PhaseSection
                key={phase.name}
                phase={phase}
                phaseIdx={phaseIdx}
                transcripts={transcripts}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/** Renders a single phase with its attempts and transcripts. */
function PhaseSection({
  phase,
  phaseIdx,
  transcripts,
}: {
  phase: MissionPhase;
  phaseIdx: number;
  transcripts: Record<string, TranscriptEvent[]>;
}) {
  return (
    <Card>
      {/* Phase header */}
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground font-mono">
              {phaseIdx + 1}.
            </span>
            <CardTitle className="text-base capitalize">{phase.name}</CardTitle>
            <Badge variant={phase.verdict === "pass" ? "success" : "destructive"}>
              {phase.verdict}
            </Badge>
          </div>
          <span className="text-xs text-muted-foreground flex items-center gap-1">
            <Clock className="h-3.5 w-3.5" />
            {fmtDuration(phase.durationMs)}
          </span>
        </div>
      </CardHeader>

      <CardContent className="space-y-3 pt-0">
        {phase.attempts.map((attempt, attemptIdx) => (
          <AttemptSection
            key={attempt.sessionFile}
            attempt={attempt}
            attemptIdx={attemptIdx}
            totalAttempts={phase.attempts.length}
            events={transcripts[attempt.sessionFile] ?? []}
          />
        ))}
      </CardContent>
    </Card>
  );
}

/** Renders a single attempt with its collapsible transcript. */
function AttemptSection({
  attempt,
  attemptIdx,
  totalAttempts,
  events,
}: {
  attempt: MissionAttempt;
  attemptIdx: number;
  totalAttempts: number;
  events: TranscriptEvent[];
}) {
  const messageCount = events.filter((e) => e.type === "message").length;

  return (
    <details className="group border border-border rounded-md overflow-hidden">
      <summary className="flex items-center justify-between gap-3 px-4 py-3 cursor-pointer select-none hover:bg-accent/30 transition-colors list-none">
        <div className="flex items-center gap-2.5">
          {attempt.verdict === "pass" ? (
            <CheckCircle className="h-4 w-4 text-green-400 shrink-0" />
          ) : (
            <XCircle className="h-4 w-4 text-red-400 shrink-0" />
          )}
          <span className="text-sm font-medium">
            Attempt {attemptIdx + 1}
            {totalAttempts > 1 && (
              <span className="text-muted-foreground font-normal">
                {" "}of {totalAttempts}
              </span>
            )}
          </span>
          <Badge variant={attempt.verdict === "pass" ? "success" : "destructive"} className="text-[10px]">
            {attempt.verdict}
          </Badge>
          <span className="text-xs text-muted-foreground">
            {fmtDuration(attempt.durationMs)}
          </span>
        </div>

        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          {messageCount > 0 && (
            <span>{messageCount} events</span>
          )}
          <ChevronDown className="h-4 w-4 transition-transform group-open:rotate-180" />
        </div>
      </summary>

      {/* Transcript */}
      <div className="border-t border-border">
        {events.length === 0 ? (
          <p className="px-4 py-6 text-sm text-muted-foreground text-center">
            No transcript data available for{" "}
            <code className="font-mono text-xs">{attempt.sessionFile}</code>.
          </p>
        ) : (
          <TranscriptView events={events} />
        )}
      </div>
    </details>
  );
}
