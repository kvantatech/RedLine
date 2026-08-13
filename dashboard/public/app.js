// RedLine onboarding wizard — UI logic. Vanilla, no build step.
import { esc, api } from './util.js';
import { envForUrl } from './env-detect.js';
import { envLabel } from './scope.js';

const ENV_PICK = ['stg', 'prod', 'local']; // wizard environment choices

const $ = (sel, el = document) => el.querySelector(sel);

let state = null;       // payload from /api/state
let cursor = 0;         // index into state.stages
let stageSubmit = null; // set by form stages; Next awaits it (returns bool = may advance)
let es = null;          // EventSource for the agent feed
let mount = null;  // the #page element the shell hands us (set by initWizard)
let stateGen = 0;  // bumped on every setState — lets an in-flight refresh detect it's stale

// Inline SVGs for the two-path Start screen. currentColor so each theme drives them.
const ICONS = {
  // functional = "does it work" → a checked circle (works / doesn't)
  func: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"></circle><path d="M8.5 12.4l2.4 2.4 4.6-5.2"></path></svg>',
  // performance = "is it fast" → a gauge / speedometer
  perf: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 18a8 8 0 1 1 16 0"></path><path d="M12 13l4-3.5"></path><circle cx="12" cy="13" r="1.5" fill="currentColor" stroke="none"></circle></svg>',
  arrow: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h13"></path><path d="M13 6l6 6-6 6"></path></svg>',
};

const stageById = (id) => state.stages.find((s) => s.id === id);
const firstOpen = () => {
  const i = state.stages.findIndex((s) => !s.done);
  return i === -1 ? state.stages.length - 1 : i;
};

// The wizard engine drives two nav destinations: #create (full author flow) and
// #run (operate flow, trimmed). '#run' must be matched precisely so it never
// swallows '#runs' (the Executions page).
const isRunNav = () => location.hash === '#run' || location.hash.startsWith('#run/');
const inWizard = () => location.hash.startsWith('#create') || isRunNav();
// On the #run destination the flow starts at "Before we start" — the Start /
// Set-up-or-run fork steps are hidden, so Run test reads as its own 4-step page.
const stageFloor = () => {
  if (!isRunNav() || !state) return 0;
  const i = state.stages.findIndex((s) => s.id === 'ready');
  return i === -1 ? 0 : i;
};
const idxStage = (id) => Math.max(stageFloor(), state.stages.findIndex((s) => s.id === id));

function setState(next) {
  stateGen++;
  state = next;
  cursor = Math.max(0, Math.min(cursor, state.stages.length - 1));
  render();
}

async function refresh(fresh = false) {
  const g = stateGen; // if a form submit lands a newer state while this GET is in
  const next = await api(`/api/state${fresh ? '?fresh=1' : ''}`); // flight, don't clobber it
  if (g !== stateGen) return;
  // nothing changed server-side → don't re-render (a re-render rebuilds forms)
  if (state && JSON.stringify(next) === JSON.stringify(state)) { state = next; return; }
  setState(next);
}

// ── render ───────────────────────────────────────────────────────────

function render() {
  if (!mount || !inWizard()) return;
  const shownStages = state.stages.slice(stageFloor()); // #run hides the fork steps
  const done = shownStages.filter((s) => s.done).length;
  $('#barfill').style.width = `${Math.round((done / shownStages.length) * 100)}%`;
  $('#count').textContent = `${done} of ${shownStages.length}`;
  const tag = $('#teamtag');
  if (state.config.mode === 'operate' && state.operate?.picked) {
    tag.innerHTML = `<span class="tlabel">you're running</span>
      <span class="tname">${esc(state.operate.team)}</span>
      <span class="tprofile">${esc(profileTitle(state.operate.profile))}</span>`;
  } else if (state.config.suite === 'performance' && state.config.team) {
    tag.innerHTML = `<span class="tlabel">setting up for</span>
      <span class="tname">${esc(state.config.team)}</span>
      ${state.config.path ? `<span class="tprofile">${esc(state.config.path === 'browser' ? 'browser journey test' : 'API benchmark test')}</span>` : ''}`;
  } else {
    tag.innerHTML = '';
  }
  renderMain();
}

function renderMain() {
  // snapshot unsaved form input so a background refresh never wipes what was typed
  const keep = {};
  document.querySelectorAll('#stage input, #stage textarea').forEach((el) => { if (el.id) keep[el.id] = el.value; });
  // Both sign-in toggles: #logintoggle (perf describe) and #flogin (func describe).
  // Only one exists per stage; snapshot whichever is present so a background
  // refresh mid-stage doesn't silently reset it to off.
  const keepLogin = $('#logintoggle')?.classList.contains('on') ?? null;
  const keepFlogin = $('#flogin')?.classList.contains('on') ?? null;

  stageSubmit = null;
  const s = state.stages[cursor];
  const render = {
    start: renderStart,
    'func-intro': renderFuncIntro, 'func-describe': renderFuncDescribe,
    'func-create': renderFuncCreate, 'func-results': renderFuncResults,
    ready: renderReady, team: renderTeam, path: renderPath,
    describe: renderDescribe, create: renderCreate, benchmark: renderBenchmark, done: renderDone,
    pick: renderPick, run: renderRun, outcome: renderOutcome,
  }[s.id];

  const modeChip = state.config.mode === 'operate' ? 'run & judge' : state.config.mode === 'onboard' ? 'set up' : '';
  const floor = stageFloor();               // hidden fork steps on the #run flow
  const shown = state.stages.slice(floor);  // for the "step N of M" counter
  mount.innerHTML = `
    <article class="card narrow" data-screen-label="${esc(s.title)}">
      <div class="stepper" role="navigation" aria-label="Wizard steps">
        ${state.stages.map((st, i) => i < floor ? '' : `
          <button class="stepdot${st.done ? ' done' : ''}${i === cursor ? ' current' : ''}" data-i="${i}" title="${esc(st.title)}">
            <span class="sglyph">${st.done && i !== cursor ? '✓' : i - floor + 1}</span><span class="slabel">${esc(st.title)}</span>
          </button>`).join('')}
      </div>
      <div class="kicker"><span class="idx">${String(cursor - floor + 1).padStart(2, '0')}</span><span>step ${cursor - floor + 1} of ${shown.length}</span>${modeChip ? `<span class="opt">${modeChip}</span>` : ''}</div>
      <div id="stage"></div>
      <div class="stepnav">
        <button class="btn" id="back" ${cursor <= floor ? 'disabled' : ''}>← Back</button>
        <span class="hint" id="naverr"></span>
        <button class="btn primary" id="next" ${cursor === state.stages.length - 1 ? 'style="visibility:hidden"' : ''}>Next →</button>
      </div>
    </article>`;

  mount.querySelectorAll('.stepdot').forEach((b) =>
    b.addEventListener('click', () => goto(Number(b.dataset.i))));

  render($('#stage'), s);

  // restore unsaved values + the sign-in toggle (ids only exist on their own stage)
  for (const [id, v] of Object.entries(keep)) { const el = $('#' + id); if (el && el.value !== undefined) el.value = v; }
  if (keepLogin !== null && $('#logintoggle')) {
    $('#logintoggle').classList.toggle('on', keepLogin);
    const lf = $('#loginfields');
    if (lf) lf.style.display = keepLogin ? 'block' : 'none';
  }
  if (keepFlogin !== null && $('#flogin')) $('#flogin').classList.toggle('on', keepFlogin);
  updateNext();

  $('#back').addEventListener('click', () => goto(cursor - 1));
  let advancing = false; // a fast double-click must not fire stageSubmit (a POST) twice
  $('#next').addEventListener('click', async () => {
    if (advancing) return;
    advancing = true;
    try {
      if (stageSubmit) {
        $('#naverr').textContent = '';
        try { if (!(await stageSubmit())) return; }
        catch (e) { $('#naverr').textContent = e.message; return; }
      }
      goto(cursor + 1, true);
    } finally { advancing = false; }
  });
}

