// Results (runs) view — history list, run detail, trend sparklines.
// Owns everything under #runs / #runs/<run_id>. Read-only: fetches
// /api/runs and /reports/*, never starts or files anything.
import { esc, api, startedBy, envLabel } from './util.js';
import { groupByTest, filterRange } from './agg.js';
import { getRange, rangePill, bindRangePill } from './range.js';
import { applyScope } from './scope.js';

export const routeRuns = () => location.hash === '#runs' || location.hash.startsWith('#runs/');

const filters = { suite: '', verdict: '' }; // page filters; Project+Env are the global top switchers
let listCap = 50;              // "show more" grows this by 50; reset when filters change
const INLINE_CAP = 512 * 1024; // artifacts bigger than this are download-only

export const chip = (r) => r.verdict === 'green' ? '<span class="chip green">green</span>'
  : r.verdict === 'red' ? '<span class="chip red">red</span>'
  : '<span class="chip fail">didn’t finish</span>';
export const flakeNote = (r) => r.flake ? '<span class="flakenote">not reproduced on re-run</span>' : '';
// At-a-glance heal marker on the Executions row — so a self-heal is visible without opening the run.
export const healNote = (h) => {
  if (!h || !h.outcome) return '';
  const healed = Number(h.healed || 0), escalated = Number(h.escalated || 0);
  const auto = /_AUTO$/.test(h.outcome);
  if (!healed && !escalated) return '';
  const bits = [healed ? `self-healed ${healed}${auto ? ' (auto)' : ''}` : '', escalated ? `${escalated} needs a person` : ''].filter(Boolean).join(', ');
  const title = auto ? 'A test was auto-repaired — review the change on this run' : 'A test was repaired — open the run to approve it';
  return `<span class="hbadge" title="${esc(title)}">${esc(bits)}</span>`;
};
export const when = (iso) => iso ? `${iso.slice(0, 10)} ${iso.slice(11, 16)}` : '—';
const kb = (n) => n >= 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`;

// Worst endpoint = highest p95/threshold ratio — the headline number for a perf run.
const worst = (r) => r.endpoints.reduce((a, e) =>
  (e.p95_ms / (e.p95_red_ms || 1) > a.p95_ms / (a.p95_red_ms || 1) ? e : a), r.endpoints[0]);

export const headline = (r) => r.suite === 'functional'
  ? (r.counts ? `${r.counts.passed ?? '—'}/${r.counts.total ?? '—'} passed` : '—')
  : (r.endpoints.length ? `${worst(r).p95_ms} ms · red line ${worst(r).p95_red_ms} ms` : '—');

export async function renderRuns(main) {
  const m = location.hash.match(/^#runs\/(.+)$/);
  try {
    if (m) await renderDetail(main, decodeURIComponent(m[1]));
    else await renderList(main);
  } catch (e) {
    main.innerHTML = `<article class="card"><div id="stage"><h1>Couldn’t load results.</h1>
      <p class="why">${esc(e.message)}</p></div></article>`;
  }
}

// Last 8 runs of this row's team+profile as colored blocks (oldest→newest).
// Flake stays a red block — annotation, never a third colour (two-verdict rule).
// size 'sm' (default) = the compact strip on Home/Executions rows; 'lg' = the
// elongated strip on Tests rows.
export function historyBar(r, historyByCombo, size = 'sm') {
  if (!r.team || !r.profile) return '';
  const list = historyByCombo.get(`${r.team}|${r.profile}`) || [];
  const [wrap, cell] = size === 'lg' ? ['testhist', 'thcell'] : ['hbar', 'hcell'];
  const cells = list.slice(-8).map((run) => {
    const cls = run.verdict === 'green' ? 'green' : run.verdict === 'red' ? 'red' : 'fail';
    return `<i class="${cell} ${cls}"></i>`;
  }).join('');
  return cells ? `<span class="${wrap}" aria-hidden="true">${cells}</span>` : '';
}

// ── list ─────────────────────────────────────────────────────────────

async function renderList(main) {
  const { runs: allRuns, unreadable } = await api('/api/runs'); // filter client-side so trends see everything
  const scoped = applyScope(allRuns); // global Project + Environment switchers
  const runs = filterRange(scoped, getRange());
  const shown = runs.filter((r) =>
    (!filters.suite || r.suite === filters.suite)
    && (!filters.verdict || r.verdict === filters.verdict));

  // Group scoped runs by team|profile, oldest→newest, for the per-row history
  // bars. runs is newest-first, so reverse into chronological.
  const historyByCombo = groupByTest(scoped);

  const fbtn = (key, val, label, sub) =>
    `<button class="fbtn ${sub ? 'stacked' : ''} ${filters[key] === val ? 'on' : ''}" data-k="${key}" data-v="${val}">${label}${sub ? `<span class="fbtnsub">${sub}</span>` : ''}</button>`;

  main.innerHTML = `
    <article class="card" data-screen-label="Results">
      <div class="kicker"><span class="idx">≡</span><span>run history</span></div>
      <div id="stage">
        <h1>Results.</h1>
        <p class="why">Every run RedLine has recorded — newest first. Click a run for its full story:
        what failed, the evidence, and what the reviewer decided.</p>
        <div class="runsbar">
          ${fbtn('suite', '', 'all')}${fbtn('suite', 'functional', 'Functional', 'Does it work?')}${fbtn('suite', 'performance', 'Performance', 'Is it fast?')}
          <span class="fsep"></span>
          ${fbtn('verdict', '', 'any verdict')}${fbtn('verdict', 'green', 'green')}${fbtn('verdict', 'red', 'red')}
          <span class="fsep"></span>${rangePill()}
        </div>
        <div id="trends"></div>
        <div id="rows">
          ${shown.length ? shown.slice(0, listCap).map((r) => row(r, historyByCombo)).join('')
            : runs.length ? '<p class="why">No runs match these filters. Try loosening them.</p>'
            : scoped.length ? '<p class="why">No runs in this time range for the selected project / environment.</p>'
            : allRuns.length ? '<p class="why">No runs for the selected project / environment. Change the switchers up top.</p>'
            : '<p class="why">No runs recorded yet. Run a test from the wizard to see it here.</p>'}
        </div>
        ${shown.length > listCap ? `<button class="fbtn" id="more" style="margin-top:12px">show ${Math.min(50, shown.length - listCap)} more</button>` : ''}
        ${unreadable ? `<p class="runmeta" style="margin-top:10px">${unreadable} older record${unreadable > 1 ? 's' : ''} couldn’t be read and ${unreadable > 1 ? 'were' : 'was'} skipped.</p>` : ''}
      </div>
    </article>`;

  renderTrends(document.getElementById('trends'), shown);

  // Filter controls re-render the whole list (main.innerHTML swap) — refocus the
  // control the user just used so keyboard/filter-heavy use doesn't lose position.
  // reRender guards two things: a fetch that fails mid-filter (surface it, don't
  // hang), and a navigation away mid-fetch (bail so we don't paint over the new page).
  const reRender = async (refocus) => {
    const hash = location.hash;
    try {
      await renderList(main);
      if (location.hash !== hash) return; // user navigated away while we fetched
      refocus?.();
    } catch (e) {
      if (location.hash !== hash) return;
      const rows = document.getElementById('rows');
      if (rows) rows.innerHTML = `<p class="why">Couldn’t load runs: ${esc(e.message)}. Try again.</p>`;
    }
  };
  document.getElementById('more')?.addEventListener('click', () => {
    listCap += 50; reRender(() => document.getElementById('more')?.focus());
  });
  // [data-k] scoping keeps this off #more, which shares the .fbtn look but not the
  // filter contract — a second handler there would reset listCap right after the bump.
  main.querySelectorAll('.fbtn[data-k]').forEach((b) => b.addEventListener('click', () => {
    const { k, v } = b.dataset; filters[k] = v; listCap = 50;
    reRender(() => main.querySelector(`.fbtn[data-k="${k}"][data-v="${v}"]`)?.focus());
  }));
  main.querySelectorAll('.runrow').forEach((r) => {
    const go = () => { location.hash = `#runs/${encodeURIComponent(r.dataset.id)}`; };
    r.addEventListener('click', go);
    r.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go(); }
    });
  });
  bindRangePill(main);
}

