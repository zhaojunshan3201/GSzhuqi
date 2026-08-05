import type { DatabaseLike } from './channelingProjectStore.ts';

export type MetricRole = 'injector' | 'producer';
export type MetricRange = { start: string; end: string };
export type ComparisonRange = { beforeStart: string; splitDate: string; afterEnd: string };
export type MetricPoint = { average: number | null; validDays: number };
export type ProductionRow = { date: string; oil: number | null; liquid: number | null; waterCut: number | null; block: string | null };
export type InjectionStage = { cycleNo: number | null; startDate: string; endDate: string | null; steamVolume: number | null; temperature: number | null; pressure: number | null; dryness: number | null; productionHours: number | null };
export type ProductionSummary = {
  rows: ProductionRow[];
  latest: { date: string; oil: number | null; liquid: number | null; waterCut: number | null; block: string | null };
  oil: MetricPoint;
  liquid: MetricPoint;
  waterCut: MetricPoint;
  last7Days: { oil: MetricPoint; liquid: MetricPoint; waterCut: MetricPoint };
  last30Days: { oil: MetricPoint; liquid: MetricPoint; waterCut: MetricPoint };
};
export type InjectionSummary = { stages: InjectionStage[]; cumulativeSteam: number | null; cycleCount: number };
export type WellMetrics = {
  wellNo: string;
  normalizedWellNo: string;
  roles: MetricRole[];
  queriedAt: string;
  range: MetricRange;
  production: ProductionSummary | null;
  injection: InjectionSummary | null;
};
export type ProductionWindowMetric = {
  beforeAverage: number | null;
  afterAverage: number | null;
  change: number | null;
  changeRate: number | null;
  beforeValidDays: number;
  afterValidDays: number;
};
export type ProductionWindowComparison = { oil: ProductionWindowMetric; liquid: ProductionWindowMetric; waterCut: ProductionWindowMetric };

function finiteNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function calendarDate(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || value.startsWith('0000-')) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

export function validateMetricRange(start: string, end: string): void {
  if (!calendarDate(start) || !calendarDate(end) || start > end) throw new Error('date range is invalid');
}

export function validateComparisonRange(range: ComparisonRange): void {
  if (!calendarDate(range.beforeStart) || !calendarDate(range.splitDate) || !calendarDate(range.afterEnd)
    || range.beforeStart > range.splitDate || range.splitDate >= range.afterEnd) throw new Error('comparison range is invalid');
}

export function normalizeMetricWellNo(value: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error('wellNo is required');
  return value.trim().toUpperCase();
}

function average(values: unknown[]): MetricPoint {
  const valid = values.map(finiteNumber).filter((value): value is number => value !== null);
  return { average: valid.length ? valid.reduce((sum, value) => sum + value, 0) / valid.length : null, validDays: valid.length };
}

function shiftDate(date: string, days: number): string {
  const result = new Date(`${date}T00:00:00Z`);
  result.setUTCDate(result.getUTCDate() + days);
  return result.toISOString().slice(0, 10);
}

function metricSet(rows: ProductionRow[]): { oil: MetricPoint; liquid: MetricPoint; waterCut: MetricPoint } {
  return {
    oil: average(rows.map((row) => row.oil)),
    liquid: average(rows.map((row) => row.liquid)),
    waterCut: average(rows.map((row) => row.waterCut)),
  };
}

function latestValue(rows: ProductionRow[], field: 'oil' | 'liquid' | 'waterCut'): number | null {
  for (let index = rows.length - 1; index >= 0; index -= 1) {
    const value = finiteNumber(rows[index][field]);
    if (value !== null) return value;
  }
  return null;
}

function summarizeProduction(rows: ProductionRow[]): ProductionSummary {
  const latestDate = rows[rows.length - 1].date;
  const latestBlock = [...rows].reverse().find((row) => typeof row.block === 'string')?.block ?? null;
  return {
    rows,
    latest: { date: latestDate, oil: latestValue(rows, 'oil'), liquid: latestValue(rows, 'liquid'), waterCut: latestValue(rows, 'waterCut'), block: latestBlock },
    ...metricSet(rows),
    last7Days: metricSet(rows.filter((row) => row.date >= shiftDate(latestDate, -6) && row.date <= latestDate)),
    last30Days: metricSet(rows.filter((row) => row.date >= shiftDate(latestDate, -29) && row.date <= latestDate)),
  };
}

