import assert from 'node:assert/strict';
import test from 'node:test';

import { buildInjectionScenarioForecast } from '../src/lib/injectionScenarioForecast.ts';

const input = {
  historicalDailyOil: [100, 99, 98, 97, 96],
  plannedGain: 12,
  optimizedGain: 20,
  riskConstrainedGain: 8,
  channelingLoss: 5,
  occupancyLoss: 3,
};

test('calculates every scenario from baseline plus gain minus channeling and occupancy losses', () => {
  const result = buildInjectionScenarioForecast(input);

  assert.deepEqual(result.horizons, [30, 90, 180]);
  for (const scenario of result.scenarios) {
    const firstPoint = scenario.points[0];
    assert.equal(firstPoint.dailyOil, firstPoint.baseline === null || firstPoint.gain === null ? null : firstPoint.baseline + firstPoint.gain - firstPoint.channelingLoss - firstPoint.occupancyLoss);
  }
  assert.deepEqual(result.scenarios.map((scenario) => scenario.id), ['naturalDecline', 'currentPlan', 'stableProductionOptimization', 'riskConstrained']);
  assert.equal(result.scenarios[0].points[0].gain, 0);
  assert.equal(result.scenarios[1].points[0].gain, 12);
  assert.equal(result.scenarios[2].points[0].gain, 20);
  assert.equal(result.scenarios[3].points[0].gain, 8);
  assert.equal(result.source, 'historical-fit');
});

test('falls back to rule cases and lowers confidence when historical series is unavailable', () => {
  const result = buildInjectionScenarioForecast({
    baselineDailyOil: 50,
    plannedGain: 4,
    optimizedGain: 6,
    riskConstrainedGain: 3,
    channelingLoss: 1,
    occupancyLoss: 1,
  });

  assert.equal(result.source, 'rule-case');
  assert.ok(result.confidence < 0.7);
  assert.equal(result.scenarios[1].points.length, 180);
});

test('does not turn unknown losses into zero and reports low confidence', () => {
  const result = buildInjectionScenarioForecast({
    historicalDailyOil: [80, 79, 78],
    plannedGain: 4,
    optimizedGain: 6,
    riskConstrainedGain: 3,
    channelingLoss: null,
    occupancyLoss: 1,
  });

  assert.equal(result.scenarios[0].points[0].channelingLoss, null);
  assert.equal(result.scenarios[0].points[0].dailyOil, null);
  assert.ok(result.confidence < 0.6);
  assert.ok(result.assumptions.some((item) => item.includes('待补全')));
});
