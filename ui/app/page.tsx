import Link from "next/link";
import { loadAllSessions } from "@/lib/data";
import { fmtDate, fmtDuration } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { CheckCircle, XCircle, Clock, Layers, ArrowRight } from "lucide-react";
import type { Session } from "@/lib/types";

/** Group sessions by workspace name and compute aggregate stats. */
function groupByWorkspace(sessions: Session[]) {
  const map = new Map<string, Session[]>();
  for (const s of sessions) {
    const list = map.get(s.workspace) ?? [];
    list.push(s);
    map.set(s.workspace, list);
  }

  return Array.from(map.entries())
    .map(([workspace, runs]) => {
      const passes = runs.filter((r) => r.outcome === "pass").length;
      const durations = runs.map((r) => r.durationMs ?? 0).filter((d) => d > 0);
      const avgDuration = durations.length
        ? Math.round(durations.reduce((s, d) => s + d, 0) / durations.length)
        : 0;
      const lastRun = runs.reduce((latest, r) =>
        r.startedAt > latest.startedAt ? r : latest
      );
      return { workspace, runs, passes, avgDuration, lastRun };
    })
    .sort((a, b) => b.lastRun.startedAt.localeCompare(a.lastRun.startedAt));
}

export default async function HomePage() {
  const sessions = await loadAllSessions();
  const groups = groupByWorkspace(sessions);

  const passes = sessions.filter((s) => s.outcome === "pass").length;
  const successRate =
    sessions.length > 0 ? Math.round((passes / sessions.length) * 100) : 0;
  const durations = sessions.map((s) => s.durationMs ?? 0).filter((d) => d > 0);
  const avgDuration = durations.length
    ? Math.round(durations.reduce((s, d) => s + d, 0) / durations.length)
    : 0;

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Mission Control</h1>
        <p className="text-muted-foreground text-sm mt-1">
          Agent sessions grouped by workspace
        </p>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <StatCard label="Total Sessions" value={String(sessions.length)} icon={<Layers className="h-4 w-4 text-muted-foreground" />} />
        <StatCard label="Workspaces" value={String(groups.length)} icon={<Layers className="h-4 w-4 text-muted-foreground" />} />
        <StatCard label="Pass Rate" value={sessions.length > 0 ? `${successRate}%` : "—"} icon={<CheckCircle className="h-4 w-4 text-muted-foreground" />} />
        <StatCard label="Avg Duration" value={durations.length > 0 ? fmtDuration(avgDuration) : "—"} icon={<Clock className="h-4 w-4 text-muted-foreground" />} />
      </div>

      {groups.length === 0 ? (
        <p className="text-muted-foreground text-sm">
          No sessions found in <code className="font-mono">.pi/agent/sessions/</code> or <code className="font-mono">~/.pi/agent/sessions/</code>.
        </p>
      ) : (
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {groups.map(({ workspace, runs, passes, avgDuration, lastRun }) => (
            <Link key={workspace} href={`/mission/${encodeURIComponent(workspace)}`}>
              <Card className="h-full hover:border-ring transition-colors cursor-pointer group">
                <CardHeader className="pb-2">
                  <div className="flex items-start justify-between gap-2">
                    <CardTitle className="text-base font-semibold">{workspace}</CardTitle>
                    <ArrowRight className="h-4 w-4 text-muted-foreground shrink-0 mt-0.5 group-hover:translate-x-0.5 transition-transform" />
                  </div>
                  <CardDescription className="text-xs">
                    Last run {fmtDate(lastRun.startedAt)}
                  </CardDescription>
                </CardHeader>

                <CardContent className="space-y-3">
                  <div className="flex items-center gap-2 text-sm">
                    <span className="text-muted-foreground">{runs.length} session{runs.length !== 1 ? "s" : ""}</span>
                    <span className="text-muted-foreground">·</span>
                    <span className="flex items-center gap-1 text-green-400">
                      <CheckCircle className="h-3.5 w-3.5" /> {passes}
                    </span>
                    <span className="flex items-center gap-1 text-red-400">
                      <XCircle className="h-3.5 w-3.5" /> {runs.length - passes}
                    </span>
                  </div>

                  <div>
                    <div className="flex justify-between text-xs text-muted-foreground mb-1">
                      <span>Pass rate</span>
                      <span>{Math.round((passes / runs.length) * 100)}%</span>
                    </div>
                    <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                      <div
                        className="h-full rounded-full bg-green-500"
                        style={{ width: `${(passes / runs.length) * 100}%` }}
                      />
                    </div>
                  </div>

                  {avgDuration > 0 && (
                    <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                      <Clock className="h-3.5 w-3.5" />
                      Avg {fmtDuration(avgDuration)}
                    </div>
                  )}

                  <div className="flex items-center gap-1">
                    {runs.slice(0, 8).map((r) => (
                      <span
                        key={r.id}
                        title={`${fmtDate(r.startedAt)} · ${r.outcome}`}
                        className={`h-2 w-2 rounded-full ${
                          r.outcome === "pass"
                            ? "bg-green-500"
                            : r.outcome === "fail"
                            ? "bg-red-500"
                            : "bg-zinc-500"
                        }`}
                      />
                    ))}
                    {runs.length > 8 && (
                      <span className="text-xs text-muted-foreground ml-1">+{runs.length - 8}</span>
                    )}
                  </div>
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

function StatCard({ label, value, icon }: { label: string; value: string; icon: React.ReactNode }) {
  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex items-center justify-between mb-1">
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">{label}</p>
          {icon}
        </div>
        <p className="text-2xl font-bold">{value}</p>
      </CardContent>
    </Card>
  );
}
