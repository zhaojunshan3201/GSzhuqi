import type { StageOilRow } from './injectionSelectionData.ts';

export type PlanMode = 'next-month' | 'year-end';
export type ProductionOilPoint = { wellNo: string; date: string; oil: number | null };
export type EligibilityEvidence = {
  eligible: boolean;
  reason: string;
  oilValue: number | null;
  oilSource: 'actual' | 'predicted' | null;
  minimumEligibleDate: string | null;
};

export type EligibilityInput = {
  mode: PlanMode;
  planDate: string;
  wellNo: string;
  latestActualOil: number | null;
  cycles: readonly StageOilRow[];
  production: readonly ProductionOilPoint[];
  importedWellNos: ReadonlySet<string>;
  actualStarts: readonly string[];
};

export type YearEndPlanCandidate = {
  wellNo: string;
  score: number;
  latestActualOil: number | null;
  cycles: readonly StageOilRow[];
  actualStarts: readonly string[];
};
export type PlannedCandidate = YearEndPlanCandidate & { evidence: EligibilityEvidence };
export type ExcludedCandidate = { wellNo: string; score: number; evidence: EligibilityEvidence };
export type YearEndPlanInput = {
  startMonth: string;
  candidates: readonly YearEndPlanCandidate[];
  production: readonly ProductionOilPoint[];
  importedWellNos: ReadonlySet<string>;
  maxWells?: number;
};
export type YearEndMonthPlan = { month: string; planDate: string; items: PlannedCandidate[]; excluded: ExcludedCandidate[] };

const OIL_LIMIT = 1.5;

export function evaluateSelectionEligibility(input: EligibilityInput): EligibilityEvidence {
  if (input.importedWellNos.has(input.wellNo)) return rejected('该井已确认导入月度注汽计划，不能再次入选');

  const interval = minimumEligibleDate(input.actualStarts);
  if (interval.invalid) return rejected('实际注汽记录缺少相邻两轮开始日期，无法计算最小注汽间隔');
  if (interval.date && input.planDate < interval.date) {
    return rejected(`计划日早于最小可注汽日期 ${interval.date}`, null, null, interval.date);
  }

  if (input.mode === 'next-month') {
    if (!finiteNonNegative(input.latestActualOil)) return rejected('缺少最新有效实际底产', null, 'actual', interval.date);
    if (input.latestActualOil > OIL_LIMIT) return rejected(`最新底产 ${input.latestActualOil} 吨/日高于 1.5 吨/日`, input.latestActualOil, 'actual', interval.date);
    return accepted(`最新底产 ${input.latestActualOil} 吨/日符合要求`, input.latestActualOil, 'actual', interval.date);
  }

  const prediction = predictOil(input.wellNo, input.planDate, input.cycles, input.production);
  if (prediction.oil === null) return rejected(prediction.reason, null, null, interval.date);
  if (prediction.oil > OIL_LIMIT) return rejected(`预测底产 ${prediction.oil} 吨/日高于 1.5 吨/日`, prediction.oil, 'predicted', interval.date);
  return accepted(`预测底产 ${prediction.oil} 吨/日符合要求`, prediction.oil, 'predicted', interval.date);
}

export function buildYearEndPlans(input: YearEndPlanInput): YearEndMonthPlan[] {
  const months = monthsThroughDecember(input.startMonth);
  const reserved = new Set<string>();
  const maxWells = input.maxWells ?? 30;
  return months.map(({ month, planDate }) => {
    const excluded: ExcludedCandidate[] = [];
    const eligible: PlannedCandidate[] = [];
    for (const candidate of input.candidates) {
      if (reserved.has(candidate.wellNo)) {
        excluded.push({ wellNo: candidate.wellNo, score: candidate.score, evidence: rejected('该井已在本次年末计划中建议，不能提前重复安排') });
        continue;
      }
      const evidence = evaluateSelectionEligibility({ mode: 'year-end', planDate, wellNo: candidate.wellNo, latestActualOil: candidate.latestActualOil, cycles: candidate.cycles, production: input.production, importedWellNos: input.importedWellNos, actualStarts: candidate.actualStarts });
      if (evidence.eligible) eligible.push({ ...candidate, evidence });
      else excluded.push({ wellNo: candidate.wellNo, score: candidate.score, evidence });
    }
    const items = eligible.sort(compareCandidate).slice(0, maxWells);
    for (const item of items) reserved.add(item.wellNo);
    for (const item of eligible.slice(maxWells)) excluded.push({ wellNo: item.wellNo, score: item.score, evidence: rejected(`当月可选井超过计划上限 ${maxWells} 口`) });
    return { month, planDate, items, excluded };
  });
}

