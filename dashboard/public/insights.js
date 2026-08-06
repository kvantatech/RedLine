// Insights — native analytics from the ledger. No Grafana dependency.
// #insights                     → global panels (the Grafana top row, ledger-computed)
// #insights/<team>/<profile>    → per-test execution history, hoverable bars
import { esc, api, startedBy } from './util.js';
import { rangedRuns, rangePill, bindRangePill } from './range.js';
import { kpis, rolling, groupByTest, catalog, passRateByTest, slowestP95, teamRollup, flakyTests } from './agg.js';
import { barChart, areaChart } from './charts.js';
import { when, chip } from './runs.js';
import { applyScope } from './scope.js';

export async function renderInsights(page) {
  const m = location.hash.match(/^#insights\/([^/]+)\/(.+)$/);
  if (m) return renderTest(page, decodeURIComponent(m[1]), decodeURIComponent(m[2]));
  return renderGlobal(page);
}

// ── boards rail — "Execution analysis" (global) + one board per known test ──

function boardsRail(runs, activeKey) {
  const boards = catalog(runs); // reuse the same catalog Tests uses — no fake nav
  return `
    <aside class="boardsrail">
      <div class="boardslabel">Default boards</div>
      <button class="boardbtn ${!activeKey ? 'on' : ''}" data-board="">Execution analysis</button>
      <div class="boardslabel second">Your boards</div>
      <div style="display:flex; flex-direction:column; gap:1px;">
        ${boards.map((b) => `<button class="boardbtn ${activeKey === b.key ? 'on' : ''}" data-board="${esc(b.key)}">${esc(b.team)} · ${esc(b.profile)}</button>`).join('')
          || '<p class="why" style="font-size:12.5px; padding:0 10px;">No tests yet.</p>'}
      </div>
    </aside>`;
}

function bindBoardsRail(page) {
  page.querySelectorAll('.boardbtn').forEach((b) => b.addEventListener('click', () => {
    location.hash = b.dataset.board ? `#insights/${b.dataset.board.replace('|', '/')}` : '#insights';
  }));
}

// ── stacked bar chart: execution count by test & status ─────────────────

function stackedByTest(runs) {
  const byTest = groupByTest(runs);
  const items = catalog(runs);
  const max = Math.max(...items.map((c) => c.count), 1);
  const short = (t, p) => t.replace('-team', '') + ' · ' + (p === 'api-benchmark' ? 'api' : p === 'browser-journey' ? 'browser' : 'func');
  return items.map((c) => {
    const list = byTest.get(c.key) || [];
    const g = list.filter((r) => r.verdict === 'green').length;
    const rd = list.filter((r) => r.verdict === 'red').length;
    const f = list.filter((r) => r.verdict === 'fail').length;
    const seg = (n, color) => n ? `<div style="height:${Math.max(4, Math.round((n / max) * 150))}px; background:${color};"></div>` : '';
    return `
      <div class="stackcol" title="${esc(`${c.team} · ${c.profile}: ${c.count} runs (${g} green, ${rd} red${f ? ', ' + f + ' didn’t finish' : ''})`)}">
        <div class="stackstack">${seg(g, 'var(--green)')}${seg(rd, 'var(--red)')}${seg(f, 'var(--line-strong)')}</div>
        <span class="stackname">${esc(short(c.team, c.profile))}</span>
      </div>`;
  }).join('');
}

// ── global panels ────────────────────────────────────────────────────

const prow = (label, valueText, pct, cls) => `
  <div class="prow">
    <span class="plabel">${esc(label)}</span>
    <span class="ptrack"><i class="pfill ${cls}" style="width:${Math.max(2, Math.min(100, pct)).toFixed(1)}%"></i></span>
    <span class="pval">${esc(valueText)}</span>
  </div>`;

async function renderGlobal(page) {
  const { runs: rangedAll } = await rangedRuns();
  const runs = applyScope(rangedAll); // global Project + Environment switchers
  const k = kpis(runs);
  const rates = passRateByTest(runs);
  const slow = slowestP95(runs);
  const teams = teamRollup(runs);
  const flaky = flakyTests(runs);
  const maxP95 = slow.length ? Math.max(...slow.map((s) => s.p95)) : 1;
  const chrono = [...runs].reverse().filter((r) => r.verdict !== 'fail');
  const redSeries = rolling(chrono.map((r) => (r.verdict === 'red' ? 1 : 0)));
  const passSeries = rolling(chrono.map((r) => (r.verdict === 'green' ? 1 : 0)));

  page.innerHTML = `
    <article class="card" data-screen-label="Insights">
      <div id="stage">
        <div class="pagehead">
          <div>
            <h1>Insights.</h1>
            <p class="why">Charts built from your run history — no extra tools needed.</p>
          </div>
          ${rangePill()}
        </div>
        <div class="insshell">
          ${boardsRail(runs, null)}
          <div class="insmain">
            <div class="kpirow">
              <div class="kpitile fail">
                <div class="kchart">${redSeries.length >= 2 ? areaChart(redSeries, 'var(--red)') : ''}</div>
                <div class="klabel">Failed executions</div>
                <div class="knum">${k.red}</div>
                <div class="kdelta">${k.corroborated} confirmed real · ${k.flakes} one-off${k.flakes === 1 ? '' : 's'}</div>
              </div>
              <div class="kpitile pass">
                <div class="kchart">${passSeries.length >= 2 ? areaChart(passSeries, 'var(--green)') : ''}</div>
                <div class="klabel">Pass / fail ratio</div>
                <div class="knum">${k.passRate !== null ? `${k.passRate}%` : '—'}</div>
                <div class="kdelta">${k.passRate !== null ? `${k.green} green of ${k.green + k.red} verdicts` : 'no verdicts in this range'}</div>
              </div>
            </div>

            <div class="stackpanel">
              <div class="stackhead">
                <div>
                  <div class="plab" style="margin:0">Execution count by test &amp; status</div>
                  <div style="color:var(--faint); font-size:12px; margin-top:2px;">every recorded run, grouped by test</div>
                </div>
                <div class="stacklegend">
                  <span><i style="background:var(--green)"></i>green</span>
                  <span><i style="background:var(--red)"></i>red</span>
                  <span><i style="background:var(--line-strong)"></i>didn't finish</span>
                </div>
              </div>
              <div class="stackbars">${stackedByTest(runs) || '<p class="why">No tests yet.</p>'}</div>
            </div>

            <div class="panelgrid">
              <div class="panel">
                <div class="plab">Team health</div>
                ${teams.length ? teams.map((t) =>
                  prow(`${t.team} — ${t.tests} test${t.tests === 1 ? '' : 's'}, ${t.executions} run${t.executions === 1 ? '' : 's'}${t.flakes ? `, ${t.flakes} one-off${t.flakes === 1 ? '' : 's'}` : ''}`,
                    t.passRate !== null ? `${t.passRate}%` : '—', t.passRate ?? 0,
                    t.passRate === null ? 'green' : t.passRate === 100 ? 'green' : 'red')).join('')
                  : '<p class="why">No teams in this range.</p>'}
              </div>
              <div class="panel">
                <div class="plab">One-off failures — red once, fine on the re-run</div>
                ${flaky.length ? flaky.map((f) =>
                  prow(`${f.team} · ${f.profile}`, `${f.flakes} of ${f.executions}`, (f.flakes / f.executions) * 100, 'red')).join('')
                  : '<p class="why">None in this range — every red failure happened twice.</p>'}
              </div>
            </div>

            <div class="panelgrid">
              <div class="panel">
                <div class="plab">Pass rate by test</div>
                ${rates.length ? rates.map((r) =>
                  prow(`${r.team} · ${r.profile}`, `${r.rate}%`, r.rate, r.rate === 100 ? 'green' : 'red')).join('')
                  : '<p class="why">No verdicts in this range.</p>'}
              </div>
              <div class="panel">
                <div class="plab">Slowest test p95</div>
                ${slow.length ? slow.map((s) =>
                  prow(`${s.team} · ${s.profile} — ${s.metric}`, `${s.p95} ms`, (s.p95 / maxP95) * 100,
                    s.threshold != null && s.p95 > s.threshold ? 'red' : 'green')).join('')
                  : '<p class="why">No structured perf metrics in this range.</p>'}
              </div>
            </div>
          </div>
        </div>
      </div>
    </article>`;

  bindRangePill(page);
  bindBoardsRail(page);
}

// ── per-test drill-down ──────────────────────────────────────────────

const section = (title, sub, body) => `
  <div class="isec">
    <div class="isechead"><span class="sectitle">${esc(title)}</span><span class="isesub">${esc(sub)}</span></div>
    <div class="iscroll">${body}</div>
  </div>`;

// The test's workflow — every step it runs, one small panel each. Perf steps are
// the measured transactions (endpoints[]) of the latest run; functional steps are
// the suite's test() cases, with pass/fail from the latest run that has counts.
function stepPanels(list, funcSteps) {
  const last = list[list.length - 1];
  if (!last) return '<p class="why">No steps to show yet.</p>';

  if (last.suite !== 'functional') {
    const withEp = [...list].reverse().find((r) => r.endpoints.length);
    const eps = withEp ? withEp.endpoints : [];
    if (!eps.length) return '<p class="why">This run recorded no measured steps.</p>';
    return `<div class="stepgrid">${eps.map((e, i) => {
      const red = e.verdict === 'red';
      return `<div class="steppanel ${red ? 'red' : 'green'}">
        <span class="stepidx">${i + 1}</span>
        <div class="stepbody">
          <div class="stepname">${esc(e.name || e.metric)}</div>
          <div class="stepnum" style="color:${red ? 'var(--red-text)' : 'var(--green-text)'}">${esc(String(e.p95_ms ?? '—'))}<span> ms</span></div>
          <div class="stepcap">red line ${esc(String(e.p95_red_ms ?? '—'))} ms · ${red ? 'over the line' : 'comfortably under'}</div>
        </div>
      </div>`;
    }).join('')}</div>`;
  }

  if (!funcSteps.length) return '<p class="why">Couldn’t read this suite’s steps from its spec files.</p>';
  const lastWithCounts = [...list].reverse().find((r) => r.counts);
  const failed = lastWithCounts ? (lastWithCounts.failures || []).map((f) => f.test || '') : null;
  const statusOf = (name) => failed === null ? 'neutral' : failed.some((fn) => fn.includes(name)) ? 'red' : 'green';
  const label = { red: 'failed', green: 'passed', neutral: 'not run yet' };
  return `<div class="stepgrid">${funcSteps.map((s, i) => {
    const st = statusOf(s.name);
    return `<div class="steppanel ${st}">
      <span class="stepidx">${i + 1}</span>
      <div class="stepbody">
        <div class="stepname">${esc(s.name)}</div>
        <div class="stepcap">${esc(s.file)} · ${label[st]}</div>
      </div>
    </div>`;
  }).join('')}</div>`;
}

async function renderTest(page, team, profile) {
  const { runs: rangedAll } = await rangedRuns();
  const runs = applyScope(rangedAll); // honor the global Environment switcher
  const list = groupByTest(runs).get(`${team}|${profile}`) || [];
  const isFunctional = list.length && list[list.length - 1].suite === 'functional';
  // Functional workflow steps come from the suite's spec files (perf uses endpoints[]).
  let funcSteps = [];
  if (isFunctional) {
    try { funcSteps = (await api(`/api/test-steps?team=${encodeURIComponent(team)}&profile=${encodeURIComponent(profile)}`)).steps || []; } catch {}
  }

  let body = '';
  if (!list.length) {
    body = '<p class="why">No runs recorded for this test in the selected range. Widen the range, or run it from the wizard.</p>';
  } else if (list[list.length - 1].suite === 'functional') {
    const bars = list.filter((r) => r.counts?.total && Number.isFinite(r.counts.passed)).map((r) => ({
      v: (r.counts.passed / r.counts.total) * 100,
      cls: r.verdict === 'red' ? (r.flake ? 'red hollow' : 'red') : r.verdict === 'green' ? 'green' : 'fail',
      run: r.run_id,
      tip: `${r.run_id}\n${when(r.recorded_at)}\nverdict: ${r.verdict}${r.flake ? ' — not reproduced on re-run' : ''}\n${r.counts.passed}/${r.counts.total} passed${r.counts.failed ? ` · ${r.counts.failed} failed` : ''}${r.counts.skipped ? ` · ${r.counts.skipped} skipped` : ''}\nstarted by: ${startedBy(r.trigger)}`,
    }));
    body = bars.length
      ? section('Pass rate per execution', 'each bar = one run · 100% = every check passed · click a bar for the full run', barChart(bars, { max: 100 }))
      : '<p class="why">No structured check counts recorded for this range.</p>';
  } else {
    const latest = [...list].reverse().find((r) => r.endpoints.length);
    const charts = (latest ? latest.endpoints : []).map((sample) => {
      const bars = list.map((r) => {
        const e = r.endpoints.find((x) => x.metric === sample.metric);
        return e && {
          v: e.p95_ms,
          cls: e.verdict === 'red' ? (r.flake ? 'red hollow' : 'red') : 'green',
          run: r.run_id,
          tip: `${r.run_id}\n${when(r.recorded_at)}\n${sample.name || sample.metric}: p95 ${e.p95_ms} ms — red line ${e.p95_red_ms} ms\nmetric verdict: ${e.verdict}${r.flake ? '\none-off — not reproduced on re-run' : ''}\nstarted by: ${startedBy(r.trigger)}`,
        };
      }).filter(Boolean);
      return bars.length
        ? section(`${sample.name || sample.metric} — p95 per execution`,
            `dashed line = red threshold ${sample.p95_red_ms} ms · click a bar for the full run`,
            barChart(bars, { threshold: sample.p95_red_ms }))
        : '';
    }).join('');
    body = charts || '<p class="why">No detailed numbers for this range — older runs didn’t record them.</p>';
  }

  const last = list[list.length - 1];
  const stepSub = isFunctional ? 'each check the suite runs' : 'each step this test measures';
  const stepSection = list.length ? `
    <div class="isec">
      <div class="isechead"><span class="sectitle">What runs, step by step</span><span class="isesub">${stepSub}</span></div>
      ${stepPanels(list, funcSteps)}
    </div>` : '';

  page.innerHTML = `
    <article class="card" data-screen-label="Test insights">
      <div id="stage">
        <a class="backlink" href="#tests">← All tests</a>
        <div class="pagehead">
          <div>
            <h1>${last ? chip(last) + ' ' : ''}${esc(team)} · ${esc(profile)}</h1>
            <p class="why">${list.length} execution${list.length === 1 ? '' : 's'} in range${last ? ` · latest ${esc(when(last.recorded_at))}` : ''}</p>
          </div>
          ${rangePill()}
        </div>
        ${stepSection}
        ${body}
        <div class="tip" id="tip" hidden></div>
      </div>
    </article>`;

  bindRangePill(page);

  // Tooltip + navigation for the bars. data-tip is plain text (esc'd at the
  // attribute); textContent keeps it inert.
  const tip = page.querySelector('#tip');
  const show = (el) => {
    tip.textContent = el.dataset.tip;
    tip.hidden = false;
    const r = el.getBoundingClientRect();
    tip.style.left = `${Math.max(8, Math.min(window.innerWidth - 8, r.left + r.width / 2))}px`;
    tip.style.top = `${r.top - 8}px`;
  };
  const hide = () => { tip.hidden = true; };
  page.querySelectorAll('.ibar').forEach((el) => {
    const go = () => { location.hash = `#runs/${encodeURIComponent(el.dataset.run)}`; };
    el.addEventListener('mouseenter', () => show(el));
    el.addEventListener('mouseleave', hide);
    el.addEventListener('focus', () => show(el));
    el.addEventListener('blur', hide);
    el.addEventListener('click', go);
    el.addEventListener('keydown', (e) => { if (e.key === 'Enter') go(); });
  });
}
