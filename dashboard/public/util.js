// Shared helpers for the dashboard front-end modules. Vanilla, no build step.

export const esc = (s) => String(s ?? '')
  .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;').replaceAll("'", '&#39;');

export async function api(path, body) {
  const res = await fetch(path, body
    ? { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }
    : undefined);
  const json = await res.json();
  if (!res.ok) throw new Error(json.error || res.statusText);
  return json;
}

// Plain-language trigger — non-technical users read "Started by: Manual",
// never the raw ledger enum casing (manual | cron | deploy).
export const startedBy = (t) => t === 'manual' ? 'Manual'
  : t === 'cron' ? 'Schedule'
  : t === 'deploy' ? 'Deploy'
  : '—';

// One vocabulary for environment, everywhere — matches the top Project/Environment
// switcher's own labels (Staging/Production/Local) instead of the raw ledger code.
export const envLabel = (e) => e === 'stg' ? 'Staging'
  : e === 'prod' ? 'Production'
  : e === 'local' ? 'Local'
  : (e || '—');

// Relative time for list rows — coarse buckets, absolute dates elsewhere.
export const rel = (iso) => {
  if (!iso) return '—';
  const s = Math.max(0, (Date.now() - Date.parse(iso)) / 1000);
  if (Number.isNaN(s)) return '—';
  if (s < 90) return 'just now';
  if (s < 5400) return `${Math.round(s / 60)} min ago`;
  if (s < 129600) return `${Math.round(s / 3600)} hr ago`;
  return `${Math.round(s / 86400)} days ago`;
};
