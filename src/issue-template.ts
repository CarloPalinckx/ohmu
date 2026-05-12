import { z } from "zod";
import type { MissionConstructor } from "./mission.js";
import { baseParameters } from "./mission.js";

// ---------------------------------------------------------------------------
// YAML helpers
// ---------------------------------------------------------------------------

/**
 * Wrap a string in double quotes if it contains characters that would break
 * bare YAML scalars (colons, hashes, brackets, etc.).
 *
 * @param s - Raw string value.
 */
function yamlQuote(s: string): string {
  if (/[:#{\[\]},|>&*?!'"@`%]/.test(s) || s.includes("\n")) {
    return `"${s.replace(/"/g, '\\"')}"`;
  }
  return s;
}

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
 * Generate a GitHub issue form (`.yml`) for a mission.
 *
 * Each parameter becomes a labeled form field. When a human submits the form,
 * GitHub renders the body as `### key\n\nvalue` sections, which
 * `parseIssueFrontmatter` in the GitHub input reads back as structured vars.
 *
 * The `mission` field is pre-filled and should not be modified by the user.
 * Required parameters become single-line `input` fields; optional ones become
 * multi-line `textarea` fields.
 *
 * Output path convention: `.github/ISSUE_TEMPLATE/<mission-name>.yml`
 *
 * @param Cls - The mission constructor whose `static config` is used as the source of truth.
 * @returns `{ filename, content }` — filename is relative to the ISSUE_TEMPLATE dir.
 */
export function generateIssueTemplate(Cls: MissionConstructor): { filename: string; content: string } {
  const { name, description, parameters } = Cls.config;

  const bodyFields: string[] = [];

  // `mission` field: pre-filled textarea so the agent knows which mission type
  // to dispatch to. The user should leave this untouched.
  bodyFields.push([
    `  - type: textarea`,
    `    id: mission`,
    `    attributes:`,
    `      label: mission`,
    `      description: "Identifies the mission type for the coding agent. Do not modify."`,
    `      value: ${name}`,
    `    validations:`,
    `      required: true`,
  ].join("\n"));

  // Base parameters (e.g. repo) followed by mission-specific parameters.
  const allShapes: Array<[string, z.ZodTypeAny]> = [
    ...Object.entries(baseParameters.shape as Record<string, z.ZodTypeAny>),
    ...(parameters ? Object.entries(parameters.shape as Record<string, z.ZodTypeAny>) : []),
  ];

  for (const [key, field] of allShapes) {
    const { description: fieldDesc, required } = introspectField(field);
    // Required → single-line input; optional → textarea for multiline flexibility.
    const type = required ? "input" : "textarea";
    const lines = [
      `  - type: ${type}`,
      `    id: ${key}`,
      `    attributes:`,
      `      label: ${key}`,
    ];
    if (fieldDesc) {
      lines.push(`      description: ${yamlQuote(fieldDesc)}`);
    }
    lines.push(`    validations:`);
    lines.push(`      required: ${required}`);
    bodyFields.push(lines.join("\n"));
  }

  const content = [
    `name: ${toTitleCase(name)}`,
    `description: ${yamlQuote(description)}`,
    `title: "[${name}] "`,
    `labels: []`,
    `body:`,
    bodyFields.join("\n"),
  ].join("\n") + "\n";

  return { filename: `${name}.yml`, content };
}
