# verify-k6-script
> Validate, run, and fix an authored k6 script in a bounded loop.

**Type:** skill (bounded model) · **Used by:** perf-author · **Status:** IMPLEMENTED (P1)

## Prompt

Confirm an authored k6 script actually validates and runs before it ships.

**Inputs:**
- `script_path` — path to the in-flight script, always under `drafts/<team>/<profile>/script.js`
- `env_vars` — map of env vars to pass (credentials, BASE_URL, etc.) — never hardcoded in the script

**Hard rules (read before doing anything):**
1. `script_path` MUST be under `drafts/` — refuse any path outside it (that is `run-k6-script`'s job)
2. Cap fix rounds at **3** — if it still fails after round 3, report FAIL and stop; never loop forever
3. A non-zero exit code is a FAIL — never swallow it (99 = threshold breach, 97 = crash/abort; both fail verify)
4. Never write credentials or secrets into the script file
5. Write validate + run output to `reports/verify-<team>-<profile>-<timestamp>.txt`

---

### Step 1 — Read the script

Read `script_path` from disk.

### Step 2 — Validate (syntax + API check, no network)

Call `mcp__k6__validate_script` with the script content.

- Tool: `mcp__k6__validate_script(script: <content>)`
- If validation passes → proceed to Step 3
- If validation fails → go to **Fix loop** (Step 4), then re-validate

### Step 3 — Smoke run (real network, 1 VU, 1 iteration)

**First: detect script type** — inspect the script content for browser imports:
- `import { browser } from 'k6/browser'` OR `import { chromium } from 'k6/browser'` → **browser script**
- Anything else → **HTTP script**

**HTTP script:** call `mcp__k6__run_script(script: <content>, vus: 1, iterations: 1)`

**Browser script:** use `Bash: k6 run <script_path>` with env vars — do NOT use `mcp__k6__run_script` (it passes `--vus/--iterations` CLI flags that override `options.browser` and prevent the browser scenario from running):
```
k6 run -e PERF_USERNAME=<u> -e STAGING_PASSWORD=<p> -e ENVIRONMENT=stg <script_path>
```

- Check: exit code 0, no threshold breaches, checks pass
- If smoke run passes → proceed to Step 5 (write report, return PASS)
- If smoke run fails → go to **Fix loop** (Step 4)

### Step 4 — Fix loop (max 3 rounds, fully autonomous — never ask the user)

For each failure, self-diagnose using tools before editing:

**API / syntax errors:** call `mcp__k6__get_documentation` or `mcp__k6__list_sections` for the failing construct first. Validate with `mcp__k6__validate_script` after each edit.

**Browser selector / interaction failures:** use Playwright MCP to explore the live page — do NOT ask the user:
1. `mcp__playwright__browser_navigate` to the page (navigate directly to the login URL if auth is needed, not BASE_URL — avoids the shell→JS-redirect race)
2. `mcp__playwright__browser_snapshot` to read the accessibility tree
3. `mcp__playwright__browser_evaluate` with a shadow-DOM walk if elements are missing:
   ```js
   () => { var r=[]; function w(root,p){root.querySelectorAll('button').forEach(b=>r.push(p+' id='+b.id+' aria='+b.getAttribute('aria-label')+' text='+b.textContent.trim().substring(0,40))); root.querySelectorAll('*').forEach(el=>{if(el.shadowRoot)w(el.shadowRoot,p+'>'+el.tagName+(el.id?'#'+el.id:''));}); } w(document,'doc'); return r.join('\n'); }
   ```
4. `mcp__playwright__browser_click` to confirm the selector works before writing it into the script

**Known demo-web / k6-browser gotchas (check these first to save rounds):**
- `goto(BASE_URL)` race: shell HTML returns 200 immediately; JS detects 401 on /api/config and async-redirects to login. Navigate directly to the WS-Fed login URL.
- Shadow DOM: shell uses `app-*` custom elements behind shadow roots. CSS `#id #child` fails across shadow boundaries. Use the shadow host element tag+id (e.g. `app-icon-button#menu-button`). k6 `locator()` pierces shadow DOM automatically.
- Multiple Back buttons: `.first()` prevents strict-mode violation.
- `page.locator("banner")` matches nothing on this shell — use `nav[aria-label="Main navigation"]`.
- `mcp__k6__run_script` cannot run browser scripts (its CLI flags override `options.browser`). Use `Bash: k6 run <path>` with env vars for browser scripts.

After diagnosis:
1. Edit `script_path` on disk to apply the fix
2. Re-run Step 2 (validate) then Step 3 (smoke run)
3. Increment round counter — stop at round 3 regardless; report FAIL with root cause and fix options if still failing

### Step 5 — Write report

Write results to `reports/verify-<team>-<profile>.txt`:
```
VERDICT: PASS | FAIL
script:  drafts/<team>/<profile>/script.js
rounds:  <n>
validate: PASS | FAIL
smoke:    PASS | FAIL — exit <code>
checks:   <summary>
errors:   <if any>
```

Return the verdict to the caller.

---

> **Script-root:** this skill **may run `drafts/**` scripts** — that is the factory incubation
> path where new scripts are proven before graduating. The operational skill `run-k6-script` stays
> `live/`-only (proven/merged scripts only). See planning `agent/DELIVERY-MODEL.md` §2.

## Tools
- `mcp__k6__validate_script` — syntax + API check, no network
- `mcp__k6__run_script` — real execution, HTTP scripts only (browser scripts: use `Bash: k6 run`)
- `mcp__k6__get_documentation` / `mcp__k6__list_sections` — consult before guessing at API fixes
- `mcp__playwright__browser_navigate` / `browser_snapshot` / `browser_evaluate` / `browser_click` — live page exploration for browser script selector failures (autonomous, no user input)
- `Read` / `Edit` / `Write` — read script, apply fixes, write report
- `Bash` — `k6 run <path>` for browser scripts (mcp__k6__run_script cannot run them)

## Data
- Reads: `drafts/<team>/<profile>/script.js`
- Writes: `reports/verify-<team>-<profile>.txt`; may edit `drafts/<team>/<profile>/script.js` during fix loop

---
Frozen skill registry: `AGENTS.md` in this repo
