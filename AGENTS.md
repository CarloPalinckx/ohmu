# ohmu

- This is a coding agent that uses the pi (pi.dev) SDK to create automated coding sessions called "missions".
- These "missions" run inside code repo's called "workspaces".
- The agent stores (through the sdk) persistent memory in a "wiki".

## Project structure

```
src/
  framework/
    mission.ts     # mission() — defines a mission and collects phase definitions
    phase.ts       # phase() — defines a phase with optional verification
    runner.ts      # runMission() / runPhase() — executes missions, manages logs
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
