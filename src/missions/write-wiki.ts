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
          'Raw text from a session log, terminal output, or notes. The agent will mine this for reusable knowledge about the codebase/repo and write wiki articles documenting what was discovered — not the task itself.',
        ),
    }),
    tools: ['read', 'bash', 'write'],
  },
  ({ parameters }) => {
    const { about } = parameters;

    /**
     * Survey the existing vault and identify what codebase knowledge to extract
     * from the session content — before writing anything.
     */
    phase('research', async ({ prompt }) => {
      await prompt(`\
You are preparing to write wiki articles that document a codebase. Before writing anything, do two things.

## 1. Survey the existing vault at \`./wiki/\`

Run \`find ./wiki -type f -name "*.md"\`. If the directory does not exist, note the vault is empty.
Skim the frontmatter of existing notes to collect:
- all tags currently in use
- all note titles and filenames

Read any notes that seem related to the content below, to understand the tone and linking style.
Summarise what you found.

## 2. Mine the content for codebase knowledge

The content below comes from a session log or notes produced while working on a codebase.
Your job is to extract **reusable knowledge about the repository itself** — not to document the task or what the agent did.

For each piece of information in the content, ask:
- "Would a new developer working on this repo want to know this?"
- "Does this describe how the repo works, how to run it, its structure, its APIs, its gotchas?"

If yes → it belongs in the wiki.
If it only describes what happened during this specific task (what was fixed, what the agent tried, what failed) → skip it.

Good candidates from a session log:
- Test infrastructure: what framework is used, how to run tests, caveats (e.g. "integration tests require a live server")
- API endpoints: routes discovered, their purpose, auth requirements
- Data models: entity relationships, key fields
- Architecture: how the app is structured, key files and their roles
- Configuration: environment variables, ports, build steps
- Known quirks or gotchas specific to this codebase

List the wiki articles you plan to write, with a one-line description of each. Do not write any files yet.

Content to analyse:
${about}`);
    });

    /**
     * Write the wiki article(s) into the vault using Obsidian conventions,
     * then verify the output is well-formed.
     */
    phase('write', async ({ prompt }) => {
      await prompt(`\
You are writing wiki articles into the vault at \`./wiki/\`. These articles document the **codebase**, not the task that was performed.

Use the research from the previous phase — the planned article list and the vault survey — to write the notes now.

## What to write about

Document what you learned **about the repository**: how it works, how to run things, its structure, its APIs, its quirks.

Do NOT write about:
- What the agent did during the session
- What was fixed or attempted
- The vulnerability or bug that was being worked on (that belongs in a separate task-tracking memory)

## Writing style

Write every article as a **reference doc or mini guide** — something a developer new to this repo could read and immediately use.

- Open with one or two sentences explaining what this is and why it matters in this codebase.
- Use clear headings to break content into scannable sections.
- Prefer concrete commands, examples, and specifics over vague descriptions.
- Include warnings or gotchas where relevant (a "Watch out for" section).
- Do not pad. Aim for useful and dense, not long.

## Obsidian conventions

- **File location**: Organise by project/repo under \`./wiki/\`. Use \`./wiki/<project-name>/<topic>.md\` (e.g. \`./wiki/juice-shop/running-tests.md\`, \`./wiki/juice-shop/api-endpoints.md\`). Create folders as needed.
- **Filename**: lowercase kebab-case.
- **Frontmatter**: every note must open with:
  \`\`\`yaml
  ---
  title: Human Readable Title
  tags: [tag-one, tag-two]
  created: YYYY-MM-DD
  ---
  \`\`\`
- **Wikilinks**: use \`[[Note Title]]\` to link to existing notes. Do not invent links to notes that do not exist.
- **Atomic notes**: if the content naturally spans multiple topics, split into multiple files and cross-link.

Write the file(s) now using the \`write\` tool.`);

      return (promptWithVerdict) =>
        {return promptWithVerdict(`\
Review the wiki note(s) you just wrote.

1. Read each file you created with the \`read\` tool.
2. Confirm every file has valid YAML frontmatter (title, tags, created).
3. Confirm all \`[[wikilinks]]\` point to files that actually exist in \`./wiki/\`. No invented links.
4. Confirm no new tags were introduced when a sufficiently similar tag already exists in the vault.
5. Confirm the filename is lowercase kebab-case and lives under \`./wiki/<project>/\`.
6. Confirm the article documents the **repository** (how it works, how to use it) — not the task or what the agent did.
7. Confirm there is no mention of the specific bug, fix, or mission that produced this session log.
`)};
    });
  },
);
