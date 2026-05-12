import { runMission, type MissionRun } from "./mission.js";

const POLL_INTERVAL_MS = 30_000;

/**
 * Run a polling loop driven by any input source.
 * @param getNextMission - returns the next mission, or null if there is nothing to do
 * @param cwd - working directory passed to each mission session
 */
export async function runLoop(
  getNextMission: () => Promise<MissionRun | null>,
  cwd: string,
): Promise<void> {
  while (true) {
    try {
      const mission = await getNextMission();

      if (mission) {
        await runMission(mission, cwd);
      } else {
        console.log("[ohmu] nothing to do — sleeping");
      }
    } catch (err) {
      console.error("[ohmu] error:", err);
    }

    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
  }
}
