# open-draft-pr
> Open a DRAFT PR with the authored script — never commit to main.

**Type:** skill (1 model narration) · **Used by:** perf-author · **Status:** STUB (P0 scaffold — not yet implemented)

## Prompt
Open a DRAFT pull request carrying the authored or leveled-up k6 script.

- Input: the verified script (graduated from `workbench/<team>/<profile>/`) plus context
  (environment, what changed).
- **Target: the team's upstream repo** (the "shelf" — e.g. `ui-deployments`), branch
  `perf-author/<team>-<profile>`. **Never** the agent repo, **never** inside `envs/*`. On merge, the
  source leaves the factory `workbench/` (the team repo becomes the home-of-record).
- Output: a DRAFT PR with a clear title and body summarizing the script.

NEVER commit to main; NEVER auto-merge. A human reviews and merges.

> **No push access? Use the manual-export fallback** (planning `agent/DELIVERY-MODEL.md` §3): hand
> the team the proven `script.js` + `perf-gate.yaml` + an informational baseline copy; the team
> commits on their own branch and merges via their own reviewer. The PE never touches their `main`.

## Tools
GitHub MCP

## Data
- Reads: the graduated script (from `workbench/<team>/<profile>/`); `envs/` (read-only, for PR context — which environment the script targets)
- Writes: a DRAFT PR in the **team's upstream repo** (not this agent repo; not `envs/*`)

## Notes
Activation: P5. Workflows are proposals only — no irreversible action mid-run.
Hard rule: DRAFT PR only, no direct commits to main and no auto-merge. The human
is the merge gate.

---
Frozen skill registry: `AGENTS.md` in this repo
