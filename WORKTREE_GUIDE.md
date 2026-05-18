# Git Worktree Support

This guide explains how to use git worktree support in the ohmu mission framework.

## Overview

Git worktrees allow your missions to run in isolated repositories without affecting the main codebase. Each mission execution creates a unique worktree, runs the agent in that isolated environment, and automatically cleans up afterward.

## Why Use Worktrees?

- **Isolation**: Changes are confined to the worktree and don't affect the main repository
- **Concurrency**: Multiple missions can run simultaneously on the same repo without interfering
- **Safety**: Mistakes or failed attempts don't modify the original code
- **Clean history**: Each worktree has its own git history, making it easy to inspect changes

## Quick Start

Enable worktrees in any mission by adding a `worktree` configuration:

```typescript
import { z } from 'zod';
import { mission, type MissionConfig } from '../framework/mission.ts';

const config = {
  parameters: z.object({
    // your parameters
  }),
  worktree: {
    ref: 'main', // optional: which branch to check out (defaults to HEAD)
  },
} satisfies MissionConfig;

export default mission(config, async ({ params, session, cwd }) => {
  // Agent runs here in an isolated worktree
  // cwd is automatically set to the worktree path
  await session.prompt('...');
  await session.verify('...');
});
```

## Configuration Options

### `worktree.ref` (optional)

Specifies which git ref to check out in the worktree.

- Default: `'HEAD'`
- Examples: `'main'`, `'develop'`, `'v1.0.0'`, or any valid git ref

```typescript
worktree: { ref: 'main' }   // Check out the main branch
worktree: { ref: 'HEAD' }   // Check out the current HEAD (default)
worktree: { ref: 'develop' } // Check out develop branch
```

## How It Works

1. **Creation**: When the mission starts, a unique worktree is created as a sibling directory next to the main repository.
   - Naming: `_worktree_<timestamp>_<random>`
   - Example: `.../juice-shop-original/_worktree_1779113059819_7cqmlnj/`

2. **Execution**: The agent runs inside the worktree with full access to the codebase.

3. **Cleanup**: When the mission completes (success or failure), the worktree is automatically removed.

## Example: Isolated Bug Fix

```typescript
export default mission(
  {
    parameters: z.object({
      issue: z.string(),
    }),
    worktree: { ref: 'main' },
  },
  async ({ params: { issue }, session }) => {
    await session.prompt(`Fix this issue: ${issue}`);
    await session.verify('Confirm the fix works and tests pass');
  }
);
```

Run it:
```bash
npm run mission my-mission --cwd=/path/to/repo --issue="Memory leak in parser"
```

## Technical Details

### Worktree Paths

Worktrees are created next to the main repository to maintain valid paths and symlinks:

```
repo/
  .git
  src/
  ...
_worktree_1779113059819_7cqmlnj/
  .git (file, points to main repo)
  src/ (same structure as main repo)
  ...
```

### Git Integration

- Uses `git worktree add` to create the worktree
- Uses `git worktree remove` to clean up
- Falls back to `git worktree prune` if removal fails
- All git history and commits remain isolated to each worktree

### Error Handling

If worktree cleanup fails:
1. Attempts `git worktree remove`
2. Falls back to force-removing the directory
3. Runs `git worktree prune` to clean up git metadata
4. Logs a warning if cleanup still fails (mission continues)

## API Reference

### `MissionConfig.worktree?: WorktreeConfig`

Optional configuration for isolated worktree execution.

```typescript
interface WorktreeConfig {
  /**
   * Git ref to check out in the worktree (e.g., 'main', 'HEAD').
   * Defaults to 'HEAD'.
   */
  ref?: string;
}
```

### Framework Changes

The framework automatically handles worktree lifecycle:

1. **mission()** - Passes worktree config to createSession
2. **createSession()** - Creates worktree before building runtime, cleans up on dispose
3. **createWorktree()** - Low-level API in worktree.ts (exported for advanced use)

## Advanced Usage

### Manual Worktree Management

For scenarios where you need more control, you can import `createWorktree` directly:

```typescript
import { createWorktree } from '../framework/worktree.ts';

const handle = await createWorktree('/path/to/repo', { ref: 'develop' });
try {
  console.log('Worktree path:', handle.path);
  // Do work in handle.path
} finally {
  await handle.cleanup();
}
```

### Accessing Worktree Path

The `cwd` parameter in your mission is automatically set to the worktree path when enabled:

```typescript
async ({ params, session, cwd }) => {
  console.log(cwd); // Path to the worktree
  await session.prompt(`Work in ${cwd}`);
}
```

## Troubleshooting

### Worktree not being created

1. Ensure the `--cwd` points to a valid git repository
2. Check that the ref exists: `git branch -r | grep <ref>`
3. Verify git is installed and working

### Cleanup fails with "worktree locked"

This can happen if a process in the worktree is still running. The framework:
- Waits for the agent to finish
- Tries to remove the worktree
- Falls back to force removal if needed

If you see warnings, check for background processes in the worktree directory.

### Multiple missions on same repo

Since each mission runs in its own worktree, concurrent execution is safe:

```bash
npm run mission task1 --cwd=/path/to/repo &
npm run mission task2 --cwd=/path/to/repo &
```

Each will use its own isolated worktree with no conflicts.

## Performance Considerations

- **Creation overhead**: ~100-200ms per worktree (depends on repo size)
- **Cleanup time**: ~50-100ms (usually faster than creation)
- **Space usage**: Worktree uses hard links for unchanged files (efficient)
- **I/O**: No significant difference from working in the main repo

## Migration from Non-Worktree Missions

To add worktree support to an existing mission:

```diff
const config = {
  parameters: z.object({ /* ... */ }),
+ worktree: { ref: 'main' },
} satisfies MissionConfig;
```

No other changes needed — the framework handles everything automatically.

## See Also

- [git worktree documentation](https://git-scm.com/docs/git-worktree)
- `src/framework/worktree.ts` - Implementation
- `src/missions/example-worktree.ts` - Working example
