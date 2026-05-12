import { z } from "zod";
import type { MissionConstructor } from "./mission.js";

// ---------------------------------------------------------------------------
// GitHub issue template generator
// ---------------------------------------------------------------------------

/**
 * Introspect a single Zod schema field to extract its human-readable
 * description and whether it is required.
 *
 * @param field - A field from a `z.object()` shape.
 */
function introspectField(field: z.ZodTypeAny): { description: string; required: boolean } {
  return {
    description: field.description ?? "",
    required: !field.isOptional(),
  };
}

/**
 * Convert a kebab-case mission name to Title Case for display.
 *
 * @param name - e.g. `"vuln-fix"`
 * @returns e.g. `"Vuln Fix"`
 */
function toTitleCase(name: string): string {
  return name
    .split("-")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

/**
 * Generate a GitHub issue template markdown file for a mission.
 *
 * The template pre-populates the issue body with the YAML frontmatter
 * skeleton that `parseIssueFrontmatter` expects. Field placeholder comments
 * are derived from each parameter's `.describe()` annotation in the Zod schema.
 *
 * Output path convention: `.github/ISSUE_TEMPLATE/<mission-name>.md`
 *
 * @param Cls - The mission constructor whose `static config` is used as the source of truth.
 * @returns The full markdown string to write to the template file.
 */
export function generateIssueTemplate(Cls: MissionConstructor): string {
  const { name, description, parameters } = Cls.config;

  // GitHub template metadata block (not the issue frontmatter — this is GH's own header)
  const templateHeader = [
    `---`,
    `name: ${toTitleCase(name)}`,
    `about: ${description}`,
    `title: "[${name}] "`,
    `labels: ""`,
    `---`,
  ].join("\n");

  // Issue body: YAML frontmatter skeleton that the ohmu parser will read
  const frontmatterLines: string[] = ["---", `mission: ${name}`];

  if (parameters) {
    for (const [key, field] of Object.entries(
      parameters.shape as Record<string, z.ZodTypeAny>,
    )) {
      const { description: fieldDesc, required } = introspectField(field);
      const suffix = required ? "" : " (optional)";
      const placeholder = fieldDesc ? `<!-- ${fieldDesc}${suffix} -->` : "";
      frontmatterLines.push(`${key}: ${placeholder}`);
    }
  }

  frontmatterLines.push("---");

  return `${templateHeader}\n\n${frontmatterLines.join("\n")}\n`;
}