function updateNext() {
  const next = $('#next');
  if (!next) return;
  const s = state.stages[cursor];
  const agentBusy = state.agent?.running; // agent-action stages must finish first
  if (s.id === 'create' || s.id === 'benchmark' || s.id === 'run') {
    next.disabled = !s.done || agentBusy;
  } else {
    next.disabled = !s.done && !stageSubmit; // form stages validate on click; others gate on done
  }
}

function goto(i, force = false) {
  // Forward jump is allowed only if EVERY stage between here and the target is
  // done — checking just the current one let a stepdot leap over undone stages.
  if (i > cursor && !force && state.stages.slice(cursor, i).some((s) => !s.done)) return;
  // Never step below the floor (hidden fork steps on the #run flow).
  cursor = Math.max(stageFloor(), Math.min(i, state.stages.length - 1));
  render();
}

// ── stage renderers ──────────────────────────────────────────────────

function renderReady(zone) {
  const c = state.checks;
  const row = (check, name) => `
    <div class="checkrow">
      <span class="dot ${check.pass ? 'pass' : 'fail'}"></span>
      <span class="checktext">
        <span class="cdesc">${esc(name)}</span>
        <span class="cdetail">${esc(check.detail)}</span>
      </span>
    </div>`;
  zone.innerHTML = `
    <h1>Let's set up performance testing for your project.</h1>
    <p class="why">In a few guided steps you'll have a real performance test running against your staging
    environment — and a clear <b>Red Line</b> that tells you when something got slower. You won't write any code:
    you describe what matters, and the RedLine agent does the technical work.</p>
    <p class="why" style="margin-top:12px">Two tools need to be installed on this computer. We already checked:</p>
    ${row(c.claude, 'Claude Code — the agent that does the work')}
    ${row(c.k6, 'k6 — the tool that runs performance tests')}
    ${row(c.submodules, 'Project files — everything the agent needs came with this folder')}
    <div class="override"><button id="recheck">check again</button></div>`;
  $('#recheck', zone).addEventListener('click', () => refresh(true));
}

function renderTeam(zone) {
  zone.innerHTML = `
    <h1>What's your project called?</h1>
    <p class="why">Everything we create — the test, its results, its alerts — is filed under your project's name.
    Use the short name the project goes by in repositories — letters, numbers and dashes. We'll lower-case it for you.</p>
    <div class="teamform">
      <input id="team" placeholder="e.g. demo-web" value="${esc(state.config.team)}" spellcheck="false" autocomplete="off" />
    </div>
    <div class="formerr" id="err"></div>`;
  stageSubmit = async () => {
    const team = $('#team', zone).value.trim();
    try { setState(await api('/api/team', { team })); return true; }
    catch (e) { $('#err', zone).textContent = e.message; return false; }
  };
  $('#team', zone).addEventListener('keydown', (e) => { if (e.key === 'Enter') $('#next').click(); });
  updateNext();
}

function renderPath(zone) {
  const sel = state.config.path;
  zone.innerHTML = `
    <h1>What kind of test do you need?</h1>
    <p class="why">Pick the one that matches what you care about. You can always come back and add the other later.</p>
    <div class="choices">
      <button class="choice ${sel === 'api' ? 'selected' : ''}" data-path="api">
        <div class="ctitle">Test an API</div>
        <div class="cdesc">Check how quickly your service answers. Right when you have one important
        endpoint — a search, a config call, a save — that everything else depends on.</div>
        <div class="ctag">the API way</div>
      </button>
      <button class="choice ${sel === 'browser' ? 'selected' : ''}" data-path="browser">
        <div class="ctitle">Test in the browser</div>
        <div class="cdesc">Measure what a real person experiences — pages loading, clicks responding.
        Right when you care about a whole journey, like logging in and reaching a dashboard.</div>
        <div class="ctag">the browser way</div>
      </button>
    </div>`;
  zone.querySelectorAll('.choice').forEach((b) => b.addEventListener('click', async () => {
    setState(await api('/api/path', { path: b.dataset.path }));
  }));
}

