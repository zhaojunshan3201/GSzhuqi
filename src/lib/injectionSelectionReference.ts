import type { StageOilRow } from './injectionSelectionData.ts';
import type { SelectionCandidate } from './injectionSelectionPlanner.ts';

export type ProductionOilPoint = { wellNo: string; date: string; oil: number | null };

type CycleMetrics = {
  stageOil: number;
  oilSteamRatio: number;
  steamVolume: number;
};

type ReferenceCycle = {
  cycleNo: number;
  stopInjectionDate: string;
  metrics: CycleMetrics;
  points: Array<{ day: number; oil: number | null }>;
  missingReason: string | null;
};

type SimilarWell = {
  wellNo: string;
  similarity: number;
  score: number;
  oilSteamRatio: number;
  stageOil: number;
};

export type SelectedWellReference = {
  wellNo: string;
  cycles: ReferenceCycle[];
  similarWells: SimilarWell[];
  missingReasons: string[];
};

export function buildSelectedWellReference(input: {
  wellNo: string;
  stageRows: readonly StageOilRow[];
  production: readonly ProductionOilPoint[];
  candidates: readonly SelectionCandidate[];
}): SelectedWellReference {
  const cycles = input.stageRows
    .filter((row) => row.wellNo === input.wellNo && validCycle(row) && row.endDate)
    .sort((left, right) => right.endDate!.localeCompare(left.endDate!) || right.cycleNo - left.cycleNo)
    .slice(0, 3)
    .map((row) => {
      const points = buildPoints(row.endDate!, input.production.filter((point) => point.wellNo === input.wellNo));
      const missingReason = points.every((point) => point.oil === null)
        ? `第 ${row.cycleNo} 轮停注汽后第10至310天缺少生产日报日产油数据`
        : null;
      return { cycleNo: row.cycleNo, stopInjectionDate: row.endDate!, metrics: cycleMetrics(row), points, missingReason };
    });

  const missingReasons: string[] = [];
  if (!cycles.length) {
    missingReasons.push('没有可用于对齐的停注汽日期阶段周期');
    missingReasons.push(...invalidCycleReasons(input.stageRows.filter((row) => row.wellNo === input.wellNo)));
  }
  missingReasons.push(...cycles.flatMap((cycle) => cycle.missingReason ? [cycle.missingReason] : []));
  if (cycles.length && cycles.every((cycle) => cycle.points.every((point) => point.oil === null))) {
    missingReasons.push('停注汽后第10至310天缺少生产日报日产油数据');
  }

  return {
    wellNo: input.wellNo,
    cycles,
    similarWells: buildSimilarWells(input.wellNo, input.candidates),
    missingReasons,
  };
}

function validCycle(row: StageOilRow): boolean {
  return validDate(row.endDate)
    && Number.isFinite(row.steamVolume) && row.steamVolume > 0
    && Number.isFinite(row.stageOil) && row.stageOil >= 0;
}

function invalidCycleReasons(rows: readonly StageOilRow[]): string[] {
  if (!rows.length) return ['没有该井的阶段产油周期数据'];
  const reasons = new Set<string>();
  for (const row of rows) {
    if (!row.endDate) reasons.add('阶段周期缺少停注汽日期');
    else if (!validDate(row.endDate)) reasons.add('阶段周期停注汽日期无效');
    if (!Number.isFinite(row.steamVolume) || row.steamVolume <= 0) reasons.add('阶段周期缺少有效周期注汽量');
    if (!Number.isFinite(row.stageOil) || row.stageOil < 0) reasons.add('阶段周期缺少有效阶段产油');
  }
  return [...reasons];
}

function cycleMetrics(row: StageOilRow): CycleMetrics {
  return {
    stageOil: row.stageOil,
    oilSteamRatio: Number.isFinite(row.oilSteamRatio) && row.oilSteamRatio! >= 0
      ? row.oilSteamRatio!
      : round(row.stageOil / row.steamVolume),
    steamVolume: row.steamVolume,
  };
}

function buildPoints(stopInjectionDate: string, production: readonly ProductionOilPoint[]): Array<{ day: number; oil: number | null }> {
  const oilByDay = new Map<number, number>();
  for (const point of production) {
    const day = daysAfter(stopInjectionDate, point.date);
    if (day === null || day < 10 || day > 310 || !Number.isFinite(point.oil) || point.oil! < 0) continue;
    oilByDay.set(day, point.oil!);
  }
  return Array.from({ length: 301 }, (_, index) => {
    const day = index + 10;
    return { day, oil: oilByDay.get(day) ?? null };
  });
}

function daysAfter(startDate: string, endDate: string): number | null {
  const start = dateTimestamp(startDate);
  const end = dateTimestamp(endDate);
  if (start === null || end === null) return null;
  return Math.round((end - start) / 86_400_000);
}

function validDate(value: string | null): value is string {
  return value !== null && dateTimestamp(value) !== null;
}

function dateTimestamp(value: string): number | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;
  const timestamp = Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  return new Date(timestamp).toISOString().slice(0, 10) === value ? timestamp : null;
}

function buildSimilarWells(wellNo: string, candidates: readonly SelectionCandidate[]): SimilarWell[] {
  const target = candidates.find((candidate) => candidate.wellNo === wellNo);
  if (!target) return [];

  const featureRows = candidates.map(candidateFeatures).filter((features): features is CandidateFeatures => features !== null);
  const targetFeatures = candidateFeatures(target);
  if (!targetFeatures) return [];
  const ranges = featureRanges(featureRows);

  return candidates
    .filter((candidate) => candidate.wellNo !== wellNo)
    .map((candidate) => {
      const features = candidateFeatures(candidate);
      if (!features) return null;
      const distance = average(featureNames.map((name) => normalizedDifference(targetFeatures[name], features[name], ranges[name])));
      return {
        wellNo: candidate.wellNo,
        similarity: round((1 - distance) * 100),
        score: candidate.score,
        oilSteamRatio: candidate.oilSteamRatio,
        stageOil: candidate.stageOil,
      };
    })
    .filter((item): item is SimilarWell => item !== null)
    .sort((left, right) => right.similarity - left.similarity || right.score - left.score || left.wellNo.localeCompare(right.wellNo))
    .slice(0, 10);
}

type CandidateFeatures = Record<(typeof featureNames)[number], number>;
const featureNames = ['oilSteamRatio', 'stageOil', 'stability', 'dailyCompleteness'] as const;

function candidateFeatures(candidate: SelectionCandidate): CandidateFeatures | null {
  const features = {
    oilSteamRatio: candidate.oilSteamRatio,
    stageOil: candidate.stageOil,
    stability: candidate.scoreBreakdown.stability.value,
    dailyCompleteness: candidate.scoreBreakdown.dailyCompleteness.value,
  };
  return featureNames.every((name) => Number.isFinite(features[name])) ? features as CandidateFeatures : null;
}

function featureRanges(rows: readonly CandidateFeatures[]): CandidateFeatures {
  return Object.fromEntries(featureNames.map((name) => {
    const values = rows.map((row) => row[name]);
    return [name, Math.max(...values) - Math.min(...values)];
  })) as CandidateFeatures;
}

function normalizedDifference(left: number, right: number, range: number): number {
  return range > 0 ? Math.abs(left - right) / range : 0;
}

function average(values: readonly number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

