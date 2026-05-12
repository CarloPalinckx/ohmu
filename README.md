# ohmu


## Setup

Run this agent by:
- Forking this repo
- Create a gh project board alongside this repo (don't worry, it can work on any other github repo). We just need it to be the default repository so that we can use issue templates.

## Missions

Missions are GitHub Issues created from the **🎯 Mission** template.
The agent polls the project board and picks up any issue in the **Ready** column.

### Filing a mission

1. Open a new issue in this repo — the **🎯 Mission** template will be pre-selected.
2. Fill in all required fields:
   | Field | Purpose |
   |---|---|
   | **Objective** | One-sentence goal the agent must achieve |
   | **Context & Background** | File paths, related issues, prior decisions |
   | **Acceptance Criteria** | Checklist the agent ticks off to declare done |
   | **Constraints & Notes** | Things the agent must not do / guardrails |
   | **Scope** | Small / Medium / Large — helps the agent timebox |
3. Add the issue to the project board and move it to **Ready**.
4. The agent picks it up on the next poll cycle, implements it, opens a PR, and moves the card to **In Review**.

### Mission lifecycle

```
Ready → (agent picks up) → In Progress → PR opened → In Review → Done
```

If the PR receives review feedback the agent will automatically address it and push a new commit.