function renderDescribe(zone) {
  const cfg = state.config;
  const isApi = cfg.path === 'api';
  if (!cfg.path) {
    zone.innerHTML = `<h1>What should we test?</h1><p class="why">Pick a test type first (previous step).</p>`;
    return;
  }
  zone.innerHTML = `
    <h1>${isApi ? 'Which API should we test?' : 'Describe the user journey.'}</h1>
    <p class="why">${isApi
      ? 'Paste the full address of the endpoint that matters most. You probably know it from your project — it\'s the call everything else waits for.'
      : 'Tell us where the journey starts and what the user does, in plain words. The agent turns each action into a measured step.'}</p>
    <div class="field">
      <label>${isApi ? 'API address' : 'Starting page'}</label>
      <input id="url" placeholder="${isApi ? 'https://your-app.staging.example.com/api/…' : 'https://your-app.staging.example.com/'}"
        value="${esc(isApi ? cfg.api.url : cfg.browser.url)}" spellcheck="false" autocomplete="off" />
    </div>
    <div class="field">
      <label>Environment <span class="autohint" id="envhint"></span></label>
      <div class="envpick" id="envpick">
        ${ENV_PICK.map((e) => `<button type="button" class="envopt" data-env="${e}">${esc(envLabel(e))}</button>`).join('')}
      </div>
      <div class="note" id="envnote" style="margin-top:10px"></div>
    </div>
    ${isApi ? '' : `
    <div class="field">
      <label>The journey, step by step</label>
      <textarea id="journey" rows="5" placeholder="Log in, open the dashboard, click 'Reports', wait for the chart to appear.">${esc(cfg.browser.journey)}</textarea>
    </div>`}
    <button class="confirm ${cfg.login.required ? 'on' : ''}" id="logintoggle" type="button">
      <span class="box"></span><span>${isApi ? 'This API needs a sign-in' : 'This page needs a sign-in'}</span>
    </button>
    <div id="loginfields" style="display:${cfg.login.required ? 'block' : 'none'}">
      ${cfg.login.credsSet ? '<div class="note" style="margin-top:14px">A test account is already saved ✓ — fill these in only to replace it.</div>' : `
      <div class="note" style="margin-top:14px">Use a <b>staging test account</b> — not your own login. It's saved only on this
      computer (in a file git never commits). No account at hand? Leave these empty and ask your tech lead later.</div>`}
      <div class="field"><label>Test account username</label><input id="username" autocomplete="off" /></div>
      <div class="field"><label>Test account password</label><input id="password" type="password" autocomplete="off" /></div>
    </div>
    <div class="formerr" id="err"></div>`;

  $('#logintoggle', zone).addEventListener('click', () => {
    const on = !$('#logintoggle', zone).classList.contains('on');
    $('#logintoggle', zone).classList.toggle('on', on);
    $('#loginfields', zone).style.display = on ? 'block' : 'none';
  });

  // Environment: auto-detected from the URL, overridable. If the config already
  // has an env (returning to this step), treat it as the user's explicit pick.
  let userPicked = !!cfg.env;
  let env = cfg.env || envForUrl($('#url', zone).value.trim());
  const ENV_NOTES = {
    stg: 'Staging / test environment — the standard target for RedLine tests.',
    local: 'Local environment (localhost) — fine for trying things out.',
    prod: '⚠ Production. Load against production needs explicit operator authorization (STG-only policy, CLAUDE.md hard rule 2). The test is organized under production, but a run may be blocked until that is granted.',
  };
  const syncEnv = () => {
    zone.querySelectorAll('.envopt').forEach((b) => b.classList.toggle('on', b.dataset.env === env));
    $('#envhint', zone).textContent = userPicked ? '' : '· detected from the address';
    const note = $('#envnote', zone);
    note.textContent = ENV_NOTES[env] || '';
    note.classList.toggle('warn', env === 'prod');
  };
  syncEnv();
  $('#url', zone).addEventListener('input', (e) => {
    if (userPicked) return;           // manual choice wins; stop auto-following
    env = envForUrl(e.target.value.trim());
    syncEnv();
  });
  zone.querySelectorAll('.envopt').forEach((b) => b.addEventListener('click', () => {
    userPicked = true; env = b.dataset.env; syncEnv();
  }));

  stageSubmit = async () => {
    const body = {
      url: $('#url', zone).value.trim(),
      env,
      journey: isApi ? undefined : $('#journey', zone).value.trim(),
      loginRequired: $('#logintoggle', zone).classList.contains('on'),
      username: $('#username', zone)?.value.trim() || undefined,
      password: $('#password', zone)?.value || undefined,
    };
    try { setState(await api('/api/describe', body)); return true; }
    catch (e) { $('#err', zone).textContent = e.message; return false; }
  };
  updateNext();
}

function renderCreate(zone, stage) {
  const cfg = state.config;
  const isApi = cfg.path === 'api';
  const running = state.agent?.running && state.agent.kind === 'author';
  zone.innerHTML = `
    <h1>Ready to create your test.</h1>
    <p class="why">Here's what the agent will build. When you press the button it writes the test,
    checks it, and gives it one careful trial run — usually a few minutes. You can watch it work.</p>
    <dl class="review">
      <div><dt>Project</dt><dd>${esc(cfg.team)}</dd></div>
      <div><dt>Environment</dt><dd>${esc(envLabel(cfg.env) || '—')}</dd></div>
      <div><dt>Test</dt><dd>${isApi ? 'API benchmark' : 'Browser journey'}</dd></div>
      <div><dt>${isApi ? 'API address' : 'Starting page'}</dt><dd>${esc(isApi ? cfg.api.url : cfg.browser.url)}</dd></div>
      ${isApi ? '' : `<div><dt>Journey</dt><dd>${esc(cfg.browser.journey)}</dd></div>`}
      <div><dt>Sign-in</dt><dd>${cfg.login.required ? (cfg.login.credsSet ? 'yes — test account saved' : 'yes — account to be added later') : 'not needed'}</dd></div>
    </dl>
    <div id="agentzone"></div>`;
  agentPanel($('#agentzone', zone), {
    kind: 'author',
    startLabel: stage.done ? 'Create it again' : 'Create my test',
    doneText: 'Your test is ready.',
    alreadyDone: stage.done && !running ? `The test exists — ${esc(`workbench/${cfg.team}/${isApi ? 'api-benchmark' : 'browser-journey'}/script.js`)}` : null,
  });
}

function renderBenchmark(zone, stage) {
  const r = state.results;
  zone.innerHTML = `
    <h1>${r ? 'Your red line is set.' : 'Time for the first real run.'}</h1>
    <p class="why">${r
      ? 'These numbers come from a real 10-round run against staging. If a future run crosses a red line, that\'s the signal something got slower.'
      : 'The agent runs your test ten times against staging and uses the results to set your red line — the number that, when crossed in the future, means something got slower and your team should look.'}</p>
    <div id="results">${r ? resultCards(r) : ''}</div>
    <div id="agentzone"></div>
    ${r ? '' : `<p class="cdetail" style="margin-top:16px">
      <button class="fbtn" id="skipbench">Skip for now</button>
      Your test is saved either way. Without this run there's no red line yet, so the test stays
      out of <b>Run &amp; judge</b> — come back to this step whenever you're ready.
    </p>`}`;
  agentPanel($('#agentzone', zone), {
    kind: 'benchmark',
    startLabel: r ? 'Run it again' : 'Run the first benchmark',
    doneText: 'Benchmark complete — red line saved.',
    alreadyDone: null,
  });
  $('#skipbench', zone)?.addEventListener('click', async (e) => {
    e.target.disabled = true;
    try { setState(await api('/api/skip-benchmark', {})); goto(cursor + 1, true); }
    catch (err) { e.target.disabled = false; $('#naverr').textContent = err.message; }
  });
}

