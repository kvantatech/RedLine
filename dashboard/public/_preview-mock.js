// RedLine — PREVIEW-ONLY mock of server.mjs (fetch + EventSource).
// Not part of the deliverable. Lets the redesign be reviewed without
// running `node dashboard/server.mjs`. Delete freely.
(() => {
  'use strict';
  const KEY = 'redline-preview-scenario';
  const SCENARIOS = {
    'w1-fresh':       'W1 · Start (nothing chosen)',
    'w1-team':        'W1 · Ready checks → team name',
    'w1-describe':    'W1 · Describe the journey',
    'w1-create':      'W1 · Review + create my test',
    'w1-results':     'W1 · Benchmark results + handoff',
    'w2-pick':        'W2 · Pick a test',
    'w2-run':         'W2 · Run & judge',
    'w2-green':       'W2 · Verdict: all clear',
    'w2-flake':       'W2 · Verdict: a wobble',
    'w2-crash':       'W2 · Verdict: run didn’t finish',
    'w2-red-pending': 'W2 · Verdict: red, gates pending (locked)',
    'w2-red-ready':   'W2 · Verdict: red, ready to file',
    'w2-filed':       'W2 · Verdict: red, ticket filed',
  };
  const scenario = SCENARIOS[localStorage.getItem(KEY)] ? localStorage.getItem(KEY) : 'w1-fresh';

  const CHECKS = {
    claude: { pass: true, detail: 'claude 2.1.4 — found on this computer' },
    k6: { pass: true, detail: 'k6 v0.57.0 — found on this computer' },
    submodules: { pass: true, detail: 'drafts/, live/, baselines/ — all present' },
  };
  const INVENTORY = [
    { team: 'demo-web', profile: 'browser-journey', last: { verdict: 'green', at: '2026-06-10T18:02:11Z' } },
    { team: 'demo-web', profile: 'api-benchmark', last: { verdict: 'red', at: '2026-06-08T09:41:55Z' } },
    { team: 'search-platform', profile: 'api-benchmark', last: null },
  ];
  const RESULTS = {
    endpoints: [{ name: 'home_to_dashboard', metric: 'p95', p95_red_ms: 1000 }],
    source: '10-iteration real run 2026-06-11 — p95=680ms; threshold = max(1000, 680*1.2)=1000ms (API floor rule)',
    updated: '2026-06-11',
  };
  const EP_GREEN = [
    { name: 'login_submit', p95_ms: 412, p95_red_ms: 1000, verdict: 'green' },
    { name: 'dashboard_load', p95_ms: 688, p95_red_ms: 1200, verdict: 'green' },
  ];
  const EP_RED = [
    { name: 'login_submit', p95_ms: 455, p95_red_ms: 1000, verdict: 'green' },
    { name: 'dashboard_load', p95_ms: 1480, p95_red_ms: 1200, verdict: 'red' },
  ];
  const DRAFT = `h1. Performance regression — demo-web · browser-journey\n\n*Summary:* the dashboard_load step is 23% over its red line, confirmed across two independent runs on 2026-06-12.\n\n||Step||p95||Red line||Verdict||\n|login_submit|455 ms|1000 ms|GREEN|\n|dashboard_load|1480 ms|1200 ms|RED|\n\n*Evidence:* state/perf-run-log/2026-06-12-demo-web-browser-journey.json (runs #1 and #2), reviewer sign-off attached.\n*Environment:* staging (https://demo-web.staging.example.com) — STG only, per policy.\n*Suggested owner:* demo-web`;

  function freshCfg() {
    return {
      mode: '', team: '', path: '',
      api: { url: '' }, browser: { url: '', journey: '' },
      login: { required: false, credsSet: false },
    };
  }
  function freshOp() {
    return { picked: false, team: '', profile: '', current: false, latest: null, gates: {}, draft: null, fileable: false };
  }

  // ── scenario setup ──────────────────────────────────────────────
  const S = { cfg: freshCfg(), op: freshOp(), results: null, created: false, agent: null };
  {
    const c = S.cfg, o = S.op;
    const w2 = (latest, gates, extra = {}) => {
      c.mode = 'operate';
      Object.assign(o, { picked: true, team: 'demo-web', profile: 'browser-journey', current: true, latest, gates }, extra);
    };
    switch (scenario) {
      case 'w1-team': c.mode = 'onboard'; break;
      case 'w1-describe': c.mode = 'onboard'; c.team = 'demo-web'; c.path = 'browser'; break;
      case 'w1-create':
        c.mode = 'onboard'; c.team = 'demo-web'; c.path = 'browser';
        c.browser.url = 'https://demo-web.staging.example.com/';
        c.browser.journey = "Log in, open the dashboard, click 'Reports', wait for the chart to appear.";
        c.login.required = true; c.login.credsSet = true;
        break;
      case 'w1-results':
        c.mode = 'onboard'; c.team = 'demo-web'; c.path = 'browser';
        c.browser.url = 'https://demo-web.staging.example.com/';
        c.browser.journey = "Log in, open the dashboard, click 'Reports', wait for the chart to appear.";
        c.login.required = true; c.login.credsSet = true;
        S.created = true; S.results = RESULTS;
        break;
      case 'w2-pick': c.mode = 'operate'; break;
      case 'w2-run': c.mode = 'operate'; Object.assign(o, { picked: true, team: 'demo-web', profile: 'browser-journey' }); break;
      case 'w2-green':
        w2({ overall_verdict: 'green', recorded_at: '2026-06-12T09:14:00Z', sources: 1, endpoints: EP_GREEN, summary_line: 'all steps comfortably under the line' }, {});
        break;
      case 'w2-flake':
        w2({ overall_verdict: 'red', recorded_at: '2026-06-12T09:14:00Z', sources: 1, endpoints: EP_RED, summary_line: 'second run came back clean' }, { sources: 1 });
        break;
      case 'w2-crash':
        w2({ overall_verdict: 'fail', recorded_at: '2026-06-12T09:14:00Z', sources: 0, endpoints: [] }, {});
        break;
      case 'w2-red-pending':
        w2({ overall_verdict: 'red', recorded_at: '2026-06-12T09:14:00Z', sources: 2, endpoints: EP_RED, summary_line: 'dashboard_load over the line twice' },
          { sources: 2, reviewer: null, draftReady: false });
        break;
      case 'w2-red-ready':
        w2({ overall_verdict: 'red', recorded_at: '2026-06-12T09:14:00Z', sources: 2, endpoints: EP_RED, summary_line: 'dashboard_load over the line twice' },
          { sources: 2, reviewer: 'SIGN_OFF', draftReady: true }, { draft: DRAFT, fileable: true });
        break;
      case 'w2-filed':
        w2({ overall_verdict: 'red', recorded_at: '2026-06-12T09:14:00Z', sources: 2, endpoints: EP_RED, summary_line: 'dashboard_load over the line twice' },
          { sources: 2, reviewer: 'SIGN_OFF', draftReady: true, filed: true, jiraKey: 'PERF-218' }, { draft: DRAFT });
        break;
    }
  }

  // ── state builder (mirrors server.mjs buildState) ───────────────
  const START = { id: 'start', title: 'Start' };
  const ONBOARD = [START,
    { id: 'ready', title: 'Before we start' }, { id: 'team', title: 'Your team' },
    { id: 'path', title: 'Pick your test' }, { id: 'describe', title: 'What to test' },
    { id: 'create', title: 'Create the test' }, { id: 'benchmark', title: 'First results' },
    { id: 'done', title: "What's next" }];
  const OPERATE = [START,
    { id: 'ready', title: 'Before we start' }, { id: 'pick', title: 'Pick a test' },
    { id: 'run', title: 'Run & judge' }, { id: 'outcome', title: 'The verdict' }];
  const stagesFor = (m) => m === 'operate' ? OPERATE : m === 'onboard' ? ONBOARD : [START];

  function describeDone(cfg) {
    if (cfg.path === 'api') return !!cfg.api.url;
    if (cfg.path === 'browser') return !!cfg.browser.url && cfg.browser.journey.length >= 10;
    return false;
  }
  function buildState() {
    const { cfg, op } = { cfg: S.cfg, op: S.op };
    const v = op.latest?.overall_verdict;
    const flake = v === 'red' && (op.latest?.sources ?? 0) < 2;
    const outcomeDone = !!op.current && (v === 'green' || flake || !!op.gates?.filed || op.gates?.reviewer === 'REJECT');
    const doneById = {
      start: !!cfg.mode, ready: true, team: !!cfg.team, path: !!cfg.path,
      describe: describeDone(cfg), create: S.created, benchmark: !!S.results, done: !!S.results,
      pick: !!op.picked, run: !!op.current, outcome: outcomeDone,
    };
    return {
      config: cfg, checks: CHECKS,
      stages: stagesFor(cfg.mode).map((s) => ({ ...s, done: !!doneById[s.id] })),
      results: S.results, inventory: INVENTORY, operate: op,
      agent: S.agent ? { kind: S.agent.kind, running: S.agent.running, ok: S.agent.ok, events: 0 } : null,
    };
  }

  // ── agent scripts per kind ──────────────────────────────────────
  const SCRIPTS = {
    author: [
      ['info', 'starting Claude Code (headless) — authoring a browser-journey test for demo-web'],
      ['tool', 'Read live/demo-web/browser-journey/script.js'],
      ['text', 'Following the canonical example: per-vu-iterations, 1 VU, 10 iterations, one Trend per step.'],
      ['tool', 'Write drafts/demo-web/browser-journey/script.js'],
      ['tool', 'Bash(k6 inspect drafts/demo-web/browser-journey/script.js)'],
      ['text', 'Script validates. Giving it one careful trial run against staging…'],
      ['tool', 'Bash(k6 run --vus 1 --iterations 1 …)'],
      ['text', 'Trial run passed — login_submit 431ms, dashboard_load 702ms. Test is ready.'],
    ],
    benchmark: [
      ['info', 'starting Claude Code (headless) — 10-round benchmark for demo-web · browser-journey'],
      ['tool', 'Bash(k6 run --iterations 10 drafts/demo-web/browser-journey/script.js)'],
      ['text', 'Round 1–10 complete. p95: dashboard_load 680ms, login_submit 402ms.'],
      ['tool', 'Write baselines/demo-web.browser-journey.json'],
      ['text', 'Red line set: max(1000, 680×1.2) = 1000ms (API floor rule). Saved.'],
    ],
    run: [
      ['info', 'starting Claude Code (headless) — run & judge demo-web · browser-journey'],
      ['tool', 'Bash(k6 run drafts/demo-web/browser-journey/script.js)'],
      ['text', 'Run complete. Comparing every step to the red line…'],
      ['tool', 'Read baselines/demo-web.browser-journey.json'],
      ['text', 'All steps under the line. Recording the verdict.'],
      ['tool', 'Write state/perf-run-log/2026-06-12-demo-web-browser-journey.json'],
    ],
    file: [
      ['info', 'starting Claude Code (headless) — filing the reviewed ticket'],
      ['tool', 'mcp__jira · create_issue (project PERF)'],
      ['text', 'Created PERF-218.'],
      ['tool', 'Bash(curl https://hooks.slack.com/… #perf-alerts)'],
      ['text', 'Team alerted in #perf-alerts.'],
    ],
  };

  function applyEffects(kind) {
    if (kind === 'author') S.created = true;
    if (kind === 'benchmark') S.results = RESULTS;
    if (kind === 'run') {
      S.op.current = true;
      if (!S.op.latest) S.op.latest = { overall_verdict: 'green', recorded_at: '2026-06-12T10:05:00Z', sources: 1, endpoints: EP_GREEN, summary_line: 'all steps comfortably under the line' };
    }
    if (kind === 'file') { S.op.gates.filed = true; S.op.gates.jiraKey = 'PERF-218'; }
  }

  // ── fetch mock ──────────────────────────────────────────────────
  const ok = (body) => Promise.resolve(new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } }));
  const bad = (error) => Promise.resolve(new Response(JSON.stringify({ error }), { status: 400, headers: { 'content-type': 'application/json' } }));

  const realFetch = window.fetch.bind(window);
  window.fetch = (input, init) => {
    const url = typeof input === 'string' ? input : input.url;
    if (!url.startsWith('/api/')) return realFetch(input, init);
    const body = init?.body ? JSON.parse(init.body) : {};
    const path = url.split('?')[0];

    if (path === '/api/state') return ok(buildState());
    if (path === '/api/mode') { S.cfg.mode = body.mode; return ok(buildState()); }
    if (path === '/api/team') {
      const team = String(body.team || '').trim().toLowerCase();
      if (!/^[a-z0-9][a-z0-9-]{1,30}$/.test(team)) return bad('use letters, numbers and dashes — e.g. demo-web');
      S.cfg.team = team; return ok(buildState());
    }
    if (path === '/api/path') { S.cfg.path = body.path; return ok(buildState()); }
    if (path === '/api/describe') {
      const u = String(body.url || '').trim();
      if (!/^https?:\/\//.test(u)) return bad('that does not look like a web address — it should start with https://');
      if (S.cfg.path === 'api') S.cfg.api.url = u;
      else {
        S.cfg.browser.url = u;
        S.cfg.browser.journey = String(body.journey || '').trim();
        if (S.cfg.browser.journey.length < 10) return bad('describe the journey in a sentence or two — what should the user do?');
      }
      S.cfg.login.required = !!body.loginRequired;
      if (S.cfg.login.required && body.username && body.password) S.cfg.login.credsSet = true;
      return ok(buildState());
    }
    if (path === '/api/pick') { Object.assign(S.op, { picked: true, team: body.team, profile: body.profile }); return ok(buildState()); }
    if (path === '/api/agent/start') {
      if (S.agent?.running) return bad('the agent is already working');
      S.agent = { kind: body.kind, running: true, ok: null };
      return ok({ started: true });
    }
    if (path === '/api/agent/cancel') {
      if (S.agent) S.agent.cancel = true;
      return ok({ ok: true });
    }
    return bad('unknown endpoint: ' + path);
  };

  // ── EventSource mock ────────────────────────────────────────────
  window.EventSource = class {
    constructor(url) {
      this.onmessage = null; this.onerror = null;
      this._timers = [];
      const job = S.agent;
      if (!job) return;
      const lines = SCRIPTS[job.kind] || SCRIPTS.run;
      let t = 400;
      lines.forEach(([type, text]) => {
        this._timers.push(setTimeout(() => {
          if (job.cancel) return;
          this.onmessage?.({ data: JSON.stringify({ t: type, text }) });
        }, t));
        t += 550 + Math.random() * 450;
      });
      this._timers.push(setTimeout(() => {
        job.running = false;
        if (job.cancel) {
          job.ok = false;
          this.onmessage?.({ data: JSON.stringify({ t: 'end', ok: false, text: 'Stopped at your request' }) });
        } else {
          job.ok = true;
          applyEffects(job.kind);
          this.onmessage?.({ data: JSON.stringify({ t: 'end', ok: true }) });
        }
      }, t + 300));
      // honor cancel quickly
      const poll = setInterval(() => {
        if (job.cancel && job.running) {
          job.running = false; job.ok = false;
          this._timers.forEach(clearTimeout);
          this.onmessage?.({ data: JSON.stringify({ t: 'end', ok: false, text: 'Stopped at your request' }) });
          clearInterval(poll);
        }
        if (!job.running) clearInterval(poll);
      }, 200);
      this._timers.push(poll);
    }
    close() { this._timers.forEach((t) => { clearTimeout(t); clearInterval(t); }); }
  };

  // ── scenario switcher chrome ────────────────────────────────────
  addEventListener('DOMContentLoaded', () => {
    const box = document.createElement('div');
    box.id = 'previewbox';
    box.style.cssText = 'position:fixed;bottom:14px;right:14px;z-index:99;display:flex;gap:8px;align-items:center;'
      + 'background:#16181c;border:1px solid rgba(255,255,255,.14);border-radius:10px;padding:8px 10px;'
      + 'font:12px "Segoe UI",sans-serif;color:#a7acb5;box-shadow:0 12px 32px -16px rgba(0,0,0,.6)';
    const isel = (opts, storageKey, cur) => {
      const s = document.createElement('select');
      s.style.cssText = 'background:#0e1013;color:#ece9e3;border:1px solid rgba(255,255,255,.14);border-radius:6px;padding:5px 8px;font:12px "Segoe UI",sans-serif;';
      for (const [v,n] of Object.entries(opts)) {
        const o = document.createElement('option');
        o.value=v; o.textContent=n; o.selected=(v===cur); s.appendChild(o);
      }
      s.addEventListener('change', () => { localStorage.setItem(storageKey, s.value); location.reload(); });
      return s;
    };
    const THEMES = { brass:'Brass (default)', canvas:'Canvas & Sienna', void:'Void & Ice' };
    const curTheme = localStorage.getItem('redline-theme') || 'brass';
    const tlabel = document.createElement('span');
    tlabel.textContent = 'theme';
    tlabel.style.cssText = 'text-transform:uppercase;letter-spacing:.14em;font-size:9.5px;color:#80868f';
    const sep = document.createElement('span');
    sep.textContent = '|';
    sep.style.cssText = 'color:rgba(255,255,255,.16)';
    const slabel = document.createElement('span');
    slabel.textContent = 'scenario';
    slabel.style.cssText = 'text-transform:uppercase;letter-spacing:.14em;font-size:9.5px;color:#80868f';
    box.appendChild(tlabel);
    box.appendChild(isel(THEMES, 'redline-theme', curTheme));
    box.appendChild(sep);
    box.appendChild(slabel);
    box.appendChild(isel(SCENARIOS, KEY, scenario));
    document.body.appendChild(box);
  });
})();