function row(r, historyByCombo) {
  return `
    <div class="runrow" data-id="${esc(r.run_id)}" role="button" tabindex="0">
      <span>${chip(r)}</span>
      <span>
        <span class="runhead">${esc(r.team ?? '?')} · ${esc(r.profile ?? '?')}</span>
        <span class="runmeta"> · ${esc(headline(r))}</span> ${flakeNote(r)} ${historyBar(r, historyByCombo)}
        ${r.sources >= 2 ? '<span class="runmeta"> · confirmed ×2</span>' : ''}
        ${healNote(r.heal)}
        ${r.reviewer_decision ? `<span class="runmeta"> · reviewer ${esc(r.reviewer_decision === 'SIGN_OFF' ? 'signed off' : r.reviewer_decision.toLowerCase())}</span>` : ''}
        ${r.jira.filed ? `<span class="runmeta"> · ticket ${esc(r.jira.key || 'filed')}</span>` : ''}
        ${r.origin && r.origin !== 'local' ? `<span class="hbadge" title="Result from another RedLine (${esc(r.origin)})">${esc(r.origin)}</span>` : ''}
      </span>
      <span class="runmeta">${esc(when(r.recorded_at))}</span>
    </div>`;
}

// ── trends (inline SVG, computed client-side, nothing stored) ────────

