// URL → environment guess. Pure, no DOM — imported by the browser wizard
// (app.js) for the live "detected: Staging" hint, by the server (wizard.mjs)
// as the authoritative default, and unit-tested in tests/env-detect.test.mjs.
//
// Buckets to the product's environment codes: 'local' | 'stg' | 'prod'.
// Anything that isn't clearly local or a non-prod/staging host is treated as
// production — the user can always override the guess in the wizard.

const NONPROD = /(^|[.-])(stg|staging|stage|test|qa|dev|uat|sandbox|preprod|pre-prod|nonprod|non-prod)([.-]|$)/;

export function envForUrl(url) {
  let host;
  try { host = new URL(url).hostname.toLowerCase(); }
  catch { return 'stg'; } // unparseable/empty → safe non-prod default, never accidental prod
  if (host === 'localhost' || host === '127.0.0.1' || host === '[::1]' || host.endsWith('.local')) return 'local';
  if (NONPROD.test(host)) return 'stg';
  return 'prod';
}
