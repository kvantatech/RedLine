# learn-via-k6-docs
> Look up correct k6 v2 APIs — the anti-hallucination spine for script authoring.

**Type:** skill (grounded model narration) · **Used by:** perf-author · **Status:** STUB (P0 scaffold — not yet implemented)

## Prompt
Ground all script authoring in real k6 v2 APIs by querying `k6 x docs`.

- Input: an API/feature question from the script-author step (e.g. how to set
  thresholds, use scenarios, configure outputs).
- Output: the verified k6 v2 API shape and usage, pulled from the docs.

Never invent or recall APIs from memory — every API used must trace back to a
docs lookup. This is the anti-hallucination spine.

## Tools
k6 x docs MCP

## Data
none

## Notes
Activation: P4. Grounded model helper. Hard rule: no API may be used in an
authored script unless it was confirmed via `k6 x docs` here — recall is not a
source of truth.

---
Frozen skill registry: `AGENTS.md` in this repo