function predictOil(wellNo: string, planDate: string, cycles: readonly StageOilRow[], production: readonly ProductionOilPoint[]): { oil: number | null; reason: string } {
  const sorted = [...cycles].filter((cycle) => validDate(cycle.startDate)).sort((a, b) => b.startDate.localeCompare(a.startDate));
  const [current, previous] = sorted;
  if (!current || !previous) return { oil: null, reason: '缺少本轮和上轮阶段周期，无法预测底产' };
  if (!validDate(current.endDate) || !validDate(previous.endDate)) return { oil: null, reason: '缺少有效停注汽日期，无法预测底产' };
  const targetDay = daysBetween(current.endDate, planDate);
  if (targetDay < 0) return { oil: null, reason: '计划日早于本轮停注汽日期，无法预测底产' };
  const values = new Map<string, number>();
  for (const point of production) if (point.wellNo === wellNo && validDate(point.date) && finiteNonNegative(point.oil)) values.set(point.date, point.oil);
  const ratios: number[] = [];
  for (const [date, currentOil] of values) {
    const day = daysBetween(current.endDate, date);
    if (day < 0) continue;
    const previousOil = values.get(addDays(previous.endDate, day));
    if (finitePositive(previousOil)) ratios.push(currentOil / previousOil);
  }
  if (!ratios.length) return { oil: null, reason: '缺少本轮与上轮重叠同期日产油，无法预测底产' };
  const previousTargetOil = values.get(addDays(previous.endDate, targetDay));
  if (!finiteNonNegative(previousTargetOil)) return { oil: null, reason: '缺少上轮目标同期日产油，无法预测底产' };
  const predicted = round(previousTargetOil * median(ratios));
  return Number.isFinite(predicted) ? { oil: predicted, reason: '' } : { oil: null, reason: '预测底产计算结果无效' };
}

function minimumEligibleDate(starts: readonly string[]): { date: string | null; invalid: boolean } {
  if (!starts.length) return { date: null, invalid: false };
  if (starts.length < 2 || starts.some((value) => !validDate(value))) return { date: null, invalid: true };
  const sorted = [...starts].sort();
  const previous = sorted.at(-2)!;
  const latest = sorted.at(-1)!;
  const gap = daysBetween(previous, latest);
  if (gap <= 0) return { date: null, invalid: true };
  return { date: addDays(latest, Math.ceil(gap / 2)), invalid: false };
}

function monthsThroughDecember(startMonth: string): Array<{ month: string; planDate: string }> {
  const match = /^(\d{4})-(\d{2})$/.exec(startMonth);
  if (!match) throw new Error('startMonth 必须为 YYYY-MM');
  const year = Number(match[1]);
  const start = Number(match[2]);
  if (start < 1 || start > 12) throw new Error('startMonth 必须为有效月份');
  return Array.from({ length: 13 - start }, (_, index) => {
    const month = `${year}-${String(start + index).padStart(2, '0')}`;
    return { month, planDate: `${month}-01` };
  });
}

function compareCandidate(left: PlannedCandidate, right: PlannedCandidate): number { return right.score - left.score || left.wellNo.localeCompare(right.wellNo); }
function rejected(reason: string, oilValue: number | null = null, oilSource: EligibilityEvidence['oilSource'] = null, minimumEligibleDate: string | null = null): EligibilityEvidence { return { eligible: false, reason, oilValue, oilSource, minimumEligibleDate }; }
function accepted(reason: string, oilValue: number, oilSource: 'actual' | 'predicted', minimumEligibleDate: string | null): EligibilityEvidence { return { eligible: true, reason, oilValue, oilSource, minimumEligibleDate }; }
function validDate(value: string | null): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}
function finiteNonNegative(value: unknown): value is number { return typeof value === 'number' && Number.isFinite(value) && value >= 0; }
function finitePositive(value: unknown): value is number { return finiteNonNegative(value) && value > 0; }
function daysBetween(from: string, to: string): number { return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000); }
function addDays(date: string, days: number): string { return new Date(Date.parse(`${date}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10); }
function median(values: readonly number[]): number { const sorted = [...values].sort((a, b) => a - b); const middle = Math.floor(sorted.length / 2); return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2; }
function round(value: number): number { return Math.round(value * 10_000) / 10_000; }

