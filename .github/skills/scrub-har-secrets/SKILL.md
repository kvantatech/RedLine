# scrub-har-secrets
> Strip auth tokens and cookies from a captured HAR before anything is persisted.

**Type:** skill (deterministic) · **Used by:** perf-author (+ run-failure capture) · **Status:** STUB (P0 scaffold — not yet implemented)

## Prompt
Deterministically redact secrets from a captured HAR before it is saved to disk
or fed to a model.

- Input: a raw HAR file under `reports/`.
- Output: the same HAR with `Authorization` headers, `Cookie`/`Set-Cookie`
  headers, and bearer/session tokens replaced by a fixed redaction marker.

No model judgement — fixed redaction rules only.

## Tools
none — deterministic (plain code)

## Data
- Reads: `reports/` (raw HAR captures)
- Writes: `reports/` (scrubbed HAR — overwrites or sidecars the raw capture)

## Notes
Activation: P4. Secret hygiene gate — used by `explore-product-structure` and by
run-failure HAR capture. Hard rule: a HAR MUST be scrubbed here before it is
persisted or handed to any model. No exceptions, no partial passes.

---
Frozen skill registry: `AGENTS.md` in this repo
