// Shell — persistent section rail, sticky top bar, hash router. Entry module.
// Pages render into #page; the wizard mounts there as the #create flow.
import { esc, api } from './util.js';
import { routeRuns, renderRuns } from './runs.js';
import { renderHome } from './home.js';
import { renderTests } from './tests.js';
import { renderInsights } from './insights.js';
import { renderSchedules } from './schedules.js';
import { renderProjects } from './projects.js';
import { initWizard } from './app.js';
import { scope, setScope, envLabel, envOptions } from './scope.js';

const $ = (sel, el = document) => el.querySelector(sel);

const NAV = [
  { hash: '#home', label: 'Home', icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M3 11l9-8 9 8"/><path d="M5 10v10h14V10"/></svg>' },
  { hash: '#tests', label: 'Tests', icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M9 3h6M12 3v5l5 9a2 2 0 0 1-1.8 3H8.8A2 2 0 0 1 7 17l5-9"/></svg>' },
  { hash: '#insights', label: 'Insights', icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/></svg>' },
  { hash: '#runs', label: 'Executions', icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M3 12h4l2 6 4-14 2 8h6"/></svg>' },
  { hash: '#schedules', label: 'Schedules', icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 3"/></svg>' },
  { hash: '#projects', label: 'Projects', icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/></svg>' },
  { hash: '#run', label: 'Run test', icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><polygon points="6 4 19 12 6 20 6 4"/></svg>' },
  { hash: '#create', label: 'Create test', icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M12 5v14M5 12h14"/></svg>' },
];

function currentSection() {
  const h = location.hash;
  if (h.startsWith('#tests')) return '#tests';
  if (h.startsWith('#schedules')) return '#schedules';
  if (h.startsWith('#projects')) return '#projects';
  // Precise match: '#run' must not swallow '#runs' (Executions).
  if (h === '#run' || h.startsWith('#run/')) return '#run';
  if (routeRuns()) return '#runs';
  if (h.startsWith('#insights')) return '#insights';
  if (h.startsWith('#create')) return '#create';
  return '#home';
}

function renderNav() {
  const sec = currentSection();
  $('#nav').innerHTML = NAV.map((n) => `
    <button class="navsec${sec === n.hash ? ' on' : ''}" data-hash="${n.hash}">${n.icon}<span>${n.label}</span></button>`).join('');
  document.querySelectorAll('#nav .navsec').forEach((b) =>
    b.addEventListener('click', () => { location.hash = b.dataset.hash; }));
}

async function renderTopbar() {
  $('#topbar').innerHTML = `
    <div class="switchers" id="switchers"></div>
    <button class="btn-create" id="createbtn"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 5v14M5 12h14"/></svg>Create test</button>`;
  $('#createbtn').addEventListener('click', () => { location.hash = '#create'; });
  // The two global switchers — Project + Environment — set the scope every page
  // filters through. Populated from what the ledger actually recorded.
  let teams = [], envs = ['stg', 'prod'];
  try {
    const { runs } = await api('/api/runs');
    teams = [...new Set(runs.map((r) => r.team).filter(Boolean))].sort();
    envs = envOptions(runs);
  } catch {}
  const s = scope();
  // A previously-picked project/env that no longer exists falls back to "all".
  if (s.project && !teams.includes(s.project)) setScope({ project: '' });
  const opt = (v, label, sel) => `<option value="${esc(v)}" ${sel ? 'selected' : ''}>${esc(label)}</option>`;
  $('#switchers').innerHTML = `
    <div class="switchpill" title="Project">
      <span class="switchbadge">P</span>
      <select id="projsel" aria-label="Project">
        ${opt('', 'All projects', !s.project)}
        ${teams.map((t) => opt(t, t, s.project === t)).join('')}
      </select>
    </div>
    <span class="switchsep">/</span>
    <div class="switchpill" title="Environment">
      <i class="switchdot"></i>
      <select id="envsel" aria-label="Environment">
        ${opt('', 'All environments', !s.env)}
        ${envs.map((e) => opt(e, envLabel(e), s.env === e)).join('')}
      </select>
    </div>
    ${teams.length ? `<span class="switchteams">${esc(teams.join(', '))}</span>` : ''}`;
  $('#projsel').addEventListener('change', (e) => { setScope({ project: e.target.value }); route(); });
  $('#envsel').addEventListener('change', (e) => { setScope({ env: e.target.value }); route(); });
}

let gen = 0;    // route generation — a stale async render must never win over a newer route
let active = 0; // in-flight route() calls — self-correct only when we're the last
let lastHash = null; // last painted hash — scroll resets only on real navigation, not focus-refresh

async function route() {
  const g = ++gen;
  active++;
  renderNav();
  const sec = currentSection();
  const page = $('#page');
  const wizard = sec === '#create' || sec === '#run'; // both drive the same wizard engine
  $('#bar').style.display = wizard ? '' : 'none';
  if (!wizard) { $('#teamtag').innerHTML = ''; $('#count').textContent = ''; }
  try {
    if (wizard) await initWizard(page);
    else if (sec === '#runs') await renderRuns(page);
    else if (sec === '#tests') await renderTests(page);
    else if (sec === '#schedules') await renderSchedules(page);
    else if (sec === '#projects') await renderProjects(page);
    else if (sec === '#insights') await renderInsights(page);
    else await renderHome(page);
  } catch (e) {
    page.innerHTML = `<article class="card"><div id="stage"><h1>Couldn’t load this page.</h1>
      <p class="why">${esc(e.message)}</p></div></article>`;
  }
  active--;
  if (g === gen && location.hash !== lastHash) {
    lastHash = location.hash;
    $('#main').scrollTop = 0; // real navigation lands at the top; focus-refresh keeps its place
  }
  // A newer navigation superseded us mid-render (our slow fetch painted over
  // its page) — repaint the current route, but only if no newer call is still
  // in flight (it will handle its own correction; this prevents ping-pong).
  if (g !== gen && active === 0) route();
}

// Theme toggle — moved verbatim from app.js (shell furniture now).
function setupThemeToggle() {
  if ($('#themetoggle')) return;
  const THEMES = ['brass', 'canvas', 'void'];
  const LABELS = { brass: 'Brass', canvas: 'Canvas', void: 'Void' };
  const MAP = { brass: 'app.css', canvas: 'app-theme-canvas.css', void: 'app-theme-void.css' };
  const btn = document.createElement('button');
  btn.id = 'themetoggle';
  btn.style.cssText = 'background:none;border:1px solid var(--line);border-radius:var(--r-pill);'
    + 'color:var(--faint);font:11px var(--sans);letter-spacing:.12em;text-transform:uppercase;'
    + 'padding:4px 10px;cursor:pointer;transition:color 130ms,border-color 130ms;white-space:nowrap';
  const update = () => { btn.textContent = LABELS[localStorage.getItem('redline-theme') || 'brass']; };
  update();
  btn.addEventListener('mouseenter', () => { btn.style.color = 'var(--text)'; btn.style.borderColor = 'var(--line-strong)'; });
  btn.addEventListener('mouseleave', () => { btn.style.color = 'var(--faint)'; btn.style.borderColor = 'var(--line)'; });
  btn.addEventListener('click', () => {
    const cur = localStorage.getItem('redline-theme') || 'brass';
    const next = THEMES[(THEMES.indexOf(cur) + 1) % THEMES.length];
    localStorage.setItem('redline-theme', next);
    document.getElementById('theme-css').href = MAP[next];
    update();
  });
  const meta = $('.railmeta');
  if (meta) meta.prepend(btn);
}

window.addEventListener('hashchange', route);
// Focus-refresh non-wizard pages; the wizard owns its own refresh loop
// (a shell re-render there would wipe typed form input).
window.addEventListener('focus', () => { if (currentSection() !== '#create') route(); });

renderTopbar();
setupThemeToggle();
route();