function resultCards(r) {
  // Pull the friendly bits out of the technical seeding note, e.g.
  // "10-iteration real run 2026-06-11 — p95=680ms; threshold = max(1000, 680*1.2)=1000ms (API floor rule)"
  const src = r.source || '';
  const observed = (src.match(/p95\s*=\s*(\d+)\s*ms/i) || [])[1] || null;   // "680"
  const ran = (src.match(/\b(\d{4}-\d{2}-\d{2})\b/) || [])[1] || r.updated || null;
  const floored = /floor rule/i.test(src);                                   // red line came from the safety floor, not the measurement

  return `
    <div class="resultgrid">
      ${r.endpoints.map((e) => `
        <div class="result">
          <div class="rname">${esc(e.name || e.metric)}</div>
          <div class="rnum">${esc(String(e.p95_red_ms))}<span> ms</span></div>
          <div class="rcap">the red line — if it gets slower than this, your team should look</div>
        </div>`).join('')}
    </div>
    <p class="why" style="margin-top:18px">
      ${observed ? `In this run, your slowest responses landed around <b>${esc(observed)} ms</b> (a bit over half a second). ` : ''}
      ${floored
        ? `That's well within normal, so we set the red line at a comfortable <b>1 second</b> — a sensible starting point that won't cry wolf over tiny day-to-day wobbles.`
        : `We set the red line a little above that, so normal variation stays quiet and only a real slowdown raises a flag.`}
    </p>
    <p class="cdetail" style="margin-top:6px">
      Measured over 10 real runs against staging${ran ? ` on ${esc(ran)}` : ''}. You can re-run this anytime to get a fresh reading.
    </p>`;
}

function renderDone(zone) {
  const cfg = state.config;
  const profile = cfg.path === 'browser' ? 'browser-journey' : 'api-benchmark';
  const noBaseline = !state.results; // finished via "Skip for now" — script exists, red line doesn't
  const handoff = `Hi! Our team (${cfg.team}) now has a k6 performance test, created via the RedLine perf-eng agent.\n\n- Test script:  workbench/${cfg.team}/${profile}/script.js   (in the RedLine repo)\n- Red line:     ${noBaseline ? 'not set yet — the first benchmark in the RedLine dashboard creates baselines/' + cfg.team + '.' + profile + '.json, and the CI gate needs it' : `baselines/${cfg.team}.${profile}.json`}\n- Next step:    wire the deterministic CI gate (report-only first) into our repo —\n  see .github/actions/run-k6-action/README.md in the RedLine repo.\n  It runs the same test on every merge and reports green/red. No AI involved in the gate.\n\nQuestions → #perf-alerts on Slack.`;
  zone.innerHTML = `
    <h1>You're set up${cfg.team ? ', ' + esc(cfg.team) : ''}.</h1>
    <p class="why">${noBaseline
      ? 'Your project has a working performance test. It has no red line yet — the first benchmark sets that, and until it runs the test stays out of Run &amp; judge.'
      : 'Your project has a working performance test and a red line. From here, two things are worth doing:'}</p>
    <ol class="dolist" style="margin-top:24px">
      <li>${noBaseline
        ? 'Set your red line when you have a few minutes — revisit the previous step and run the first benchmark. That is what unlocks Run &amp; judge, schedules, and the CI gate.'
        : 'Re-run the benchmark whenever you want a fresh reading — just revisit the previous step. Results and alerts for your team land in <b>#perf-alerts</b> on Slack.'}</li>
      <li>Have a developer wire the automatic check into your project's CI, so every merge gets a green/red verdict. Send them this:</li>
    </ol>
    <div class="block">
      <div class="blabel">Message for your tech lead</div>
      <pre>${esc(handoff)}<button class="copy" id="copyhandoff">copy</button></pre>
    </div>`;
  $('#copyhandoff', zone).addEventListener('click', (e) => {
    navigator.clipboard.writeText(handoff).then(() => {
      e.target.textContent = 'copied';
      e.target.classList.add('ok');
      setTimeout(() => { e.target.textContent = 'copy'; e.target.classList.remove('ok'); }, 1400);
    });
  });
}

// ── workflow 2 · run & judge ──────────────────────────────────────────

// ── the start fork · two suites (functional | performance) ───────────

function renderStart(zone) {
  const sel = state.config.suite;
  zone.innerHTML = `
    <h1>What do you want to check?</h1>
    <p class="why">RedLine runs two kinds of check on your app. Pick the one you care about now —
    you can set up the other whenever you like.</p>
    <div class="pathgrid">
      <button class="pathcard functional ${sel === 'functional' ? 'selected' : ''}" data-suite="functional">
        <div class="picon">${ICONS.func}</div>
        <div class="ptitle">Functional</div>
        <div class="pq">Does it work?</div>
        <div class="pdesc">Click through your app the way a real person would and catch anything broken —
        a button that does nothing, a form that won't submit, a page that fails to load. Built on Playwright.</div>
        <div class="pfoot"><span class="ptag">Playwright · functional</span><span class="parrow">${ICONS.arrow}</span></div>
      </button>
      <button class="pathcard performance ${sel === 'performance' ? 'selected' : ''}" data-suite="performance">
        <div class="picon">${ICONS.perf}</div>
        <div class="ptitle">Performance</div>
        <div class="pq">Is it fast?</div>
        <div class="pdesc">Measure how quickly your app responds and set a clear red line — the number that
        tells you the moment something got slower. Built on k6.</div>
        <div class="pfoot"><span class="ptag">k6 · performance</span><span class="parrow">${ICONS.arrow}</span></div>
      </button>
    </div>`;
  zone.querySelectorAll('.pathcard').forEach((b) => b.addEventListener('click', async () => {
    setState(await api('/api/suite', { suite: b.dataset.suite }));
    goto(1, true);
  }));
}

// Performance path · step 2 — set up a new test or run an existing one.
// ── functional path · wizard shell (build step wired in a later task) ─

function renderFuncIntro(zone) {
  zone.innerHTML = `
    <h1>Check that your app works.</h1>
    <p class="why">A functional test clicks through your app the way a real person would — signing in,
    filling a form, opening a page — and flags anything that's broken. No thresholds, no jargon: it either
    works or it doesn't. RedLine writes and runs it for you with <b>Playwright</b>.</p>
    <div class="note">Use your <b>staging / test environment</b> address — never production. Functional tests never run against production.</div>
    <ol class="dolist" style="margin-top:32px">
      <li>Tell RedLine where your app lives and what a successful journey looks like, in plain words.</li>
      <li>The agent turns your description into a Playwright test that repeats those steps and checks each one.</li>
      <li>Every run comes back a simple <b>pass</b> or <b>fail</b>, with a screenshot of anything that broke.</li>
    </ol>`;
}

