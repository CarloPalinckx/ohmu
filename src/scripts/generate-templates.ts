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

for (const Cls of missions) {
  const content = generateIssueTemplate(Cls);
  const outPath = path.join(outDir, `${Cls.config.name}.md`);
  await fs.writeFile(outPath, content, "utf-8");
  console.log(`[ohmu] wrote ${path.relative(cwd, outPath)}`);
}
