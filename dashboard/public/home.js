// Home — hero KPI graphs + recent executions. The landing page.
import { esc, rel } from './util.js';
import { rangedRuns, rangePill, bindRangePill } from './range.js';
import { kpis, rolling, catalog, groupByTest } from './agg.js';
import { areaChart } from './charts.js';
import { historyBar, headline } from './runs.js';
import { applyScope } from './scope.js';

export async function renderHome(page) {
  const { runs: rangedAll } = await rangedRuns();
  const runs = applyScope(rangedAll); // global Project + Environment switchers
  const k = kpis(runs);
  const chrono = [...runs].reverse().filter((r) => r.verdict !== 'fail').slice(-30);
  const passSeries = rolling(chrono.map((r) => (r.verdict === 'green' ? 1 : 0)));
  const redSeries = rolling(chrono.map((r) => (r.verdict === 'red' ? 1 : 0)));
  const tests = catalog(runs);
  const byTest = groupByTest(runs);
  const recent = runs.slice(0, 8);
  const open = Math.max(0, k.red - k.corroborated - k.flakes);

  const tile = (cls, label, num, delta, svg) => `
    <div class="kpitile ${cls}">
      <div class="kchart">${svg}</div>
      <div class="klabel">${label}</div>
      <div class="knum">${num}</div>
      <div class="kdelta">${delta}</div>
    </div>`;

  const row = (r) => `
    <div class="homerow" data-id="${esc(r.run_id)}" role="button" tabindex="0">
      <span class="stat ${r.verdict === 'green' ? 'g' : r.verdict === 'red' ? 'r' : 'f'}"></span>
      <span class="hname">
        <span class="n">${esc(r.team ?? '?')} · ${esc(r.profile ?? '?')}</span>
        <span class="hbadge">${r.suite === 'functional' ? 'func' : 'perf'}</span>
        <span class="hmeta">${esc(headline(r))}${r.flake ? ' · not reproduced on re-run' : ''}</span>
      </span>
      ${historyBar(r, byTest) || '<span></span>'}
      <span class="hwhen">${esc(rel(r.recorded_at))}</span>
    </div>`;

  page.innerHTML = `
    <article class="card" data-screen-label="Home">
      <div id="stage">
        <div class="pagehead">
          <div>
            <h1>Overview.</h1>
            <p class="why">Everything RedLine has run for your teams. Click any run for its full story.</p>
          </div>
          ${rangePill()}
        </div>
        <div class="kpirow">
          ${tile('pass', 'Pass rate', k.passRate !== null ? `${k.passRate}%` : '—',
            k.passRate !== null ? `${k.green} green of ${k.green + k.red} verdicts` : 'no verdicts in this range',
            passSeries.length >= 2 ? areaChart(passSeries, 'var(--green)') : '')}
          ${tile('fail', 'Red runs', k.red,
            `${k.corroborated} confirmed real · ${k.flakes} one-off${k.flakes === 1 ? '' : 's'} · ${open} awaiting review`,
            redSeries.length >= 2 ? areaChart(redSeries, 'var(--red)') : '')}
          ${tile('total', 'Total executions', k.total,
            `across ${tests.length} test${tests.length === 1 ? '' : 's'}`, '')}
        </div>
        <div class="sechead"><span class="sectitle">Recent executions</span><a class="seclink" href="#runs">See all executions →</a></div>
        <div class="homerows">
          ${recent.length ? recent.map(row).join('')
            : '<p class="why">No runs in this range for the selected project / environment. Widen the date range or the switchers up top.</p>'}
        </div>
      </div>
    </article>`;

  bindRangePill(page);
  page.querySelectorAll('.homerow').forEach((r) => {
    const go = () => { location.hash = `#runs/${encodeURIComponent(r.dataset.id)}`; };
    r.addEventListener('click', go);
    r.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go(); } });
  });
}
