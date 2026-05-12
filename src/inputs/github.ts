/**
 * GitHub input source.
 *
 * Polls the project board and converts the next item into a Mission.
 * The mission instructions are written here — the agent receives them
 * as its complete goal, with no knowledge of where they came from.
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { MissionRun } from "../mission.js";
import { assembleMission, findMission } from "../mission.js";

const execAsync = promisify(execFile);

async function gh(args: string[], cwd: string): Promise<string> {
  const { stdout } = await execAsync("gh", args, { cwd, env: process.env });
  return stdout.trim();
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

interface GithubInputConfig {
  repo: string;
  projectNumber: string;
  cwd: string;
}

export async function createGithubInput(cwd: string): Promise<() => Promise<MissionRun | null>> {
  const [repo, projectNumber] = await Promise.all([
    gh(["repo", "view", "--json", "nameWithOwner", "--jq", ".nameWithOwner"], cwd),
    readProjectNumber(cwd),
  ]);

  console.log(`[ohmu] github input: ${repo} · project #${projectNumber}`);

  return () => getNextMission({ repo, projectNumber, cwd });
}

async function readProjectNumber(cwd: string): Promise<string> {
  const raw = await fs.readFile(path.join(cwd, ".env"), "utf8");
  const match = raw.match(/^PROJECT_NUMBER=(.+)$/m);
  if (match?.[1]?.trim()) return match[1].trim();
  throw new Error(`PROJECT_NUMBER not set in ${cwd}/.env`);
}

// ---------------------------------------------------------------------------
// Board polling
// ---------------------------------------------------------------------------

async function getNextMission(config: GithubInputConfig): Promise<MissionRun | null> {
  const { repo, projectNumber, cwd } = config;
  const owner = repo.split("/")[0];

  const boardJson = await gh([
    "project", "item-list", projectNumber,
    "--owner", owner, "--format", "json", "--limit", "200",
  ], cwd);

  const { items } = JSON.parse(boardJson) as {
    items: Array<{ status: string; content: { type: string; number: number } }>;
  };

  const inReviewNums = new Set(
    items
      .filter((i) => i.status === "In review" && i.content?.type === "PullRequest")
      .map((i) => i.content.number),
  );

  const doneNums = new Set(
    items
      .filter((i) => i.status === "Done" && i.content?.type === "PullRequest")
      .map((i) => i.content.number),
  );

  // Priority 1: PRs in review with new feedback
  if (inReviewNums.size > 0) {
    const mission = await findPrFeedbackMission(repo, inReviewNums, cwd);
    if (mission) return mission;
  }

  // Priority 2: Open PRs with merge conflicts or failing CI
  const prMission = await findPrBlockerMission(repo, doneNums, cwd);
  if (prMission) return prMission;

  // Priority 3: Next ready issue
  const readyIssue = items.find((i) => i.status === "Ready" && i.content?.type === "Issue");
  if (readyIssue) return buildIssueMission(repo, projectNumber, readyIssue.content.number, cwd);

  return null;
}

// ---------------------------------------------------------------------------
// Mission builders
// ---------------------------------------------------------------------------

async function buildIssueMission(
  repo: string,
  projectNumber: string,
  number: number,
  cwd: string,
): Promise<MissionRun> {
  const json = await gh([
    "issue", "view", String(number),
    "--repo", repo,
    "--json", "number,title,body,url",
  ], cwd);

  const raw = JSON.parse(json) as { number: number; title: string; body: string; url: string };

  // Try to dispatch to a typed mission definition via frontmatter.
  const parsed = parseIssueFrontmatter(raw.body);
  if (parsed) {
    const { vars, body } = parsed;
    const missionName = vars["mission"];

    if (missionName) {
      const def = await findMission(missionName);

      if (def) {
        console.log(`[ohmu] issue #${raw.number} → mission type "${missionName}"`);
        return assembleMission(def, vars);
      }

      console.warn(`[ohmu] issue #${raw.number} has unknown mission type "${missionName}" — falling back to generic`);
    }
  }

  // Generic fallback: hand the full issue body to the agent as-is.
  return {
    label: `issue #${raw.number} — ${raw.title}`,
    instructions: `\
# ${raw.title}

**Issue:** ${raw.url}

${raw.body}

---

Implement this. When done, open a pull request and move it to "In Review" on project board #${projectNumber}.`,
  };
}

// ---------------------------------------------------------------------------
// Frontmatter parser
// ---------------------------------------------------------------------------

/**
 * Parse structured variables from an issue body.
 *
 * Handles two formats produced by the two template styles:
 *
 * 1. **YAML frontmatter** (legacy markdown template):
 *    ```
 *    ---
 *    key: value
 *    ---
 *    ```
 *
 * 2. **GitHub issue form output** (current `.yml` form template):
 *    ```
 *    ### key
 *
 *    value
 *
 *    ### next-key
 *
 *    value
 *    ```
 *    Field IDs in the form equal the label text, so the key is recovered by
 *    lowercasing the section heading. The sentinel value `_No response_`
 *    (GitHub's placeholder for empty optional fields) is treated as absent.
 *
 * Returns `null` when neither format is detected.
 * Values are returned as raw trimmed strings — no type coercion.
 *
 * @param rawBody - Raw issue body string as returned by the GitHub API.
 */
