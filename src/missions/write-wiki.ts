import { z } from 'zod';
import { mission } from '../framework/mission.ts';
import { phase } from '../framework/phase.ts';

export default mission(
  {
    name: 'write-wiki',
    parameters: z.object({
      about: z
        .string()
        .describe(
          'Body of text to transform into a wiki article. Could be a session log, a small learning, or a concept explanation.',
        ),
    }),
    tools: ['read', 'bash', 'write'],
  },
  ({ parameters }) => {
    const { about } = parameters;

    /**
     * Survey the existing vault so the write phase can place the new note in context:
     * - understand the folder structure
     * - collect existing note titles for wikilinks
     * - discover tags already in use
     */
    phase('research', async ({ prompt }) => {
      await prompt(`\
You are preparing to write a new Obsidian wiki note. Before writing anything, survey the existing vault at \`./wiki/\`.

1. List the directory tree of \`./wiki/\` (use \`bash\` with \`find ./wiki -type f -name "*.md"\`). If the directory does not exist yet, note that the vault is empty.
2. Skim the frontmatter of existing notes (the YAML block between \`---\` delimiters) to collect:
   - all tags currently in use
   - all note titles / filenames that exist
3. Read a few notes that seem most related to the content below, so you understand the tone, depth, and linking style used in this vault.
4. Summarise what you found: folder structure, relevant existing notes, and tags. Do not write any files yet.

Content to analyse:
${about}`);
    });

    /**
     * Write the wiki article(s) into the vault using Obsidian conventions,
     * then verify the output is well-formed.
     */
    phase('write', async ({ prompt }) => {
      await prompt(`\
You are writing a new Obsidian wiki note into the vault at \`./wiki/\`.

Use the research you did in the previous phase to inform placement and linking.

## Writing style

Write every article as a **mini guide** — something a teammate could read and immediately act on or learn from. It should be helpful first, not just a record of what happened.

- Open with one or two sentences that explain **what this is and why it matters**.
- Use clear headings to break the content into scannable sections.
- Prefer concrete examples, steps, or rules of thumb over vague descriptions.
- End with a short **"When to use this" or "Watch out for"** section where relevant.
- Do not write in a journalistic or note-dump style. Write as if explaining to a capable colleague who has never seen this before.

## Obsidian conventions to follow

- **File location**: Place the note under a sensible subfolder of \`./wiki/\` that matches the content type (e.g. \`concepts/\`, \`guides/\`, \`learnings/\`, \`people/\`). Create the folder if it does not exist.
- **Filename**: Use lowercase kebab-case (e.g. \`sql-injection-basics.md\`).
- **Frontmatter**: Every note must open with a YAML block:
  \`\`\`yaml
  ---
  title: Human Readable Title
  tags: [tag-one, tag-two]
  created: YYYY-MM-DD
  ---
  \`\`\`
- **Wikilinks**: Link to any existing notes that are relevant using \`[[Note Title]]\` syntax. Do not invent links to notes that do not exist.
- **Structure**: Use Markdown headings (\`##\`, \`###\`), bullet lists, and code blocks as appropriate. Aim for clarity over length.
- **Atomic notes**: If the content naturally spans multiple distinct topics, split it into multiple notes and link them together.

## Content to transform

${about}

Write the file(s) now using the \`write\` tool.`);

      return (promptWithVerdict) =>
        {return promptWithVerdict(`\
Review the wiki note(s) you just wrote.

1. Read each file you created with the \`read\` tool.
2. Confirm every file has valid YAML frontmatter (title, tags, created).
3. Confirm all \`[[wikilinks]]\` point to files that actually exist in \`./wiki/\`.
4. Confirm no new tags were introduced when a sufficiently similar tag already exists in the vault — if a new tag is too close in meaning to an existing one (e.g. \`auth\` vs \`authentication\`, \`bug-fix\` vs \`bugfix\`), the existing tag should have been reused instead.
5. Confirm the filename is lowercase kebab-case and the file is under \`./wiki/\`.
6. Confirm the article reads as a helpful mini guide — not a raw note dump. It should open with context, be structured with headings, and give a reader something actionable or learnable.
7. Confirm the content faithfully represents the source material without hallucinating details.
`)};
    });
  },
);
