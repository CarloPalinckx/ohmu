import type { TranscriptEvent } from "./types";

// ── Types ────────────────────────────────────────────────────────────────────

export interface SessionTree {
  /** Events on the main path (root → current leaf), in order. */
  mainPath: TranscriptEvent[];
  /**
   * Off-path subtrees keyed by the main-path entry ID whose children diverge.
   * Each value is an array of branches; each branch is an ordered event list.
   */
  branchesAt: Map<string, TranscriptEvent[][]>;
  hasBranches: boolean;
}

// ── buildSessionTree ─────────────────────────────────────────────────────────

/**
 * Build a tree structure from a flat list of session events.
 *
 * Walks the `id`/`parentId` graph to find the current leaf (latest entry
 * with no children), traces back to the root to get the main path, then
 * collects any off-path subtrees as branches.
 *
 * @param events - Raw events from the session JSONL (excluding the header line).
 */
export function buildSessionTree(events: TranscriptEvent[]): SessionTree {
  if (events.length === 0) {
    return { mainPath: [], branchesAt: new Map(), hasBranches: false };
  }

  // Index events by id
  const byId = new Map<string, TranscriptEvent>(events.map((e) => [e.id, e]));

  // Build parentId → children map
  const childrenOf = new Map<string, TranscriptEvent[]>();
  for (const e of events) {
    const key = e.parentId ?? "__root__";
    const list = childrenOf.get(key) ?? [];
    list.push(e);
    childrenOf.set(key, list);
  }

  // Find the current leaf: entry with no children. If multiple (e.g. abandoned
  // branches), pick the one with the latest timestamp.
  const hasChildren = new Set(
    events.map((e) => e.parentId).filter((id): id is string => id !== null)
  );
  const leaves = events
    .filter((e) => !hasChildren.has(e.id))
    .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
  const leaf = leaves[0];

  // Walk leaf → root to collect main-path IDs
  const mainPathIds = new Set<string>();
  const mainPath: TranscriptEvent[] = [];
  let cur: TranscriptEvent | undefined = leaf;
  while (cur) {
    mainPathIds.add(cur.id);
    mainPath.unshift(cur);
    cur = cur.parentId ? byId.get(cur.parentId) : undefined;
  }

  // Find branch points: main-path entries that have off-path children
  const branchesAt = new Map<string, TranscriptEvent[][]>();
  for (const entry of mainPath) {
    const children = childrenOf.get(entry.id) ?? [];
    const offPath = children.filter((c) => !mainPathIds.has(c.id));
    if (offPath.length > 0) {
      branchesAt.set(
        entry.id,
        offPath.map((start) => collectSubtree(start, childrenOf))
      );
    }
  }

  return { mainPath, branchesAt, hasBranches: branchesAt.size > 0 };
}

// ── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Collect an entry and all its descendants (BFS), preserving tree order.
 *
 * @param root       - Root of the subtree to collect.
 * @param childrenOf - Pre-built parentId → children map.
 */
function collectSubtree(
  root: TranscriptEvent,
  childrenOf: Map<string, TranscriptEvent[]>
): TranscriptEvent[] {
  const result: TranscriptEvent[] = [];
  const queue: TranscriptEvent[] = [root];
  while (queue.length > 0) {
    const e = queue.shift()!;
    result.push(e);
    for (const child of childrenOf.get(e.id) ?? []) {
      queue.push(child);
    }
  }
  return result;
}
