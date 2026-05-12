/**
 * generate-templates
 *
 * Reads every mission class from src/missions/ and writes a GitHub issue
 * template to .github/ISSUE_TEMPLATE/<name>.md.
 *
 * Usage:
 *   npm run generate-templates
 */

import path from "node:path";
import fs from "node:fs/promises";
import { loadMissions } from "../mission.js";
import { generateIssueTemplate } from "../issue-template.js";

const cwd = process.cwd();
const outDir = path.join(cwd, ".github", "ISSUE_TEMPLATE");

await fs.mkdir(outDir, { recursive: true });

const missions = await loadMissions();

if (missions.length === 0) {
  console.log("[ohmu] no missions found — nothing to generate.");
  process.exit(0);
}

const generated = new Set<string>();

for (const Cls of missions) {
  const { filename, content } = generateIssueTemplate(Cls);
  const outPath = path.join(outDir, filename);
  await fs.writeFile(outPath, content, "utf-8");
  generated.add(filename);
  console.log(`[ohmu] wrote ${path.relative(cwd, outPath)}`);
}

// Remove stale templates (.md or .yml) that no longer correspond to a mission.
for (const existing of await fs.readdir(outDir)) {
  if (!generated.has(existing)) {
    await fs.rm(path.join(outDir, existing));
    console.log(`[ohmu] removed stale template: ${existing}`);
  }
}
