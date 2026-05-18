# ohmu

- This is a coding agent that uses the pi (pi.dev) SDK to create automated coding sessions called "missions".
- These "missions" run inside code repo's called "workspaces".
- The agent stores (through the sdk) persistent memory in a "wiki".

## Project structure

```
src/
  framework/
    mission.ts     # mission() — defines a mission with config (params, escalation, worktree)
    session.ts     # createSession() — runtime + prompt/verify + worktree management
    escalation.ts  # escalation logic (model switching on stuck detection)
    worktree.ts    # git worktree creation/cleanup utilities
    wiki.ts        # wiki_list and wiki_read tool definitions
  missions/
    fix-vulnerability.ts
    write-wiki.ts
  scripts/
    run-mission.ts   # CLI entry point
wiki/                # persistent codebase knowledge (Obsidian vault)
workspaces/          # target code repos (git clones)
.logs/               # mission run history
ui/                  # Next.js dashboard for browsing mission logs
```

Update this project structure when folder structure changes.

## Worktree support

Missions can run in isolated git worktrees by adding a `worktree` config:

```typescript
export default mission({
  parameters: z.object({ /* ... */ }),
  worktree: { ref: 'main' }  // optional: ref to check out (defaults to HEAD)
}, async ({ params, session, cwd }) => {
  // Agent runs in an isolated worktree, automatically cleaned up on dispose
});
```

When enabled:
- An isolated worktree is created as a sibling to the main repository
- The agent operates in this worktree (no changes to the main repo)
- The worktree is automatically cleaned up after the mission completes
- Paths and symlinks remain valid within the worktree hierarchy
