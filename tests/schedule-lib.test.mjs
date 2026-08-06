// node tests/schedule-lib.test.mjs — assert-based self-check for schedule-lib.
import assert from 'node:assert/strict';
import { validateSchedule, isDue, nextFire, dayKey } from '../dashboard/schedule-lib.mjs';

// ── validateSchedule ─────────────────────────────────────────────────
assert.equal(validateSchedule({}).error, 'pick a test to schedule');
assert.equal(validateSchedule({ team: 'demo-web', profile: 'benchmark' }).error, 'time must be HH:MM (24-hour)');
assert.equal(validateSchedule({ team: 'demo-web', profile: 'benchmark', time: '25:00' }).error, 'time must be HH:MM (24-hour)');
assert.equal(validateSchedule({ team: '../etc', profile: 'benchmark', time: '06:00' }).error, 'pick a test to schedule');
{
  const { schedule: s } = validateSchedule({ team: 'Demo-Web', profile: 'benchmark', time: '06:30', days: [1, 1, 3, 9, -1, 'x'] });
  assert.equal(s.team, 'demo-web');            // lowercased
  assert.deepEqual(s.days, [1, 3]);            // deduped, out-of-range dropped
  assert.equal(s.id, 'demo-web.benchmark.0630');
  assert.equal(s.enabled, true);
}

// ── isDue ────────────────────────────────────────────────────────────
// Wed 2026-07-15 09:00 local
const wed9 = new Date(2026, 6, 15, 9, 0);
const base = { team: 'demo-web', profile: 'benchmark', time: '06:00', days: [], enabled: true, lastFired: '', lastFiredDay: '' };

assert.equal(isDue({ ...base }, wed9), true, 'past 06:00, never fired → due');
assert.equal(isDue({ ...base, enabled: false }, wed9), false, 'disabled → never due');
assert.equal(isDue({ ...base, time: '10:00' }, wed9), false, 'before its time → not due');
assert.equal(isDue({ ...base, time: '09:00' }, wed9), true, 'exactly its minute → due');
assert.equal(isDue({ ...base, lastFiredDay: dayKey(wed9) }, wed9), false, 'already fired today → not due');
assert.equal(isDue({ ...base, lastFiredDay: '2026-07-14' }, wed9), true, 'fired yesterday → due again');
assert.equal(isDue({ ...base, days: [3] }, wed9), true, 'Wed schedule on a Wed → due');
assert.equal(isDue({ ...base, days: [1] }, wed9), false, 'Mon schedule on a Wed → not due');

// ── nextFire ─────────────────────────────────────────────────────────
assert.equal(nextFire({ ...base, enabled: false }, wed9), null, 'disabled → no next');
{
  const n = new Date(nextFire({ ...base, time: '10:00' }, wed9));
  assert.equal(+n, +new Date(2026, 6, 15, 10, 0), 'later today');
}
{
  const n = new Date(nextFire({ ...base }, wed9)); // 06:00 already past → tomorrow
  assert.equal(+n, +new Date(2026, 6, 16, 6, 0), 'past today → tomorrow');
}
{
  const n = new Date(nextFire({ ...base, time: '10:00', days: [1] }, wed9)); // Mon only
  assert.equal(n.getDay(), 1, 'lands on Monday');
  assert.equal(+n, +new Date(2026, 6, 20, 10, 0), 'next Monday 10:00');
}
{ // fired today already, daily → tomorrow even though clock is past time
  const n = new Date(nextFire({ ...base, lastFiredDay: dayKey(wed9), time: '08:00' }, wed9));
  assert.equal(+n, +new Date(2026, 6, 16, 8, 0), 'fired today → tomorrow');
}

console.log('schedule-lib: all checks passed');
