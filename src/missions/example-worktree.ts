import { z } from 'zod';
import { mission, type MissionConfig } from '../framework/mission.ts';

const config = {
  parameters: z.object({
    message: z.string().describe('A message to write to a file in the worktree'),
  }),
  // Enable isolated worktree execution
  worktree: {
    ref: 'HEAD', // check out HEAD in the worktree
  },
} satisfies MissionConfig;

/**
 * Example mission demonstrating git worktree support.
 *
 * The worktree is created and cleaned up automatically by the framework.
 */
export default mission(config, async ({ params: { message }, session }) => {
  await session.prompt(`\
Your job:

1. Create a file called "worktree-test.txt" with this message:
   "${message}"
2. Commit the file with git
3. Verify the commit was created with "git log"`);

  await session.verify(`\
Verify the work:

1. Check that "worktree-test.txt" exists and contains the expected message
2. Confirm there is a new commit in the git log`);
});
