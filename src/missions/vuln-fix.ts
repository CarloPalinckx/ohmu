import { z } from "zod";
import { Mission } from "../mission.js";

export default class VulnFix extends Mission<z.infer<typeof VulnFix.config.parameters>> {
  public static config = {
    name: 'vuln-fix',
    description: "Locate and patch a security vulnerability identified by CVE or CWE.",
    skills: [],
    parameters: z.object({
      identifier: z.string().describe("CVE or CWE identifier (e.g. CVE-2021-44228 or CWE-79)"),
      description: z.string().optional().describe("Plain-text summary of the vulnerability and affected area"),
    }),
  };

  /**
   * Set up the working environment and ensure test coverage exists before any fix is applied.
   */
  prepare(): string {
    const { description } = this.parameters;
    return `
      **IMPORTANT: Do not implement any fixes for the vulnerability yet**.

      1. Read the vulnerability report below, it will provide you a vulnerability report and a location where the vulnerability occurred.
      2. Prepare the working state of the application so that the next agent can properly do its work.
      3. It is your task to look at the coverage for the module this vulnerability occurs in, if there is no coverage on the unit this vulnerability lives in, write the missing tests first.
      4. Make sure those tests pass.

Report:

${description}
    `;
  }

  /**
   * Implement the fix for the identified security vulnerability.
   */
  execute(): string {
    const { description } = this.parameters;
    return `
      It is your task to fix a security vulnerability in the codebase that has been reported by a scanning tool.
      Follow these steps:

      1. Read the vulnerability report below, it will explain the vulnerability.
      2. Implement a fix for the security vulnerability.

Report:

${description}
    `;
  }

  /**
   * Review the fix: check commits, perform a code review, and run tests.
   */
  verify(): string {
    return verify(`Review the work done in this mission:
      1. Run \`git log --oneline -5\` to see what was changed.
      2. Run \`git diff main\` and check that no unrelated logic was altered.
      3. Run \`npm run lint\` and confirm it exits with no errors.
      4. Run only the server unit tests (\`npm run test:server\` or the relevant spec file directly with mocha) — do not start the full application or run integration/e2e tests.
      5. Confirm all tests pass.
    `);
  }
}