function renderFuncDescribe(zone) {
  const f = state.config.func || {};
  zone.innerHTML = `
    <h1>Describe the journey to check.</h1>
    <p class="why">Tell RedLine where to start and what the user does, in plain words. The agent explores
    your app, turns each action into a Playwright test, and checks every step passes.</p>
    <div class="note">Use your <b>staging / test environment</b> address — never production.</div>
    <div class="field">
      <label>Your project</label>
      <input id="fteam" placeholder="e.g. demo-web" value="${esc(f.team)}" spellcheck="false" autocomplete="off" />
    </div>
    <div class="field">
      <label>Starting page</label>
      <input id="furl" placeholder="https://your-app.staging.example.com/" value="${esc(f.url)}" spellcheck="false" autocomplete="off" />
    </div>
    <div class="field">
      <label>The journey, step by step</label>
      <textarea id="fjourney" rows="5" placeholder="Sign in, open the dashboard, click 'Reports', check the chart appears.">${esc(f.journey)}</textarea>
    </div>
    <button class="confirm ${f.login?.required ? 'on' : ''}" id="flogin" type="button"><span class="box"></span><span>This page needs a sign-in</span></button>
    <div class="formerr" id="ferr"></div>`;
  const t = $('#flogin', zone);
  t?.addEventListener('click', () => t.classList.toggle('on'));

  stageSubmit = async () => {
    const body = {
      team: $('#fteam', zone).value.trim(),
      url: $('#furl', zone).value.trim(),
      journey: $('#fjourney', zone).value.trim(),
      loginRequired: $('#flogin', zone).classList.contains('on'),
    };
    try { setState(await api('/api/func', body)); return true; }
    catch (e) { $('#ferr', zone).textContent = e.message; return false; }
  };
  updateNext();
}

// Functional path · create — drives func-author (stops at the scope-review gate).
function renderFuncCreate(zone, stage) {
  const f = state.config.func || {};
  const running = state.agent?.running && state.agent.kind === 'func-author';
  zone.innerHTML = `
    <h1>Create your functional test.</h1>
    <p class="why">The agent opens your app in a real browser, walks the journey you described, and writes
    a Playwright test from what it sees. When it's done, your test is ready to run — right away.</p>
    <dl class="review">
      <div><dt>Project</dt><dd>${esc(f.team)}</dd></div>
      <div><dt>Starting page</dt><dd>${esc(f.url)}</dd></div>
      <div><dt>Journey</dt><dd>${esc(f.journey)}</dd></div>
      <div><dt>Sign-in</dt><dd>${f.login?.required ? 'yes' : 'not needed'}</dd></div>
    </dl>
    <div id="agentzone"></div>`;
  agentPanel($('#agentzone', zone), {
    kind: 'func-author',
    startLabel: stage.done ? 'Create it again' : 'Create my test',
    doneText: 'Your test is ready — head to the next step to run it.',
    // "done" here means a suite exists to run, in either envs/ (committed) or workbench/
    // (freshly authored) — see server funcSuite. Both are real, runnable suites.
    alreadyDone: stage.done && !running ? `Your test is ready — ${esc(`${f.team}/functional`)}` : null,
  });
}

// Functional path · first run — drives func-run-one (pass/fail, no baseline).
function renderFuncResults(zone, stage) {
  const l = state.funcRun?.latest;
  zone.innerHTML = `
    <h1>Run it and see.</h1>
    <p class="why">RedLine runs your functional test and comes back with a simple pass or fail. A failure is
    double-checked with a second run before anyone's alerted; a ticket is only ever drafted for your review,
    never filed automatically.</p>
    ${l ? funcVerdictBanner(l) : ''}
    ${l?.run_id ? `<p class="why"><a class="seclink" href="#runs/${encodeURIComponent(l.run_id)}">See the full run report →</a></p>` : ''}
    <div id="agentzone"></div>`;
  agentPanel($('#agentzone', zone), {
    kind: 'func-run',
    startLabel: stage.done ? 'Run it again' : 'Run the test',
    doneText: 'Run complete — see the verdict above.',
    alreadyDone: null,
  });
}

// Plain-language verdict banner for a functional-suite ledger record.
function funcVerdictBanner(l) {
  const v = l.overall_verdict;
  if (v === 'fail') {
    return `<div class="banner error">The run didn't complete: ${esc(l.summary_line || 'something stopped it before any test finished.')}</div>`;
  }
  const total = l.tests_total ?? '—', failed = l.failed ?? 0;
  if (v === 'green') {
    return `<div class="banner success">✓ All ${esc(String(total))} checks passed.</div>`;
  }
  // red — a flake is specifically a red the confirmation re-run cleared (green).
  const flake = l.confirm_verdict === 'green';
  if (flake) {
    return `<div class="banner">⚠ ${esc(String(failed))} of ${esc(String(total))} checks failed on the first run, but passed on the
      double-check — likely a one-off, not filed. ${esc(l.summary_line || '')}</div>`;
  }
  // Only claim corroboration when it actually happened (sources ≥ 2); an
  // uncorroborated or crashed-confirm red must not be sold as "confirmed".
  const corroborated = (l.sources ?? 0) >= 2;
  return `<div class="banner error">✗ ${esc(String(failed))} of ${esc(String(total))} checks failed${corroborated ? ' (confirmed on a second run)' : ''} —
    ${esc(l.summary_line || '')}${l.jira_draft ? ' A ticket draft is ready for your review.' : ''}</div>`;
}

const profileTitle = (p) => ({
  'api-benchmark': 'API benchmark test',
  'browser-journey': 'browser journey test',
  load: 'load test', stress: 'stress test', soak: 'soak test', spike: 'spike test',
}[p] || p);

const profileBlurb = (p) => ({
  'api-benchmark': 'API benchmark — how quickly the key endpoint answers, measured over 10 careful rounds.',
  'browser-journey': 'Browser journey — what a real person experiences, step by step, in a real browser.',
  load: 'Load test — the app under expected everyday traffic.',
  stress: 'Stress test — pushing past normal to find the breaking point.',
  soak: 'Soak test — hours of steady traffic to catch slow leaks.',
  spike: 'Spike test — a sudden burst of traffic, then recovery.',
}[p] || p);

