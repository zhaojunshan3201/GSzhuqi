import assert from 'node:assert/strict';
import test from 'node:test';

import { buildInjectionOperationRecommendations } from '../src/lib/injectionOperationOptimizer.ts';

const constraint = { boilerSteamCapacity: 1200, maxConcurrentWells: 2, maxChannelingRisk: 0.5, oilPrice: 500, steamUnitCost: 20 };
const common = { channelingLoss: 2, occupancyLoss: 1, confidence: 0.8, similarCaseEvidence: ['A区块同层系井 A-12：低压错峰后净增油 8 t/d'] };

test('excludes plans exceeding boiler capacity and ranks high net oil with lower volatility and risk first', () => {
  const result = buildInjectionOperationRecommendations({
    constraints: constraint,
    candidates: [
      { id: 'over', name: '超限', wellOrder: ['J-1', 'J-2'], staggerDays: 2, steamVolume: 1300, pressure: 12, steamRate: 20, soakDays: 5, convertToProductionDay: 6, boiler: 'B-1', grossIncrementalOil: 30, productionVolatility: 0.1, channelingRisk: 0.1 },
      { id: 'steady', name: '稳产优先', wellOrder: ['J-3'], staggerDays: 3, steamVolume: 1000, pressure: 11, steamRate: 18, soakDays: 6, convertToProductionDay: 7, boiler: 'B-1', grossIncrementalOil: 18, productionVolatility: 0.1, channelingRisk: 0.1 },
      { id: 'volatile', name: '高波动', wellOrder: ['J-4'], staggerDays: 0, steamVolume: 1000, pressure: 13, steamRate: 22, soakDays: 4, convertToProductionDay: 5, boiler: 'B-1', grossIncrementalOil: 19, productionVolatility: 0.8, channelingRisk: 0.45 },
    ],
    ...common,
  });

  assert.deepEqual(result.recommendations.map((item) => item.id), ['steady', 'volatile']);
  assert.equal(result.rejected[0].id, 'over');
  assert.match(result.rejected[0].reason, /锅炉/);
  assert.ok(result.recommendations[0].score > result.recommendations[1].score);
});

test('returns editable operational fields, explainable evidence, and an audit-ready adjustment', () => {
  const result = buildInjectionOperationRecommendations({
    constraints: constraint,
    candidates: [{ id: 'one', name: '方案一', wellOrder: ['J-1', 'J-2'], staggerDays: 2, steamVolume: 900, pressure: 12, steamRate: 18, soakDays: 5, convertToProductionDay: 6, boiler: 'B-1', grossIncrementalOil: 20, productionVolatility: 0.2, channelingRisk: 0.2 }],
    ...common,
  });
  const plan = result.recommendations[0];
  assert.deepEqual(plan.operation.wellOrder, ['J-1', 'J-2']);
  assert.equal(plan.operation.staggerDays, 2);
  assert.equal(plan.operation.soakDays, 5);
  assert.ok(plan.evidence.some((item) => item.includes('同层系井')));

  const adjusted = buildInjectionOperationRecommendations({
    constraints: constraint, candidates: [plan.operation], ...common,
    adjustments: [{ planId: 'one', reason: '现场锅炉检修，延后施工', patch: { staggerDays: 7, soakDays: 8 } }],
  }).recommendations[0];
  assert.equal(adjusted.operation.staggerDays, 7);
  assert.equal(adjusted.adjustments[0].reason, '现场锅炉检修，延后施工');
});

test('does not substitute unknown losses with zero and reduces confidence', () => {
  const result = buildInjectionOperationRecommendations({
    constraints: constraint,
    candidates: [{ id: 'unknown', name: '待补全', wellOrder: ['J-1'], staggerDays: 1, steamVolume: 900, pressure: 12, steamRate: 18, soakDays: 5, convertToProductionDay: 6, boiler: 'B-1', grossIncrementalOil: 20, productionVolatility: 0.2, channelingRisk: 0.2 }],
    channelingLoss: null, occupancyLoss: 1, confidence: 0.8,
  });
  const plan = result.recommendations[0];
  assert.equal(plan.metrics.netIncrementalOil, null);
  assert.equal(plan.metrics.netBenefit, null);
  assert.ok(plan.confidence < 0.8);
  assert.ok(plan.assumptions.some((item) => item.includes('未按 0 处理')));
});




test('rejects unknown critical risk and calculates staggered boiler concurrency from rate', () => {
  const result = buildInjectionOperationRecommendations({ constraints: constraint, channelingLoss: 1, occupancyLoss: 1, confidence: 0.8, candidates: [
    { id: 'unknown-risk', name: 'unknown', wellOrder: ['J-1'], staggerDays: 1, steamVolume: 700, pressure: 10, steamRate: 10, soakDays: 5, convertToProductionDay: 6, boiler: 'B-1', grossIncrementalOil: 10, productionVolatility: 0.1, channelingRisk: null },
    { id: 'parallel', name: 'parallel', wellOrder: ['J-1', 'J-2', 'J-3'], staggerDays: 0, steamVolume: 700, pressure: 10, steamRate: 500, soakDays: 5, convertToProductionDay: 6, boiler: 'B-1', grossIncrementalOil: 10, productionVolatility: 0.1, channelingRisk: 0.1 },
  ] });
  assert.equal(result.recommendations.length, 0);
  assert.match(result.rejected[0].reason, /risk|\u98ce\u9669/);
  assert.match(result.rejected[1].reason, /concurrency|\u5e76\u53d1/);
});
