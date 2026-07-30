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

export function derivePriorityTrackingImportYear(asOfDate?: string, currentYear = new Date().getFullYear()) {
  const match = asOfDate?.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (match) {
    const timestamp = Date.parse(`${asOfDate}T00:00:00Z`);
    if (Number.isFinite(timestamp) && new Date(timestamp).toISOString().slice(0, 10) === asOfDate) return match[1];
  }
  return String(currentYear);
}

export function filterPumpTrackingRowsByWell<T extends Record<string, unknown>>(
  rows: T[],
  columns: string[],
  wellNo: string,
) {
  const normalizedWellNo = wellNo.trim();
  if (!normalizedWellNo) return rows;
  const wellColumn = columns.find((column) => ['井号', '井名', '井'].includes(column.trim()));
  if (!wellColumn) return [];
  return rows.filter((row) => String(row[wellColumn] ?? '').trim() === normalizedWellNo);
}

export function mergePriorityIssueMeasureQuery<T extends { keyword: string; block: string }>(
  previous: T,
  issue: Pick<PriorityIssue, 'wellNo' | 'block'>,
): T {
  return {
    ...previous,
    ...(issue.wellNo ? { keyword: issue.wellNo } : {}),
    ...(issue.block ? { block: issue.block } : {}),
  };
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
  totalOil: number | null;
  missingWells: number;
};

const DAY_MS = 86_400_000;

function utcDay(value: string): number | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const timestamp = Date.parse(`${value}T00:00:00Z`);
  if (!Number.isFinite(timestamp)) return null;
  return new Date(timestamp).toISOString().slice(0, 10) === value ? timestamp : null;
}

function dayDistance(left: string, right: string): number | null {
  const leftDay = utcDay(left);
  const rightDay = utcDay(right);
  return leftDay == null || rightDay == null ? null : Math.abs(leftDay - rightDay) / DAY_MS;
}

function validWaterCut(value: number): boolean {
  return Number.isFinite(value) && value >= 0 && value <= 100;
}

export function buildWaterCutIssues(
  labRows: WaterCutRow[],
  productionRows: WaterCutRow[],
): PriorityIssue[] {
  return labRows.flatMap((lab) => {
    if (!validWaterCut(lab.waterCut) || utcDay(lab.date) == null) return [];
    const production = productionRows
      .flatMap((row) => {
        if (row.wellNo !== lab.wellNo || !validWaterCut(row.waterCut)) return [];
        const distance = dayDistance(row.date, lab.date);
        return distance != null && distance <= 7 ? [{ row, distance }] : [];
      })
      .sort((left, right) => left.distance - right.distance)[0]?.row;
    if (!production) return [];

    const deviation = Math.abs(lab.waterCut - production.waterCut);
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
  if (!Number.isFinite(annualizedOil)) return null;
  const rate = ((previousYearOil - annualizedOil) / previousYearOil) * 100;
  return Number.isFinite(rate) ? Number(rate.toFixed(1)) : null;
}

export function buildInjectionPeriodIssues(rows: InjectionPeriodRow[]): PriorityIssue[] {
  return rows.flatMap((row) => {
    if (
      !Number.isFinite(row.previousAverageOil)
      || row.previousAverageOil <= 0
      || !Number.isFinite(row.currentAverageOil)
      || row.currentAverageOil < 0
    ) return [];

    const change = ((row.currentAverageOil - row.previousAverageOil) / row.previousAverageOil) * 100;
    if (!Number.isFinite(change) || Math.abs(change) <= 20) return [];

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

  const rate = (currentOil / beforeOil) * 100;
  return Number.isFinite(rate) ? Number(rate.toFixed(1)) : null;
}

export function calculateSoakingDays(stopDate: string, asOfDate: string): number | null {
  const stopDay = utcDay(stopDate);
  const asOfDay = utcDay(asOfDate);
  if (stopDay == null || asOfDay == null) return null;
  return Math.max(0, Math.floor((asOfDay - stopDay) / DAY_MS));
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
      totalOil: null,
      missingWells: 0,
    };
    const hasOil = row.currentOil != null && Number.isFinite(row.currentOil) && row.currentOil >= 0;
    item.wells += 1;
    item.producingWells += row.producing ? 1 : 0;
    if (hasOil) item.totalOil = (item.totalOil ?? 0) + row.currentOil!;
    item.missingWells += hasOil ? 0 : 1;
    return summary;
  }, {});
}
