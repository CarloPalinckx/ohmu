import { readdir, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import type { Mission, TranscriptEvent } from "./types";

/** Resolved path to the missions log directory. */
const LOGS_DIR =
  process.env.MISSIONS_LOG_DIR ??
  path.join(process.cwd(), "..", ".logs", "missions");

/**
 * Load all missions that have a meta.json, sorted newest-first.
 */
export async function loadAllMissions(): Promise<Mission[]> {
  if (!existsSync(LOGS_DIR)) return [];

  const entries = await readdir(LOGS_DIR, { withFileTypes: true });
  const missions: Mission[] = [];

  await Promise.all(
    entries
      .filter((e) => e.isDirectory())
      .map(async (entry) => {
        const metaPath = path.join(LOGS_DIR, entry.name, "meta.json");
        try {
          const raw = await readFile(metaPath, "utf-8");
          missions.push(JSON.parse(raw) as Mission);
        } catch {
          // skip dirs without meta.json or with invalid JSON
        }
      })
  );

  missions.sort(
    (a, b) =>
      new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime()
  );

  return missions;
}

/**
 * Load a single mission by its UUID directory name.
 * Returns null if not found or unparseable.
 */
export async function loadMission(id: string): Promise<Mission | null> {
  const metaPath = path.join(LOGS_DIR, id, "meta.json");
  try {
    const raw = await readFile(metaPath, "utf-8");
    return JSON.parse(raw) as Mission;
  } catch {
    return null;
  }
}

/**
 * Load and parse a JSONL session transcript file.
 * Returns an empty array on any error.
 *
 * @param missionId - The mission UUID (used as directory name)
 * @param filename  - The JSONL filename (e.g. "phase-research-attempt-1.jsonl")
 */
export async function loadTranscript(
  missionId: string,
  filename: string
): Promise<TranscriptEvent[]> {
  // Prevent path traversal — only allow the base filename
  const safe = path.basename(filename);
  const filePath = path.join(LOGS_DIR, missionId, safe);

  try {
    const raw = await readFile(filePath, "utf-8");
    return raw
      .split("\n")
      .filter((line) => line.trim().length > 0)
      .flatMap((line) => {
        try {
          return [JSON.parse(line) as TranscriptEvent];
        } catch {
          return [];
        }
      });
  } catch {
    return [];
  }
}
