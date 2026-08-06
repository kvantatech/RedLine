# build-status-views
> Render human views (STATUS.md + dashboard.html) from the status.json SSOT — zero model calls.

**Type:** skill (deterministic) · **Used by:** build-status · **Status:** STUB (P0 scaffold — not yet implemented)

## Prompt
When implemented, read the `status.json` single source of truth and render two human-facing views: `STATUS.md` (rewriting only the region between the AUTOGEN markers) and `architecture-dashboard.html`.
Inputs: `status.json` -> Outputs: regenerated STATUS.md region + dashboard HTML.
All totals/rollups are COMPUTED by the renderer at build time — never stored back into status.json.

## Tools
none — deterministic (plain code)

## Data
- Reads: `status.json` (SSOT — planned to live in the planning repo, which was never created; a local `status.json` is the sensible home if/when this is implemented)
- Writes: `STATUS.md` (between AUTOGEN markers only) and `docs/redline-architecture.html`
- Until then both views are hand-maintained (STATUS.md at repo root; the diagram in `docs/`)

## Notes
Activation: P0. One artifact, two lifecycle phases: build-readiness rollups now -> live SLOs at WS4. Hard rules: zero model calls (pure render); totals are computed, never stored; only the AUTOGEN-marked region of STATUS.md is rewritten.

---
Frozen skill registry: `AGENTS.md` in this repo
