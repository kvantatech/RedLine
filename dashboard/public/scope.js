// Global scope — the two top switchers (Project + Environment). One place,
// persisted to localStorage, applied by every page. '' means "all".
// Pages read scope() and filter their runs through inScope(); the switchers
// call setScope() which persists and re-renders the current route.

const KEY = 'redline-scope';
const state = load();
const subs = new Set();

function load() {
  try {
    const o = JSON.parse(localStorage.getItem(KEY) || '{}');
    return { project: o.project || '', env: o.env || '' };
  } catch { return { project: '', env: '' }; }
}

export const scope = () => ({ ...state });

export function setScope(patch) {
  Object.assign(state, patch);
  try { localStorage.setItem(KEY, JSON.stringify(state)); } catch {}
  for (const fn of subs) fn(scope());
}

export const onScope = (fn) => { subs.add(fn); return () => subs.delete(fn); };

// A run passes the global scope when its team+env match (or the slot is "all").
// Kept here so every page filters identically. `team` is the internal key that
// the "Project" switcher selects.
export const inScope = (r) =>
  (!state.project || r.team === state.project)
  && (!state.env || r.env === state.env);

export const applyScope = (runs) => runs.filter(inScope);

// Friendly labels for the environment codes the ledger records.
const ENV_LABELS = { stg: 'Staging', prod: 'Production', local: 'Local' };
export const envLabel = (e) => ENV_LABELS[e] || (e ? e[0].toUpperCase() + e.slice(1) : e);

// Environment options for the switcher: the two first-class envs the product
// names (staging, production) always shown, plus any other env actually present
// in the data (e.g. local for localhost functional suites). Honest — no fake
// options beyond the two canonical ones.
export function envOptions(runs) {
  const present = new Set(runs.map((r) => r.env).filter(Boolean));
  const out = ['stg', 'prod'];
  for (const e of present) if (!out.includes(e)) out.push(e);
  return out;
}