function renderTrends(zone, shown) {
  const groups = new Map();
  for (const r of shown) {
    if (!r.team || !r.profile) continue;
    const k = `${r.team}|${r.profile}`;
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(r);
  }
  const cards = [];
  for (const [key, list] of groups) {
    const sep = key.indexOf('|'); // split on the FIRST '|' — a '|' in profile must not shift team
    const team = key.slice(0, sep), profile = key.slice(sep + 1);
    const chrono = [...list].reverse().slice(-30); // oldest → newest, last 30
    if (chrono.filter((r) => r.verdict !== 'fail').length < 2) continue; // nothing to chart
    if (chrono[0].suite === 'functional') {
      const pts = chrono.filter((r) => r.counts?.total && Number.isFinite(r.counts.passed)).map((r) => ({
        y: (r.counts.passed / r.counts.total) * 100,
        cls: r.verdict === 'red' ? (r.flake ? 'red hollow' : 'red') : '',
      }));
      if (pts.length >= 2) cards.push(card(`${team} · pass rate`, spark(pts, { min: 0, max: 100 })));
    } else {
      // Metric set comes from the most recent run that actually HAS endpoints —
      // if the newest run crashed (empty endpoints), don't drop the whole test's trends.
      const metrics = ([...chrono].reverse().find((r) => r.endpoints.length)?.endpoints || []).slice(0, 3);
      for (const m of metrics) {
        const pts = chrono.map((r) => {
          const e = r.endpoints.find((x) => x.metric === m.metric);
          return e && { y: e.p95_ms, cls: e.verdict === 'red' ? (r.flake ? 'red hollow' : 'red') : '' };
        }).filter(Boolean);
        if (pts.length >= 2) cards.push(card(`${team} · ${m.name || m.metric} p95`,
          spark(pts, { threshold: m.p95_red_ms })));
      }
    }
  }
  zone.innerHTML = cards.length ? `<div class="trendstrip">${cards.join('')}</div>` : '';
}

