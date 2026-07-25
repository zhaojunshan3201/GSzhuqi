import type { CockpitAlertType, InjectionProductionCockpit } from './injectionProductionCockpit';

export type CockpitMeasureFilters = {
  keyword?: string;
  block?: string;
  alertType?: CockpitAlertType;
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
  const name = typeof params === 'object' && params !== null && 'name' in params ? (params as { name?: unknown }).name : null;
  return typeof name === 'string' && name.trim() ? { block: name } : null;
}

export function getCockpitAlertDrilldown(params: unknown): Pick<CockpitMeasureFilters, 'alertType'> | null {
  const name = typeof params === 'object' && params !== null && 'name' in params ? (params as { name?: unknown }).name : null;
  const alertType = typeof name === 'string' ? alertTypeByLabel.get(name) : undefined;
  return alertType ? { alertType } : null;
}

export function applyCockpitMeasureFilters<T extends { keyword: string; block: string }>(
  current: T,
  filters: CockpitMeasureFilters,
): { query: T; alertType: CockpitAlertType | undefined } {
  return {
    query: { ...current, keyword: filters.keyword || '', block: filters.block || '' },
    alertType: filters.alertType,
  };
}

export function filterMeasuresByCockpitAlerts<T extends { jh: string }>(
  rows: T[],
  alerts: readonly Pick<InjectionProductionCockpit['alerts'][number], 'type' | 'wellNo'>[],
  alertType?: CockpitAlertType,
): T[] {
  if (!alertType) return rows;
  const wells = new Set(alerts.filter((alert) => alert.type === alertType).map((alert) => alert.wellNo));
  return rows.filter((row) => wells.has(row.jh));
}
