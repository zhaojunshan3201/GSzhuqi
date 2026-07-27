import type { Database } from 'sqlite';

import type { DailyInjectionRow, StageOilRow } from './injectionSelectionData.ts';

export type SelectionSourceType = 'stage' | 'daily';

const writeQueues = new WeakMap<object, Promise<void>>();

function queueWrite<T>(db: Database, operation: () => Promise<T>): Promise<T> {
  const previous = writeQueues.get(db) ?? Promise.resolve();
  const result = previous.catch(() => undefined).then(operation);
  writeQueues.set(db, result.then(() => undefined, () => undefined));
  return result;
}

export function initInjectionSelectionTables(db: Database): Promise<void> {
  return queueWrite(db, async () => {
    await db.exec('PRAGMA foreign_keys = ON;');
    await db.exec(`
    CREATE TABLE IF NOT EXISTS injection_selection_imports (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      source_type TEXT NOT NULL CHECK(source_type IN ('stage', 'daily')),
      source_file TEXT NOT NULL,
      imported_at TEXT NOT NULL,
      row_count INTEGER NOT NULL DEFAULT 0,
      skipped_row_count INTEGER NOT NULL DEFAULT 0,
      error_messages_json TEXT NOT NULL DEFAULT '[]'
    );
    CREATE TABLE IF NOT EXISTS injection_stage_rows (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      import_id INTEGER NOT NULL,
      well_no TEXT NOT NULL,
      cycle_no INTEGER NOT NULL,
      start_date TEXT NOT NULL,
      end_date TEXT,
      steam_volume REAL,
      temperature REAL,
      pressure REAL,
      dryness REAL,
      production_hours REAL,
      stage_oil REAL,
      stage_water REAL,
      oil_steam_ratio REAL,
      raw_json TEXT NOT NULL,
      UNIQUE(import_id, well_no, cycle_no),
      FOREIGN KEY(import_id) REFERENCES injection_selection_imports(id)
    );
    CREATE TABLE IF NOT EXISTS injection_daily_rows (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      import_id INTEGER NOT NULL,
      well_no TEXT NOT NULL,
      record_date TEXT NOT NULL,
      boiler_no TEXT,
      production_hours REAL,
      flow REAL,
      daily_steam REAL,
      design_steam REAL,
      cumulative_steam REAL,
      pressure REAL,
      dryness REAL,
      temperature REAL,
      nitrogen INTEGER NOT NULL DEFAULT 0,
      carbon_dioxide INTEGER NOT NULL DEFAULT 0,
      remarks_json TEXT NOT NULL DEFAULT '[]',
      raw_json TEXT NOT NULL,
      UNIQUE(import_id, well_no, record_date),
      FOREIGN KEY(import_id) REFERENCES injection_selection_imports(id)
    );
    CREATE TABLE IF NOT EXISTS injection_selection_plans (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      plan_month TEXT NOT NULL,
      generated_at TEXT NOT NULL,
      max_wells INTEGER NOT NULL,
      status TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS injection_selection_plan_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      plan_id INTEGER NOT NULL,
      rank_no INTEGER NOT NULL,
      well_no TEXT NOT NULL,
      score REAL NOT NULL,
      suggested_steam REAL,
      recommended_boiler TEXT,
      nitrogen INTEGER NOT NULL DEFAULT 0,
      carbon_dioxide INTEGER NOT NULL DEFAULT 0,
      source_json TEXT NOT NULL,
      decision TEXT,
      manual_note TEXT,
      FOREIGN KEY(plan_id) REFERENCES injection_selection_plans(id)
    );
    CREATE INDEX IF NOT EXISTS idx_injection_stage_rows_well_date ON injection_stage_rows(well_no, start_date DESC, cycle_no DESC);
    CREATE INDEX IF NOT EXISTS idx_injection_daily_rows_well_date ON injection_daily_rows(well_no, record_date);
    CREATE INDEX IF NOT EXISTS idx_injection_selection_plan_items_rank ON injection_selection_plan_items(plan_id, rank_no);
    `);
    const importColumns = await db.all('PRAGMA table_info(injection_selection_imports)');
    if (!importColumns.some((column: any) => column.name === 'skipped_row_count')) await db.exec('ALTER TABLE injection_selection_imports ADD COLUMN skipped_row_count INTEGER NOT NULL DEFAULT 0');
    if (!importColumns.some((column: any) => column.name === 'error_messages_json')) await db.exec("ALTER TABLE injection_selection_imports ADD COLUMN error_messages_json TEXT NOT NULL DEFAULT '[]'");
    await db.exec('BEGIN TRANSACTION');
    try {
      await db.exec(`
        DELETE FROM injection_stage_rows
        WHERE id NOT IN (
          SELECT MAX(id) FROM injection_stage_rows GROUP BY import_id, well_no, cycle_no
        );
        DELETE FROM injection_daily_rows
        WHERE id NOT IN (
          SELECT MAX(id) FROM injection_daily_rows GROUP BY import_id, well_no, record_date
        );
        CREATE UNIQUE INDEX IF NOT EXISTS uq_injection_stage_rows_import_well_cycle
          ON injection_stage_rows(import_id, well_no, cycle_no);
        CREATE UNIQUE INDEX IF NOT EXISTS uq_injection_daily_rows_import_well_date
          ON injection_daily_rows(import_id, well_no, record_date);
      `);
      await db.exec('COMMIT');
    } catch (error) {
      await db.exec('ROLLBACK');
      throw error;
    }
  });
}

