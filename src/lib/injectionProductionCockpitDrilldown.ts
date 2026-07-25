import type { CockpitAlertType, InjectionProductionCockpit } from './injectionProductionCockpit';

export type CockpitMeasureFilters = {
  keyword?: string;
  block?: string;
  alertType?: CockpitAlertType;
};

export function buildCockpitMeasureFilters(filters: CockpitMeasureFilters): CockpitMeasureFilters {
  return Object.fromEntries(Object.entries(filters).filter(([, value]) => Boolean(value))) as CockpitMeasureFilters;
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

