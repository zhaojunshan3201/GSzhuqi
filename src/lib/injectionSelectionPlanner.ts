import type { DailyInjectionRow, GasFlags, StageOilRow } from './injectionSelectionData.ts';

export type ScorePart = {
  score: number;
  value: number | null;
  maxScore: number;
};

export type SelectionCandidate = {
  wellNo: string;
  score: number;
  latestCycle: StageOilRow;
  validCycles: StageOilRow[];
  qualityReasons: string[];
  oilSteamRatio: number;
  stageOil: number;
  scoreBreakdown: {
    oilSteamRatio: ScorePart;
    stageOil: ScorePart;
    stability: ScorePart;
    dailyCompleteness: ScorePart;
  };
};

export type ExcludedSelectionWell = {
  wellNo: string;
  latestCycle: StageOilRow;
  reason: string;
};

export type SelectionCandidates = SelectionCandidate[] & { excluded: ExcludedSelectionWell[] };

export type PlanDecision = 'included' | 'locked' | 'excluded';

export type MonthlyPlanItem = {
  rankNo: number;
  wellNo: string;
  score: number;
  suggestedSteam: number | null;
  recommendedBoiler: string;
  nitrogen: boolean;
  carbonDioxide: boolean;
  oilSteamRatio: number;
  stageOil: number;
  scoreBreakdown: SelectionCandidate['scoreBreakdown'];
  decision: PlanDecision;
  manualNote: string | null;
  source: SelectionCandidate;
};

export type MonthlyPlan = {
  month: string;
  maxWells: number;
  items: MonthlyPlanItem[];
};

const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);
const positive = (value: unknown): value is number => finite(value) && value > 0;
const nonNegative = (value: unknown): value is number => finite(value) && value >= 0;

export function buildSelectionCandidates(stageRows: readonly StageOilRow[], dailyRows: readonly DailyInjectionRow[]): SelectionCandidates {
  const rowsByWell = groupByWell(stageRows);
  const eligible: Array<{ wellNo: string; latestCycle: StageOilRow; validCycles: StageOilRow[]; qualityReasons: string[]; oilSteamRatio: number; stageOil: number; stability: number; dailyCompleteness: number }> = [];
  const excluded: ExcludedSelectionWell[] = [];

  for (const [wellNo, rows] of rowsByWell) {
    const sortedRows = sortCycles(rows);
    const invalidRows = sortedRows.flatMap((row) => {
      const reason = invalidCycleReason(row);
      return reason ? [`\u5468\u671f ${row.cycleNo}\uff1a${reason}`] : [];
    });
    const validCycles = sortedRows.filter((row) => !invalidCycleReason(row));
    if (!validCycles.length) {
      excluded.push({ wellNo, latestCycle: sortedRows[0], reason: invalidRows.join('\uff1b') });
      continue;
    }

    const latestCycle = validCycles[0];
    const qualityReasons = [
      ...invalidRows,
      ...validCycles.filter((row) => !row.endDate).map((row) => `\u5468\u671f ${row.cycleNo}\uff1a\u7f3a\u5c11\u505c\u6ce8\u6c7d\u65e5\u671f\uff0c\u672a\u7eb3\u5165\u9505\u7089\u6548\u679c`),
    ];
    const oilSteamRatio = cycleOilSteamRatio(latestCycle)!;
    const stageOil = latestCycle.stageOil;
    eligible.push({
      wellNo,
      latestCycle,
      validCycles,
      qualityReasons,
      oilSteamRatio,
      stageOil,
      stability: ratioStability(validCycles),
      dailyCompleteness: dailyDataCompleteness(dailyRows.filter((row) => row.wellNo === wellNo)),
    });
  }

  const maxRatio = maximum(eligible.map((item) => item.oilSteamRatio));
  const maxOil = maximum(eligible.map((item) => item.stageOil));
  const maxStability = maximum(eligible.map((item) => item.stability));
  const candidates = eligible.map((item): SelectionCandidate => {
    const scoreBreakdown = {
      oilSteamRatio: scorePart(item.oilSteamRatio, maxRatio, 60),
      stageOil: scorePart(item.stageOil, maxOil, 20),
      stability: scorePart(item.stability, maxStability, 10),
      dailyCompleteness: { score: round(item.dailyCompleteness * 10), value: item.dailyCompleteness, maxScore: 10 },
    };
    return {
      wellNo: item.wellNo,
      latestCycle: item.latestCycle,
      validCycles: item.validCycles,
      qualityReasons: item.qualityReasons,
      oilSteamRatio: item.oilSteamRatio,
      stageOil: item.stageOil,
      scoreBreakdown,
      score: round(Object.values(scoreBreakdown).reduce((total, part) => total + part.score, 0)),
    };
  }).sort((left, right) => right.score - left.score || right.oilSteamRatio - left.oilSteamRatio || left.wellNo.localeCompare(right.wellNo));

  return Object.assign(candidates, { excluded });
}

