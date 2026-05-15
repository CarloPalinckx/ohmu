import Link from "next/link";
import { loadAllMissions } from "@/lib/data";
import { fmtDate, fmtDuration } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { CheckCircle, XCircle, Clock, Layers, ArrowRight } from "lucide-react";
import type { Mission } from "@/lib/types";

/**
 * Group missions by their `mission` type name and compute aggregate stats.
 */
function groupByType(missions: Mission[]) {
  const map = new Map<string, Mission[]>();
  for (const m of missions) {
    const list = map.get(m.mission) ?? [];
    list.push(m);
    map.set(m.mission, list);
  }

  return Array.from(map.entries())
    .map(([type, runs]) => {
      const successes = runs.filter((r) => r.outcome === "success").length;
      const avgDuration = Math.round(
        runs.reduce((s, r) => s + (r.durationMs ?? 0), 0) / runs.length
      );
      const lastRun = runs.reduce((latest, r) =>
        r.startedAt > latest.startedAt ? r : latest
      );
      return { type, runs, successes, avgDuration, lastRun };
    })
    .sort((a, b) => b.lastRun.startedAt.localeCompare(a.lastRun.startedAt));
}

export default async function HomePage() {
  const missions = await loadAllMissions();
  const groups = groupByType(missions);

  const totalSuccesses = missions.filter((m) => m.outcome === "success").length;
  const successRate =
    missions.length > 0
      ? Math.round((totalSuccesses / missions.length) * 100)
      : 0;
  const avgDuration =
    missions.length > 0
      ? Math.round(
          missions.reduce((s, m) => s + (m.durationMs ?? 0), 0) / missions.length
        )
      : 0;

  return (
    <div className="space-y-8">
      {/* Page heading */}
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Mission Control</h1>
        <p className="text-muted-foreground text-sm mt-1">
          Overview of all agent missions grouped by type
        </p>
      </div>

      {/* Summary stat cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <StatCard
          label="Total Runs"
          value={String(missions.length)}
          icon={<Layers className="h-4 w-4 text-muted-foreground" />}
        />
        <StatCard
          label="Mission Types"
          value={String(groups.length)}
          icon={<Layers className="h-4 w-4 text-muted-foreground" />}
        />
        <StatCard
          label="Success Rate"
          value={missions.length > 0 ? `${successRate}%` : "—"}
          icon={<CheckCircle className="h-4 w-4 text-muted-foreground" />}
        />
        <StatCard
          label="Avg Duration"
          value={missions.length > 0 ? fmtDuration(avgDuration) : "—"}
          icon={<Clock className="h-4 w-4 text-muted-foreground" />}
        />
      </div>

      {/* Mission type cards */}
      {groups.length === 0 ? (
        <p className="text-muted-foreground text-sm">
          No mission logs found in <code className="font-mono">.logs/missions/</code>.
        </p>
      ) : (
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {groups.map(({ type, runs, successes, avgDuration, lastRun }) => (
            <Link key={type} href={`/mission/${encodeURIComponent(type)}`}>
              <Card className="h-full hover:border-ring transition-colors cursor-pointer group">
                <CardHeader className="pb-2">
                  <div className="flex items-start justify-between gap-2">
                    <CardTitle className="text-base font-semibold capitalize">
                      {type}
                    </CardTitle>
                    <ArrowRight className="h-4 w-4 text-muted-foreground shrink-0 mt-0.5 group-hover:translate-x-0.5 transition-transform" />
                  </div>
                  <CardDescription className="text-xs">
                    Last run {fmtDate(lastRun.startedAt)}
                  </CardDescription>
                </CardHeader>

                <CardContent className="space-y-3">
                  {/* Run counts */}
                  <div className="flex items-center gap-2 text-sm">
                    <span className="text-muted-foreground">{runs.length} run{runs.length !== 1 ? "s" : ""}</span>
                    <span className="text-muted-foreground">·</span>
                    <span className="flex items-center gap-1 text-green-400">
                      <CheckCircle className="h-3.5 w-3.5" />
                      {successes}
                    </span>
                    <span className="flex items-center gap-1 text-red-400">
                      <XCircle className="h-3.5 w-3.5" />
                      {runs.length - successes}
                    </span>
                  </div>

                  {/* Success rate bar */}
                  <div>
                    <div className="flex justify-between text-xs text-muted-foreground mb-1">
                      <span>Success rate</span>
                      <span>{Math.round((successes / runs.length) * 100)}%</span>
                    </div>
                    <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                      <div
                        className="h-full rounded-full bg-green-500"
                        style={{ width: `${(successes / runs.length) * 100}%` }}
                      />
                    </div>
                  </div>

                  {/* Avg duration */}
                  <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    <Clock className="h-3.5 w-3.5" />
                    Avg {fmtDuration(avgDuration)}
                  </div>

                  {/* Last 5 run outcomes */}
                  <div className="flex items-center gap-1">
                    {runs.slice(0, 8).map((r) => (
                      <span
                        key={r.missionId}
                        title={`${fmtDate(r.startedAt)} · ${r.outcome}`}
                        className={`h-2 w-2 rounded-full ${
                          r.outcome === "success" ? "bg-green-500" : "bg-red-500"
                        }`}
                      />
                    ))}
                    {runs.length > 8 && (
                      <span className="text-xs text-muted-foreground ml-1">
                        +{runs.length - 8}
                      </span>
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

/** A single summary stat card. */
function StatCard({
  label,
  value,
  icon,
}: {
  label: string;
  value: string;
  icon: React.ReactNode;
}) {
  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex items-center justify-between mb-1">
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
            {label}
          </p>
          {icon}
        </div>
        <p className="text-2xl font-bold">{value}</p>
      </CardContent>
    </Card>
  );
}
