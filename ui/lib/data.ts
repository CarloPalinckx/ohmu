import { readdir, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import type { Session, TranscriptEvent } from "./types";

const SESSIONS_DIR =
  process.env.PI_SESSIONS_DIR ??
  path.join(os.homedir(), ".pi", "agent", "sessions");

/**
 * Extract the UUID from a session filename.
 * Filename format: `<timestamp>_<uuid>.jsonl`
 *
 * @param filename - Basename of the session file.
 */
function uuidFromFilename(filename: string): string | null {
  const match = filename.match(/_([0-9a-f-]{36})\.jsonl$/i);
  return match?.[1] ?? null;
}

/**
 * Parse only the metadata needed for session listings.
 * Reads the first line (header) and scans for VERDICT lines without
 * allocating the full event list.
 *
 * @param filePath - Absolute path to the JSONL file.
 */
async function parseSessionSummary(filePath: string): Promise<Session | null> {
  let raw: string;
  try { raw = await readFile(filePath, "utf-8"); } catch { return null; }

  const newline = raw.indexOf("\n");
  if (newline === -1) return null;

  let header: Record<string, unknown>;
  try { header = JSON.parse(raw.slice(0, newline)); } catch { return null; }
  if (header.type !== "session") return null;

  const cwd = (header.cwd as string | undefined) ?? "";
  const startedAt = (header.timestamp as string | undefined) ?? new Date().toISOString();
  const parentSession = (header.parentSession as string | undefined) ?? null;

  // Scan remaining lines for timestamps, message counts, and VERDICTs
  // without fully parsing every entry.
  let messageCount = 0;
  let lastTimestamp: string | null = null;
  let outcome: Session["outcome"] = "unknown";

  const rest = raw.slice(newline + 1);
  let pos = 0;
  while (pos < rest.length) {
    const end = rest.indexOf("\n", pos);
    const line = end === -1 ? rest.slice(pos) : rest.slice(pos, end);
    pos = end === -1 ? rest.length : end + 1;
    if (!line.trim()) continue;

    // Fast path: avoid full JSON.parse where possible
    if (line.includes('"type":"message"')) messageCount++;
    if (line.includes('"timestamp"')) {
      const m = line.match(/"timestamp":"([^"]+)"/);
      if (m) lastTimestamp = m[1];
    }
    if (outcome === "unknown" && line.includes("VERDICT")) {
      if (/VERDICT:\s*PASS/i.test(line)) outcome = "pass";
      else if (/VERDICT:\s*FAIL/i.test(line)) outcome = "fail";
    }
  }

  const durationMs = lastTimestamp
    ? new Date(lastTimestamp).getTime() - new Date(startedAt).getTime()
    : null;

  return {
    id: uuidFromFilename(path.basename(filePath)) ?? (header.id as string) ?? "",
    file: filePath,
    cwd,
    workspace: path.basename(cwd) || cwd,
    startedAt,
    endedAt: lastTimestamp,
    durationMs,
    outcome,
    messageCount,
    parentSession,
  };
}

/**
 * Parse a session JSONL file into a Session summary and raw events.
 * Returns null if the file is unreadable or has no valid header.
 *
 * @param filePath - Absolute path to the JSONL file.
 */
async function parseSessionFile(
  filePath: string
): Promise<{ session: Session; events: TranscriptEvent[] } | null> {
  let raw: string;
  try {
    raw = await readFile(filePath, "utf-8");
  } catch {
    return null;
  }

  const lines = raw.split("\n").filter((l) => l.trim().length > 0);
  if (lines.length === 0) return null;

  // Parse all entries
  const events: TranscriptEvent[] = [];
  let header: Record<string, unknown> | null = null;

  for (const line of lines) {
    try {
      const entry = JSON.parse(line) as TranscriptEvent;
      if (entry.type === "session" && header === null) {
        header = entry as unknown as Record<string, unknown>;
      } else {
        events.push(entry);
      }
    } catch {
      // skip malformed lines
    }
  }

  if (!header) return null;

  const cwd = (header.cwd as string | undefined) ?? "";
  const startedAt = (header.timestamp as string | undefined) ?? new Date().toISOString();
  const parentSession = (header.parentSession as string | undefined) ?? null;

  // Derive end time from the last event that has a timestamp
  const lastTimestamp = [...events].reverse().find((e) => e.timestamp)?.timestamp ?? null;
  const durationMs =
    lastTimestamp
      ? new Date(lastTimestamp).getTime() - new Date(startedAt).getTime()
      : null;

  // Determine outcome from VERDICT lines in assistant messages
  let outcome: Session["outcome"] = "unknown";
  for (const event of events) {
    if (event.type === "message" && event.message?.role === "assistant") {
      const text = (event.message.content as Array<{ type: string; text?: string }>)
        .filter((b) => b.type === "text")
        .map((b) => b.text ?? "")
        .join(" ");
      if (/VERDICT:\s*PASS/i.test(text)) {
        outcome = "pass";
        break;
      }
      if (/VERDICT:\s*FAIL/i.test(text)) {
        outcome = "fail";
      }
    }
  }

  const messageCount = events.filter((e) => e.type === "message").length;
  const id = uuidFromFilename(path.basename(filePath)) ?? (header.id as string) ?? "";

  return {
    session: {
      id,
      file: filePath,
      cwd,
      workspace: path.basename(cwd) || cwd,
      startedAt,
      endedAt: lastTimestamp,
      durationMs,
      outcome,
      messageCount,
      parentSession,
    },
    events,
  };
}

