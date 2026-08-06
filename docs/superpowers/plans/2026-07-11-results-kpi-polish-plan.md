# Results View — KPI Tiles & History Bars Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add hero KPI tiles (pass-rate, red-run count, total runs with full-bleed sparklines) above the filter bar, and inline per-row history bars (last 8 runs of each team+profile) to the Results view, matching Testkube's polished dashboard aesthetic.

**Architecture:** Client-side aggregation over the fetched `runs` array — reuse the existing `renderTrends` grouping logic, extend `spark()` to draw filled areas, and add two new helper functions (`renderKpis` and `historyBar`). No new endpoints, no new ledger fields, nothing stored.

**Tech Stack:** Vanilla JS (ES6 modules), inline SVG (existing `spark()` technique), plain HTML/CSS.

## Global Constraints

- **Two verdicts only:** green | red. History-bar blocks: green / red / muted "didn't finish". Flake is a red block (annotation, never a color).
- **Zero dependencies:** inline SVG + plain divs only; no new npm installs.
- **Compute-at-render-time:** KPI tiles and history bars computed client-side from the in-memory `runs` array every render; nothing stored.
- **No new `runs-lib.mjs` logic:** pure rendering over existing data structures; live-browser verification only (no unit tests).
- **CSS appended identically to all three theme files:** `app.css`, `app-theme-canvas.css`, `app-theme-void.css` must remain byte-identical after edit.

---

## File Structure

**Modified:**
- `dashboard/public/runs.js` — add `renderKpis()`, extend `spark()`, add `historyBar()`, modify `renderList()` and `row()`.
- `dashboard/public/app.css` — append `.kpirow`, `.kpitile`, `.hbar`, `.hcell` CSS block.
- `dashboard/public/app-theme-canvas.css` — append identical CSS block.
- `dashboard/public/app-theme-void.css` — append identical CSS block.

**No new files created.** All changes fold into existing modules.

---

## Task 1: Extend `spark()` for filled-area charts

**Files:**
- Modify: `dashboard/public/runs.js:155-171`

**Interfaces:**
- Consumes: existing `spark(pts, { threshold, min, max })` signature
- Produces: `spark(pts, { threshold, min, max, fill: boolean })` — `fill=true` closes the polygon to the baseline and fills it

**Steps:**

- [ ] **Step 1: Read the current `spark()` function**

Review lines 155–171 of `runs.js`. Understand: polyline drawn from oldest→newest points, threshold line optional, dots drawn over the line.

- [ ] **Step 2: Modify `spark()` to accept `fill` option**

Add `fill: false` to the destructuring default:

```javascript
function spark(pts, { threshold, min, max, fill = false } = {}) {
  const W = 220, H = 34, P = 4;
  const ys = pts.map((p) => p.y).concat(threshold ?? []);
  const lo = min ?? Math.min(...ys), hi = max ?? Math.max(...ys);
  const span = hi - lo || 1;
  const x = (i) => P + (i * (W - 2 * P)) / Math.max(1, pts.length - 1);
  const y = (v) => H - P - ((v - lo) * (H - 2 * P)) / span;
  const line = pts.map((p, i) => `${x(i).toFixed(1)},${y(p.y).toFixed(1)}`).join(' ');
  const dots = pts.map((p, i) =>
    `<circle class="pt ${p.cls}" cx="${x(i).toFixed(1)}" cy="${y(p.y).toFixed(1)}" r="${p.cls.includes('hollow') ? 3.3 : 2.4}"/>`).join('');
  const th = threshold != null
    ? `<line class="thresh" x1="${P}" x2="${W - P}" y1="${y(threshold).toFixed(1)}" y2="${y(threshold).toFixed(1)}"/>` : '';
  
  // NEW: if fill=true, draw a filled polygon from the line down to the baseline
  let polygon = '';
  if (fill && pts.length >= 1) {
    // Polygon: line points + baseline end → baseline start (closed)
    const linePoints = pts.map((p, i) => `${x(i).toFixed(1)},${y(p.y).toFixed(1)}`).join(' ');
    const baselineEnd = `${x(pts.length - 1).toFixed(1)},${H - P}`;
    const baselineStart = `${P},${H - P}`;
    polygon = `<polygon class="spark-fill" points="${linePoints} ${baselineEnd} ${baselineStart}"/>`;
  }

  return `<svg class="spark" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" aria-hidden="true">
    ${polygon}<polyline class="line" points="${line}"/>${th}${dots}</svg>`;
}
```

