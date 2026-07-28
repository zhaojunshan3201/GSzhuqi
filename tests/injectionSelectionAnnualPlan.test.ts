import assert from 'node:assert/strict';
import test from 'node:test';

import { buildYearEndPlans, evaluateSelectionEligibility, type ProductionOilPoint } from '../src/lib/injectionSelectionAnnualPlan.ts';
import type { StageOilRow } from '../src/lib/injectionSelectionData.ts';

function stage(wellNo: string, cycleNo: number, startDate: string, endDate: string | null): StageOilRow {
  return { wellNo, cycleNo, startDate, endDate, steamVolume: 100, temperature: null, pressure: null, dryness: null, productionHours: null, stageOil: 50, stageWater: null, oilSteamRatio: 0.5 };
}

const cycles = [stage('A-1', 2, '2025-09-08', '2025-09-18'), stage('A-1', 1, '2025-01-01', '2025-01-11')];
const production: ProductionOilPoint[] = [
  { wellNo: 'A-1', date: '2025-01-21', oil: 2 }, { wellNo: 'A-1', date: '2025-01-22', oil: 4 },
  { wellNo: 'A-1', date: '2025-09-28', oil: 1 }, { wellNo: 'A-1', date: '2025-09-29', oil: 2 },
  { wellNo: 'A-1', date: '2026-01-24', oil: 2 },
];

test('uses the latest actual oil for the next-month plan and rejects oil above 1.5', () => {
  const result = evaluateSelectionEligibility({ mode: 'next-month', planDate: '2026-08-01', wellNo: 'A-1', latestActualOil: 1.6, cycles: [], production: [], importedWellNos: new Set(), actualStarts: [] });
  assert.equal(result.eligible, false);
  assert.match(result.reason, /最新底产.*1.5/);
  assert.equal(result.oilSource, 'actual');
});

test('rejects an imported plan well before evaluating oil evidence', () => {
  const result = evaluateSelectionEligibility({ mode: 'next-month', planDate: '2026-08-01', wellNo: 'A-1', latestActualOil: 0.8, cycles: [], production: [], importedWellNos: new Set(['A-1']), actualStarts: [] });
  assert.equal(result.eligible, false);
  assert.match(result.reason, /已确认导入/);
});

test('predicts year-end oil from aligned cycles and enforces the half-interval rule', () => {
  const result = evaluateSelectionEligibility({ mode: 'year-end', planDate: '2026-10-01', wellNo: 'A-1', latestActualOil: 2, actualStarts: ['2025-01-01', '2025-09-08'], importedWellNos: new Set(), cycles, production });
  assert.equal(result.eligible, true);
  assert.equal(result.oilSource, 'predicted');
  assert.ok(result.oilValue! <= 1.5);
  assert.equal(result.minimumEligibleDate, '2026-01-11');
});

test('rejects when the planned date is before half of the latest actual injection interval', () => {
  const result = evaluateSelectionEligibility({ mode: 'next-month', planDate: '2025-11-01', wellNo: 'A-1', latestActualOil: 1, actualStarts: ['2025-01-01', '2025-09-08'], importedWellNos: new Set(), cycles, production });
  assert.equal(result.eligible, false);
  assert.equal(result.minimumEligibleDate, '2026-01-11');
  assert.match(result.reason, /最小可注汽日期/);
});

test('rejects a year-end candidate with missing prediction inputs and gives a Chinese reason', () => {
  const result = evaluateSelectionEligibility({ mode: 'year-end', planDate: '2026-10-01', wellNo: 'A-1', latestActualOil: null, actualStarts: [], importedWellNos: new Set(), cycles: [stage('A-1', 1, '2025-09-08', null)], production: [] });
  assert.equal(result.eligible, false);
  assert.ok(result.reason.length > 0);
  assert.equal(result.oilSource, null);
});

test('limits each year-end month to thirty wells and reports the overflow', () => {
  const candidates = Array.from({ length: 31 }, (_, index) => {
    const wellNo = `W-${index}`;
    return { wellNo, score: 100 - index, latestActualOil: 1, cycles: [stage(wellNo, 2, '2026-07-01', '2026-07-11'), stage(wellNo, 1, '2026-01-01', '2026-01-11')], actualStarts: [] };
  });
  const daily: ProductionOilPoint[] = candidates.flatMap((candidate) => [
    { wellNo: candidate.wellNo, date: '2026-01-21', oil: 2 }, { wellNo: candidate.wellNo, date: '2026-07-21', oil: 1 },
    { wellNo: candidate.wellNo, date: '2026-02-01', oil: 2 },
  ]);
  const plans = buildYearEndPlans({ startMonth: '2026-08', candidates, production: daily, importedWellNos: new Set() });
  assert.deepEqual(plans.map((plan) => plan.month), ['2026-08', '2026-09', '2026-10', '2026-11', '2026-12']);
  assert.equal(plans[0].items.length, 30);
  assert.ok(plans[0].excluded.some((item) => item.wellNo === 'W-30'));
  assert.ok(plans.every((plan) => plan.items.length <= 30));
});

test('does not recommend the same eligible well twice in one year-end generation', () => {
  const candidate = { wellNo: 'A-1', score: 99, latestActualOil: 1, cycles, actualStarts: [] };
  const plans = buildYearEndPlans({ startMonth: '2026-10', candidates: [candidate], production, importedWellNos: new Set() });
  assert.equal(plans[0].items.length, 1);
  assert.equal(plans[1].items.length, 0);
  assert.ok(plans[1].excluded[0].evidence.reason.length > 0);
});

