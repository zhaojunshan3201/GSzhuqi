export type ComparisonStatus = 'not_started' | 'in_progress' | 'on_schedule' | 'early' | 'delayed' | 'incomplete';

export type InjectionPlanActualComparison = {
  projectId: number;
  planMonth: string | null;
  wellNo: string;
  plannedStartDate: string | null;
  actualStartDate: string | null;
  startVarianceDays: number | null;
  plannedEndDate: string | null;
  actualEndDate: string | null;
  endVarianceDays: number | null;
  plannedBoiler: string | null;
  actualBoiler: string | null;
  boilerMatches: boolean | null;
  plannedSteam: number | null;
  actualSteam: number | null;
  steamVariance: number | null;
  completionRate: number | null;
  plannedProcess: string | null;
  actualProcess: string | null;
  comparisonStatus: ComparisonStatus;
};

export type InjectionPlanActualComparisonFilters = {
  planMonth?: string;
  unit?: string;
  boiler?: string;
  status?: ComparisonStatus;
};

type DatabaseLike = { all(sql: string, params?: unknown[]): Promise<any[]> };
type Actual = { id: number; startDate: string | null; endDate: string | null; boiler: string | null; steam: number | null; process: string | null };

function normalizedText(value: unknown): string | null {
  const text = String(value ?? '').trim();
  return text || null;
}

function normalizedWellNo(value: unknown): string {
  return String(value ?? '').replace(/\s+/g, '').toUpperCase();
}

function numberValue(value: unknown): number | null {
  if (value == null || String(value).trim() === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function dateValue(value: unknown): string | null {
  const text = normalizedText(value);
  if (!text) return null;

  if (/^\d+(?:\.\d+)?$/.test(text)) {
    const serial = Number(text);
    if (Number.isFinite(serial) && serial >= 1) {
      const wholeDays = Math.floor(serial);
      const adjustedDays = wholeDays >= 60 ? wholeDays - 1 : wholeDays;
      const date = new Date(Date.UTC(1899, 11, 31) + adjustedDays * 86400000);
      return date.toISOString().slice(0, 10);
    }
  }

  const match = text.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})(?:[T\s].*)?$/);
  if (!match) return text;
  return `${match[1]}-${match[2].padStart(2, '0')}-${match[3].padStart(2, '0')}`;
}

function detail(row: any): Record<string, unknown> {
  if (typeof row.detail_json !== 'string') return row.detail_json && typeof row.detail_json === 'object' ? row.detail_json : {};
  try {
    const parsed = JSON.parse(row.detail_json);
    if (!parsed || typeof parsed !== 'object') return {};
    return { ...(parsed.rawExtras || {}), ...(parsed.currentRound || {}), ...parsed };
  } catch { return {}; }
}

function firstValue(row: any, json: Record<string, unknown>, keys: string[]): unknown {
  for (const key of keys) if (row[key] != null && String(row[key]).trim() !== '') return row[key];
  for (const key of keys) if (json[key] != null && String(json[key]).trim() !== '') return json[key];
  return null;
}

function actualFrom(row: any): Actual {
  const json = detail(row);
  return {
    id: Number(row.id) || 0,
    startDate: dateValue(firstValue(row, json, ['current_round_start_time', 'current_round_injection_time', 'current_round_start_date', 'current_round_open_time', '\u5f00\u6ce8\u65f6\u95f4', '开注时间'])),
    endDate: dateValue(firstValue(row, json, ['current_round_stop_time', 'current_round_end_time', 'current_round_end_date', '\u505c\u6ce8\u65f6\u95f4', '停注时间'])),
    boiler: normalizedText(firstValue(row, json, ['current_round_boiler', 'current_round_boiler_no', 'boiler', '\u9505\u7089\u7f16\u53f7', '锅炉编号'])),
    steam: numberValue(firstValue(row, json, ['current_round_steam', 'current_round_cumulative_steam', 'actual_steam', 'cumulative_steam', '\u7d2f\u6ce8\u6c7d\u91cf', '累注汽量'])),
    process: normalizedText(firstValue(row, json, ['current_round_process', 'current_round_process_type', 'current_round_measure_type', 'process_type', '\u63aa\u65bd\u7c7b\u578b', '措施类型'])),
  };
}