export type SelectionImportSummary = { skippedRowCount?: number; errorMessages?: string[] };
export function replaceSelectionSource(db: Database, source: 'stage', sourceFile: string, rows: readonly StageOilRow[], summary?: SelectionImportSummary): Promise<void>;
export function replaceSelectionSource(db: Database, source: 'daily', sourceFile: string, rows: readonly DailyInjectionRow[], summary?: SelectionImportSummary): Promise<void>;
export function replaceSelectionSource(db: Database, source: SelectionSourceType, sourceFile: string, rows: readonly (StageOilRow | DailyInjectionRow)[], summary: SelectionImportSummary = {}): Promise<void> {
  return queueWrite(db, async () => {
    await db.exec('BEGIN TRANSACTION');
    try {
      const rowTable = source === 'stage' ? 'injection_stage_rows' : 'injection_daily_rows';
      await db.run(`DELETE FROM ${rowTable} WHERE import_id IN (SELECT id FROM injection_selection_imports WHERE source_type = ?)`, [source]);
      await db.run('DELETE FROM injection_selection_imports WHERE source_type = ?', [source]);
      const imported = await db.run(
        'INSERT INTO injection_selection_imports (source_type, source_file, imported_at, row_count, skipped_row_count, error_messages_json) VALUES (?, ?, ?, ?, ?, ?)',
        [source, sourceFile, new Date().toISOString(), rows.length, summary.skippedRowCount ?? 0, JSON.stringify(summary.errorMessages ?? [])],
      );
      if (source === 'stage') {
        for (const row of rows as readonly StageOilRow[]) await insertStageRow(db, imported.lastID!, row);
      } else {
        for (const row of rows as readonly DailyInjectionRow[]) await insertDailyRow(db, imported.lastID!, row);
      }
      await db.exec('COMMIT');
    } catch (error) {
      await db.exec('ROLLBACK');
      throw error;
    }
  });
}

export async function listStageRows(db: Database): Promise<StageOilRow[]> {
  return queueWrite(db, async () => {
    const rows = await db.all('SELECT * FROM injection_stage_rows ORDER BY well_no ASC, start_date DESC, cycle_no DESC');
    return rows.map(toStageRow);
  });
}

export async function listDailyRows(db: Database): Promise<DailyInjectionRow[]> {
  return queueWrite(db, async () => {
    const rows = await db.all('SELECT * FROM injection_daily_rows ORDER BY well_no ASC, record_date ASC');
    return rows.map(toDailyRow);
  });
}

async function insertStageRow(db: Database, importId: number, row: StageOilRow): Promise<void> {
  await db.run(`INSERT INTO injection_stage_rows (import_id, well_no, cycle_no, start_date, end_date, steam_volume, temperature, pressure, dryness, production_hours, stage_oil, stage_water, oil_steam_ratio, raw_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(import_id, well_no, cycle_no) DO UPDATE SET
      start_date = excluded.start_date, end_date = excluded.end_date, steam_volume = excluded.steam_volume,
      temperature = excluded.temperature, pressure = excluded.pressure, dryness = excluded.dryness,
      production_hours = excluded.production_hours, stage_oil = excluded.stage_oil,
      stage_water = excluded.stage_water, oil_steam_ratio = excluded.oil_steam_ratio, raw_json = excluded.raw_json`, [
    importId, row.wellNo, row.cycleNo, row.startDate, row.endDate, row.steamVolume, row.temperature, row.pressure, row.dryness, row.productionHours, row.stageOil, row.stageWater, row.oilSteamRatio, JSON.stringify(row),
  ]);
}

