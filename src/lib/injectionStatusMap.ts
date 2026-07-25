export type InjectionMapLifecycleStatus =
  | 'pending'
  | 'injecting'
  | 'soaking'
  | 'pendingTransfer'
  | 'producing'
  | 'closed'
  | 'needsData';

export type InjectionMapAlertType = 'needsData' | 'notEvaluated' | 'lowEfficiency' | 'soakingOverdue' | 'transferOverdue';

export type InjectionMapWell = {
  wellNo: string;
  block: string;
  station: string | null;
  xPercent: number | null;
  yPercent: number | null;
  lifecycleStatus: InjectionMapLifecycleStatus;
  statusSource: 'project' | 'tracking';
  planMonth: string | null;
  projectId: number | null;
  owner: string | null;
  plannedStartDate: string | null;
  plannedEndDate: string | null;
  actualStartDate: string | null;
  actualEndDate: string | null;
  plannedTransferDate: string | null;
  overdueDays: number | null;
  plannedSteam: number | null;
  actualSteam: number | null;
  currentOil: number | null;
  cumulativeOilGain: number | null;
  oilSteamRatio: number | null;
  evaluation: string | null;
  alertTypes: InjectionMapAlertType[];
};

export type InjectionStatusMapFilters = {
  block?: string;
  lifecycleStatus?: InjectionMapLifecycleStatus;
  planMonth?: string;
  alertType?: InjectionMapAlertType | string;
  overdue?: boolean | 'true';
  keyword?: string;
};

type DatabaseLike = { all(sql: string, params?: unknown[]): Promise<any[]> };
type ProjectRow = Record<string, unknown>;
type TrackingRow = Record<string, unknown>;

const lifecycleStatuses = new Set<InjectionMapLifecycleStatus>(['pending', 'injecting', 'soaking', 'pendingTransfer', 'producing', 'closed']);

function text(value: unknown): string | null {
  const result = String(value ?? '').trim();
  return result || null;
}

function number(value: unknown): number | null {
  if (value == null || (typeof value === 'string' && !value.trim())) return null;
  const result = Number(value);
  return Number.isFinite(result) ? result : null;
}

function datePart(value: unknown): string | null {
  const match = text(value)?.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!match) return null;
  const [year, month, day] = match.slice(1).map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day ? match[0] : null;
}

function daysSince(today: string, date: string | null): number | null {
  const currentDate = datePart(today);
  if (!currentDate || !date) return null;
  const elapsed = Date.parse(`${currentDate}T00:00:00Z`) - Date.parse(`${date}T00:00:00Z`);
  return Number.isFinite(elapsed) ? Math.max(0, Math.floor(elapsed / 86_400_000)) : null;
}

function trackingStatus(value: unknown): InjectionMapLifecycleStatus {
  switch (text(value)) {
    case '\u6b63\u6ce8': return 'injecting';
    case '\u7116\u4e95': return 'soaking';
    case '\u8f6c\u6ce8': return 'pendingTransfer';
    case '\u751f\u4ea7': return 'producing';
    default: return 'needsData';
  }
}

function projectStatus(value: unknown): InjectionMapLifecycleStatus {
  const status = text(value) as InjectionMapLifecycleStatus | null;
  return status && lifecycleStatuses.has(status) ? status : 'needsData';
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function detail(row: TrackingRow | undefined): Record<string, unknown> {
  if (!row) return {};
  let parsed: unknown = row.detail_json;
  if (typeof parsed === 'string') {
    try {
      parsed = JSON.parse(parsed);
    } catch {
      return {};
    }
  }
  const values = record(parsed);
  return { ...record(values.rawExtras), ...record(values.currentRound), ...values };
}

function firstValue(row: TrackingRow | undefined, values: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = row?.[key] ?? values[key];
    if (value != null && (typeof value !== 'string' || value.trim())) return value;
  }
  return null;
}

function actualDates(row: TrackingRow | undefined, values: Record<string, unknown>) {
  return {
    actualStartDate: datePart(firstValue(row, values, ['actual_start_date', '\u5f00\u6ce8\u65f6\u95f4'])),
    actualEndDate: datePart(firstValue(row, values, ['actual_end_date', '\u505c\u6ce8\u65f6\u95f4'])),
  };
}

function actualSteam(row: TrackingRow | undefined, values: Record<string, unknown>) {
  return number(firstValue(row, values, [
    'actual_steam', 'current_round_steam', 'current_steam', 'current_round_cumulative_steam', 'cumulative_steam',
    '\u7d2f\u6ce8\u6c7d\u91cf', '\u5b9e\u9645\u6ce8\u6c7d\u91cf',
  ]));
}

function addAlert(alertTypes: InjectionMapAlertType[], alert: InjectionMapAlertType) {
  if (!alertTypes.includes(alert)) alertTypes.push(alert);
}