- [ ] **Step 3: Verify the modified function**

Visual check: the SVG now has an optional `<polygon class="spark-fill">` before the polyline when `fill=true`.

- [ ] **Step 4: Commit**

```bash
git add dashboard/public/runs.js
git commit -m "feat: extend spark() to draw filled-area charts for KPI tiles"
```

---

## Task 2: Add `renderKpis()` function and integrate into `renderList()`

**Files:**
- Modify: `dashboard/public/runs.js:27-101`

**Interfaces:**
- Consumes: `shown` (filtered runs array)
- Produces: three KPI values (pass-rate %, red count, total count) and HTML string with tiles + sparklines

**Steps:**

- [ ] **Step 1: Write the `renderKpis()` function**

Add this before `renderList()` (around line 38, before the comment `// ── list ─────────────────────────────────────────────────────────`):

```javascript
// ── KPI row (hero tiles with full-bleed sparklines) ──────────────

function renderKpis(zone, shown) {
  // Count verdicts in shown (filtered) runs, excluding 'fail'
  const green = shown.filter((r) => r.verdict === 'green').length;
  const red = shown.filter((r) => r.verdict === 'red').length;
  const passRateNum = green + red > 0 ? Math.round((green / (green + red)) * 100) : null;
  const total = shown.length;

  // Last 30 runs chronologically for sparklines
  const last30 = shown.slice().reverse().slice(0, 30).reverse(); // oldest → newest

  // Pass-rate sparkline: green=1, red=0, fail skipped
  const passRatePts = last30
    .filter((r) => r.verdict !== 'fail')
    .map((r) => ({ y: r.verdict === 'green' ? 100 : 0, cls: r.verdict === 'red' ? 'red' : '' }));

  // Red-run sparkline: red=1, green=0, fail skipped
  const redCountPts = last30
    .filter((r) => r.verdict !== 'fail')
    .map((r) => ({ y: r.verdict === 'red' ? 100 : 0, cls: r.verdict === 'red' ? 'red' : '' }));

  // Total runs: every run = 1 (no sparkline needed for flat band)
  const totalSpark = total > 0 ? '' : ''; // total runs always flat, so no fill

  // Tile HTML with full-bleed sparklines
  const kpiTile = (label, num, sparkSvg, useClass) => `
    <div class="kpitile">
      <div class="kspark">${sparkSvg}</div>
      <div class="klabel">${label}</div>
      <div class="knum">${num ?? '—'}</div>
    </div>`;

  const tiles = [
    kpiTile('Pass Rate', passRateNum !== null ? `${passRateNum}%` : '—',
      passRatePts.length >= 2 ? spark(passRatePts, { fill: true, min: 0, max: 100 }) : '', 'pass'),
    kpiTile('Red Runs', red, 
      redCountPts.length >= 2 ? spark(redCountPts, { fill: true, min: 0, max: 100 }) : '', 'red'),
    kpiTile('Total', total, '', 'total'), // no sparkline for total
  ];

  zone.innerHTML = `<div class="kpirow">${tiles.join('')}</div>`;
}
```

- [ ] **Step 2: Call `renderKpis()` from `renderList()`**

Find line 77 in `renderList()` where it calls `renderTrends()`. Add a call to `renderKpis()` right after the main HTML is set and before calling `renderTrends()`:

Change:
```javascript
  renderTrends(document.getElementById('trends'), shown);
```

To:
```javascript
  renderKpis(document.getElementById('kpis'), shown);
  renderTrends(document.getElementById('trends'), shown);
```

