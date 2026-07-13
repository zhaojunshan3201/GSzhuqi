import assert from 'node:assert/strict';
import test from 'node:test';

import { alignOilCurve, evaluateWells } from '../src/lib/measureWellSelection.ts';

const cycles = [
  { wellName: 'A', block: 'Block 1', round: 1, transferDate: '2024-01-01', actualSteam: 1000, cycleOil: 300, peakOil: 5, oilSeeingDays: 2, pressure: 14, rate: 18, designSteam: 1000 },
  { wellName: 'A', block: 'Block 1', round: 2, transferDate: '2025-01-01', actualSteam: 1000, cycleOil: 400, peakOil: 6, oilSeeingDays: 1, pressure: 14, rate: 18, designSteam: 1000 },
  { wellName: 'A', block: 'Block 1', round: 3, transferDate: '2026-01-01', actualSteam: 1000, cycleOil: 500, peakOil: 7, oilSeeingDays: 1, pressure: 14, rate: 18, designSteam: 1000 },
  { wellName: 'B', block: 'Block 1', round: 3, transferDate: '2026-01-01', actualSteam: 1000, cycleOil: 100, peakOil: 2, oilSeeingDays: 9, pressure: 18, rate: 7, designSteam: 1000 },
] as const;

test('ranks a high-performing well first within its block', () => {
  const result = evaluateWells(cycles);

  assert.equal(result[0].wellName, 'A');
  assert.equal(result[0].grade, 'recommended');
  assert.equal(result[0].scoreBreakdown.oilSteamRatio.max, 40);
  assert.equal(result[0].scoreBreakdown.oilSteamRatio.score, 40);
});

test('marks wells without valid actual steam as incomplete', () => {
  const result = evaluateWells([{ ...cycles[0], actualSteam: null }]);

  assert.equal(result[0].grade, 'incomplete');
  assert.ok(result[0].missingReasons.some((reason) => reason.includes('实际注汽量')));
});

test('sorts tied scores by well name', () => {
  const result = evaluateWells([
    { ...cycles[0], wellName: 'Well-B' },
    { ...cycles[0], wellName: 'Well-A' },
  ]);

  assert.deepEqual(result.map((well) => well.wellName), ['Well-A', 'Well-B']);
});

test('aligns oil curves at transfer day zero and excludes earlier dates', () => {
  assert.deepEqual(
    alignOilCurve('2026-01-10', [
      { date: '2026-01-09', oil: 1 },
      { date: '2026-01-10', oil: 2 },
      { date: '2026-01-12', oil: 5 },
    ]),
    [{ day: 0, oil: 2 }, { day: 2, oil: 5 }],
  );
});

test('does not fill missing curve oil values with zero', () => {
  assert.deepEqual(
    alignOilCurve('2026-01-10', [
      { date: '2026-01-10', oil: null },
      { date: '2026-01-11', oil: 3 },
    ]),
    [{ day: 1, oil: 3 }],
  );
});