const card = (name, svg) => `<div class="trendcard"><div class="tname">${esc(name)}</div>${svg}</div>`;

// pts: [{y, cls}] oldest→newest. Optional threshold (drawn dashed) and min/max overrides.
function spark(pts, { threshold, min, max } = {}) {
  const W = 220, H = 34, P = 4;
  const ys = pts.map((p) => p.y).concat(threshold ?? []);
  const lo = min ?? Math.min(...ys), hi = max ?? Math.max(...ys);
  const span = hi - lo || 1;
  const x = (i) => P + (i * (W - 2 * P)) / Math.max(1, pts.length - 1);
  const y = (v) => H - P - ((v - lo) * (H - 2 * P)) / span;
  const line = pts.map((p, i) => `${x(i).toFixed(1)},${y(p.y).toFixed(1)}`).join(' ');
  // Flake ("hollow") points get a bigger radius — at the base 2.4 size the punched-out
  // ring reads as barely-smaller-dot, not obviously hollow, next to solid neighbors.
  const dots = pts.map((p, i) =>
    `<circle class="pt ${p.cls}" cx="${x(i).toFixed(1)}" cy="${y(p.y).toFixed(1)}" r="${p.cls.includes('hollow') ? 3.3 : 2.4}"/>`).join('');
  const th = threshold != null
    ? `<line class="thresh" x1="${P}" x2="${W - P}" y1="${y(threshold).toFixed(1)}" y2="${y(threshold).toFixed(1)}"/>` : '';
  return `<svg class="spark" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" aria-hidden="true">
    <polyline class="line" points="${line}"/>${th}${dots}</svg>`;
}

// ── detail ───────────────────────────────────────────────────────────

