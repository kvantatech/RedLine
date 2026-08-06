// Inline-SVG chart builders. Pure string in/out — unit-tested by
// tests/charts.test.mjs. Colors arrive as CSS values (theme vars).
import { esc } from './util.js';

let uid = 0; // gradient ids must be unique per document

// Full-bleed gradient area for the Home KPI tiles. values: numbers in [0,1],
// oldest→newest. Stretches to its container (preserveAspectRatio none);
// the polyline keeps honest width via vector-effect.
export function areaChart(values, color) {
  if (values.length < 2) return '';
  const W = 300, H = 100, TOP = 12, BOT = 4, id = `area${++uid}`;
  const x = (i) => (i * (W - 6)) / (values.length - 1);
  const y = (v) => TOP + (1 - Math.max(0, Math.min(1, v))) * (H - TOP - BOT);
  const pts = values.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`);
  return `<svg class="area" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" aria-hidden="true">
    <defs><linearGradient id="${id}" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="${color}" stop-opacity=".42"/>
      <stop offset="1" stop-color="${color}" stop-opacity="0"/>
    </linearGradient></defs>
    <polygon fill="url(#${id})" points="${pts.join(' ')} ${(W - 6).toFixed(1)},${H} 0,${H}"/>
    <polyline fill="none" stroke="${color}" stroke-width="2" vector-effect="non-scaling-stroke" points="${pts.join(' ')}"/>
    <circle cx="${(W - 6).toFixed(1)}" cy="${y(values[values.length - 1]).toFixed(1)}" r="3" fill="${color}"/>
  </svg>`;
}

// Execution-history bars for Insights. Natural-width SVG (10px bar + 4px
// gap) — scrolls in its container, never stretches (bars stay honest).
// threshold is in the same units as v and draws a dashed reference line.
// maxOverride pins the vertical scale (e.g. 100 for a percentage) so a chart
// whose legend says "100% = full" doesn't auto-scale the best bar to full height.
export function barChart(bars, { threshold, max: maxOverride } = {}) {
  if (!bars.length) return '';
  const BW = 10, GAP = 4, H = 120, P = 8;
  const W = bars.length * (BW + GAP) + GAP;
  const max = maxOverride ?? (Math.max(...bars.map((b) => b.v), threshold ?? 0) || 1);
  const y = (v) => P + (1 - v / max) * (H - 2 * P);
  const th = threshold != null
    ? `<line class="ithresh" x1="0" x2="${W}" y1="${y(threshold).toFixed(1)}" y2="${y(threshold).toFixed(1)}"/>` : '';
  const rects = bars.map((b, i) => {
    const top = y(b.v);
    return `<rect class="ibar ${b.cls}" x="${GAP + i * (BW + GAP)}" y="${top.toFixed(1)}" width="${BW}" height="${Math.max(2, H - P - top).toFixed(1)}" rx="2" tabindex="0" role="link" data-run="${esc(b.run)}" data-tip="${esc(b.tip)}" aria-label="${esc(b.tip)}"/>`;
  }).join('');
  return `<svg class="ibars" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">${th}${rects}</svg>`;
}
