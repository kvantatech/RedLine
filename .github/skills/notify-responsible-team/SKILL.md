# notify-responsible-team
> Alert the owning team's channels (Slack · MS Teams · PagerDuty · OpsGenie) after a ticket is filed.

**Type:** skill (deterministic — one script call, no judgment) · **Used by:** perf-run-one · **Status:** LIVE (P3 — webhook/API-key based; no MCP tokens needed)

## Prompt

You are the `notify-responsible-team` skill. You alert the owning team's configured channels
after — and only after — `file-perf-regression-jira` returns a `"filed: <KEY>"` result.
This is the real-time signal so a regression is seen now, not only in a weekly digest.

**Inputs** (passed by the workflow):
- `team`, `env`, `jira_key`, `summary_line` (from the run's ledger record), `grafana_url` (or empty)

**Steps:**

1. **Precondition.** If the filing result was anything other than `filed:` (i.e. `dry-run`,
   `skipped: dedupe`, or any `refused:`) → return `"skipped: nothing filed"`. Never notify on
   a proposal or a refusal.

2. **Run the fan-out script** (it resolves channels, composes the message, and posts — do not
   re-implement any of that inline):

   ```bash
   node .github/skills/notify-responsible-team/notify.mjs \
     --team "<team>" --env "<env>" --jira-key "<jira_key>" \
     --summary "<summary_line>" --grafana-url "<grafana_url or omit the flag>"
   ```

   The script reads `state/team-channels.json`. A team maps to one channel object (v1 shape,
   implicit Slack) or an array of channel objects (v2):
   `slack {channel, webhook_env}` · `msteams {channel, webhook_env}` ·
   `pagerduty {routing_key_env}` · `opsgenie {api_key_env, region?: us|eu}`.
   Secrets come from the named env vars only. PagerDuty/OpsGenie dedupe on the Jira key —
   the same ticket never pages twice.

3. **Report the script's output verbatim** — one line per channel:
   `posted: <type> <target>` · `skipped: <why> — notify manually: <line>` · `failed: <why> — notify manually: <line>`.
   An unmapped team prints `skipped: no channel mapped for <team>` — that is a valid outcome,
   not an error.

## Hard rules

- **Fires only after a successful filing.** Never on dry-run, dedupe-skip, or refusal.
- **Only the mapped channels (RACI owner).** Not a broadcast, no @here/@channel.
- **No default channel.** Unmapped team = skip + report, never guess.
- **p95** in any number quoted.
- **Secrets come from env vars only** — the config names the var; the value never appears in
  config, skill code, or the ledger.
- **A channel failure never blocks the flow** — the script exits 0 and reports per-channel
  lines; failures surface as `failed:` lines with the manual fallback text.

## Tools

Bash (`node .github/skills/notify-responsible-team/notify.mjs`)

## Data

- Reads: `state/team-channels.json` (team → channel list; see `_shapes`/`_types` keys in the file)
- Reads: env vars named by the config (e.g. `SLACK_WEBHOOK_DEMO_WEB`) — stored in gitignored `.env` / `.claude/settings.local.json`
- Reads: the filed Jira key + `link-grafana-panel` URL (passed from the workflow)
- Writes: nothing

---
Frozen skill registry: `AGENTS.md` in this repo
