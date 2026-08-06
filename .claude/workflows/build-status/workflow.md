# build-status — workflow recipe

**Type:** UTIL (utility, deterministic) / **Trigger:** manual `/build-status` (or after any `status.json` edit) / **Status: STUB (P0 scaffold)**

Regenerates the human-facing views from the machine-readable single source of truth. The
`status.json` SSOT was designed to live in the planning repo — which was never created —
so this renderer stays a stub and its two views are hand-maintained today:
`STATUS.md` (repo root; the `<!-- AUTOGEN:status -->` region is kept in renderer shape) and
the interactive `docs/redline-architecture.html`. When build-status is implemented, point
it at a local `status.json` and let it own the AUTOGEN region + regenerate the diagram.

**Invariant:** all totals/tallies are **COMPUTED at render time, never stored** in `status.json`.
The SSOT holds facts; the views hold derived counts. This workflow is the only writer of the
AUTOGEN region — hand-edits there will be overwritten.

## Steps (recipe)

1. **`build-status-views`** — read the `status.json` SSOT; compute all totals (tickets, workflows,
   skills, subagents, MCP, blockers) on the fly; render `STATUS.md` inside the
   `<!-- AUTOGEN:status -->` … `<!-- /AUTOGEN:status -->` markers and regenerate
   `architecture-dashboard.html`. Deterministic — same input bytes produce byte-identical output.

## Branching / gates

None. Single deterministic step, no human gate, no fan-out. Idempotent: re-running with an
unchanged `status.json` is a no-op diff.

## Model-call budget

**0 model calls.** Pure read → compute → render. No subagents, no LLM judgment.

---

Skills referenced live in `.github/skills/`. Full design: planning repo `agent/WORKFLOWS.md` —
`AGENTS.md` in this repo