- [ ] **Step 3: Add `<div id="kpis">` to the HTML in `renderList()`**

Find the opening `<div id="stage">` around line 54. Add the KPI zone right after the opening `<div id="stage">` and before the filter bar:

Change the opening from:
```javascript
      <div id="stage">
        <h1>Results.</h1>
```

To:
```javascript
      <div id="stage">
        <h1>Results.</h1>
        <div id="kpis"></div>
```

- [ ] **Step 4: Verify the function works**

Visual check: `renderKpis()` correctly computes pass-rate, red count, and total from `shown`; calls `spark()` with `fill: true`; and builds three tile divs.

- [ ] **Step 5: Commit**

```bash
git add dashboard/public/runs.js
git commit -m "feat: add renderKpis() with full-bleed sparkline tiles"
```

---

## Task 3: Add history-bar helpers and integrate into `row()` function

**Files:**
- Modify: `dashboard/public/runs.js:40-116`

**Interfaces:**
- Consumes: `r` (a single run record), `historyByCombo` (Map of team|profile → chronological runs)
- Produces: HTML string of `.hbar` with colored `.hcell` blocks

**Steps:**

- [ ] **Step 1: Build the history-by-combo Map in `renderList()`**

Before calling `row()` on each run, group all runs by `team|profile`. Add this after the `shown` array is filtered (around line 46, before the `row(r)` calls):

```javascript
  // Group runs by team|profile for history bars
  const historyByCombo = new Map();
  for (const r of runs) { // use all runs, not filtered 'shown'
    if (!r.team || !r.profile) continue;
    const k = `${r.team}|${r.profile}`;
    if (!historyByCombo.has(k)) historyByCombo.set(k, []);
    historyByCombo.get(k).push(r);
  }
```

- [ ] **Step 2: Write `historyBar()` helper function**

Add this before `renderList()` (around line 38, in the "KPI row" section):

```javascript
// History bar: last 8 runs of a team+profile, colored by verdict
function historyBar(r, historyByCombo) {
  if (!r.team || !r.profile) return '';
  const k = `${r.team}|${r.profile}`;
  const runs = historyByCombo.get(k) || [];
  const last8 = runs.slice(-8); // last 8 chronologically
  if (last8.length === 0) return '';
  
  const cells = last8.map((run) => {
    const cls = run.verdict === 'green' ? 'green'
      : run.verdict === 'red' ? 'red'
      : 'fail';
    return `<i class="hcell ${cls}" title="${run.verdict}"></i>`;
  }).join('');
  
  return `<span class="hbar">${cells}</span>`;
}
```

- [ ] **Step 3: Modify the `row()` function to include the history bar**

Find the `row()` function (starts around line 103). In the middle column where headline text lives, add the history bar after the flakeNote. 

Change:
```javascript
        <span class="runmeta"> · ${esc(headline(r))}</span> ${flakeNote(r)}
```

To:
```javascript
        <span class="runmeta"> · ${esc(headline(r))}</span> ${flakeNote(r)} ${historyBar(r, historyByCombo)}
```

But wait — `row()` is a pure function that doesn't receive `historyByCombo`. Change `row()` signature:

From:
```javascript
function row(r) {
```

To:
```javascript
function row(r, historyByCombo) {
```

- [ ] **Step 4: Update the `row()` call in `renderList()`**

Find where `row()` is called (around line 68: `shown.slice(0, listCap).map(row).join('')`). Map over `shown` and pass `historyByCombo`:

Change:
```javascript
          ${shown.length ? shown.slice(0, listCap).map(row).join('')
```

To:
```javascript
          ${shown.length ? shown.slice(0, listCap).map((r) => row(r, historyByCombo)).join('')
```

- [ ] **Step 5: Verify the changes**

Visual check: `historyBar()` builds an `.hbar` with 1–8 colored `.hcell` blocks; `row()` receives and uses `historyByCombo`.

- [ ] **Step 6: Commit**

