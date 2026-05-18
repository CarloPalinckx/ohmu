import { spawn } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs/promises';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface WorktreeConfig {
  /**
   * Reference to check out in the worktree (e.g., 'main', 'HEAD').
   * Defaults to 'HEAD'.
   */
  ref?: string;
}

export interface WorktreeHandle {
  path: string;
  cleanup(): Promise<void>;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Run a git command in a given directory and return the output.
 *
 * @param cwd - Directory to run the command in.
 * @param args - Git command arguments (e.g., ['status']).
 * @returns The trimmed stdout output.
 */
async function runGit(cwd: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    let output = '';
    let error = '';

    const proc = spawn('git', args, { cwd });

    proc.stdout.on('data', (data) => {
      output += data.toString();
    });

    proc.stderr.on('data', (data) => {
      error += data.toString();
    });

    proc.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(`git ${args[0]} failed: ${error}`));
      } else {
        resolve(output.trim());
      }
    });

    proc.on('error', (err) => {
      reject(err);
    });
  });
}

/**
 * Check if a directory is a git repository.
 *
 * @param cwd - Directory to check.
 * @returns True if the directory is a git repo, false otherwise.
 */
async function isGitRepo(cwd: string): Promise<boolean> {
  try {
    await runGit(cwd, ['rev-parse', '--git-dir']);
    return true;
  } catch {
    return false;
  }
}

/**
 * Get the absolute path to the git repository root.
 *
 * @param cwd - Any directory within the repository.
 * @returns The path to the git root directory.
 */
async function getGitRoot(cwd: string): Promise<string> {
  const output = await runGit(cwd, ['rev-parse', '--show-toplevel']);
  return output;
}

/**
 * Generate a unique worktree directory name.
 * Format: `_worktree_<timestamp>_<random>`
 *
 * @returns A unique directory name.
 */
function generateWorktreeName(): string {
  const timestamp = Date.now();
  const random = Math.random().toString(36).substring(2, 9);
  return `_worktree_${timestamp}_${random}`;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Create a new git worktree in a sibling directory next to the repo root.
 *
 * The worktree is created as a sibling to the main repository so that paths
 * and symlinks remain valid. On cleanup, the worktree is removed via `git worktree prune`.
 *
 * @param cwd - A directory within the git repository.
 * @param config - Optional worktree configuration (ref to check out, etc).
 * @returns WorktreeHandle with the path and cleanup function.
 *
 * @example
 * const handle = await createWorktree('/path/to/repo');
 * try {
 *   await doSomethingIn(handle.path);
 * } finally {
 *   await handle.cleanup();
 * }
 */
export async function createWorktree(
  cwd: string,
  config?: WorktreeConfig,
): Promise<WorktreeHandle> {
  // Ensure we're in a git repository.
  if (!(await isGitRepo(cwd))) {
    throw new Error(`Not a git repository: ${cwd}`);
  }

  const gitRoot = await getGitRoot(cwd);
  const worktreeName = generateWorktreeName();
  const worktreePath = path.join(path.dirname(gitRoot), worktreeName);
  const ref = config?.ref ?? 'HEAD';

  // Create the worktree.
  try {
    await runGit(gitRoot, ['worktree', 'add', '-b', worktreeName, worktreePath, ref]);
  } catch (err) {
    throw new Error(`Failed to create git worktree at ${worktreePath}: ${(err as Error).message}`);
  }

  // Verify the worktree was created.
  try {
    await fs.access(worktreePath);
  } catch {
    throw new Error(`Worktree directory was not created: ${worktreePath}`);
  }

  return {
    path: worktreePath,
    /**
     * Remove the worktree and prune git metadata.
     */
    async cleanup(): Promise<void> {
      // Remove the worktree via git, or fall back to force removal if it fails.
      try {
        await runGit(gitRoot, ['worktree', 'remove', worktreePath]);
      } catch {
        // If removal fails, try to force remove the directory and prune.
        try {
          await fs.rm(worktreePath, { recursive: true, force: true });
          await runGit(gitRoot, ['worktree', 'prune']);
        } catch (cleanupErr) {
          console.warn(
            `Failed to clean up worktree at ${worktreePath}: ${(cleanupErr as Error).message}`,
          );
        }
      }
    },
  };
}
