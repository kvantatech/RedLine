# explore-product-structure
> Map product pages with Playwright and capture a HAR of representative traffic.

**Type:** skill (grounded model exploration) · **Used by:** perf-author · **Status:** STUB (P0 scaffold — not yet implemented)

## Prompt
Drive the product UI with Playwright to enumerate the pages/flows a load test
should cover and capture a HAR of representative traffic.

- Input: an environment from `envs/` (read-only) plus a target product area.
- Output: a page/endpoint map (pages, flows, request URLs) that feeds the
  script-author step, alongside the raw HAR capture.

This is grounded exploration — observe the real UI, do not invent endpoints.

## Tools
Playwright MCP

## Data
- Reads: `envs/` (read-only — environment definitions / scripts)
- Writes: `reports/` (HAR capture + page/endpoint map)

## Notes
Activation: P4. First half is grounded model exploration; its output feeds
`verify-k6-script` / the script-author step. Read-only against `envs/` — this
skill never mutates environment definitions. Any captured HAR MUST pass through
`scrub-har-secrets` before it is persisted or fed to a model.

---
Frozen skill registry: `AGENTS.md` in this repo