function variance(actual: string | null, planned: string | null): number | null {
  if (!actual || !planned) return null;
  const actualTime = Date.parse(`${actual}T00:00:00Z`);
  const plannedTime = Date.parse(`${planned}T00:00:00Z`);
  return Number.isFinite(actualTime) && Number.isFinite(plannedTime) ? Math.round((actualTime - plannedTime) / 86400000) : null;
}

function statusFor(row: Omit<InjectionPlanActualComparison, 'comparisonStatus'>): ComparisonStatus {
  if (!row.actualStartDate) return 'not_started';
  const missingCriticalData = !row.plannedStartDate || !row.plannedEndDate || row.plannedBoiler == null || row.actualBoiler == null || row.plannedSteam == null || row.actualSteam == null || row.plannedProcess == null || row.actualProcess == null;
  if (missingCriticalData) return 'incomplete';
  if (!row.actualEndDate) return 'in_progress';
  if ((row.startVarianceDays ?? 0) > 1 || (row.endVarianceDays ?? 0) > 1) return 'delayed';
  if ((row.startVarianceDays ?? 0) < -1 || (row.endVarianceDays ?? 0) < -1) return 'early';
  return 'on_schedule';
}

export async function buildInjectionPlanActualComparison(db: DatabaseLike, filters: InjectionPlanActualComparisonFilters = {}): Promise<InjectionPlanActualComparison[]> {
  const [projects, tracking] = await Promise.all([
    db.all(`SELECT p.*, i.plan_month FROM injection_projects p LEFT JOIN injection_plan_imports i ON i.id = p.source_import_id`),
    db.all(`SELECT * FROM measure_tracking WHERE TRIM(COALESCE(jh, '')) != ''`),
  ]);
  const actualByWell = new Map<string, Actual>();
  for (const trackingRow of tracking) {
    const wellNo = normalizedWellNo(trackingRow.jh);
    const actual = actualFrom(trackingRow);
    const current = actualByWell.get(wellNo);
    if (!current || (actual.startDate || '') > (current.startDate || '') || ((actual.startDate || '') === (current.startDate || '') && actual.id > current.id)) actualByWell.set(wellNo, actual);
  }

  return projects
    .map((project) => {
      const wellNo = normalizedWellNo(project.well_no);
      const actual = actualByWell.get(wellNo) ?? { id: 0, startDate: null, endDate: null, boiler: null, steam: null, process: null };
      const plannedStartDate = dateValue(project.planned_start_date);
      const plannedEndDate = dateValue(project.planned_end_date);
      const plannedBoiler = normalizedText(project.boiler);
      const plannedSteam = numberValue(project.planned_steam);
      const plannedProcess = normalizedText(project.process_type);
      const result = {
        projectId: project.id,
        planMonth: normalizedText(project.plan_month),
        wellNo,
        plannedStartDate,
        actualStartDate: actual.startDate,
        startVarianceDays: variance(actual.startDate, plannedStartDate),
        plannedEndDate,
        actualEndDate: actual.endDate,
        endVarianceDays: variance(actual.endDate, plannedEndDate),
        plannedBoiler,
        actualBoiler: actual.boiler,
        boilerMatches: plannedBoiler && actual.boiler ? plannedBoiler === actual.boiler : null,
        plannedSteam,
        actualSteam: actual.steam,
        steamVariance: plannedSteam != null && actual.steam != null ? actual.steam - plannedSteam : null,
        completionRate: plannedSteam != null && plannedSteam !== 0 && actual.steam != null ? actual.steam / plannedSteam : null,
        plannedProcess,
        actualProcess: actual.process,
      };
      return { ...result, comparisonStatus: statusFor(result) };
    })
    .filter((row) => (!filters.planMonth || row.planMonth === filters.planMonth)
      && (!filters.unit || normalizedText(projects.find((project) => project.id === row.projectId)?.unit) === filters.unit)
      && (!filters.boiler || row.plannedBoiler === filters.boiler)
      && (!filters.status || row.comparisonStatus === filters.status))
    .sort((a, b) => a.wellNo.localeCompare(b.wellNo));
}
