// Schedules — timed runs. List + create; fires while the dashboard is
// running (the server skips a window it was closed for — said in the copy,
// not hidden). Both kinds are schedulable: perf tests, and functional suites
// (whose target URL the server reads from each suite's own playwright.config.ts).
import { esc, api } from './util.js';

const DAYL = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
// The whole form survives re-render — a day-toggle repaints the page, and
// losing the picked test/time to that repaint would make the form unusable.
const form = { test: '', time: '06:00', days: [] };

const fmt = (iso) => iso ? new Date(iso).toLocaleString([], { weekday: 'short', hour: '2-digit', minute: '2-digit' }) : '';

export async function renderSchedules(page) {
  const { schedules, tests } = await api('/api/schedules');

  const daysLabel = (s) => !s.days?.length ? 'every day' : s.days.map((d) => DAYL[d]).join(' · ');
  const row = (s) => `
    <div class="testrow" style="cursor:default">
      <div class="testinfo">
        <div class="testhead">
          <span class="testname">${esc(s.team)} · ${esc(s.profile)}</span>
          <span class="hbadge">${esc(s.time)}</span>
          ${s.exists ? '' : '<span class="hbadge">test missing</span>'}
        </div>
        <div class="testmeta">${esc(daysLabel(s))}
          · ${s.lastFired ? `last ran ${esc(fmt(s.lastFired))}` : 'never ran yet'}
          ${s.enabled ? (s.due ? ' · <b>due now — starts on the next tick</b>' : s.next ? ` · next ${esc(fmt(s.next))}` : '') : ' · paused'}
          ${s.note ? ` · ${esc(s.note)}` : ''}</div>
      </div>
      <div class="testtail">
        <button class="fbtn ${s.enabled ? 'on' : ''}" data-toggle="${esc(s.id)}"
          title="${s.enabled ? 'Pause this schedule' : 'Resume this schedule'}">${s.enabled ? 'on' : 'off'}</button>
        <button class="fbtn" data-del="${esc(s.id)}" title="Delete this schedule">✕</button>
      </div>
    </div>`;

  const testOpt = (t) => {
    const v = `${t.team}|${t.profile}`;
    return `<option value="${esc(v)}" ${form.test === v ? 'selected' : ''}>${esc(t.team)} · ${esc(t.profile)}</option>`;
  };
  const dayBtn = (d) => `<button class="fbtn ${form.days.includes(d) ? 'on' : ''}" data-day="${d}"
    title="Only on ${DAYL[d]} — none selected means every day">${DAYL[d]}</button>`;

  page.innerHTML = `
    <article class="card" data-screen-label="Schedules">
      <div id="stage">
        <div class="pagehead">
          <div>
            <h1>Schedules.</h1>
            <p class="why">Run a test on a timer — daily, or only on the days you pick. Times are this
            machine's local time, and schedules fire only while the dashboard is running: a run whose
            window passed while it was closed is skipped for that day, not queued.</p>
          </div>
        </div>
        ${tests.length ? `
        <div class="runsbar">
          <select id="schedtest" aria-label="Test to schedule">${tests.map(testOpt).join('')}</select>
          <input type="time" id="schedtime" value="${esc(form.time)}" aria-label="Time of day">
          <span class="fsep"></span>
          ${[1, 2, 3, 4, 5, 6, 0].map(dayBtn).join('')}
          <button class="btn primary" id="schedadd">Schedule it</button>
        </div>
        <p class="why" id="schederr" style="display:none"></p>` : `
        <p class="why">No runnable tests yet — create a performance test first, then schedule it here.</p>`}
        ${schedules.length ? `<div class="testrows">${schedules.map(row).join('')}</div>`
          : tests.length ? '<p class="why">Nothing scheduled yet.</p>' : ''}
      </div>
    </article>`;

  const reRender = () => renderSchedules(page).catch(() => {});
  const showErr = (m) => { const el = page.querySelector('#schederr'); if (el) { el.textContent = m; el.style.display = ''; } };

  const saveForm = () => { // capture typed values before any repaint
    form.test = page.querySelector('#schedtest')?.value || form.test;
    form.time = page.querySelector('#schedtime')?.value || form.time;
  };
  page.querySelectorAll('[data-day]').forEach((b) => b.addEventListener('click', () => {
    saveForm();
    const d = Number(b.dataset.day);
    form.days = form.days.includes(d) ? form.days.filter((x) => x !== d) : [...form.days, d];
    reRender();
  }));
  page.querySelector('#schedadd')?.addEventListener('click', async () => {
    saveForm();
    const [team, profile] = (form.test || page.querySelector('#schedtest').value || '').split('|');
    try {
      await api('/api/schedules', { team, profile, time: form.time, days: form.days });
      form.days = [];
      reRender();
    } catch (e) { showErr(e.message); }
  });
  page.querySelectorAll('[data-toggle]').forEach((b) => b.addEventListener('click', async () => {
    try { await api('/api/schedules/toggle', { id: b.dataset.toggle }); reRender(); } catch { reRender(); }
  }));
  page.querySelectorAll('[data-del]').forEach((b) => b.addEventListener('click', async () => {
    try { await api('/api/schedules/delete', { id: b.dataset.del }); reRender(); } catch { reRender(); }
  }));
}
