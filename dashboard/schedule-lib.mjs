// Scheduling — pure helpers for timed runs. The server's timer loop calls
// isDue() every tick. Schedules fire in the server's LOCAL timezone and only
// while the dashboard is running: a window the server was closed for is
// skipped for that day, never queued. Deliberately not cron syntax — "daily
// at HH:MM, optionally on selected weekdays" covers the real use case.
// ponytail: no cron parser; add one only if a user asks for sub-daily runs.

const SLUG = /^[a-z0-9][a-z0-9-]{0,40}$/;
const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

// Local-date key YYYY-MM-DD — the "already fired today" bookkeeping unit.
export const dayKey = (d) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

// Validate a create-schedule request body → { schedule } or { error }.
// days: array of 0(Sun)–6(Sat); empty = every day.
export function validateSchedule(body = {}) {
  const team = String(body.team || '').trim().toLowerCase();
  const profile = String(body.profile || '').trim().toLowerCase();
  if (!SLUG.test(team) || !SLUG.test(profile)) return { error: 'pick a test to schedule' };
  const time = String(body.time || '').trim();
  if (!HHMM.test(time)) return { error: 'time must be HH:MM (24-hour)' };
  const days = Array.isArray(body.days)
    ? [...new Set(body.days.map(Number).filter((d) => Number.isInteger(d) && d >= 0 && d <= 6))].sort()
    : [];
  return {
    schedule: {
      id: `${team}.${profile}.${time.replace(':', '')}`,
      team, profile, time, days,
      enabled: true, lastFired: '', lastFiredDay: '',
    },
  };
}

// Due = enabled + today is a selected day + wall clock has passed HH:MM +
// hasn't fired yet today. Passing (not equalling) the minute is deliberate:
// "daily at 06:00" still fires when the dashboard is opened at 09:00.
export function isDue(s, now = new Date()) {
  if (!s.enabled) return false;
  if (s.days?.length && !s.days.includes(now.getDay())) return false;
  const [h, m] = s.time.split(':').map(Number);
  if (now.getHours() * 60 + now.getMinutes() < h * 60 + m) return false;
  return s.lastFiredDay !== dayKey(now);
}

// Next moment this schedule will fire (ISO) — display only. null = disabled.
export function nextFire(s, now = new Date()) {
  if (!s.enabled) return null;
  const [h, m] = s.time.split(':').map(Number);
  for (let i = 0; i < 8; i++) {
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() + i, h, m, 0, 0);
    if (s.days?.length && !s.days.includes(d.getDay())) continue;
    if (i === 0 && (d <= now || s.lastFiredDay === dayKey(now))) continue;
    return d.toISOString();
  }
  return null; // unreachable with valid days, but never loop forever
}
