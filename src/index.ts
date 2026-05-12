import { createGithubInput } from "./inputs/github.js";
import { runLoop } from "./loop.js";

const cwd = process.cwd();
const getNextMission = await createGithubInput(cwd);
await runLoop(getNextMission, cwd);
