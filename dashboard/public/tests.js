// Tests — catalog of every test the ledger knows (team+profile), most
// recently run first. Full ledger on purpose: a catalog shouldn't lose
// tests that simply haven't run this week (per-test Insights IS ranged).
// Project + Environment come from the global top switchers; suite + verdict
// are page filters, matching the Executions page.
import { esc, api, rel } from './util.js';
import { catalog, groupByTest } from './agg.js';
import { chip, headline, historyBar } from './runs.js';
import { applyScope } from './scope.js';

const filters = { suite: '', verdict: '' }; // module state, survives re-render

export async function renderTests(page) {
  const { runs: allRuns } = await api('/api/runs');
  const scoped = applyScope(allRuns);
  const byTest = groupByTest(scoped);
  const all = catalog(scoped);
  const items = all.filter((c) =>
    (!filters.suite || c.suite === filters.suite)
    && (!filters.verdict || c.last.verdict === filters.verdict));

  const fbtn = (key, val, label, sub) =>
    `<button class="fbtn ${sub ? 'stacked' : ''} ${filters[key] === val ? 'on' : ''}" data-k="${key}" data-v="${val}">${label}${sub ? `<span class="fbtnsub">${sub}</span>` : ''}</button>`;

  const row = (c) => `
    <div class="testrow">
      <button class="testrow-link" type="button" data-open
              data-team="${esc(c.team)}" data-profile="${esc(c.profile)}">
        ${chip(c.last)}
        <div class="testinfo">
          <div class="testhead">
            <span class="testname">${esc(c.team)} · ${esc(c.profile)}</span>
            <span class="hbadge">${c.suite === 'functional' ? 'Does it work?' : 'Is it fast?'}</span>
          </div>
          <div class="testmeta">${esc(headline(c.last))}${c.last.flake ? ' · not reproduced on re-run' : ''} · ${esc(rel(c.last.recorded_at))}</div>
        </div>
        ${historyBar(c.last, byTest, 'lg') || '<span></span>'}
      </button>
      <div class="testtail">
        <span class="testcount">${c.count} execution${c.count === 1 ? '' : 's'}</span>
        ${c.suite === 'functional' ? '' : `<button class="fbtn" data-run data-team="${esc(c.team)}" data-profile="${esc(c.profile)}"
          title="Run this test now — straight to the run step">Run ▸</button>`}
      </div>
    </div>`;

  const grid = items.length ? `<div class="testrows">${items.map(row).join('')}</div>`
    : all.length ? '<p class="why">No tests match these filters. Try loosening them.</p>'
    : scoped.length ? '<p class="why">No tests for the selected project / environment.</p>'
    : allRuns.length ? '<p class="why">No tests for the selected project / environment. Change the switchers up top.</p>'
    : `<p class="why">No tests yet — create your first.</p>
       <button class="btn primary" id="catcreate">＋ Create test</button>`;

  page.innerHTML = `
    <article class="card" data-screen-label="Tests">
      <div id="stage">
        <div class="pagehead">
          <div>
            <h1>Tests.</h1>
            <p class="why">Every test RedLine knows for your teams. Click one for its execution history and insights.</p>
          </div>
        </div>
        <div class="runsbar">
          ${fbtn('suite', '', 'all')}${fbtn('suite', 'functional', 'Functional', 'Does it work?')}${fbtn('suite', 'performance', 'Performance', 'Is it fast?')}
          <span class="fsep"></span>
          ${fbtn('verdict', '', 'any verdict')}${fbtn('verdict', 'green', 'green')}${fbtn('verdict', 'red', 'red')}
        </div>
        ${grid}
      </div>
    </article>`;

  const reRender = () => renderTests(page).catch(() => {});
  page.querySelectorAll('.fbtn[data-k]').forEach((b) => b.addEventListener('click', () => {
    const { k, v } = b.dataset; filters[k] = v; reRender();
  }));
  page.querySelector('#catcreate')?.addEventListener('click', () => { location.hash = '#create'; });
  page.querySelectorAll('[data-run]').forEach((b) => b.addEventListener('click', () => {
    location.hash = `#run/${encodeURIComponent(b.dataset.team)}/${encodeURIComponent(b.dataset.profile)}`;
  }));
  page.querySelectorAll('[data-open]').forEach((b) => b.addEventListener('click', () => {
    location.hash = `#insights/${encodeURIComponent(b.dataset.team)}/${encodeURIComponent(b.dataset.profile)}`;
  }));
}
