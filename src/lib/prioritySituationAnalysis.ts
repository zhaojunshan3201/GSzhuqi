export type PriorityCategory =
  | 'pump'
  | 'waterCut'
  | 'blockDecline'
  | 'soaking'
  | 'injectionPeriod'
  | 'restartTracking';

export type PrioritySeverity = 'high' | 'medium' | 'low';

export interface PriorityIssue {
  id: string;
  category: PriorityCategory;
  severity: PrioritySeverity;
  wellNo?: string;
  block?: string;
  comparison: string;
  deviation: number | null;
  deviationText: string;
  status: string;
  suggestion: string;
  dataDate: string | null;
  targetTab: string;
}

type WaterCutRow = {
  wellNo: string;
  date: string;
  waterCut: number;
  block?: string;
};

type InjectionPeriodRow = {
  wellNo: string;
  currentAverageOil: number;
  previousAverageOil: number;
  block?: string;
  dataDate?: string | null;
};

export type RestartTrackingRow = {
  year: number;
  category: string;
  currentOil: number | null;
  producing: boolean;
};

export type RestartTrackingSummary = {
  year: number;
  category: string;
  wells: number;
  producingWells: number;
  totalOil: number;
  missingWells: number;
};

const DAY_MS = 86_400_000;

function utcDay(value: string): number {
  const date = value.slice(0, 10);
  return Date.parse(`${date}T00:00:00Z`);
}

function dayDistance(left: string, right: string): number {
  return Math.abs(utcDay(left) - utcDay(right)) / DAY_MS;
}

export function buildWaterCutIssues(
  labRows: WaterCutRow[],
  productionRows: WaterCutRow[],
): PriorityIssue[] {
  return labRows.flatMap((lab) => {
    const production = productionRows
      .filter((row) => row.wellNo === lab.wellNo && dayDistance(row.date, lab.date) <= 7)
      .sort((left, right) => dayDistance(left.date, lab.date) - dayDistance(right.date, lab.date))[0];
    if (!production) return [];

    const deviation = Math.abs(Number(lab.waterCut) - Number(production.waterCut));
    if (!(deviation > 20)) return [];

    return [{
      id: `waterCut:${lab.wellNo}:${lab.date}`,
      category: 'waterCut',
      severity: deviation >= 30 ? 'high' : 'medium',
      wellNo: lab.wellNo,
      block: lab.block || production.block || '',
      comparison: `化验 ${Number(lab.waterCut).toFixed(1)}% / 报产 ${Number(production.waterCut).toFixed(1)}%`,
      deviation,
      deviationText: `${deviation.toFixed(1)} 个百分点`,
      status: '含水偏差',
      suggestion: '核对化验样品与报产口径',
      dataDate: lab.date,
      targetTab: 'waterLab',
    } satisfies PriorityIssue];
  });
}

export function calculateBlockDeclineRate(
  previousYearOil: number,
  monthlyAverageOil: number,
  yearDays: number,
): number | null {
  if (
    !Number.isFinite(previousYearOil)
    || previousYearOil <= 0
    || !Number.isFinite(monthlyAverageOil)
    || monthlyAverageOil < 0
    || !Number.isFinite(yearDays)
    || yearDays <= 0
  ) return null;

  const annualizedOil = monthlyAverageOil * yearDays;
  return Number((((previousYearOil - annualizedOil) / previousYearOil) * 100).toFixed(1));
}

export function buildInjectionPeriodIssues(rows: InjectionPeriodRow[]): PriorityIssue[] {
  return rows.flatMap((row) => {
    if (
      !Number.isFinite(row.previousAverageOil)
      || row.previousAverageOil <= 0
      || !Number.isFinite(row.currentAverageOil)
    ) return [];

    const change = ((row.currentAverageOil - row.previousAverageOil) / row.previousAverageOil) * 100;
    if (Math.abs(change) <= 20) return [];

    return [{
      id: `injectionPeriod:${row.wellNo}`,
      category: 'injectionPeriod',
      severity: change < -30 ? 'high' : change < -20 ? 'medium' : 'low',
      wellNo: row.wellNo,
      block: row.block || '',
      comparison: `本轮 ${row.currentAverageOil.toFixed(1)}t / 上轮 ${row.previousAverageOil.toFixed(1)}t`,
      deviation: change,
      deviationText: `${change > 0 ? '+' : ''}${change.toFixed(1)}%`,
      status: change > 0 ? '同期变好' : '同期变差',
      suggestion: change > 0 ? '持续跟踪增油效果' : '复核注汽参数和生产恢复',
      dataDate: row.dataDate || null,
      targetTab: 'measures',
    } satisfies PriorityIssue];
  }).sort((left, right) => Math.abs(Number(right.deviation)) - Math.abs(Number(left.deviation)));
}

const severityRank: Record<PrioritySeverity, number> = {
  high: 0,
  medium: 1,
  low: 2,
};

export function mergePriorityIssues(items: PriorityIssue[]): PriorityIssue[] {
  return [...items].sort((left, right) =>
    severityRank[left.severity] - severityRank[right.severity]
    || Math.abs(Number(right.deviation || 0)) - Math.abs(Number(left.deviation || 0))
    || String(right.dataDate || '').localeCompare(String(left.dataDate || '')));
}

export function calculatePumpRecoveryRate(
  currentOil: number | null,
  beforeOil: number | null,
): number | null {
  if (
    currentOil == null
    || beforeOil == null
    || !Number.isFinite(currentOil)
    || currentOil < 0
    || !Number.isFinite(beforeOil)
    || beforeOil <= 0
  ) return null;

  return Number(((currentOil / beforeOil) * 100).toFixed(1));
}

export function calculateSoakingDays(stopDate: string, asOfDate: string): number {
  const difference = Math.floor((utcDay(asOfDate) - utcDay(stopDate)) / DAY_MS);
  return Number.isFinite(difference) ? Math.max(0, difference) : 0;
}

export function summarizeRestartTracking(
  rows: RestartTrackingRow[],
): Record<string, RestartTrackingSummary> {
  return rows.reduce<Record<string, RestartTrackingSummary>>((summary, row) => {
    const key = `${row.year}:${row.category}`;
    const item = summary[key] ||= {
      year: row.year,
      category: row.category,
      wells: 0,
      producingWells: 0,
      totalOil: 0,
      missingWells: 0,
    };
    const hasOil = row.currentOil != null && Number.isFinite(row.currentOil) && row.currentOil >= 0;
    item.wells += 1;
    item.producingWells += row.producing ? 1 : 0;
    item.totalOil += hasOil ? row.currentOil! : 0;
    item.missingWells += hasOil ? 0 : 1;
    return summary;
  }, {});
}
