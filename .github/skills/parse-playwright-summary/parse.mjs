#!/usr/bin/env node
// parse-playwright-summary — Playwright JSON reporter → canonical contract.json.
// Usage: node parse.mjs <results.json> <run_id> <out-contract.json>
// Fails closed: any structural problem exits 1 with "FAILED — <reason>" on stderr.
import { readFileSync, writeFileSync } from "node:fs";

const [resultsPath, runId, outPath] = process.argv.slice(2);
const fail = (r) => { console.error(`FAILED — ${r}`); process.exit(1); };
if (!resultsPath || !runId || !outPath) fail("usage: parse.mjs <results.json> <run_id> <contract.json>");

let raw;
try { raw = JSON.parse(readFileSync(resultsPath, "utf8")); }
catch (e) { fail(`unreadable or invalid JSON: ${e.message}`); }
const s = raw.stats;
if (!s || typeof s.expected !== "number" || typeof s.unexpected !== "number")
  fail("not a Playwright JSON report (stats missing)");

const failures = [];
const walk = (suite, path) => {
  for (const child of suite.suites ?? []) walk(child, [...path, child.title]);
  for (const spec of suite.specs ?? [])
    for (const t of spec.tests ?? []) {
      if (t.status === "unexpected" || t.status === "flaky")
        failures.push({
          test: [...path, spec.title].filter(Boolean).join(" > "),
          file: spec.file ?? suite.file ?? "",
          error: (t.results?.[0]?.error?.message ?? "").replace(/\x1b\[[0-9;]*m/g, "").split("\n")[0],
        });
    }
};
for (const suite of raw.suites ?? []) walk(suite, [suite.title]);

const flaky = s.flaky ?? 0; // retries are 0 by convention; count any flaky as failed, defensively
const contract = {
  run_id: runId,
  suite: "functional",
  started_at: s.startTime ?? "",
  duration_s: Math.round((s.duration ?? 0) / 100) / 10,
  tests_total: s.expected + s.unexpected + (s.skipped ?? 0) + flaky,
  passed: s.expected,
  failed: s.unexpected + flaky,
  skipped: s.skipped ?? 0,
  failures,
};
if (contract.tests_total === 0) fail("zero tests found — refusing to report an empty run");
writeFileSync(outPath, JSON.stringify(contract, null, 2));
console.log(`OK — ${contract.passed}/${contract.tests_total} passed, ${contract.failed} failed`);