export async function buildInjectionStatusMap(db: DatabaseLike, options: { today: string }): Promise<{ wells: InjectionMapWell[] }> {
  const [projects, trackingRows, markers, cycles] = await Promise.all([
    db.all(`
      SELECT * FROM (
        SELECT ip.*, ROW_NUMBER() OVER (
          PARTITION BY well_no
          ORDER BY CASE WHEN lifecycle_status = 'closed' THEN 1 ELSE 0 END, updated_at DESC, id DESC
        ) AS row_number
        FROM injection_projects ip
        WHERE TRIM(COALESCE(well_no, '')) != ''
          AND lifecycle_status IN ('pending', 'injecting', 'soaking', 'pendingTransfer', 'producing', 'closed')
      ) WHERE row_number = 1
    `),
    db.all(`
      SELECT * FROM (
        SELECT mt.*, ROW_NUMBER() OVER (PARTITION BY jh ORDER BY current_round_transfer_time DESC, id DESC) AS row_number
        FROM measure_tracking mt WHERE TRIM(COALESCE(jh, '')) != ''
      ) WHERE row_number = 1
    `),
    db.all('SELECT * FROM well_map_markers'),
    db.all('SELECT * FROM measure_well_cycles'),
  ]);
  const projectsByWell = new Map<string, ProjectRow>(projects.map((row) => [text(row.well_no)!, row]));
  const trackingByWell = new Map<string, TrackingRow>(trackingRows.map((row) => [text(row.jh)!, row]));
  const markerByWell = new Map<string, Record<string, unknown>>(markers.map((row) => [text(row.well_no)!, row]));
  const cycleByWell = new Map<string, { steam: number; oil: number }>();

  for (const cycle of cycles) {
    const wellNo = text(cycle.well_name);
    const steam = number(cycle.actual_steam);
    const oil = number(cycle.cycle_oil);
    if (!wellNo || steam == null || steam <= 0 || oil == null) continue;
    const total = cycleByWell.get(wellNo) || { steam: 0, oil: 0 };
    total.steam += steam;
    total.oil += oil;
    cycleByWell.set(wellNo, total);
  }

  const wellNos = new Set([...projectsByWell.keys(), ...trackingByWell.keys()]);
  const wells = [...wellNos].sort((left, right) => left.localeCompare(right, 'zh-CN')).map((wellNo) => {
    const project = projectsByWell.get(wellNo);
    const tracking = trackingByWell.get(wellNo);
    const marker = markerByWell.get(wellNo);
    const source = project ? 'project' : 'tracking';
    const lifecycleStatus = project ? projectStatus(project.lifecycle_status) : trackingStatus(tracking?.current_status);
    const plannedTransferDate = datePart(project?.planned_transfer_date);
    const trackingDate = datePart(tracking?.current_round_transfer_time);
    const overdueDays = project ? daysSince(options.today, plannedTransferDate) : null;
    const currentOil = number(tracking?.current_oil);
    const evaluation = text(tracking?.evaluation);
    const cyclesForWell = cycleByWell.get(wellNo);
    const alertTypes: InjectionMapAlertType[] = [];
    const alertStatus = trackingStatus(tracking?.current_status);
    const trackingComplete = Boolean(text(tracking?.current_status) && trackingDate && alertStatus !== 'needsData');
    const needsData = !trackingComplete || (alertStatus === 'producing' && currentOil == null);

    if (needsData) addAlert(alertTypes, 'needsData');
    else if (alertStatus === 'producing') {
      if (!evaluation) addAlert(alertTypes, 'notEvaluated');
      else if (evaluation === 'D') addAlert(alertTypes, 'lowEfficiency');
    }
    const elapsedDays = daysSince(options.today, trackingDate);
    if (!needsData && alertStatus === 'soaking' && elapsedDays != null && elapsedDays > 30) addAlert(alertTypes, 'soakingOverdue');
    if (!needsData && alertStatus === 'pendingTransfer' && elapsedDays != null && elapsedDays > 7) addAlert(alertTypes, 'transferOverdue');

    const trackingDetail = detail(tracking);
    const dates = actualDates(tracking, trackingDetail);
    return {
      wellNo,
      block: text(project?.block) || text(tracking?.block) || text(marker?.block) || '',
      station: text(tracking?.station),
      xPercent: number(marker?.x_percent),
      yPercent: number(marker?.y_percent),
      lifecycleStatus,
      statusSource: source,
      planMonth: (datePart(project?.planned_start_date) || plannedTransferDate)?.slice(0, 7) || null,
      projectId: number(project?.id),
      owner: text(project?.owner),
      plannedStartDate: datePart(project?.planned_start_date),
      plannedEndDate: datePart(project?.planned_end_date),
      actualStartDate: dates.actualStartDate,
      actualEndDate: dates.actualEndDate,
      plannedTransferDate,
      overdueDays,
      plannedSteam: number(project?.planned_steam),
      actualSteam: actualSteam(tracking, trackingDetail),
      currentOil,
      cumulativeOilGain: number(tracking?.cumulative_oil_gain),
      oilSteamRatio: cyclesForWell ? cyclesForWell.oil / cyclesForWell.steam : null,
      evaluation,
      alertTypes,
    } satisfies InjectionMapWell;
  });

  return { wells };
}

