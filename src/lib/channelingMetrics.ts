import type { DatabaseLike } from './channelingProjectStore.ts';

export type MetricRole = 'injector' | 'producer';
export type MetricRange = { start: string; end: string };
export type ComparisonRange = { beforeStart: string; splitDate: string; afterEnd: string };
export type MetricPoint = { average: number | null; validDays: number };
export type ProductionRow = { date: string; oil: number | null; liquid: number | null; waterCut: number | null; block: string | null };
type ProductionLatest = { date: string; oil: number | null; liquid: number | null; waterCut: number | null; block: string | null };
export type InjectionStage = { cycleNo: number | null; startDate: string; endDate: string | null; steamVolume: number | null; temperature: number | null; pressure: number | null; dryness: number | null; productionHours: number | null };
export type ProductionSummary = {
  rows: ProductionRow[];
  latest: ProductionLatest;
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

export async function initChannelingMetricIndexes(db: DatabaseLike): Promise<void> {
  await db.exec(`CREATE INDEX IF NOT EXISTS idx_production_normalized_well_date ON production(UPPER(TRIM(jh)), rq);
    CREATE INDEX IF NOT EXISTS idx_injection_stage_normalized_well_date ON injection_stage_rows(UPPER(TRIM(well_no)), start_date, end_date);
    CREATE INDEX IF NOT EXISTS idx_channeling_relations_injection_normalized_well ON channeling_relations(UPPER(TRIM(injection_well)));
    CREATE INDEX IF NOT EXISTS idx_channeling_relations_production_normalized_well ON channeling_relations(UPPER(TRIM(production_well)));`);
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

function summarizeProduction(rows: ProductionRow[], history: ProductionRow[], latest: ProductionLatest): ProductionSummary {
  const latestDate = latest.date;
  return {
    rows,
    latest,
    ...metricSet(rows),
    last7Days: metricSet(history.filter((row) => row.date >= shiftDate(latestDate, -6))),
    last30Days: metricSet(history),
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
    `WITH ranked_production AS (
      SELECT rq AS date, oil, liquid, water_cut AS waterCut, block,
        ROW_NUMBER() OVER (PARTITION BY UPPER(TRIM(jh)), rq ORDER BY rowid DESC) AS rn
      FROM production WHERE UPPER(TRIM(jh)) = ? AND rq BETWEEN ? AND ?
    ) SELECT date, oil, liquid, waterCut, block FROM ranked_production WHERE rn = 1 ORDER BY date ASC`,
    [normalizedWellNo, start, end],
  )).map(productionRow);
}

async function loadProductionHistory(db: DatabaseLike, normalizedWellNo: string, end: string): Promise<{ rows: ProductionRow[]; latest: ProductionLatest | null }> {
  const row = await db.get(`WITH ranked_production AS (
      SELECT rq AS date, oil, liquid, water_cut AS waterCut, block,
        ROW_NUMBER() OVER (PARTITION BY UPPER(TRIM(jh)), rq ORDER BY rowid DESC) AS rn
      FROM production WHERE UPPER(TRIM(jh)) = ? AND rq <= ?
    ), canonical_production AS (
      SELECT date, oil, liquid, waterCut, block FROM ranked_production WHERE rn = 1
    ) SELECT MAX(date) AS date,
      (SELECT oil FROM canonical_production WHERE typeof(oil) IN ('integer', 'real') ORDER BY date DESC LIMIT 1) AS oil,
      (SELECT liquid FROM canonical_production WHERE typeof(liquid) IN ('integer', 'real') ORDER BY date DESC LIMIT 1) AS liquid,
      (SELECT waterCut FROM canonical_production WHERE typeof(waterCut) IN ('integer', 'real') ORDER BY date DESC LIMIT 1) AS waterCut,
      (SELECT block FROM canonical_production WHERE block IS NOT NULL ORDER BY date DESC LIMIT 1) AS block
    FROM canonical_production`, [normalizedWellNo, end]);
  if (!calendarDate(row?.date)) return { rows: [], latest: null };
  return {
    rows: await loadProductionRows(db, normalizedWellNo, shiftDate(row.date, -29), row.date),
    latest: {
      date: row.date,
      oil: finiteNumber(row.oil),
      liquid: finiteNumber(row.liquid),
      waterCut: finiteNumber(row.waterCut),
      block: typeof row.block === 'string' ? row.block : null,
    },
  };
}

export async function getWellMetrics(db: DatabaseLike, wellNo: string, start: string, end: string): Promise<WellMetrics> {
  validateMetricRange(start, end);
  const normalizedWellNo = normalizeMetricWellNo(wellNo);
  const [productionRows, productionHistory, stageRows, roleRow] = await Promise.all([
    loadProductionRows(db, normalizedWellNo, start, end),
    loadProductionHistory(db, normalizedWellNo, end),
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
    production: productionHistory.latest ? summarizeProduction(productionRows, productionHistory.rows, productionHistory.latest) : null,
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
  initialTotalOil: number | null;
  latestTotalOil: number | null;
  totalOilChange: number | null;
  latestAvailableDate: string | null;
  evaluatedCount: number;
  latestEvaluationConclusion: string | null;
};

async function evaluationSummary(db: DatabaseLike, projectId: number): Promise<{ count: number; conclusion: string | null }> {
  const tables = await db.all("SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('channeling_tracking_events', 'channeling_tracking_event_links')");
  if (tables.length < 2) return { count: 0, conclusion: null };
  const rows = await db.all(`WITH RECURSIVE evaluation_lineage(root_id, id, occurred_on, content, created_at, voided_at) AS (
      SELECT e.id, e.id, e.occurred_on, e.content, e.created_at, e.voided_at
      FROM channeling_tracking_events e
      WHERE e.event_type = ? AND EXISTS (
        SELECT 1 FROM channeling_tracking_event_links l WHERE l.event_id = e.id AND (
          (l.subject_type = ? AND l.subject_id = ?)
          OR (l.subject_type = ? AND l.subject_id IN (SELECT id FROM channeling_relations WHERE project_id = ?))
        )
      )
      UNION ALL
      SELECT parent.root_id, child.id, child.occurred_on, child.content, child.created_at, child.voided_at
      FROM evaluation_lineage parent
      JOIN channeling_tracking_events child ON child.supersedes_event_id = parent.id
    ) SELECT root_id, id, occurred_on AS occurredOn, content, created_at AS createdAt
    FROM evaluation_lineage lineage
    WHERE voided_at IS NULL AND NOT EXISTS (
      SELECT 1 FROM channeling_tracking_events child WHERE child.supersedes_event_id = lineage.id AND child.voided_at IS NULL
    ) ORDER BY occurred_on DESC, created_at DESC, id DESC`, ['evaluated', 'project', projectId, 'relation', projectId]);
  const roots = new Set(rows.map((row) => row.root_id));
  return { count: roots.size, conclusion: rows.length && typeof rows[0].content === 'string' ? rows[0].content : null };
}

async function projectCumulativeSteam(db: DatabaseLike, projectId: number, start: string, end: string): Promise<number | null> {
  const rows = await db.all(`SELECT steam_volume AS steamVolume FROM injection_stage_rows
    WHERE UPPER(TRIM(well_no)) IN (
      SELECT DISTINCT UPPER(TRIM(injection_well)) FROM channeling_relations WHERE project_id = ?
    ) AND start_date <= ? AND COALESCE(end_date, start_date) >= ?`, [projectId, end, start]);
  const values = rows.map((row) => finiteNumber(row.steamVolume)).filter((value): value is number => value !== null);
  return values.length ? values.reduce((sum, value) => sum + value, 0) : null;
}

async function projectOilTotals(db: DatabaseLike, projectId: number, start: string, end: string): Promise<{ initial: number | null; latest: number | null; change: number | null }> {
  const rows = await db.all(`WITH ranked_dates AS (
      SELECT UPPER(TRIM(jh)) AS normalizedWellNo, rq AS date, oil,
        ROW_NUMBER() OVER (PARTITION BY UPPER(TRIM(jh)), rq ORDER BY rowid DESC) AS date_rank
      FROM production WHERE UPPER(TRIM(jh)) IN (
        SELECT DISTINCT UPPER(TRIM(production_well)) FROM channeling_relations WHERE project_id = ?
      ) AND rq BETWEEN ? AND ?
    ), canonical_production AS (
      SELECT normalizedWellNo, date, oil FROM ranked_dates WHERE date_rank = 1
    ) SELECT normalizedWellNo, date, oil FROM canonical_production
      WHERE typeof(oil) IN ('integer', 'real') ORDER BY normalizedWellNo, date`, [projectId, start, end]);
  const byWell = new Map<string, number[]>();
  for (const row of rows) {
    const value = finiteNumber(row.oil);
    if (value === null) continue;
    const values = byWell.get(row.normalizedWellNo) ?? [];
    values.push(value);
    byWell.set(row.normalizedWellNo, values);
  }
  if (!byWell.size) return { initial: null, latest: null, change: null };
  const initial = [...byWell.values()].reduce((sum, values) => sum + values[0], 0);
  const latest = [...byWell.values()].reduce((sum, values) => sum + values[values.length - 1], 0);
  return { initial, latest, change: latest - initial };
}

async function projectLatestAvailableDate(db: DatabaseLike, projectId: number): Promise<string | null> {
  const row = await db.get(`SELECT MAX(date) AS latestAvailableDate FROM (
      SELECT MAX(CASE WHEN rq GLOB '????-??-??' AND date(rq) = rq THEN rq END) AS date FROM production WHERE UPPER(TRIM(jh)) IN (
        SELECT DISTINCT UPPER(TRIM(production_well)) FROM channeling_relations WHERE project_id = ?
      )
      UNION ALL
      SELECT MAX(CASE
        WHEN end_date GLOB '????-??-??' AND date(end_date) = end_date THEN end_date
        WHEN start_date GLOB '????-??-??' AND date(start_date) = start_date THEN start_date
      END) AS date FROM injection_stage_rows WHERE UPPER(TRIM(well_no)) IN (
        SELECT DISTINCT UPPER(TRIM(injection_well)) FROM channeling_relations WHERE project_id = ?
      )
    )`, [projectId, projectId]);
  return calendarDate(row?.latestAvailableDate) ? row.latestAvailableDate : null;
}

function shanghaiBusinessDate(now: Date): string {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now).filter((part) => part.type !== 'literal').map((part) => [part.type, part.value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
}

export async function getProjectSummary(db: DatabaseLike, projectId: number, start?: string, end?: string, now = new Date()): Promise<ProjectSummary> {
  if ((start === undefined) !== (end === undefined)) throw new Error('date range is invalid');
  if (!await db.get('SELECT id FROM channeling_projects WHERE id = ?', [projectId])) throw new Error('Project not found');
  const latestAvailableDate = await projectLatestAvailableDate(db, projectId);
  const resolvedEnd = end ?? latestAvailableDate ?? shanghaiBusinessDate(now);
  const resolvedStart = start ?? shiftDate(resolvedEnd, -29);
  validateMetricRange(resolvedStart, resolvedEnd);
  const relations = await db.all('SELECT * FROM channeling_relations WHERE project_id = ? ORDER BY id ASC', [projectId]);
  const injectors = [...new Map(relations.map((row) => [normalizeMetricWellNo(row.injection_well), row.injection_well] as const)).values()];
  const producers = [...new Map(relations.map((row) => [normalizeMetricWellNo(row.production_well), row.production_well] as const)).values()];
  const [cumulativeSteam, oilTotals, evaluations] = await Promise.all([
    projectCumulativeSteam(db, projectId, resolvedStart, resolvedEnd),
    projectOilTotals(db, projectId, resolvedStart, resolvedEnd),
    evaluationSummary(db, projectId),
  ]);
  const allWells = new Set([...injectors, ...producers].map(normalizeMetricWellNo));
  return {
    projectId,
    start: resolvedStart,
    end: resolvedEnd,
    range: { start: resolvedStart, end: resolvedEnd },
    generatedAt: new Date().toISOString(),
    relationCount: relations.length,
    activeRelationCount: relations.filter((relation) => relation.status !== 'released').length,
    releasedRelationCount: relations.filter((relation) => relation.status === 'released').length,
    injectorCount: injectors.length,
    producerCount: producers.length,
    uniqueWellCount: allWells.size,
    cumulativeSteam,
    initialTotalOil: oilTotals.initial,
    latestTotalOil: oilTotals.latest,
    totalOilChange: oilTotals.change,
    latestAvailableDate,
    evaluatedCount: evaluations.count,
    latestEvaluationConclusion: evaluations.conclusion,
  };
}