export function buildBoilerEffects(stageRows: readonly StageOilRow[], dailyRows: readonly DailyInjectionRow[]): Map<string, number> {
  const effects = new Map<string, number[]>();
  const dailyByWell = groupByWell(dailyRows);
  for (const stage of stageRows) {
    const ratio = cycleOilSteamRatio(stage);
    if (ratio === null || !stage.endDate) continue;
    const boilers = new Set((dailyByWell.get(stage.wellNo) ?? [])
      .filter((daily) => daily.boilerNo && isDuringCycle(daily.recordDate, stage))
      .map((daily) => daily.boilerNo!));
    for (const boiler of boilers) {
      const values = effects.get(boiler) ?? [];
      values.push(ratio);
      effects.set(boiler, values);
    }
  }
  return new Map([...effects.entries()].map(([boiler, ratios]) => [boiler, round(average(ratios))]));
}

export function createMonthlyPlan(month: string, candidates: readonly SelectionCandidate[], dailyRows: readonly DailyInjectionRow[], boilerEffects: ReadonlyMap<string, number>): MonthlyPlan {
  const boiler = bestBoiler(boilerEffects);
  const items = [...candidates]
    .sort((left, right) => right.score - left.score || right.oilSteamRatio - left.oilSteamRatio || left.wellNo.localeCompare(right.wellNo))
    .slice(0, 30)
    .map((candidate, index) => {
      const gasFlags = aggregateGasFlags(dailyRows.filter((row) => row.wellNo === candidate.wellNo));
      return {
        rankNo: index + 1,
        wellNo: candidate.wellNo,
        score: candidate.score,
        suggestedSteam: suggestedSteam(candidate.validCycles),
        recommendedBoiler: boiler ?? '待人工指定',
        nitrogen: gasFlags.nitrogen,
        carbonDioxide: gasFlags.carbonDioxide,
        oilSteamRatio: candidate.oilSteamRatio,
        stageOil: candidate.stageOil,
        scoreBreakdown: candidate.scoreBreakdown,
        decision: 'included' as const,
        manualNote: null,
        source: candidate,
      };
    });
  return { month, maxWells: 30, items };
}

export function applyPlanDecision(plan: MonthlyPlan, wellNo: string, decision: PlanDecision, manualNote: string | null = null): MonthlyPlan {
  if (!['included', 'locked', 'excluded'].includes(decision)) throw new Error(`不支持的计划决定：${decision}`);
  return {
    ...plan,
    items: plan.items.map((item) => item.wellNo === wellNo ? { ...item, decision, manualNote } : item),
  };
}

export function toPlanExportRows(plan: MonthlyPlan): Array<Record<string, string | number | null>> {
  return plan.items.map((item) => ({
    '目标月份': plan.month,
    '顺序': item.rankNo,
    '井号': item.wellNo,
    '建议注汽量': item.suggestedSteam,
    '评分': item.score,
    '油汽比': item.oilSteamRatio,
    '阶段产油': item.stageOil,
    '推荐锅炉': item.recommendedBoiler,
    '氮气': item.nitrogen ? '是' : '否',
    '二氧化碳': item.carbonDioxide ? '是' : '否',
    '评分依据': scoreEvidence(item.scoreBreakdown),
    '人工决定': item.decision,
    '备注': item.manualNote,
  }));
}

