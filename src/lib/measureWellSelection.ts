export const SCORE_WEIGHTS = {
  oilSteamRatio: 40,
  cycleOil: 20,
  peakOil: 15,
  oilSeeing: 10,
  injectionStability: 10,
  completeness: 5,
} as const;

export type SelectionGrade = 'recommended' | 'candidate' | 'not_recommended' | 'incomplete';

export interface SelectionCycle {
  wellName: string;
  block: string;
  round: number;
  transferDate: string;
  actualSteam?: number | null;
  cycleOil?: number | null;
  peakOil?: number | null;
  oilSeeingDays?: number | null;
  pressure?: number | null;
  rate?: number | null;
  designSteam?: number | null;
}

export interface OilPoint {
  date: string;
  oil?: number | null;
}

export interface AlignedOilPoint {
  day: number;
  oil: number;
}

type MetricName = keyof typeof SCORE_WEIGHTS;

export interface ScorePart {
  value: number | null;
  score: number;
  max: number;
}

export interface EvaluatedWell {
  wellName: string;
  block: string;
  score: number;
  grade: SelectionGrade;
  missingReasons: string[];
  scoreBreakdown: Record<MetricName, ScorePart>;
  cycles: SelectionCycle[];
}

interface WellMetrics {
  wellName: string;
  block: string;
  cycles: SelectionCycle[];
  oilSteamRatio: number | null;
  cycleOil: number | null;
  peakOil: number | null;
  oilSeeing: number | null;
  injectionStability: number | null;
  completeness: number;
  missingReasons: string[];
}

export function alignOilCurve(transferDate: string, points: readonly OilPoint[]): AlignedOilPoint[] {
  const transferDay = parseDay(transferDate);
  if (transferDay === undefined) return [];

  return points
    .flatMap((point) => {
      const day = parseDay(point.date);
      if (day === undefined || day < transferDay || !isFiniteNumber(point.oil)) return [];
      return [{ day: (day - transferDay) / 86_400_000, oil: point.oil }];
    })
    .sort((left, right) => left.day - right.day);
}

export function evaluateWells(cycles: readonly SelectionCycle[]): EvaluatedWell[] {
  const wells = [...groupByWell(cycles).values()].map(toMetrics);
  const metricsByBlock = new Map<string, WellMetrics[]>();
  for (const well of wells) {
    const blockWells = metricsByBlock.get(well.block) ?? [];
    blockWells.push(well);
    metricsByBlock.set(well.block, blockWells);
  }

  return wells
    .map((well) => evaluateWell(well, metricsByBlock.get(well.block) ?? []))
    .sort((left, right) => right.score - left.score || left.wellName.localeCompare(right.wellName));
}

function groupByWell(cycles: readonly SelectionCycle[]): Map<string, SelectionCycle[]> {
  const grouped = new Map<string, SelectionCycle[]>();
  for (const cycle of cycles) {
    const wellCycles = grouped.get(cycle.wellName) ?? [];
    wellCycles.push(cycle);
    grouped.set(cycle.wellName, wellCycles);
  }
  return grouped;
}

function toMetrics(cycles: SelectionCycle[]): WellMetrics {
  const ordered = [...cycles].sort(compareNewestFirst);
  const latest = ordered[0];
  const validRatios = ordered.flatMap((cycle) => validOilSteamRatio(cycle) ?? []);
  const recentRatios = ordered.slice(0, 3).flatMap((cycle) => validOilSteamRatio(cycle) ?? []);
  const oilSteamRatio = validRatios.length === 0
    ? null
    : average(recentRatios.length > 0 ? recentRatios : validRatios) * 0.7 + average(validRatios) * 0.3;
  const cycleOil = averageOrNull(ordered.map((cycle) => cycle.cycleOil).filter(isNonNegativeNumber));
  const missingReasons = validRatios.length === 0 ? ['实际注汽量或周期产油缺失'] : [];

  return {
    wellName: latest?.wellName ?? '',
    block: latest?.block ?? '',
    cycles: ordered,
    oilSteamRatio,
    cycleOil,
    peakOil: isFiniteNumber(latest?.peakOil) ? latest.peakOil : null,
    oilSeeing: isFiniteNumber(latest?.oilSeeingDays) ? latest.oilSeeingDays : null,
    injectionStability: injectionStability(latest),
    completeness: completeness(latest),
    missingReasons,
  };
}