function summarizeInjection(stages: InjectionStage[]): InjectionSummary {
  const steam = stages.map((stage) => finiteNumber(stage.steamVolume)).filter((value): value is number => value !== null);
  return { stages, cumulativeSteam: steam.length ? steam.reduce((sum, value) => sum + value, 0) : null, cycleCount: stages.length };
}

function productionRow(row: any): ProductionRow {
  return {
    date: row.date,
    oil: finiteNumber(row.oil),
    liquid: finiteNumber(row.liquid),
    waterCut: finiteNumber(row.waterCut),
    block: typeof row.block === 'string' ? row.block : null,
  };
}

function injectionStage(row: any): InjectionStage {
  return {
    cycleNo: finiteNumber(row.cycleNo),
    startDate: row.startDate,
    endDate: typeof row.endDate === 'string' ? row.endDate : null,
    steamVolume: finiteNumber(row.steamVolume),
    temperature: finiteNumber(row.temperature),
    pressure: finiteNumber(row.pressure),
    dryness: finiteNumber(row.dryness),
    productionHours: finiteNumber(row.productionHours),
  };
}

export function compareProductionWindows(rows: Array<Partial<ProductionRow> & { date: string }>, range: ComparisonRange): ProductionWindowComparison {
  validateComparisonRange(range);
  const summarize = (field: 'oil' | 'liquid' | 'waterCut'): ProductionWindowMetric => {
    const before = average(rows.filter((row) => row.date >= range.beforeStart && row.date <= range.splitDate).map((row) => row[field]));
    const after = average(rows.filter((row) => row.date > range.splitDate && row.date <= range.afterEnd).map((row) => row[field]));
    const change = before.average === null || after.average === null ? null : after.average - before.average;
    return {
      beforeAverage: before.average,
      afterAverage: after.average,
      change,
      changeRate: change === null || before.average === null || before.average === 0 ? null : change / before.average,
      beforeValidDays: before.validDays,
      afterValidDays: after.validDays,
    };
  };
  return { oil: summarize('oil'), liquid: summarize('liquid'), waterCut: summarize('waterCut') };
}

async function loadProductionRows(db: DatabaseLike, normalizedWellNo: string, start: string, end: string): Promise<ProductionRow[]> {
  return (await db.all(
    'SELECT rq AS date, oil, liquid, water_cut AS waterCut, block FROM production WHERE UPPER(TRIM(jh)) = ? AND rq BETWEEN ? AND ? ORDER BY rq ASC',
    [normalizedWellNo, start, end],
  )).map(productionRow);
}

export async function getWellMetrics(db: DatabaseLike, wellNo: string, start: string, end: string): Promise<WellMetrics> {
  validateMetricRange(start, end);
  const normalizedWellNo = normalizeMetricWellNo(wellNo);
  const [productionRows, stageRows, roleRow] = await Promise.all([
    loadProductionRows(db, normalizedWellNo, start, end),
    db.all(
      'SELECT cycle_no AS cycleNo, start_date AS startDate, end_date AS endDate, steam_volume AS steamVolume, temperature, pressure, dryness, production_hours AS productionHours FROM injection_stage_rows WHERE UPPER(TRIM(well_no)) = ? AND start_date <= ? AND COALESCE(end_date, start_date) >= ? ORDER BY start_date ASC, cycle_no ASC',
      [normalizedWellNo, end, start],
    ),
    db.get(`SELECT
      EXISTS(SELECT 1 FROM channeling_relations WHERE UPPER(TRIM(injection_well)) = ?)
        OR EXISTS(SELECT 1 FROM injection_stage_rows WHERE UPPER(TRIM(well_no)) = ?) AS injector,
      EXISTS(SELECT 1 FROM channeling_relations WHERE UPPER(TRIM(production_well)) = ?)
        OR EXISTS(SELECT 1 FROM production WHERE UPPER(TRIM(jh)) = ?) AS producer`,
    [normalizedWellNo, normalizedWellNo, normalizedWellNo, normalizedWellNo]),
  ]);
  const roles: MetricRole[] = [];
  if (Boolean(roleRow?.injector)) roles.push('injector');
  if (Boolean(roleRow?.producer)) roles.push('producer');
  const stages = stageRows.map(injectionStage);
  return {
    wellNo,
    normalizedWellNo,
    roles,
    queriedAt: new Date().toISOString(),
    range: { start, end },
    production: productionRows.length ? summarizeProduction(productionRows) : null,
    injection: stages.length ? summarizeInjection(stages) : null,
  };
}

export type RelationMetrics = {
  relationId: number;
  injectionWell: string;
  productionWell: string;
  range: ComparisonRange;
  injector: WellMetrics;
  producerSeries: ProductionRow[];
  comparison: ProductionWindowComparison;
  generatedAt: string;
};

