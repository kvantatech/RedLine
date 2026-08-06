import test from 'node:test';
import assert from 'node:assert/strict';
import { areaChart, barChart } from '../dashboard/public/charts.js';

test('areaChart: empty under 2 points; has gradient, area, line, endpoint dot', () => {
  assert.equal(areaChart([], 'var(--green)'), '');
  assert.equal(areaChart([1], 'var(--green)'), '');
  const svg = areaChart([0, 0.5, 1], 'var(--green)');
  assert.match(svg, /linearGradient/);
  assert.match(svg, /<polygon/);
  assert.match(svg, /<polyline/);
  assert.match(svg, /<circle/);
  assert.match(svg, /aria-hidden="true"/);
});

test('areaChart: values clamped to [0,1] — no NaN/out-of-viewBox coordinates', () => {
  const svg = areaChart([-1, 2], 'var(--red)');
  assert.doesNotMatch(svg, /NaN/);
});

test('barChart: rects with classes, tabindex, data attrs; threshold line optional', () => {
  const bars = [
    { v: 400, cls: 'green', tip: 'run-1\nok', run: 'run-1' },
    { v: 900, cls: 'red', tip: 'run-2\nover', run: 'run-2' },
  ];
  const svg = barChart(bars, { threshold: 500 });
  assert.equal((svg.match(/<rect/g) || []).length, 2);
  assert.match(svg, /class="ibar green"/);
  assert.match(svg, /class="ibar red"/);
  assert.match(svg, /tabindex="0"/);
  assert.match(svg, /data-run="run-1"/);
  assert.match(svg, /<line class="ithresh"/);
  assert.doesNotMatch(barChart(bars), /ithresh/);
  assert.equal(barChart([]), '');
});

test('barChart: escapes hostile tip/run content', () => {
  const svg = barChart([{ v: 1, cls: 'green', tip: '<img src=x onerror=alert(1)>', run: '"><script>' }]);
  assert.doesNotMatch(svg, /<img/);
  assert.doesNotMatch(svg, /<script/);
});

test('barChart: zero-value bar still gets a visible 2px nub', () => {
  const svg = barChart([{ v: 0, cls: 'fail', tip: 'x', run: 'x' }, { v: 10, cls: 'green', tip: 'y', run: 'y' }]);
  assert.match(svg, /height="2(\.0)?"/);
});