/**
 * Load all sessions across all workspace directories, sorted newest-first.
 */
export async function loadAllSessions(): Promise<Session[]> {
  if (!existsSync(SESSIONS_DIR)) return [];

  const workspaceDirs = await readdir(SESSIONS_DIR, { withFileTypes: true });
  const sessions: Session[] = [];

  await Promise.all(
    workspaceDirs
      .filter((e) => e.isDirectory())
      .map(async (dir) => {
        const dirPath = path.join(SESSIONS_DIR, dir.name);
        let files: string[];
        try {
          files = await readdir(dirPath);
        } catch {
          return;
        }
        await Promise.all(
          files
            .filter((f) => f.endsWith(".jsonl"))
            .map(async (file) => {
              const session = await parseSessionSummary(path.join(dirPath, file));
              if (session) sessions.push(session);
            })
        );
      })
  );

  sessions.sort(
    (a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime()
  );

  return sessions;
}

/**
 * Load all sessions for a given workspace name (basename of cwd).
 *
 * @param workspace - e.g. "juice-shop"
 */
export async function loadWorkspaceSessions(workspace: string): Promise<Session[]> {
  const all = await loadAllSessions();
  return all.filter((s) => s.workspace === workspace);
}

/**
 * Find the absolute file path for a session by its UUID.
 * The UUID is embedded in the filename so no file parsing is needed.
 *
 * @param id - Session UUID (from the filename after the underscore).
 */
async function findSessionFile(id: string): Promise<string | null> {
  if (!existsSync(SESSIONS_DIR)) return null;

  const workspaceDirs = await readdir(SESSIONS_DIR, { withFileTypes: true });
  for (const dir of workspaceDirs.filter((e) => e.isDirectory())) {
    const dirPath = path.join(SESSIONS_DIR, dir.name);
    let files: string[];
    try { files = await readdir(dirPath); } catch { continue; }
    const match = files.find((f) => f.includes(id) && f.endsWith(".jsonl"));
    if (match) return path.join(dirPath, match);
  }
  return null;
}

/**
 * Load a single session summary by its UUID.
 *
 * @param id - Session UUID (from the filename after the underscore).
 */
export async function loadSession(id: string): Promise<Session | null> {
  const file = await findSessionFile(id);
  if (!file) return null;
  const result = await parseSessionFile(file);
  return result?.session ?? null;
}

/**
 * Find all sessions that were forked from a given session file path.
 * These are verify() retry branches created by runtime.fork().
 *
 * Only reads the first line (header) of each candidate file rather than
 * parsing the full transcript, keeping this fast regardless of file sizes.
 *
 * @param sessionFile - Absolute path of the parent session file.
 */
export async function loadForkedSessions(sessionFile: string): Promise<Session[]> {
  if (!existsSync(SESSIONS_DIR)) return [];

  const workspaceDirs = await readdir(SESSIONS_DIR, { withFileTypes: true });
  const matched: Session[] = [];

  await Promise.all(
    workspaceDirs
      .filter((e) => e.isDirectory())
      .map(async (dir) => {
        const dirPath = path.join(SESSIONS_DIR, dir.name);
        let files: string[];
        try { files = await readdir(dirPath); } catch { return; }

        await Promise.all(
          files
            .filter((f) => f.endsWith(".jsonl"))
            .map(async (file) => {
              const filePath = path.join(dirPath, file);
              try {
                const raw = await readFile(filePath, "utf-8");
                const firstLine = raw.slice(0, raw.indexOf("\n"));
                const header = JSON.parse(firstLine);
                if (header.parentSession === sessionFile) {
                  const result = await parseSessionFile(filePath);
                  if (result) matched.push(result.session);
                }
              } catch { /* skip */ }
            })
        );
      })
  );

  return matched.sort(
    (a, b) => new Date(a.startedAt).getTime() - new Date(b.startedAt).getTime()
  );
}

/**
 * Load and parse the full transcript for a session by its UUID.
 *
 * @param id - Session UUID.
 */
export async function loadTranscript(id: string): Promise<TranscriptEvent[]> {
  const file = await findSessionFile(id);
  if (!file) return [];
  const result = await parseSessionFile(file);
  return result?.events ?? [];
}