function renderPick(zone) {
  const inv = state.inventory || [];
  if (!inv.length) {
    zone.innerHTML = `
      <h1>No tests to run yet.</h1>
      <p class="why">No team has both a test and a red line so far. Create a test first — once its
      first benchmark has run, it appears here to run and judge.</p>
      <button class="btn primary" id="pickcreate">＋ Create test</button>`;
    zone.querySelector('#pickcreate')?.addEventListener('click', () => { location.hash = '#create'; });
    return;
  }
  const sel = state.operate?.picked ? `${state.operate.team}|${state.operate.profile}` : '';
  zone.innerHTML = `
    <h1>Which test should we run?</h1>
    <p class="why">These are the tests that already have a red line. Pick one — the agent runs it and
    judges the result against that line.</p>
    <div class="choices">
      ${inv.map((i) => `
        <button class="choice ${sel === `${i.team}|${i.profile}` ? 'selected' : ''}" data-team="${esc(i.team)}" data-profile="${esc(i.profile)}">
          <div class="ctitle">${esc(i.team)} · ${esc(i.profile)}</div>
          <div class="cdesc">${esc(profileBlurb(i.profile))}</div>
          ${i.last
            ? `<div class="ctag" style="color:${i.last.verdict === 'green' ? 'var(--green)' : 'var(--red)'}">last run ${esc(i.last.verdict)} · ${esc(String(i.last.at || '').slice(0, 10))}</div>`
            : '<div class="ctag">never run</div>'}
        </button>`).join('')}
    </div>`;
  zone.querySelectorAll('.choice').forEach((b) => b.addEventListener('click', async () => {
    setState(await api('/api/pick', { team: b.dataset.team, profile: b.dataset.profile }));
  }));
}

function renderRun(zone) {
  const op = state.operate;
  if (!op?.picked) {
    zone.innerHTML = `<h1>Run &amp; judge.</h1><p class="why">Pick a test first (previous step).</p>`;
    return;
  }
  const last = op.latest;
  zone.innerHTML = `
    <h1>Run it and judge it.</h1>
    <p class="why">The agent runs <b>${esc(op.team)} · ${esc(op.profile)}</b> against staging and compares
    every number to the red line. If something looks slower, it automatically runs the whole test a second
    time to be sure, then asks an independent reviewer. Nothing is filed or sent without your approval —
    you get the verdict on the next page.</p>
    ${last ? `<div class="note">Last run: <b>${esc(last.overall_verdict || '')}</b> on ${esc(String(last.recorded_at || '').slice(0, 10))}${last.summary_line ? ' — ' + esc(last.summary_line) : ''}</div>` : ''}
    <div id="agentzone"></div>`;
  agentPanel($('#agentzone', zone), {
    kind: 'run',
    startLabel: last ? 'Run it again now' : 'Run it now',
    doneText: 'Run complete — see the verdict on the next page.',
    alreadyDone: null,
  });
}

