import type { CockpitAlertType, InjectionProductionCockpit } from './injectionProductionCockpit';

export type CockpitMeasureFilters = {
  keyword?: string;
  block?: string;
  alertType?: CockpitAlertType;
  alertWellNos?: string[];
};

export const cockpitAlertLabels: Record<CockpitAlertType, string> = {
  needsData: '数据待补全',
  notEvaluated: '未评价',
  lowEfficiency: '低效井',
  soakingOverdue: '焖井逾期',
  transferOverdue: '待转抽逾期',
};

const alertTypeByLabel = new Map(Object.entries(cockpitAlertLabels).map(([type, label]) => [label, type as CockpitAlertType]));

export function getCockpitBlockDrilldown(params: unknown): Pick<CockpitMeasureFilters, 'block'> | null {
  if (typeof params !== 'object' || params === null) return null;
  const event = params as { name?: unknown; axisValue?: unknown; data?: unknown };
  const dataName = typeof event.data === 'object' && event.data !== null && 'name' in event.data
    ? (event.data as { name?: unknown }).name
    : null;
  const name = [event.name, dataName, event.axisValue]
    .find((candidate) => typeof candidate === 'string' && candidate.trim());
  return typeof name === 'string' ? { block: name.trim() } : null;
}

export function formatCockpitMetric(
  value: number,
  metric: keyof InjectionProductionCockpit['metrics'],
): string {
  return new Intl.NumberFormat('zh-CN', {
    maximumFractionDigits: metric === 'oilSteamRatio' ? 3 : 2,
  }).format(value);
}

export function getCockpitAlertDrilldown(
  params: unknown,
  alerts: readonly Pick<InjectionProductionCockpit['alerts'][number], 'type' | 'wellNo'>[],
): Pick<CockpitMeasureFilters, 'alertType' | 'alertWellNos'> | null {
  const name = typeof params === 'object' && params !== null && 'name' in params ? (params as { name?: unknown }).name : null;
  const alertType = typeof name === 'string' ? alertTypeByLabel.get(name) : undefined;
  if (!alertType) return null;
  return {
    alertType,
    alertWellNos: [...new Set(alerts.filter((alert) => alert.type === alertType).map((alert) => alert.wellNo))],
  };
}

type MeasureQuery = {
  start: string;
  end: string;
  block: string;
  station: string;
  status: string;
  keyword: string;
  year: string;
};

export function applyCockpitMeasureFilters(
  _current: MeasureQuery,
  filters: CockpitMeasureFilters,
): { query: MeasureQuery; alertType: CockpitAlertType | undefined } {
  return {
    query: {
      start: '',
      end: '',
      block: filters.block || '',
      station: '',
      status: '',
      keyword: filters.keyword || '',
      year: '',
    },
    alertType: filters.alertType,
  };
}

export function filterMeasuresByCockpitWellNos<T extends { jh: string }>(
  rows: T[],
  wellNos?: readonly string[],
): T[] {
  if (!wellNos) return rows;
  const wells = new Set(wellNos);
  return rows.filter((row) => wells.has(row.jh));
}
