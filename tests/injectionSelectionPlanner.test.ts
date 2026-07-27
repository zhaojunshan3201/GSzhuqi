import assert from 'node:assert/strict';
import test from 'node:test';

import {
  applyPlanDecision,
  buildBoilerEffects,
  buildSelectionCandidates,
  createMonthlyPlan,
  toPlanExportRows,
  type SelectionCandidate,
} from '../src/lib/injectionSelectionPlanner.ts';
import type { DailyInjectionRow, StageOilRow } from '../src/lib/injectionSelectionData.ts';

function stage(wellNo: string, cycleNo: number, startDate: string, steamVolume: number | null, stageOil: number | null, endDate: string | null = null, oilSteamRatio: number | null = null): StageOilRow {
  return { wellNo, cycleNo, startDate, endDate, steamVolume: steamVolume as number, temperature: null, pressure: null, dryness: null, productionHours: null, stageOil: stageOil as number, stageWater: null, oilSteamRatio };
}

function daily(wellNo: string, recordDate: string, boilerNo: string | null, gasFlags = { nitrogen: false, carbonDioxide: false }): DailyInjectionRow {
  return { wellNo, recordDate, boilerNo, productionHours: 24, flow: 8, dailySteam: 100, designSteam: 1200, cumulativeSteam: 100, pressure: 15, dryness: 75, temperature: 350, gasFlags, remarks: [] };
}

test('ranks eligible wells by oil-steam ratio and excludes incomplete latest cycles', () => {
  const candidates = buildSelectionCandidates([
    stage('A', 2, '2026-01-02', 1000, 600),
    stage('B', 2, '2026-01-02', 1000, 200),
    stage('C', 2, '2026-01-02', null, 300),
  ], []);

  assert.deepEqual(candidates.map((item) => item.wellNo), ['A', 'B']);
  assert.equal(candidates[0].scoreBreakdown.oilSteamRatio.score, 60);
  assert.match(candidates.excluded.find((item) => item.wellNo === 'C')!.reason, /周期注汽量/);
});

test('recommends the boiler with the best historical oil-steam result and aggregates gas flags', () => {
  const stages = [
    stage('A', 1, '2025-11-01', 1000, 800, '2025-11-03'),
    stage('A', 2, '2026-01-01', 1200, 720, '2026-01-03'),
  ];
  const candidates = buildSelectionCandidates(stages, []);
  const dailyRows = [
    daily('A', '2025-11-02', '炉-优', { nitrogen: true, carbonDioxide: false }),
    daily('A', '2026-01-02', '炉-差', { nitrogen: false, carbonDioxide: true }),
  ];

  const plan = createMonthlyPlan('2026-08', candidates, dailyRows, buildBoilerEffects(stages, dailyRows));
  assert.equal(plan.items[0].recommendedBoiler, '炉-优');
  assert.equal(plan.items[0].nitrogen, true);
  assert.equal(plan.items[0].carbonDioxide, true);
  assert.equal(plan.items[0].suggestedSteam, 1100);
});

function candidate(wellNo: string, score: number): SelectionCandidate {
  const cycle = stage(wellNo, 1, '2026-01-01', 1000, 500);
  return {
    wellNo,
    score,
    latestCycle: cycle,
    validCycles: [cycle],
    oilSteamRatio: 0.5,
    stageOil: 500,
    scoreBreakdown: {
      oilSteamRatio: { score: 60, value: 0.5, maxScore: 60 },
      stageOil: { score: 20, value: 500, maxScore: 20 },
      stability: { score: 10, value: 1, maxScore: 10 },
      dailyCompleteness: { score: 10, value: 1, maxScore: 10 },
    },
  };
}

test('limits an automatic plan to 30 wells and retains a manual exclusion', () => {
  const plan = createMonthlyPlan('2026-08', Array.from({ length: 31 }, (_, i) => candidate(`W${i}`, 100 - i)), [], new Map());
  const adjusted = applyPlanDecision(plan, 'W0', 'excluded', '现场停井');
  assert.equal(plan.items.length, 30);
  assert.equal(adjusted.items[0].decision, 'excluded');
  assert.equal(adjusted.items[0].manualNote, '现场停井');
  assert.equal(plan.items[0].decision, 'included');
});

test('exports transparent rows with manual decisions', () => {
  const plan = applyPlanDecision(createMonthlyPlan('2026-08', [candidate('A', 90)], [], new Map()), 'A', 'locked', '优先实施');
  const [row] = toPlanExportRows(plan);
  assert.equal(row['目标月份'], '2026-08');
  assert.equal(row['人工决定'], 'locked');
  assert.match(String(row['评分依据']), /油汽比/);
});
