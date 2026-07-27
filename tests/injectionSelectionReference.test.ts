import assert from 'node:assert/strict';
import test from 'node:test';

import { buildSelectedWellReference, type ProductionOilPoint } from '../src/lib/injectionSelectionReference.ts';
import type { StageOilRow } from '../src/lib/injectionSelectionData.ts';
import type { SelectionCandidate } from '../src/lib/injectionSelectionPlanner.ts';

function stage(wellNo: string, cycleNo: number, endDate: string | null, stageOil = cycleNo * 10, steamVolume = 100): StageOilRow {
  return { wellNo, cycleNo, startDate: '2026-01-01', endDate, steamVolume, temperature: null, pressure: null, dryness: null, productionHours: null, stageOil, stageWater: null, oilSteamRatio: null };
}

function candidate(wellNo: string, score: number, ratio: number, stageOil: number, stability = 0.8, completeness = 0.9): SelectionCandidate {
  const latestCycle = stage(wellNo, 1, '2026-01-31', stageOil, 100);
  return {
    wellNo, score, latestCycle, validCycles: [latestCycle], qualityReasons: [], oilSteamRatio: ratio, stageOil,
    scoreBreakdown: {
      oilSteamRatio: { score: 60, value: ratio, maxScore: 60 },
      stageOil: { score: 20, value: stageOil, maxScore: 20 },
      stability: { score: 10, value: stability, maxScore: 10 },
      dailyCompleteness: { score: 10, value: completeness, maxScore: 10 },
    },
  };
}

test('builds the latest three stopped-injection cycles with a fixed day 10 to 310 window', () => {
  const production: ProductionOilPoint[] = [
    { wellNo: 'A-1', date: '2026-04-10', oil: 1 },
    { wellNo: 'A-1', date: '2026-04-12', oil: 3 },
    { wellNo: 'A-1', date: '2026-02-11', oil: 2 },
    { wellNo: 'A-1', date: '2026-02-09', oil: 99 },
    { wellNo: 'A-1', date: '2027-02-05', oil: 99 },
  ];
  const result = buildSelectedWellReference({
    wellNo: 'A-1',
    stageRows: [stage('A-1', 1, '2026-01-31'), stage('A-1', 2, '2026-02-01'), stage('A-1', 3, '2026-03-01'), stage('A-1', 4, '2026-03-31'), stage('A-1', 5, null)],
    production,
    candidates: [candidate('A-1', 90, 0.5, 40)],
  });

  assert.deepEqual(result.cycles.map((item) => item.cycleNo), [4, 3, 2]);
  assert.equal(result.cycles[0].points.length, 301);
  assert.deepEqual(result.cycles[0].points.slice(0, 3), [{ day: 10, oil: 1 }, { day: 11, oil: null }, { day: 12, oil: 3 }]);
  assert.equal(result.cycles[0].points[300].day, 310);
  assert.equal(result.cycles[0].points[300].oil, null);
  assert.equal(result.cycles[0].metrics.stageOil, 40);
  assert.equal(result.cycles[0].metrics.oilSteamRatio, 0.4);
  assert.equal(result.cycles[0].metrics.steamVolume, 100);
});

test('reports precise reasons when no stopped cycle or production window is available', () => {
  const noStop = buildSelectedWellReference({ wellNo: 'A-1', stageRows: [stage('A-1', 1, null)], production: [], candidates: [candidate('A-1', 90, 0.5, 40)] });
  assert.deepEqual(noStop.cycles, []);
  assert.ok(noStop.missingReasons.includes('没有可用于对齐的停注汽日期阶段周期'));

  const noProduction = buildSelectedWellReference({ wellNo: 'A-1', stageRows: [stage('A-1', 1, '2026-01-31')], production: [], candidates: [candidate('A-1', 90, 0.5, 40)] });
  assert.ok(noProduction.missingReasons.includes('停注汽后第10至310天缺少生产日报日产油数据'));
  assert.ok(noProduction.cycles[0].points.every((point) => point.oil === null));
});

test('distinguishes missing or invalid cycle fields when no valid cycle remains', () => {
  const invalidStageOil = stage('A-1', 1, '2026-01-31', -1, 100);
  const invalidSteam = stage('A-1', 2, '2026-02-01', 20, 0);
  const invalidEndDate = stage('A-1', 3, 'not-a-date', 30, 100);
  const missingEndDate = stage('A-1', 4, null, 40, 100);
  const result = buildSelectedWellReference({
    wellNo: 'A-1', stageRows: [invalidStageOil, invalidSteam, invalidEndDate, missingEndDate], production: [], candidates: [candidate('A-1', 90, 0.5, 40)],
  });

  assert.deepEqual(result.cycles, []);
  assert.ok(result.missingReasons.includes('阶段周期缺少有效阶段产油'));
  assert.ok(result.missingReasons.includes('阶段周期缺少有效周期注汽量'));
  assert.ok(result.missingReasons.includes('阶段周期停注汽日期无效'));
  assert.ok(result.missingReasons.includes('阶段周期缺少停注汽日期'));
});

test('reports the missing production window for each affected cycle when another cycle has data', () => {
  const result = buildSelectedWellReference({
    wellNo: 'A-1',
    stageRows: [stage('A-1', 1, '2026-01-31'), stage('A-1', 2, '2026-06-30')],
    production: [{ wellNo: 'A-1', date: '2026-03-10', oil: 2 }],
    candidates: [candidate('A-1', 90, 0.5, 40)],
  });

  assert.equal(result.cycles[0].cycleNo, 2);
  assert.equal(result.cycles[0].missingReason, '第 2 轮停注汽后第10至310天缺少生产日报日产油数据');
  assert.equal(result.cycles[1].cycleNo, 1);
  assert.equal(result.cycles[1].missingReason, null);
  assert.ok(result.missingReasons.includes('第 2 轮停注汽后第10至310天缺少生产日报日产油数据'));
});
test('returns at most ten current-candidate similar wells, excluding the selected well', () => {
  const candidates = [candidate('A-1', 90, 0.5, 100), ...Array.from({ length: 12 }, (_, index) => candidate(`B-${index + 1}`, 80 - index, 0.5 + index / 100, 100 + index, 0.8, 0.9))];
  const result = buildSelectedWellReference({ wellNo: 'A-1', stageRows: [], production: [], candidates });

  assert.equal(result.similarWells.length, 10);
  assert.ok(result.similarWells.every((item) => item.wellNo !== 'A-1'));
  assert.deepEqual(result.similarWells.map((item) => item.wellNo), ['B-1', 'B-2', 'B-3', 'B-4', 'B-5', 'B-6', 'B-7', 'B-8', 'B-9', 'B-10']);
  assert.ok(result.similarWells.every((item, index, values) => index === 0 || values[index - 1].similarity >= item.similarity));
});

test('handles zero feature ranges without NaN similarities', () => {
  const result = buildSelectedWellReference({
    wellNo: 'A-1', stageRows: [], production: [],
    candidates: [candidate('A-1', 90, 0.5, 100), candidate('B-1', 80, 0.5, 100)],
  });
  assert.deepEqual(result.similarWells, [{ wellNo: 'B-1', similarity: 100, score: 80, oilSteamRatio: 0.5, stageOil: 100 }]);
});



