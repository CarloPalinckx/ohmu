/**
 * Extract human-readable text from one or more pi session JSONL files.
 *
 * Outputs assistant message text and tool call summaries to stdout.
 *
 * Usage:
 *   tsx src/scripts/extract-session-text.ts <file.jsonl> [file2.jsonl ...]
 *
 * Typical use: pipe into write-wiki's --about parameter.
 */

import { readFile } from 'node:fs/promises';

// ---------------------------------------------------------------------------
// Types (minimal subset of the pi session format we care about)
// ---------------------------------------------------------------------------

interface TextContent {
  type: 'text';
  text: string;
}

interface ToolCall {
  type: 'toolCall';
  name: string;
  arguments: Record<string, unknown>;
}

interface AssistantMessage {
  role: 'assistant';
  content: (TextContent | ToolCall | { type: string })[];
}

interface SessionEntry {
  type: string;
  message?: AssistantMessage | { role: string; content: unknown };
}

// ---------------------------------------------------------------------------
// Extraction
// ---------------------------------------------------------------------------

/**
 * Parse a single JSONL session file and return a human-readable transcript
 * containing only assistant text turns and brief tool call annotations.
 *
 * @param filePath - Absolute or relative path to a `.jsonl` session file.
 */
async function extractFromFile(filePath: string): Promise<string> {
  const raw = await readFile(filePath, 'utf-8');
  const lines = raw.split('\n').filter((l) => {return l.trim().length > 0});

  const sections: string[] = [];

  for (const line of lines) {
    let entry: SessionEntry;
    try {
      entry = JSON.parse(line) as SessionEntry;
    } catch {
      continue;
    }

    if (entry.type !== 'message' || !entry.message) continue;

    const msg = entry.message;

    if (msg.role === 'assistant') {
      const assistantMsg = msg as AssistantMessage;
      const parts: string[] = [];

      for (const block of assistantMsg.content) {
        if (block.type === 'text') {
          parts.push((block as TextContent).text);
        } else if (block.type === 'toolCall') {
          const tc = block as ToolCall;
          parts.push(`[Tool: ${tc.name}]`);
        }
      }

      const text = parts.join('\n').trim();
      if (text) sections.push(text);
    }
  }

  return sections.join('\n\n---\n\n');
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const files = process.argv.slice(2);

  if (files.length === 0) {
    console.error('Usage: tsx src/scripts/extract-session-text.ts <file.jsonl> [...]');
    process.exit(1);
  }

  const parts: string[] = [];

  for (const file of files) {
    const text = await extractFromFile(file);
    if (text) parts.push(`=== ${file} ===\n\n${text}`);
  }

  process.stdout.write(parts.join('\n\n'));
}

main().catch((err) => {
  console.error('[extract-session-text] error:', err);
  process.exit(1);
});
