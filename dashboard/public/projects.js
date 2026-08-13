// Projects — one card per project: where its tests point, whether they sign in,
// and where its alerts go. Before this page a project's target URL lived in the
// single wizard session, so onboarding a second project overwrote the first one's.
//
// Editable here: target URL, environment, test type, sign-in + saved account.
// Read-only here: alert channels (state/team-channels.json) and heal policy
// (state/heal-policy.json) — both are their own files with their own shapes,
// and a half-featured editor for them would be worse than a clear pointer.
// Not editable at all: iterations / VUs, fixed by CLAUDE.md hard rule 7.
import { esc, api } from './util.js';
import { envLabel } from './scope.js';

const ENV_PICK = ['stg', 'prod', 'local'];
// Which project's card is expanded, and any unsaved edits in it. Kept at module
// scope so a re-render (after save) does not collapse what you were editing.
let open = '';
let msg = null;   // { team, text, ok }

const CH_LABEL = { slack: 'Slack', msteams: 'Teams', pagerduty: 'PagerDuty', opsgenie: 'OpsGenie' };

export async function renderProjects(page) {
  const { teams, locked } = await api('/api/settings');

  const summary = (t) => {
    const bits = [];
    bits.push(t.url ? esc(t.url) : '<i>no target set</i>');
    if (t.env) bits.push(esc(envLabel(t.env)));
    if (t.login?.required) bits.push(t.login.credsSet ? 'sign-in · account saved' : 'sign-in · no account yet');
    return bits.join(' · ');
  };

  const tests = (t) => {
    const out = t.profiles.map((p) => esc(p));
    if (t.functional) out.push('functional');
    return out.length ? out.join(', ') : 'no tests yet';
  };

  const card = (t) => `
    <div class="testrow" style="cursor:default;align-items:flex-start">
      <div class="testinfo">
        <div class="testhead">
          <span class="testname">${esc(t.team)}</span>
          <span class="hbadge">${esc(tests(t))}</span>
          ${t.heal ? `<span class="hbadge">heal: ${esc(t.heal)}</span>` : ''}
        </div>
        <div class="testmeta">${summary(t)}</div>
        ${open === t.team ? form(t) : ''}
      </div>
      <div class="testtail">
        <button class="fbtn ${open === t.team ? 'on' : ''}" data-edit="${esc(t.team)}">${open === t.team ? 'close' : 'edit'}</button>
      </div>
    </div>`;

  const form = (t) => `
    <div class="field">
      <label for="u-${esc(t.team)}">Target address</label>
      <input id="u-${esc(t.team)}" value="${esc(t.url)}" spellcheck="false" autocomplete="off"
        placeholder="https://your-app.staging.example.com/api/health" />
    </div>
    <div class="field">
      <label>Environment</label>
      <div class="envpick">
        ${ENV_PICK.map((e) => `<button type="button" class="envopt${t.env === e ? ' on' : ''}" data-env="${e}">${esc(envLabel(e))}</button>`).join('')}
      </div>
      <div class="cdetail" style="margin-top:8px">Your choice is authoritative — the agent will not re-guess it from the address.</div>
    </div>
    <div class="field">
      <label>Test type</label>
      <div class="envpick">
        <button type="button" class="envopt${t.path === 'api' ? ' on' : ''}" data-path="api">API</button>
        <button type="button" class="envopt${t.path === 'browser' ? ' on' : ''}" data-path="browser">Browser journey</button>
      </div>
    </div>
    <div class="field">
      <label>Sign-in</label>
      <div class="envpick">
        <button type="button" class="envopt${t.login?.required ? ' on' : ''}" data-login="1">${t.login?.required ? 'required' : 'not needed'}</button>
      </div>
    </div>
    ${t.login?.required ? `
      <div class="note">${t.login.credsSet
        ? 'An account is saved for this project. Enter a new one below to replace it.'
        : 'No account saved yet for this project.'}
        Accounts are stored <b>per project</b> in the gitignored <b>.env</b>, never in settings.</div>
      <div class="field">
        <label for="us-${esc(t.team)}">Test account</label>
        <input id="us-${esc(t.team)}" autocomplete="off" placeholder="username" />
        <input id="pw-${esc(t.team)}" type="password" autocomplete="new-password" placeholder="password" style="margin-top:10px" />
      </div>` : ''}
    <div class="note" style="margin-top:22px">
      <b>Benchmark shape:</b> ${locked.iterations} iterations, ${locked.vus} VU, ${esc(locked.executor)} — fixed by design.
      A single sample gives no meaningful p95, so this is not a per-project setting.<br>
      <b>Alerts:</b> ${t.channels.length
        ? t.channels.map((c) => `${esc(CH_LABEL[c.type] || c.type)}${c.channel ? ' ' + esc(c.channel) : ''} (${esc(c.secret_env)})`).join(' · ')
        : 'none configured'} — edit in state/team-channels.json.
    </div>
    <div style="margin-top:20px;display:flex;gap:12px;align-items:center">
      <button class="btn primary" data-save="${esc(t.team)}">Save</button>
      ${msg && msg.team === t.team ? `<span class="hint">${esc(msg.text)}</span>` : ''}
    </div>`;

  page.innerHTML = `
    <article class="card" data-screen-label="Projects">
      <div id="stage">
        <div class="pagehead">
          <div>
            <h1>Projects.</h1>
            <p class="why">What each project's tests point at, and how they sign in. Every project keeps its
            own target and its own test account — setting up a second project never overwrites the first.</p>
          </div>
        </div>
        ${teams.length
          ? teams.map(card).join('')
          : '<p class="why">No projects yet. Create a test and this page fills in.</p>'}
      </div>
    </article>`;

  const draft = (team) => {
    const g = (id) => document.getElementById(`${id}-${team}`);
    return { url: g('u')?.value, username: g('us')?.value || undefined, password: g('pw')?.value || undefined };
  };
  // Toggles post immediately so a click is never silently lost on collapse.
  const patch = async (team, body) => {
    try {
      await api('/api/settings', { team, ...body });
      msg = { team, text: 'Saved.', ok: true };
    } catch (e) { msg = { team, text: e.message, ok: false }; }
    await renderProjects(page);
  };

  page.querySelectorAll('[data-edit]').forEach((b) => b.addEventListener('click', () => {
    open = open === b.dataset.edit ? '' : b.dataset.edit;
    msg = null;
    renderProjects(page);
  }));
  page.querySelectorAll('[data-env]').forEach((b) => b.addEventListener('click', () => patch(open, { env: b.dataset.env })));
  page.querySelectorAll('[data-path]').forEach((b) => b.addEventListener('click', () => patch(open, { path: b.dataset.path })));
  page.querySelectorAll('[data-login]').forEach((b) => b.addEventListener('click', () => {
    const t = teams.find((x) => x.team === open);
    patch(open, { loginRequired: !t?.login?.required });
  }));
  page.querySelectorAll('[data-save]').forEach((b) => b.addEventListener('click', () => patch(b.dataset.save, draft(b.dataset.save))));
}