function renderOutcome(zone) {
  const op = state.operate;
  const l = op?.latest;
  if (!l || !op.current) {
    zone.innerHTML = `
      <h1>No verdict yet.</h1>
      <p class="why">Run the test first (previous step) — the verdict lands here.${l
        ? ` For reference: the last recorded run of <b>${esc(op.team)} · ${esc(op.profile)}</b> was
           <b>${esc(l.overall_verdict || '')}</b> on ${esc(String(l.recorded_at || '').slice(0, 10))}.`
        : ''}</p>`;
    return;
  }
  const v = l.overall_verdict;
  // A flake is specifically a red whose confirmation re-run came back GREEN —
  // not merely "fewer than 2 sources" (a crashed or never-run confirm also has
  // sources < 2, and calling that "came back fine" is a lie). Matches runs-lib.
  const flake = v === 'red' && l.confirm_verdict === 'green';
  const date = String(l.recorded_at || '').slice(0, 10);

  const cards = `
    <div class="resultgrid">
      ${(l.endpoints || []).map((e) => `
        <div class="result">
          <div class="rname">${esc(e.name || e.metric)}</div>
          <div class="rnum" style="color:${e.verdict === 'red' ? 'var(--red)' : 'var(--green)'}">${esc(String(e.p95_ms ?? '—'))}<span> ms</span></div>
          <div class="rcap">red line ${esc(String(e.p95_red_ms ?? '—'))} ms — ${e.verdict === 'red' ? 'over the line' : 'comfortably under'}</div>
        </div>`).join('')}
    </div>`;

  const seal = (tone, icon) => `<div class="seal ${tone}">${icon}</div>`;
  const icons = {
    check: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6L9 17l-5-5"></path></svg>',
    wave: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M3 12c2.5-5 5.5-5 8 0s5.5 5 8 0"></path></svg>',
    halt: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="9"></circle><path d="M5.6 5.6l12.8 12.8"></path></svg>',
    rise: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 17l6-6 4 4 7-8"></path><path d="M14 7h6v6"></path></svg>',
  };

  if (v === 'green') {
    zone.innerHTML = `
      ${seal('green', icons.check)}
      <h1>All clear.</h1>
      <p class="why">The run on ${esc(date)} stayed under the red line. Nothing to do — come back
      any time for a fresh reading.</p>
      ${cards}
      ${op.latest?.run_id ? `<p class="why"><a class="seclink" href="#runs/${encodeURIComponent(op.latest.run_id)}">See the full run report →</a></p>` : ''}`;
    return;
  }

  if (flake) {
    zone.innerHTML = `
      ${seal('brass', icons.wave)}
      <h1>A wobble, not a slowdown.</h1>
      <p class="why">The first run on ${esc(date)} crossed the red line, so the agent automatically ran the
      whole test again to double-check — and the second run came back fine. One bad reading out of two is
      treated as noise: nothing is escalated, nobody is paged. Worth a re-run tomorrow.</p>
      ${cards}
      ${op.latest?.run_id ? `<p class="why"><a class="seclink" href="#runs/${encodeURIComponent(op.latest.run_id)}">See the full run report →</a></p>` : ''}`;
    return;
  }

  if (v !== 'red') {
    zone.innerHTML = `
      ${seal('', icons.halt)}
      <h1>The run didn't finish.</h1>
      <p class="why">The test stopped before producing a verdict (recorded as "${esc(v || 'fail')}" on
      ${esc(date)}). That's a problem with the test or the environment — not proof of a slowdown.
      Try running it again; if it keeps failing, ask in #perf-alerts on Slack.</p>`;
    return;
  }

  const g = op.gates || {};
  const gateRow = (cls, label, detail) => `
    <div class="checkrow">
      <span class="dot ${cls}"></span>
      <span class="checktext">
        <span class="cdesc">${esc(label)}</span>
        <span class="cdetail">${esc(detail)}</span>
      </span>
    </div>`;

  // Strip internal instructions from the draft before showing it to the user
  const cleanDraft = (raw) => raw
    .split('\n')
    .filter((ln) => !/^\s*h[23]\.\s*(Action required|Human review required)/i.test(ln)
                 && !/Route to reviewer subagent/i.test(ln)
                 && !/Human review required/i.test(ln))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  // Inject the actual URL into the draft if it's missing
  const enrichDraft = (raw, entry) => {
    const url = entry?.endpoints?.[0] ? null : null; // URL comes from baseline, not ledger
    // Find the Failing endpoints table and make sure endpoint name is there (it is), done.
    return cleanDraft(raw);
  };

  // The final call: a ticket is created only when every gate passes —
  // confirmed twice AND the independent reviewer signed off AND a draft exists.
  const createTicket = g.sources >= 2 && g.reviewer === 'SIGN_OFF' && g.draftReady;
  const verdictBanner = createTicket
    ? `<div class="banner error" style="margin-top:26px;font-size:16px"><b>Verdict: Create a ticket.</b>
       Every check passed — this is a real slowdown. The ticket below is ready to file.</div>`
    : g.reviewer === 'REJECT'
    ? `<div class="banner success" style="margin-top:26px;font-size:16px"><b>Verdict: Do not create a ticket.</b>
       The independent reviewer looked at the raw evidence and judged this not worth filing. No ticket will be created.</div>`
    : `<div class="note"><b>Verdict pending.</b> Not every check has passed yet — see below for what's missing.</div>`;

  zone.innerHTML = `
    ${seal('red', icons.rise)}
    <h1>Something got slower.</h1>
    <p class="why">The run on ${esc(date)} crossed the red line — and a second run confirmed it.</p>
    ${cards}
    ${op.latest?.run_id ? `<p class="why"><a class="seclink" href="#runs/${encodeURIComponent(op.latest.run_id)}">See the full run report →</a></p>` : ''}
    ${verdictBanner}
    <div class="gates">
      <div class="blabel">How the verdict was reached</div>
      ${gateRow(g.sources >= 2 ? 'pass' : 'fail', 'Confirmed twice',
        g.sources >= 2 ? 'Two separate runs both crossed the red line — this is not a fluke.' : `Only ${g.sources || 1} of 2 runs crossed the line — confirmation needed.`)}
      ${gateRow(g.reviewer === 'SIGN_OFF' ? 'pass' : g.reviewer === 'REJECT' ? 'fail' : '', 'Independent reviewer',
        g.reviewer === 'SIGN_OFF' ? 'Signed off — confirmed this is a real slowdown worth a ticket.'
        : g.reviewer === 'REJECT' ? 'Reviewer said this slowdown is within normal variation — no ticket needed.'
        : 'Reviewer has not made a decision yet.')}
      ${gateRow(g.draftReady ? 'pass' : 'fail', 'Ticket draft ready',
        g.draftReady ? (createTicket ? 'The draft below is ready to file.' : 'A draft was prepared, but it only matters if the reviewer signs off.')
        : 'No draft yet — run the test again to generate one.')}
    </div>
    ${createTicket && op.draft ? `<div class="block"><div class="blabel">The ticket that will be filed</div><pre>${esc(enrichDraft(op.draft, l))}</pre></div>` : ''}
    <div id="filezone"></div>`;

  const fz = $('#filezone', zone);
  if (g.filed) {
    fz.innerHTML = `<div class="banner success">✓ Ticket ${esc(g.jiraKey || '')} is filed and the team has been alerted in Slack.</div>`;
  } else if (op.fileable && createTicket) {
    agentPanel(fz, {
      kind: 'file',
      startLabel: 'File the ticket & alert the team',
      doneText: 'Ticket filed — the team has been alerted in Slack.',
      alreadyDone: null,
    });
  } else if (op.overrideable) {
    // Reviewer said no, but a human may overrule — explicitly, per draft, on the record.
    const showOverridePanel = () => {
      fz.innerHTML = `
        <div class="note" style="margin-top:26px"><b>Overruling the reviewer.</b> The independent reviewer
          recommended against this ticket. Filing it anyway is allowed, but it is recorded as a human
          override — both in the ticket text and in this run's record. This is the ticket that will be filed:</div>
        ${op.draft ? `<div class="block"><div class="blabel">The ticket that will be filed (human override)</div><pre>${esc(enrichDraft(op.draft, l))}</pre></div>` : ''}
        <div id="overridezone"></div>`;
      agentPanel($('#overridezone', fz), {
        kind: 'file-override',
        startLabel: 'Yes — file it anyway & alert the team',
        doneText: 'Ticket filed on your override — the team has been alerted in Slack.',
        alreadyDone: null,
      });
    };
    if (state.agent?.kind === 'file-override' && state.agent.running) {
      showOverridePanel();
    } else {
      fz.innerHTML = `
        <div class="overriderow">
          <button class="btn" id="overridebtn">Create a ticket anyway</button>
          <span class="overridehint">overrules the independent reviewer — recorded as a human override</span>
        </div>`;
      $('#overridebtn', fz).addEventListener('click', showOverridePanel);
    }
  } else if (!createTicket && g.reviewer !== 'REJECT') {
    fz.innerHTML = `<div class="locked">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><rect x="4.5" y="10.5" width="15" height="9.5" rx="2"></rect><path d="M8 10.5V7a4 4 0 0 1 8 0v3.5"></path></svg>
      <span>Filing stays <b>locked</b> until every check above passes.
      Run the test again to regenerate what's missing.</span></div>`;
  }
}

// ── the live agent panel (shared by create / benchmark) ──────────────