async function renderDetail(main, id) {
  const { run: r, artifacts, grafana_url } = await api(`/api/runs/${encodeURIComponent(id)}`);
  const shots = artifacts.filter((a) => /\.(png|jpe?g)$/i.test(a.path));
  const texts = artifacts.filter((a) => /\.(md|txt|log|json|diff)$/i.test(a.path));
  const zips = artifacts.filter((a) => /\.zip$/i.test(a.path));
  const href = (p) => `/reports/${encodeURIComponent(r.run_id)}/${p.split('/').map(encodeURIComponent).join('/')}`;
  const healDiff = artifacts.find((a) => /(^|\/)heal\/suite\.diff$/i.test(a.path));
  const healReport = artifacts.find((a) => /(^|\/)heal\/heal-report\.md$/i.test(a.path));

  const gates = (r.verdict === 'red') ? `
    <div class="gates">
      <div class="blabel">How the verdict was reached</div>
      ${gateRow(r.sources >= 2 ? 'pass' : 'fail', 'Confirmed twice',
        r.sources >= 2 ? 'Two separate runs both failed — this is not a fluke.'
          : r.flake ? 'The confirmation re-run came back fine — treated as a one-off, nobody was paged.'
          : 'Not confirmed by a second run — no corroboration data was recorded for this run.')}
      ${gateRow(r.reviewer_decision === 'SIGN_OFF' ? 'pass' : r.reviewer_decision === 'REJECT' ? 'fail' : '',
        'Independent reviewer',
        r.reviewer_decision === 'SIGN_OFF' ? 'Signed off — worth a ticket.'
          : r.reviewer_decision === 'REJECT' ? 'Judged not worth filing.'
          : 'No reviewer decision recorded.')}
      ${gateRow(r.jira.filed ? 'pass' : '', 'Jira',
        r.jira.filed ? `Ticket ${r.jira.key || ''} filed.`
          : r.jira.draft_path ? 'A draft was prepared; filing stays human-gated.' : 'No draft.')}
    </div>` : '';

  main.innerHTML = `
    <article class="card" data-screen-label="Run detail">
      <div class="kicker"><span class="idx">≡</span><span>run detail</span></div>
      <div id="stage">
        <a class="backlink" href="#runs">← All results</a>
        <h1>${chip(r)} ${esc(r.team ?? '?')} · ${esc(r.profile ?? '?')}</h1>
        <p class="why">${esc(r.summary_line || 'No summary recorded for this run.')}
          ${r.suite !== 'functional' && r.team && r.profile
            ? ` <a class="seclink" href="#run/${encodeURIComponent(r.team)}/${encodeURIComponent(r.profile)}">Run this test again →</a>` : ''}</p>
        ${r.flake ? '<div class="banner">⚠ The failure was not reproduced on the automatic re-run — treated as a one-off, nothing was escalated.</div>' : ''}
        <dl class="review">
          <div><dt>When</dt><dd>${esc(when(r.recorded_at))}</dd></div>
          <div><dt>Started by</dt><dd>${esc(startedBy(r.trigger))}</dd></div>
          <div><dt>Environment</dt><dd>${esc(envLabel(r.env))}</dd></div>
          ${r.counts ? `<div><dt>Checks</dt><dd>${esc(String(r.counts.passed ?? '—'))} passed · ${esc(String(r.counts.failed ?? 0))} failed${r.counts.skipped ? ` · ${esc(String(r.counts.skipped))} skipped` : ''}</dd></div>` : ''}
        </dl>
        ${r.heal ? healPanel(r, healDiff, healReport, href) : ''}
        ${r.endpoints.length ? perfTable(r) : ''}
        ${r.failures.length ? failureCards(r) : ''}
        ${shots.length ? `<div class="blabel">Screenshots of what broke</div>
          <div class="shots">${shots.map((a) => `<a href="${href(a.path)}" target="_blank"><img src="${href(a.path)}" alt="${esc(a.path)}" loading="lazy"></a>`).join('')}</div>` : ''}
        ${gates}
        ${texts.length || zips.length ? `<div class="blabel">Files from this run</div>
          ${texts.map((a) => artRow(a, href(a.path), a.size <= INLINE_CAP)).join('')}
          ${zips.map((a) => `<div class="artrow"><span>${esc(a.path)}</span><a href="${href(a.path)}">download · ${kb(a.size)}</a></div>`).join('')}
          <div id="preview"></div>`
        : (r.has_report_dir ? '' : '<p class="runmeta" style="margin-top:14px">This run’s files weren’t kept on this machine — the record above is the full surviving story.</p>')}
        ${grafana_url ? `<p class="why" style="margin-top:16px"><a href="${esc(grafana_url)}" target="_blank">Open this run window in Grafana →</a></p>` : ''}
        <p class="runmeta" style="margin-top:18px; opacity:.6">Run ID: ${esc(r.run_id)}${r.confirm_run_id ? ` · double-check: ${esc(r.confirm_run_id)} (${esc(r.confirm_verdict ?? '?')})` : ''}</p>
      </div>
    </article>`;

  main.querySelectorAll('[data-inline]').forEach((btn) => btn.addEventListener('click', async () => {
    const pv = document.getElementById('preview');
    pv.innerHTML = '<p class="runmeta">loading…</p>';
    const text = await (await fetch(btn.dataset.inline)).text();
    pv.innerHTML = `<div class="block"><div class="blabel">${esc(btn.dataset.name)}</div><pre>${esc(text)}</pre></div>`;
  }));
  // Heal panel has its own preview so the diff/report render right where the
  // reviewer is looking. Clicking the same button again collapses it.
  let healOpen = ''; // which button's content is showing ('' = collapsed)
  main.querySelectorAll('[data-healview]').forEach((btn) => btn.addEventListener('click', async () => {
    const pv = document.getElementById('healpreview');
    main.querySelectorAll('[data-healview]').forEach((b) => b.classList.remove('on'));
    if (healOpen === btn.dataset.name) { healOpen = ''; pv.innerHTML = ''; return; } // toggle shut
    healOpen = btn.dataset.name;
    btn.classList.add('on');
    pv.innerHTML = '<p class="runmeta">loading…</p>';
    try {
      const text = await (await fetch(btn.dataset.healview)).text();
      if (healOpen !== btn.dataset.name) return; // collapsed while loading
      pv.innerHTML = `<div class="block"><div class="blabel">${esc(btn.dataset.name)}</div><pre>${esc(text)}</pre></div>`;
    } catch (e) {
      pv.innerHTML = `<p class="why">Couldn’t load: ${esc(e.message)}</p>`;
    }
  }));
  // Approve the fix — the ONE human click that finishes a self-heal. The
  // server does the whole job (copy if needed + save it permanently); on
  // success the detail re-renders to the "saved, nothing more to do" state.
  document.getElementById('healapprove')?.addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    const original = btn.textContent;
    btn.disabled = true; btn.textContent = 'Saving…';
    const msg = document.getElementById('healmsg');
    try {
      const res = await fetch('/api/heal/graduate', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ run_id: r.run_id }),
      });
      const out = await res.json();
      if (!res.ok) throw new Error(out.error || `HTTP ${res.status}`);
      await renderDetail(main, r.run_id); // re-render → "saved, nothing more to do" state
    } catch (err) {
      btn.disabled = false; btn.textContent = original;
      msg.innerHTML = `<p class="why" style="margin-top:8px">Couldn’t save: ${esc(err.message)}</p>`;
    }
  });
}