function hasMapCoordinates(well: InjectionMapWell) {
  return well.xPercent != null && well.yPercent != null && well.xPercent >= 0 && well.xPercent <= 100 && well.yPercent >= 0 && well.yPercent <= 100;
}

export function filterInjectionMapWells(wells: InjectionMapWell[], filters: InjectionStatusMapFilters = {}) {
  const block = text(filters.block);
  const lifecycleStatus = text(filters.lifecycleStatus);
  const planMonth = text(filters.planMonth);
  const alertType = text(filters.alertType);
  const keyword = text(filters.keyword)?.toLocaleLowerCase() || '';
  const filtered = wells.filter((well) =>
    (!block || well.block === block) &&
    (!lifecycleStatus || well.lifecycleStatus === lifecycleStatus) &&
    (!planMonth || well.planMonth === planMonth) &&
    (!alertType || well.alertTypes.includes(alertType as InjectionMapAlertType)) &&
    (!(filters.overdue === true || filters.overdue === 'true') || (well.overdueDays ?? 0) > 0) &&
    (!keyword || well.wellNo.toLocaleLowerCase().includes(keyword)),
  );
  return { mapWells: filtered.filter(hasMapCoordinates), unlocatedWells: filtered.filter((well) => !hasMapCoordinates(well)) };
}

export type InjectionStatusMapResponse = {
  filters: InjectionStatusMapFilters;
  mapWells: InjectionMapWell[];
  unlocatedWells: InjectionMapWell[];
  summary: ReturnType<typeof summarizeInjectionMap>;
};

const queryLifecycleStatuses = new Set<InjectionMapLifecycleStatus>([
  'pending', 'injecting', 'soaking', 'pendingTransfer', 'producing', 'closed', 'needsData',
]);
const queryAlertTypes = new Set<InjectionMapAlertType>([
  'needsData', 'notEvaluated', 'lowEfficiency', 'soakingOverdue', 'transferOverdue',
]);

function queryText(query: unknown, key: string): string | null {
  const value = record(query)[key];
  return typeof value === 'string' ? text(value) : null;
}

function parseInjectionStatusMapFilters(query: unknown): InjectionStatusMapFilters {
  const filters: InjectionStatusMapFilters = {};
  const block = queryText(query, 'block');
  const lifecycleStatus = queryText(query, 'lifecycleStatus');
  const planMonth = queryText(query, 'planMonth');
  const alertType = queryText(query, 'alertType');
  const keyword = queryText(query, 'keyword');

  if (block) filters.block = block;
  if (lifecycleStatus && queryLifecycleStatuses.has(lifecycleStatus as InjectionMapLifecycleStatus)) {
    filters.lifecycleStatus = lifecycleStatus as InjectionMapLifecycleStatus;
  }
  if (planMonth && /^\d{4}-(0[1-9]|1[0-2])$/.test(planMonth)) filters.planMonth = planMonth;
  if (alertType && queryAlertTypes.has(alertType as InjectionMapAlertType)) {
    filters.alertType = alertType as InjectionMapAlertType;
  }
  if (record(query).overdue === 'true') filters.overdue = true;
  if (keyword) filters.keyword = keyword;

  return filters;
}

export function buildInjectionStatusMapResponse(
  result: { wells: InjectionMapWell[] },
  query: unknown,
): InjectionStatusMapResponse {
  const filters = parseInjectionStatusMapFilters(query);
  const { mapWells, unlocatedWells } = filterInjectionMapWells(result.wells, filters);

  return {
    filters,
    mapWells,
    unlocatedWells,
    summary: summarizeInjectionMap(mapWells, unlocatedWells),
  };
}

export function summarizeInjectionMap(mapWells: InjectionMapWell[], unlocatedWells: InjectionMapWell[]) {
  return {
    total: mapWells.length,
    injecting: mapWells.filter((well) => well.lifecycleStatus === 'injecting').length,
    soaking: mapWells.filter((well) => well.lifecycleStatus === 'soaking').length,
    pendingTransfer: mapWells.filter((well) => well.lifecycleStatus === 'pendingTransfer').length,
    producing: mapWells.filter((well) => well.lifecycleStatus === 'producing').length,
    alerts: mapWells.filter((well) => well.alertTypes.length > 0).length,
    unlocated: unlocatedWells.length,
  };
}