async function insertDailyRow(db: Database, importId: number, row: DailyInjectionRow): Promise<void> {
  await db.run(`INSERT INTO injection_daily_rows (import_id, well_no, record_date, boiler_no, production_hours, flow, daily_steam, design_steam, cumulative_steam, pressure, dryness, temperature, nitrogen, carbon_dioxide, remarks_json, raw_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(import_id, well_no, record_date) DO UPDATE SET
      boiler_no = excluded.boiler_no, production_hours = excluded.production_hours, flow = excluded.flow,
      daily_steam = excluded.daily_steam, design_steam = excluded.design_steam,
      cumulative_steam = excluded.cumulative_steam, pressure = excluded.pressure, dryness = excluded.dryness,
      temperature = excluded.temperature, nitrogen = excluded.nitrogen, carbon_dioxide = excluded.carbon_dioxide,
      remarks_json = excluded.remarks_json, raw_json = excluded.raw_json`, [
    importId, row.wellNo, row.recordDate, row.boilerNo, row.productionHours, row.flow, row.dailySteam, row.designSteam, row.cumulativeSteam, row.pressure, row.dryness, row.temperature, Number(row.gasFlags.nitrogen), Number(row.gasFlags.carbonDioxide), JSON.stringify(row.remarks), JSON.stringify(row),
  ]);
}

function toStageRow(row: any): StageOilRow {
  return { wellNo: row.well_no, cycleNo: row.cycle_no, startDate: row.start_date, endDate: row.end_date, steamVolume: row.steam_volume, temperature: row.temperature, pressure: row.pressure, dryness: row.dryness, productionHours: row.production_hours, stageOil: row.stage_oil, stageWater: row.stage_water, oilSteamRatio: row.oil_steam_ratio };
}

function toDailyRow(row: any): DailyInjectionRow {
  return { wellNo: row.well_no, recordDate: row.record_date, boilerNo: row.boiler_no, productionHours: row.production_hours, flow: row.flow, dailySteam: row.daily_steam, designSteam: row.design_steam, cumulativeSteam: row.cumulative_steam, pressure: row.pressure, dryness: row.dryness, temperature: row.temperature, gasFlags: { nitrogen: Boolean(row.nitrogen), carbonDioxide: Boolean(row.carbon_dioxide) }, remarks: JSON.parse(row.remarks_json) };
}

export type StoredMonthlyPlan = import('./injectionSelectionPlanner.ts').MonthlyPlan & {
  id: number;
  generatedAt: string;
  status: 'active' | 'superseded';
};

export type PlanItemPatch = {
  decision?: import('./injectionSelectionPlanner.ts').PlanDecision;
  manualNote?: string | null;
  suggestedSteam?: number | null;
  recommendedBoiler?: string | null;
};

export type SelectionSourceStatus = {
  sourceType: SelectionSourceType;
  sourceFile: string;
  importedAt: string;
  rowCount: number;
  skippedRowCount: number;
  errorMessages: string[];
};