const gateRow = (cls, label, detail) => `
  <div class="checkrow"><span class="dot ${cls}"></span>
    <span class="checktext"><span class="cdesc">${esc(label)}</span><span class="cdetail">${esc(detail)}</span></span></div>`;

// Self-healing review panel — shown when O4.5 (heal-playwright-suite) ran.
// Plain language first (this app is for non-technical people), diff + report
// one click away, and ONE button that finishes the whole job — no terminal,
// no git, ever. Policy `ask`: the click authorizes the fix AND saves it.
// Policy `trust`: the fix already ran unattended, so the same click is the
// first human review, and what's left is making it permanent.
function healPanel(r, healDiff, healReport, href) {
  const h = r.heal;
  const auto = /_AUTO$/.test(h.outcome || '');
  const base = (h.outcome || '').replace(/_AUTO$/, '');
  const healed = Number(h.healed || 0), escalated = Number(h.escalated || 0);
  const heading = base === 'HEALED' ? 'Your test needed an update — not your app'
    : base === 'PARTIAL' ? 'Part test update, part real change'
    : base === 'NOT_HEALABLE' ? 'Your app really changed — this is not a test problem'
    : 'RedLine tried to repair the test but couldn’t';
  // The plain-language story. The heal skill writes h.plain (what moved on the
  // page, in everyday words); the fallback still avoids jargon.
  const story = h.plain
    || [healed ? `Your app’s pages changed (things moved or were renamed), so the test was looking in the old places. RedLine found where they went and updated the test — ${healed === 1 ? 'that check passes' : `those ${healed} checks pass`} again.` : '',
        escalated ? `${escalated === 1 ? 'One check failed' : `${escalated} checks failed`} because something is genuinely gone from your app — a test update can’t fix that, so it stays flagged for a person to look at.` : '']
        .filter(Boolean).join(' ');
  const saved = !!(h.graduated && h.committed); // fully done: live AND permanent
  const status = saved
    ? `Saved${h.graduated_at ? ` on ${when(h.graduated_at)}` : ''} — the updated test is live and permanent. Nothing more to do.`
    : h.graduated
      ? 'The updated test is live, but not saved permanently yet — click below to finish.'
      : auto
        ? 'This project trusts automatic repairs, so the fix is already running — but it isn’t permanent yet. Review it below, then save it.'
        : 'The fix is NOT live yet — it waits for your approval below.';
  const viewBtn = (a, label) => a
    ? `<button class="fbtn" data-healview="${esc(href(a.path))}" data-name="${esc(label)}">${esc(label)}</button> ` : '';
  const canAct = !saved && healed > 0 && (!r.origin || r.origin === 'local');
  const approve = canAct
    ? `<button class="fbtn" id="healapprove" style="font-weight:600">${auto || h.graduated
        ? '✓ Review complete — save this fix permanently'
        : '✓ Approve the fix — use the updated test from now on'}</button>`
    : '';
  return `
    <div class="gates">
      <div class="blabel">Self-healing — ${esc(heading)}</div>
      <div class="checkrow"><span class="dot ${escalated && !healed ? '' : 'pass'}"></span>
        <span class="checktext"><span class="cdesc">${esc(story)}</span>
          <span class="cdetail">${esc(status)}</span></span></div>
      <div style="margin-top:10px">${approve}</div>
      <div style="margin-top:10px">${viewBtn(healDiff, 'See exactly what changed in the test')}${viewBtn(healReport, 'Read the full repair report')}</div>
      <div id="healpreview"></div>
      <div id="healmsg"></div>
    </div>`;
}