export async function getRelationMetrics(db: DatabaseLike, relationId: number, range: ComparisonRange): Promise<RelationMetrics> {
  validateComparisonRange(range);
  const relation = await db.get('SELECT * FROM channeling_relations WHERE id = ?', [relationId]);
  if (!relation) throw new Error('Relation not found');
  const [injector, producerSeries] = await Promise.all([
    getWellMetrics(db, relation.injection_well, range.beforeStart, range.afterEnd),
    loadProductionRows(db, normalizeMetricWellNo(relation.production_well), range.beforeStart, range.afterEnd),
  ]);
  return {
    relationId,
    injectionWell: relation.injection_well,
    productionWell: relation.production_well,
    range: { ...range },
    injector,
    producerSeries,
    comparison: compareProductionWindows(producerSeries, range),
    generatedAt: new Date().toISOString(),
  };
}

export type ProjectSummary = {
  projectId: number;
  start: string;
  end: string;
  range: MetricRange;
  generatedAt: string;
  relationCount: number;
  activeRelationCount: number;
  releasedRelationCount: number;
  injectorCount: number;
  producerCount: number;
  uniqueWellCount: number;
  cumulativeSteam: number | null;
  latestTotalOil: number | null;
  evaluatedCount: number;
  latestEvaluationConclusion: string | null;
};

async function evaluationSummary(db: DatabaseLike, projectId: number): Promise<{ count: number; conclusion: string | null }> {
  const tables = await db.all("SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('channeling_tracking_events', 'channeling_tracking_event_links')");
  if (tables.length < 2) return { count: 0, conclusion: null };
  const rows = await db.all(`SELECT DISTINCT e.id, e.occurred_on AS occurredOn, e.content
    FROM channeling_tracking_events e
    JOIN channeling_tracking_event_links l ON l.event_id = e.id
    WHERE e.event_type = ? AND e.voided_at IS NULL AND (
      (l.subject_type = ? AND l.subject_id = ?)
      OR (l.subject_type = ? AND l.subject_id IN (SELECT id FROM channeling_relations WHERE project_id = ?))
    ) ORDER BY e.occurred_on DESC, e.id DESC`, ['evaluated', 'project', projectId, 'relation', projectId]);
  return { count: rows.length, conclusion: rows.length && typeof rows[0].content === 'string' ? rows[0].content : null };
}

export async function getProjectSummary(db: DatabaseLike, projectId: number, start: string, end: string): Promise<ProjectSummary> {
  validateMetricRange(start, end);
  if (!await db.get('SELECT id FROM channeling_projects WHERE id = ?', [projectId])) throw new Error('Project not found');
  const relations = await db.all('SELECT * FROM channeling_relations WHERE project_id = ? ORDER BY id ASC', [projectId]);
  const injectors = [...new Map(relations.map((row) => [normalizeMetricWellNo(row.injection_well), row.injection_well] as const)).values()];
  const producers = [...new Map(relations.map((row) => [normalizeMetricWellNo(row.production_well), row.production_well] as const)).values()];
  const [injectorMetrics, producerMetrics, evaluations] = await Promise.all([
    Promise.all(injectors.map((wellNo) => getWellMetrics(db, wellNo, start, end))),
    Promise.all(producers.map((wellNo) => getWellMetrics(db, wellNo, start, end))),
    evaluationSummary(db, projectId),
  ]);
  const steam = injectorMetrics.map((item) => item.injection?.cumulativeSteam ?? null).filter((value): value is number => value !== null);
  const oil = producerMetrics.map((item) => item.production?.latest.oil ?? null).filter((value): value is number => value !== null);
  const allWells = new Set([...injectors, ...producers].map(normalizeMetricWellNo));
  return {
    projectId,
    start,
    end,
    range: { start, end },
    generatedAt: new Date().toISOString(),
    relationCount: relations.length,
    activeRelationCount: relations.filter((relation) => relation.status !== 'released').length,
    releasedRelationCount: relations.filter((relation) => relation.status === 'released').length,
    injectorCount: injectors.length,
    producerCount: producers.length,
    uniqueWellCount: allWells.size,
    cumulativeSteam: steam.length ? steam.reduce((sum, value) => sum + value, 0) : null,
    latestTotalOil: oil.length ? oil.reduce((sum, value) => sum + value, 0) : null,
    evaluatedCount: evaluations.count,
    latestEvaluationConclusion: evaluations.conclusion,
  };
}
