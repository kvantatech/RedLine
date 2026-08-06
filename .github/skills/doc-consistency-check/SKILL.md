# doc-consistency-check
> Pre-commit literal string/path checks that block drift — never a model call in the blocking hook.

**Type:** skill (deterministic) · **Used by:** pre-commit hook · **Status:** STUB (P0 scaffold — not yet implemented)

## Prompt
When implemented, run LITERAL checks only over the repo docs: license state wording, MCP phase-of-need wording, `.github`-canonical path usage, all 5 profiles present, and percentile == `p95`.
Inputs: repo docs -> Output: pass, or a non-zero exit listing the literal violations.
Any semantic / paraphrase check is a SEPARATE non-blocking advisory — it MUST NOT be a model call inside the blocking hook.

## Tools
none — deterministic (plain code)

## Data
- Reads: repo docs (markdown + config under the repo root)

## Notes
Activation: P0. Runs in `.githooks/pre-commit`; exits non-zero to block the commit. Hard rules: literal string/path matching only in the blocking path — zero model calls; percentile must be `p95` everywhere; all 5 profiles must be present. Semantic checks live in a separate advisory, never here.

---
Frozen skill registry: `AGENTS.md` in this repo