const artRow = (a, url, inlinable) => `
  <div class="artrow"><span>${esc(a.path)}</span>
    <span>${inlinable ? `<button class="fbtn" data-inline="${esc(url)}" data-name="${esc(a.path)}">view</button> ` : ''}<a href="${url}" target="_blank">open · ${kb(a.size)}</a></span></div>`;

function perfTable(r) {
  return `<div class="resultgrid">
    ${r.endpoints.map((e) => `
      <div class="result">
        <div class="rname">${esc(e.name || e.metric)}</div>
        <div class="rnum" style="color:${e.verdict === 'red' ? 'var(--red)' : 'var(--green)'}">${esc(String(e.p95_ms ?? '—'))}<span> ms</span></div>
        <div class="rcap">red line ${esc(String(e.p95_red_ms ?? '—'))} ms — ${e.verdict === 'red' ? `over by ${esc(String(e.p95_ms - e.p95_red_ms))} ms${e.p95_red_ms > 0 ? ` (+${esc(((e.p95_ms / e.p95_red_ms - 1) * 100).toFixed(1))}%)` : ''}` : 'comfortably under'}</div>
      </div>`).join('')}
  </div>`;
}

// Spec titles are already near-English ("start screen offers both paths") —
// show the last segment, not the "file > group > title" chain. Raw Playwright
// errors are NOT — translate the common signatures deterministically, and keep
// the technical original as a faint line for whoever needs it.
const plainTestName = (t) => {
  const last = String(t || '').split(' > ').pop().trim();
  return last ? last[0].toUpperCase() + last.slice(1) : 'A check';
};
const plainError = (e) => {
  const s = String(e || '');
  if (/timeout/i.test(s) && /hook/i.test(s))
    return 'The check never reached its starting point — the setup step gave up waiting.';
  if (/timeout/i.test(s))
    return 'The page never reached the state this check was waiting for — it gave up waiting.';
  if (/toBeVisible|not visible|waiting for locator/i.test(s))
    return 'Something that should be on the page couldn’t be found.';
  if (/strict mode violation/i.test(s))
    return 'More than one thing on the page matched what should be unique.';
  if (/net::|ERR_|ECONNREFUSED|ENOTFOUND/i.test(s))
    return 'The app couldn’t be reached.';
  return 'The check failed — technical detail below.';
};

function failureCards(r) {
  return `<div class="blabel">What failed</div>
    ${r.failures.map((f) => `
      <div class="failcard">
        <div class="cdesc">${esc(plainTestName(f.test))}</div>
        <div class="cdetail">${esc(plainError(f.error))}</div>
        <div class="cdetail" style="opacity:.55; font-size:11px">${esc(f.file || '')}${f.error ? ' — ' + esc(f.error) : ''}</div>
      </div>`).join('')}`;
}
