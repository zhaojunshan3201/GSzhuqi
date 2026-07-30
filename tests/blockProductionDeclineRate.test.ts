import assert from 'node:assert/strict';
import test from 'node:test';

import {
  calculateBlockDeclineRate,
  calculateDeclineRateSeries,
} from '../src/lib/blockProductionGenerator.ts';

test('calculates block decline rate using the target year day count', () => {
  assert.equal(calculateBlockDeclineRate(36_500, 80, 2026), 20);
  assert.equal(Number(calculateBlockDeclineRate(36_600, 80, 2024)?.toFixed(1)), 20);
});

test('returns null for invalid block decline rate inputs', () => {
  assert.equal(calculateBlockDeclineRate(0, 80, 2026), null);
  assert.equal(calculateBlockDeclineRate(36_500, -1, 2026), null);
  assert.equal(calculateBlockDeclineRate(36_500, 80, Number.NaN), null);
});

test('calculates each decline-rate series point with the shared formula', () => {
  assert.deepEqual(
    calculateDeclineRateSeries(
      ['2026-01', '2026-02', '2026-03', '2027-01'],
      [100, 80, 120, 50],
      { '2025': 36_500 },
    ),
    [0, 20, -20, null],
  );
});
