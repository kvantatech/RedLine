// Date-range state + ranged ledger fetch + the range pill control.
// Tiny standalone module so shell and pages import it without cycles.
import { api } from './util.js';
import { filterRange } from './agg.js';

export const RANGE_LABELS = { '7d': 'Last 7 days', '30d': 'Last 30 days', '90d': 'Last 90 days', all: 'All time' };
const LS_KEY = 'redline-range';

// Object.hasOwn, not RANGE_LABELS[r]: a stored value of 'toString'/'constructor'
// would otherwise hit an inherited prototype method (truthy) and pass as valid,
// then filter to zero runs on every ranged page.
export function getRange() {
  const r = localStorage.getItem(LS_KEY);
  return Object.hasOwn(RANGE_LABELS, r) ? r : '30d';
}
export function setRange(r) { if (Object.hasOwn(RANGE_LABELS, r)) localStorage.setItem(LS_KEY, r); }

// Fetch the ledger and keep only runs inside the active range.
export async function rangedRuns() {
  const { runs, unreadable } = await api('/api/runs');
  return { runs: filterRange(runs, getRange()), unreadable, range: getRange() };
}

// Native <select> styled as a pill — free keyboard/a11y.
export function rangePill() {
  const cur = getRange();
  return `<select class="daterange" aria-label="Date range">
    ${Object.entries(RANGE_LABELS).map(([k, l]) =>
      `<option value="${k}"${k === cur ? ' selected' : ''}>${l}</option>`).join('')}
  </select>`;
}
export function bindRangePill(container) {
  container.querySelector('.daterange')?.addEventListener('change', (e) => {
    setRange(e.target.value);
    // Route through the shell's router so its generation guard covers this
    // re-render — a direct page re-render could race a navigation.
    window.dispatchEvent(new HashChangeEvent('hashchange'));
  });
}