function parseIssueFrontmatter(
  rawBody: string,
): { vars: Record<string, string>; body: string } | null {
  // Format 1: YAML frontmatter at the top of the body.
  const fmMatch = rawBody.match(/^---[\t ]*\n([\s\S]*?)\n---[\t ]*\n?([\s\S]*)/);
  if (fmMatch) {
    const vars: Record<string, string> = {};
    for (const line of fmMatch[1].split("\n")) {
      const m = line.match(/^([\w-]+):[\t ]*(.*)$/);
      if (m) vars[m[1].trim()] = m[2].trim();
    }
    return { vars, body: fmMatch[2].trim() };
  }

  // Format 2: GitHub issue form output ("### key\n\nvalue" sections).
  if (rawBody.includes("### ")) {
    const vars: Record<string, string> = {};
    // Split before each section heading so every chunk owns one field.
    const parts = rawBody.split(/\n(?=### )/);
    for (const part of parts) {
      const m = part.match(/^### ([\w-]+)\s*\n\n([\s\S]*)/);
      if (!m) continue;
      const value = m[2].trim();
      if (value && value !== "_No response_") {
        vars[m[1].toLowerCase()] = value;
      }
    }
    if (Object.keys(vars).length > 0) {
      return { vars, body: rawBody };
    }
  }

  return null;
}

async function findPrFeedbackMission(
  repo: string,
  inReviewNums: Set<number>,
  cwd: string,
): Promise<MissionRun | null> {
  const json = await gh([
    "pr", "list", "--repo", repo, "--state", "open",
    "--json", "number,comments,reviews", "--limit", "100",
  ], cwd);

  const prs = JSON.parse(json) as Array<{
    number: number;
    comments: Array<{ body: string; createdAt: string }>;
    reviews: Array<{ state: string; submittedAt: string }>;
  }>;

  const pr = prs
    .filter((p) => inReviewNums.has(p.number))
    .find((p) => {
      const lastBotAt = p.comments.filter((c) => c.body.startsWith("🤖")).at(-1)?.createdAt ?? "0";
      return (
        p.comments.some((c) => !c.body.startsWith("🤖") && c.createdAt > lastBotAt) ||
        p.reviews.some((r) => r.state === "CHANGES_REQUESTED" && r.submittedAt > lastBotAt)
      );
    });

  if (!pr) return null;

  return buildPrMission(repo, pr.number, "review-feedback", cwd);
}

async function findPrBlockerMission(
  repo: string,
  doneNums: Set<number>,
  cwd: string,
): Promise<MissionRun | null> {
  const json = await gh([
    "pr", "list", "--repo", repo, "--state", "open",
    "--json", "number,mergeable,statusCheckRollup", "--limit", "100",
  ], cwd);

  const prs = (JSON.parse(json) as Array<{
    number: number;
    mergeable: string;
    statusCheckRollup: Array<{ conclusion?: string; state?: string }>;
  }>).filter((p) => !doneNums.has(p.number));

  const conflict = prs.find((p) => p.mergeable === "CONFLICTING");
  if (conflict) return buildPrMission(repo, conflict.number, "merge-conflict", cwd);

  const failing = prs.find((p) =>
    p.statusCheckRollup?.some(
      (c) => c.conclusion === "FAILURE" || c.conclusion === "TIMED_OUT" || c.state === "FAILURE",
    ),
  );
  if (failing) return buildPrMission(repo, failing.number, "failing-ci", cwd);

  return null;
}

async function buildPrMission(
  repo: string,
  number: number,
  reason: string,
  cwd: string,
): Promise<MissionRun> {
  const reasons: Record<string, string> = {
    "review-feedback": "has new review feedback or change requests",
    "merge-conflict":  "has merge conflicts that need resolving",
    "failing-ci":      "has failing CI checks",
  };

  return {
    label: `PR #${number} (${reason})`,
    instructions: `\
# PR #${number}

PR **#${number}** in \`${repo}\` ${reasons[reason] ?? reason}.

\`\`\`bash
gh pr view ${number} --repo ${repo} --json title,body,headRefName,baseRefName,comments,reviews,reviewThreads,statusCheckRollup
\`\`\`

Address everything, push, and reply to any open review threads.`,
  };
}