```bash
git add dashboard/public/runs.js
git commit -m "feat: add per-row history bars showing last 8 runs by team+profile"
```

---

## Task 4: Add CSS to all three theme files

**Files:**
- Modify: `dashboard/public/app.css:end-of-Results-block`
- Modify: `dashboard/public/app-theme-canvas.css:end-of-Results-block`
- Modify: `dashboard/public/app-theme-void.css:end-of-Results-block`

**Interfaces:**
- Consumes: CSS vars from each theme (`--green`, `--red`, `--muted`, `--line`, `--text`, `--line-strong`)
- Produces: `.kpirow`, `.kpitile`, `.klabel`, `.knum`, `.kspark`, `.hbar`, `.hcell` classes + state variants

**Steps:**

- [ ] **Step 1: Prepare the CSS block**

This exact CSS block (no changes between files) will be appended to all three theme files at the end of the Results section:

```css
/* ── KPI row (hero tiles) ────────────────────────────────────────── */
.kpirow { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 16px; margin: 18px 0 22px; }
.kpitile { position: relative; border: 1px solid var(--line); border-radius: 8px; padding: 16px; min-height: 100px; }
.kpitile .kspark { position: absolute; top: 0; left: 0; right: 0; bottom: 0; border-radius: 8px; opacity: .15; }
.kpitile .klabel { font: 11px var(--sans); letter-spacing: .08em; text-transform: uppercase; color: var(--muted); margin-bottom: 4px; }
.kpitile .knum { font: 32px var(--num-font, monospace); font-weight: 600; color: var(--text); position: relative; z-index: 1; }
.kpitile .kspark polygon.spark-fill { opacity: .2; }
.kpitile .kspark .line { stroke: var(--line-strong); }
.kpitile .kspark .pt { fill: var(--green); }
.kpitile .kspark .pt.red { fill: var(--red); }

/* ── history bar (per-row sparkline) ────────────────────────────── */
.hbar { display: flex; gap: 2px; align-items: center; }
.hcell { display: inline-block; width: 8px; height: 8px; border-radius: 1px; }
.hcell.green { background: var(--green); }
.hcell.red { background: var(--red); }
.hcell.fail { background: var(--muted); }
```

- [ ] **Step 2: Locate the end of the Results CSS block in `app.css`**

Open `dashboard/public/app.css`. Find the last line of the Results section (after `.navstep.results { ... }`). This is typically around line 866 based on the diff from Task 4's impeccable pass.

- [ ] **Step 3: Append the CSS block to `app.css`**

Add a blank line after the last Results rule, then paste the CSS block verbatim.

- [ ] **Step 4: Verify the CSS block in `app.css`**

Check: `.kpirow`, `.kpitile`, all properties present, no typos.

- [ ] **Step 5: Copy the CSS block to `app-theme-canvas.css`**

Open `dashboard/public/app-theme-canvas.css`. Locate the end of the Results section (same line range, ~line 540 based on file size). Append the identical CSS block.

- [ ] **Step 6: Copy the CSS block to `app-theme-void.css`**

Open `dashboard/public/app-theme-void.css`. Locate the end of the Results section. Append the identical CSS block.

- [ ] **Step 7: Verify byte-identity**

Verify that all three CSS blocks are byte-for-byte identical:

```bash
# Extract just the CSS block from each file and compare
tail -n 20 dashboard/public/app.css | grep -A 20 "KPI row" > /tmp/a.css
tail -n 20 dashboard/public/app-theme-canvas.css | grep -A 20 "KPI row" > /tmp/b.css
tail -n 20 dashboard/public/app-theme-void.css | grep -A 20 "KPI row" > /tmp/c.css
diff /tmp/a.css /tmp/b.css && diff /tmp/b.css /tmp/c.css && echo "All identical"
```

Expected: `All identical` (no diff output).

- [ ] **Step 8: Commit**

```bash
git add dashboard/public/app.css dashboard/public/app-theme-canvas.css dashboard/public/app-theme-void.css
git commit -m "style: add KPI tiles + history-bar CSS to all three themes (byte-identical)"
```