function evaluateWell(well: WellMetrics, blockWells: WellMetrics[]): EvaluatedWell {
  const scoreBreakdown = {
    oilSteamRatio: scorePart(well.oilSteamRatio, blockWells.map((item) => item.oilSteamRatio), SCORE_WEIGHTS.oilSteamRatio),
    cycleOil: scorePart(well.cycleOil, blockWells.map((item) => item.cycleOil), SCORE_WEIGHTS.cycleOil),
    peakOil: scorePart(well.peakOil, blockWells.map((item) => item.peakOil), SCORE_WEIGHTS.peakOil),
    oilSeeing: scorePart(well.oilSeeing, blockWells.map((item) => item.oilSeeing), SCORE_WEIGHTS.oilSeeing, true),
    injectionStability: directScorePart(well.injectionStability, SCORE_WEIGHTS.injectionStability),
    completeness: directScorePart(well.completeness, SCORE_WEIGHTS.completeness),
  };
  const score = Object.values(scoreBreakdown).reduce((total, part) => total + part.score, 0);
  const grade: SelectionGrade = well.oilSteamRatio === null
    ? 'incomplete'
    : score >= 75 ? 'recommended' : score >= 60 ? 'candidate' : 'not_recommended';

  return { wellName: well.wellName, block: well.block, score, grade, missingReasons: well.missingReasons, scoreBreakdown, cycles: well.cycles };
}

function scorePart(value: number | null, values: (number | null)[], max: number, reverse = false): ScorePart {
  if (value === null) return { value, score: 0, max };
  return { value, score: percentileScore(value, values, reverse) * max, max };
}

function directScorePart(value: number | null, max: number): ScorePart {
  return { value, score: value === null ? 0 : value * max, max };
}

function percentileScore(value: number, values: (number | null)[], reverse: boolean): number {
  const ranked = values.filter(isFiniteNumber).sort((left, right) => left - right);
  if (ranked.length <= 1) return 1;
  const lowerCount = ranked.filter((item) => item < value).length;
  const upperCount = ranked.filter((item) => item > value).length;
  const percentile = (lowerCount + (ranked.length - lowerCount - upperCount - 1) / 2) / (ranked.length - 1);
  return reverse ? 1 - percentile : percentile;
}

function validOilSteamRatio(cycle: SelectionCycle): number | undefined {
  return isPositiveNumber(cycle.actualSteam) && isNonNegativeNumber(cycle.cycleOil)
    ? cycle.cycleOil / cycle.actualSteam
    : undefined;
}

function injectionStability(cycle: SelectionCycle | undefined): number | null {
  if (!cycle || !isPositiveNumber(cycle.actualSteam) || !isPositiveNumber(cycle.designSteam)) return null;
  return Math.max(0, 1 - Math.abs(cycle.actualSteam / cycle.designSteam - 1));
}

function completeness(cycle: SelectionCycle | undefined): number {
  if (!cycle) return 0;
  const fields = [cycle.actualSteam, cycle.cycleOil, cycle.peakOil, cycle.oilSeeingDays, cycle.pressure, cycle.rate, cycle.designSteam];
  return fields.filter(isFiniteNumber).length / fields.length;
}

function compareNewestFirst(left: SelectionCycle, right: SelectionCycle): number {
  return right.transferDate.localeCompare(left.transferDate) || right.round - left.round;
}

function averageOrNull(values: number[]): number | null {
  return values.length === 0 ? null : average(values);
}

function average(values: number[]): number {
  return values.reduce((total, value) => total + value, 0) / values.length;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isPositiveNumber(value: unknown): value is number {
  return isFiniteNumber(value) && value > 0;
}

function isNonNegativeNumber(value: unknown): value is number {
  return isFiniteNumber(value) && value >= 0;
}

function parseDay(value: string): number | undefined {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return undefined;
  const day = Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  return Number.isNaN(day) ? undefined : day;
}