export function savePlan(db: Database, plan: import('./injectionSelectionPlanner.ts').MonthlyPlan): Promise<StoredMonthlyPlan> {
  return queueWrite(db, async () => {
    await db.exec('BEGIN TRANSACTION');
    try {
      await db.run("UPDATE injection_selection_plans SET status = 'superseded' WHERE plan_month = ? AND status = 'active'", [plan.month]);
      const generatedAt = new Date().toISOString();
      const created = await db.run(
        "INSERT INTO injection_selection_plans (plan_month, generated_at, max_wells, status) VALUES (?, ?, ?, 'active')",
        [plan.month, generatedAt, plan.maxWells],
      );
      const planId = created.lastID!;
      for (const item of plan.items) {
        await db.run(`INSERT INTO injection_selection_plan_items
          (plan_id, rank_no, well_no, score, suggested_steam, recommended_boiler, nitrogen, carbon_dioxide, source_json, decision, manual_note)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, [
          planId, item.rankNo, item.wellNo, item.score, item.suggestedSteam, item.recommendedBoiler,
          Number(item.nitrogen), Number(item.carbonDioxide), JSON.stringify(item.source), item.decision, item.manualNote,
        ]);
      }
      await db.exec('COMMIT');
      return (await getPlanByIdUnlocked(db, planId))!;
    } catch (error) {
      await db.exec('ROLLBACK');
      throw error;
    }
  });
}

export function getPlan(db: Database, month: string): Promise<StoredMonthlyPlan | undefined> {
  return queueWrite(db, async () => {
    const row = await db.get("SELECT id FROM injection_selection_plans WHERE plan_month = ? AND status = 'active' ORDER BY generated_at DESC, id DESC LIMIT 1", [month]);
    return row ? getPlanByIdUnlocked(db, row.id) : undefined;
  });
}

export function getPlanById(db: Database, planId: number): Promise<StoredMonthlyPlan | undefined> {
  return queueWrite(db, () => getPlanByIdUnlocked(db, planId));
}

export function updatePlanItem(db: Database, planId: number, itemId: number, patch: PlanItemPatch): Promise<StoredMonthlyPlan | undefined> {
  return queueWrite(db, async () => {
    const existing = await db.get('SELECT id FROM injection_selection_plan_items WHERE id = ? AND plan_id = ?', [itemId, planId]);
    if (!existing) return undefined;
    const fields: string[] = [];
    const values: unknown[] = [];
    if (patch.decision !== undefined) { fields.push('decision = ?'); values.push(patch.decision); }
    if (patch.manualNote !== undefined) { fields.push('manual_note = ?'); values.push(patch.manualNote); }
    if (patch.suggestedSteam !== undefined) { fields.push('suggested_steam = ?'); values.push(patch.suggestedSteam); }
    if (patch.recommendedBoiler !== undefined) { fields.push('recommended_boiler = ?'); values.push(patch.recommendedBoiler); }
    if (fields.length) await db.run(`UPDATE injection_selection_plan_items SET ${fields.join(', ')} WHERE id = ? AND plan_id = ?`, [...values, itemId, planId]);
    return getPlanByIdUnlocked(db, planId);
  });
}

export function listSelectionSourceStatus(db: Database): Promise<SelectionSourceStatus[]> {
  return queueWrite(db, async () => {
    const rows = await db.all("SELECT source_type, source_file, imported_at, row_count, skipped_row_count, error_messages_json FROM injection_selection_imports ORDER BY source_type");
    return rows.map((row: any) => ({ sourceType: row.source_type as SelectionSourceType, sourceFile: row.source_file, importedAt: row.imported_at, rowCount: row.row_count, skippedRowCount: row.skipped_row_count ?? 0, errorMessages: JSON.parse(row.error_messages_json ?? '[]') }));
  });
}

async function getPlanByIdUnlocked(db: Database, planId: number): Promise<StoredMonthlyPlan | undefined> {
  const plan = await db.get('SELECT id, plan_month, generated_at, max_wells, status FROM injection_selection_plans WHERE id = ?', [planId]);
  if (!plan) return undefined;
  const itemRows = await db.all('SELECT id, rank_no, well_no, score, suggested_steam, recommended_boiler, nitrogen, carbon_dioxide, source_json, decision, manual_note FROM injection_selection_plan_items WHERE plan_id = ? ORDER BY rank_no ASC', [planId]);
  return {
    id: plan.id,
    month: plan.plan_month,
    generatedAt: plan.generated_at,
    maxWells: plan.max_wells,
    status: plan.status,
    items: itemRows.map((row: any) => {
      const source = JSON.parse(row.source_json);
      return {
        id: row.id,
        rankNo: row.rank_no,
        wellNo: row.well_no,
        score: row.score,
        suggestedSteam: row.suggested_steam,
        recommendedBoiler: row.recommended_boiler,
        nitrogen: Boolean(row.nitrogen),
        carbonDioxide: Boolean(row.carbon_dioxide),
        oilSteamRatio: source.oilSteamRatio,
        stageOil: source.stageOil,
        scoreBreakdown: source.scoreBreakdown,
        decision: row.decision,
        manualNote: row.manual_note,
        source,
      };
    }),
  } as StoredMonthlyPlan;
}
