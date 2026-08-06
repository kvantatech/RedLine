# scope-review
> Present the drafted script's test scope to a human for confirmation before verify rounds are spent.

**Type:** skill (human gate) · **Used by:** perf-author (step 4a) · **Status:** IMPLEMENTED (P1)

## Prompt

After `script-author` drafts a script and before `verify-k6-script` runs, stop and present the
test scope to the human. Do not proceed until the human explicitly confirms or redirects.

**Inputs:**
- `script_path` — path to the drafted script under `workbench/<team>/<profile>/script.js`
- `team` — team name (e.g. `demo-web`)
- `profile` — test profile (e.g. `benchmark`)
- `test_type` — **`api` or `browser`** — asked before exploration begins; determines tooling and script shape

---

### What to present

Read `script_path` and surface exactly:

1. **Endpoints under test** — every HTTP call, grouped by step, with method + URL pattern
2. **What is NOT tested** — known pages/APIs discovered during exploration that were excluded, and why
3. **Auth flow** — how login is handled (SSO type, steps, what k6 manages automatically)
4. **Metrics being captured** — each `Trend` metric, what it measures, its threshold
5. **Profile** — executor, VUs, iterations, maxDuration
6. **Open questions** — anything the agent is uncertain about or that a human should decide

Format as a short, scannable brief — not a wall of text.

---

### Gate behaviour

- **Human says confirm / looks good / yes / proceed** → skill returns `APPROVED`; workflow continues to step 5
- **Human redirects** (e.g. "also test the jobs page", "remove the IdP lookup") → agent edits the script, re-presents the brief, waits again
- **Hard stop:** never call `verify-k6-script` (step 6) until this skill returns `APPROVED`

---

## Tools
- `Read` — read the drafted script

## Data
- Reads: `workbench/<team>/<profile>/script.js`
- Writes: nothing (gate only)

---
Frozen skill registry: `AGENTS.md` in this repo
