#!/usr/bin/env node
// func-verdict — contract.json → verdict.json (green | red). Crashes never reach
// this step (run-playwright-suite STOPs at O1); still fails closed on malformed input.
// Usage: node verdict.mjs <contract.json> <team> <out-verdict.json>
import { readFileSync, writeFileSync } from "node:fs";

const [contractPath, team, outPath] = process.argv.slice(2);
const fail = (r) => { console.error(`FAILED — ${r}`); process.exit(1); };
if (!contractPath || !team || !outPath) fail("usage: verdict.mjs <contract.json> <team> <verdict.json>");

let c;
try { c = JSON.parse(readFileSync(contractPath, "utf8")); }
catch (e) { fail(`unreadable contract: ${e.message}`); }
if (typeof c.tests_total !== "number" || typeof c.failed !== "number" || !Array.isArray(c.failures))
  fail("malformed contract (tests_total/failed/failures missing)");
if (c.tests_total === 0) fail("zero-test contract — cannot verdict an empty run");

// Green requires every test to have actually passed — a suite where nothing
// failed but tests were skipped (beforeAll error, config skip) is NOT an all-clear.
const passed = typeof c.passed === "number" ? c.passed : c.tests_total - c.failed;
const verdict = (c.failed === 0 && passed === c.tests_total) ? "green" : "red";
const skipped = c.tests_total - passed - c.failed;
const summary_line = verdict === "green"
  ? `GREEN — ${passed}/${c.tests_total} tests passed (${team} functional)`
  : c.failed > 0
    ? `RED — ${c.failed}/${c.tests_total} tests failed: ${c.failures.map(f => f.test).join(", ")} (${team} functional)`
    : `RED — ${passed}/${c.tests_total} passed, ${skipped} skipped — an incomplete run is not a pass (${team} functional)`;

writeFileSync(outPath, JSON.stringify({
  run_id: c.run_id, suite: "functional", overall_verdict: verdict,
  tests_total: c.tests_total, passed: c.passed, failed: c.failed,
  failing_tests: c.failures, summary_line,
}, null, 2));
console.log(summary_line);