function agentPanel(zone, { kind, startLabel, doneText, alreadyDone }) {
  const resumable = state.agent?.kind === kind && state.agent.running;
  zone.innerHTML = `
    ${alreadyDone && !resumable ? `<div class="banner success">✓ ${alreadyDone}</div>` : ''}
    <div class="agentrow">
      <button class="btn primary big" id="go" ${resumable ? 'disabled' : ''}>${resumable ? 'Working…' : esc(startLabel)}</button>
      <button class="btn" id="stop" style="display:${resumable ? 'inline-block' : 'none'}">Stop</button>
    </div>
    <div class="console" id="feed" aria-live="polite" style="display:${resumable ? 'block' : 'none'}"></div>
    <div id="outcome"></div>`;

  const feed = $('#feed', zone);
  const line = (t, text) => {
    const d = document.createElement('div');
    d.className = `fl ${t}`;
    d.textContent = text;
    feed.appendChild(d);
    feed.scrollTop = feed.scrollHeight;
  };

  const setRunning = (on) => {
    const go = $('#go', zone);
    if (on) {
      go.classList.add('working');
      document.getElementById('bar')?.classList.add('busy');
    } else {
      go.classList.remove('working');
      document.getElementById('bar')?.classList.remove('busy');
    }
  };

  const connect = () => {
    feed.style.display = 'block';
    const go = $('#go', zone);
    go.disabled = true;
    go.textContent = 'Working…';
    setRunning(true);
    $('#stop', zone).style.display = 'inline-block';
    if (state.agent) state.agent.running = true; // keep Next gated while the agent works
    updateNext();

    // status strip above the console
    const strip = document.createElement('div');
    strip.className = 'agentrunning';
    strip.id = 'agentstrip';
    strip.innerHTML = '<span class="pulse"></span><span>Agent is working — this can take a few minutes, stay on this page.</span>';
    feed.before(strip);

    es?.close();
    es = new EventSource('/api/agent/stream');
    es.onmessage = async (m) => {
      const ev = JSON.parse(m.data);
      if (ev.t === 'end') {
        es.close();
        setRunning(false);
        document.getElementById('agentstrip')?.remove();
        await refresh();
        const ok = ev.ok;
        let endMsg;
        if (kind === 'run') {
          // for runs, the verdict is on the next page — just show pass/fail of the run itself
          const verdict = state?.operate?.latest?.overall_verdict;
          const verdictLabel = verdict === 'green' ? '🟢 passed — the results are on the next page.'
            : verdict === 'red' ? '🔴 found a slowdown — see the verdict on the next page.'
            : ok ? 'complete — see the verdict on the next page.'
            : null;
          endMsg = `<div class="banner ${ok ? 'success' : 'error'}">${ok ? '✓ Run ' + (verdictLabel || 'complete — see the verdict on the next page.') : '✗ ' + esc(ev.text || 'The run didn\'t complete.') + ' — try again or ask in #perf-alerts.'}</div>`;
        } else if (kind === 'func-run') {
          // functional run finished on this same page — show the plain-language verdict directly
          const l = state?.funcRun?.latest;
          const v = l?.overall_verdict;
          const verdictLabel = v === 'green' ? `🟢 passed — all ${esc(String(l.tests_total ?? ''))} checks passed.`
            : v === 'red' ? `🔴 ${esc(String(l.failed ?? ''))} of ${esc(String(l.tests_total ?? ''))} checks failed — see the verdict above.`
            : v === 'fail' ? null
            : ok ? 'complete — see the verdict above.'
            : null;
          endMsg = `<div class="banner ${ok && v !== 'fail' ? 'success' : 'error'}">${ok && v !== 'fail' ? '✓ Run ' + (verdictLabel || 'complete — see the verdict above.') : '✗ ' + esc(l?.summary_line || ev.text || 'The run didn\'t complete.') + ' — try again or ask in #perf-alerts.'}</div>`;
        } else {
          endMsg = `<div class="banner ${ok ? 'success' : 'error'}">${ok ? '✓ ' + esc(doneText) : '✗ ' + esc(ev.text || 'That didn\'t work.')}${ok ? '' : ' — you can adjust your answers and try again.'}</div>`;
        }
        const out = $('#outcome', document);
        if (out) out.innerHTML = endMsg; // user may have navigated away before 'end'
        return;
      }
      line(ev.t, (ev.t === 'tool' ? '· ' : '') + ev.text);
    };
    es.onerror = () => {
      // Connection dropped without an 'end' — restore the panel to an idle,
      // retryable state instead of leaving it stuck on a disabled "Working…".
      setRunning(false);
      document.getElementById('agentstrip')?.remove();
      const go = $('#go', zone);
      if (go) { go.disabled = false; go.textContent = startLabel; }
      if (state?.agent) state.agent.running = false;
      updateNext();
      es.close();
    };
  };

  $('#go', zone).addEventListener('click', async () => {
    feed.innerHTML = '';
    $('#outcome', zone).innerHTML = '';
    try { await api('/api/agent/start', { kind }); connect(); }
    catch (e) { $('#outcome', zone).innerHTML = `<div class="banner error">✗ ${esc(e.message)}</div>`; }
  });
  $('#stop', zone).addEventListener('click', () => api('/api/agent/cancel', {}).catch(() => {}));

  if (resumable) connect();
}

// ── keyboard + boot ──────────────────────────────────────────────────

document.addEventListener('keydown', (e) => {
  if (!inWizard()) return;
  if (!state) return; // ArrowLeft before the first state fetch would throw in goto()
  if (['INPUT', 'TEXTAREA'].includes(e.target.tagName)) return;
  if (e.key === 'ArrowRight') $('#next')?.click();
  if (e.key === 'ArrowLeft') goto(cursor - 1);
});

window.addEventListener('focus', () => {
  if (!inWizard()) return;
  if (state && !state.agent?.running) refresh(true).catch(() => {});
});

export async function initWizard(el) {
  mount = el;
  if (!state) { state = await api('/api/state'); cursor = firstOpen(); }
  // Run-test nav: #run (pick a test) or #run/<team>/<profile> (a specific test).
  // Enters the operate flow directly; the stage floor hides the fork steps so it
  // reads as its own page. The hash normalizes to #run so the nav stays lit.
  if (isRunNav()) {
    const rm = location.hash.match(/^#run\/([^/]+)\/([^/]+)$/);
    if (rm) history.replaceState(null, '', '#run');
    try {
      state = await api('/api/mode', { mode: 'operate' }); // also sets suite=performance
      if (rm) {
        state = await api('/api/pick', { team: decodeURIComponent(rm[1]), profile: decodeURIComponent(rm[2]) });
        cursor = idxStage('run');
      } else {
        cursor = idxStage(state.operate?.picked ? 'run' : 'pick');
      }
    } catch {
      cursor = idxStage('pick'); // test not runnable — land on the picker
    }
    render();
    refresh(true).catch(() => {});
    return;
  }
  // Create test authors a NEW test now — running an existing one is the separate
  // Run test (#run) page. If the config carries a leftover operate mode (e.g. the
  // user just came from Run test), flip it back to onboard so #create never
  // resurfaces the run flow.
  if (location.hash.startsWith('#create') && state.config.mode === 'operate') {
    state = await api('/api/mode', { mode: 'onboard' });
    cursor = firstOpen();
  }
  render();
  refresh(true).catch(() => {}); // pick up server-side changes since last visit
}