function groupByWell<T extends { wellNo: string }>(rows: readonly T[]): Map<string, T[]> {
  const grouped = new Map<string, T[]>();
  for (const row of rows) grouped.set(row.wellNo, [...(grouped.get(row.wellNo) ?? []), row]);
  return grouped;
}

function sortCycles(rows: readonly StageOilRow[]): StageOilRow[] {
  return [...rows].sort((left, right) => right.startDate.localeCompare(left.startDate) || right.cycleNo - left.cycleNo);
}

function invalidCycleReason(row: StageOilRow): string | null {
  if (!positive(row.steamVolume)) return '最近周期缺少有效周期注汽量';
  if (!finite(row.stageOil) || row.stageOil < 0) return '最近周期缺少有效阶段产油';
  return null;
}

function cycleOilSteamRatio(row: StageOilRow): number | null {
  if (!positive(row.steamVolume) || !finite(row.stageOil) || row.stageOil < 0) return null;
  return finite(row.oilSteamRatio) && row.oilSteamRatio >= 0 ? row.oilSteamRatio : row.stageOil / row.steamVolume;
}

function ratioStability(cycles: readonly StageOilRow[]): number {
  const ratios = cycles.map(cycleOilSteamRatio).filter((ratio): ratio is number => ratio !== null);
  if (!ratios.length) return 0;
  const mean = average(ratios);
  if (mean === 0) return ratios.every((ratio) => ratio === 0) ? 1 : 0;
  const variance = average(ratios.map((ratio) => (ratio - mean) ** 2));
  return 1 / (1 + Math.sqrt(variance) / Math.abs(mean));
}

function dailyDataCompleteness(rows: readonly DailyInjectionRow[]): number {
  if (!rows.length) return 0;
  const fields = ['dailySteam', 'pressure', 'dryness', 'temperature'] as const;
  const filled = rows.reduce((total, row) => total + fields.filter((field) => nonNegative(row[field])).length, 0);
  return filled / (rows.length * fields.length);
}

function scorePart(value: number, maximumValue: number, maxScore: number): ScorePart {
  return { score: maximumValue > 0 ? round(value / maximumValue * maxScore) : 0, value, maxScore };
}

function maximum(values: readonly number[]): number { return values.length ? Math.max(...values) : 0; }
function average(values: readonly number[]): number { return values.reduce((sum, value) => sum + value, 0) / values.length; }
function round(value: number): number { return Math.round(value * 100) / 100; }
function suggestedSteam(cycles: readonly StageOilRow[]): number | null {
  const volumes = sortCycles(cycles).slice(0, 3).map((cycle) => cycle.steamVolume).filter(positive);
  return volumes.length ? round(average(volumes)) : null;
}
function bestBoiler(effects: ReadonlyMap<string, number>): string | null {
  return [...effects.entries()].sort(([leftName, leftRatio], [rightName, rightRatio]) => rightRatio - leftRatio || leftName.localeCompare(rightName))[0]?.[0] ?? null;
}
function aggregateGasFlags(rows: readonly DailyInjectionRow[]): GasFlags {
  return rows.reduce<GasFlags>((flags, row) => ({ nitrogen: flags.nitrogen || row.gasFlags.nitrogen, carbonDioxide: flags.carbonDioxide || row.gasFlags.carbonDioxide }), { nitrogen: false, carbonDioxide: false });
}
function isDuringCycle(date: string, cycle: StageOilRow): boolean { return Boolean(cycle.endDate) && date >= cycle.startDate && date <= cycle.endDate!; }
function scoreEvidence(parts: SelectionCandidate['scoreBreakdown']): string {
  return `油汽比 ${parts.oilSteamRatio.value ?? '-'}（${parts.oilSteamRatio.score}/${parts.oilSteamRatio.maxScore}）；阶段产油 ${parts.stageOil.value ?? '-'}（${parts.stageOil.score}/${parts.stageOil.maxScore}）；稳定性 ${parts.stability.value ?? '-'}（${parts.stability.score}/${parts.stability.maxScore}）；日数据完整性 ${parts.dailyCompleteness.value ?? '-'}（${parts.dailyCompleteness.score}/${parts.dailyCompleteness.maxScore}）`;
}