---

## Task 5: Live-browser verification and final polish

**Files:**
- Test: live dashboard in all three themes
- Report: impeccable pass (accessibility, contrast, keyboard access)

**Steps:**

- [ ] **Step 1: Start the dashboard**

```bash
node dashboard/server.mjs
```

Expected: server starts, listening on port 4242.

- [ ] **Step 2: Open the dashboard and navigate to Results**

Navigate to `http://127.0.0.1:4242/` in your browser. Click **Results** in the left rail. Expect: the page loads, KPI tiles appear above the filter bar (3-column grid, each with a big number and a sparkline).

- [ ] **Step 3: Verify KPI tiles**

Check each tile:
- **Pass Rate:** shows a %, full-bleed filled-area sparkline (green or mixed green/red)
- **Red Runs:** shows a count, red sparkline
- **Total:** shows total run count

All text should be left-aligned within their tiles. No errors in browser console.

- [ ] **Step 4: Verify history bars on list rows**

Scroll the run list. Each row should show a tiny colored bar next to the headline text (8 or fewer small blocks). Inspect one row and verify the blocks correspond to that team+profile's last 8 runs.

- [ ] **Step 5: Test filters**

Apply a filter (e.g., `team=saucedemo-team`). Expect: KPI tiles recompute to show only filtered runs' pass-rate, red count, and total. History bars on each row update to that row's team+profile combo.

- [ ] **Step 6: Check all three themes**

Click the theme toggle (top-right of the dashboard). Switch between brass, canvas, and void. Expect: all tiles, bars, text colors remain readable and consistent with the theme. No layout shift.

- [ ] **Step 7: Verify accessibility**

- [ ] Each KPI tile is keyboard-navigable (should not be, but ensure no regressions)
- [ ] History bars have no tooltip errors (title attr on `.hcell` elements is present; checked in Task 3)
- [ ] Contrast: title text on tiles vs background; color of history blocks vs tile background
- [ ] Check browser console for any errors or warnings; should be clean

- [ ] **Step 8: Run the test suite**

```bash
node --test tests/runs-api.test.mjs
```

Expected: all tests pass (5/5).

```bash
powershell -File tests/smoke.ps1
```

Expected: `SMOKE PASSED`.

- [ ] **Step 9: Invoke impeccable skill for polish critique**

Use the impeccable skill to review the new KPI tiles and history bars for visual polish, accessibility, hierarchy, and consistency with existing Results elements.

- [ ] **Step 10: Fix any impeccable findings**

If the impeccable pass finds issues (contrast, keyboard access, layout edge cases), apply fixes (inline in runs.js and CSS files) and re-test.

- [ ] **Step 11: Commit the final state**

```bash
# Verify working tree is clean
git status --short

# Commit (only if impeccable pass approved)
git add dashboard/public/runs.js dashboard/public/app.css dashboard/public/app-theme-canvas.css dashboard/public/app-theme-void.css
git commit -m "test: KPI tiles + history bars verified across all themes, impeccable pass clean"
```

---

## Spec Coverage Checklist

- [x] Hero KPI row above filter bar (pass-rate, red count, total) ← Task 2
- [x] Full-bleed sparkline backgrounds on tiles ← Tasks 1 & 2
- [x] Per-row history bar (last 8 runs, colored by verdict) ← Task 3
- [x] Client-side aggregation, no new endpoints ← Tasks 2 & 3 (reuse existing `runs` array)
- [x] Two verdicts only, flake as annotation ← Task 3 (hcell.red for flakes, no third color)
- [x] Zero dependencies ← All tasks (SVG + divs only)
- [x] CSS byte-identical across 3 themes ← Task 4
- [x] Live-browser verification (no unit tests) ← Task 5

---

## Execution

Plan complete. Two execution options:

**1. Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, iterate fast.

**2. Inline Execution** — Execute tasks in this session with checkpoints for your review.

Which approach?
