import assert from 'node:assert/strict';
import test from 'node:test';
import { getDateLabelInterval } from '../src/lib/externalTransferChart';

test('getDateLabelInterval uses adaptive date label boundaries', () => {
  const cases = [
    [1, 0],
    [12, 0],
    [13, 1],
    [24, 1],
    [25, 2],
    [197, 16],
  ] as const;

  for (const [pointCount, expectedInterval] of cases) {
    assert.equal(getDateLabelInterval(pointCount), expectedInterval);
  }
});

test('getDateLabelInterval keeps visible labels within the readable range', () => {
  for (const pointCount of [13, 24, 25, 197]) {
    const interval = getDateLabelInterval(pointCount);
    const visibleLabelCount = Math.ceil(pointCount / (interval + 1));

    assert.ok(visibleLabelCount >= 6 && visibleLabelCount <= 12);
  }
});
