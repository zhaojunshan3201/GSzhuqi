import type { MonthlyInjectionPlanResult, MonthlyInjectionPlanRow } from './monthlyInjectionPlanParser.ts';
import type { DatabaseLike } from './injectionProjectStore.ts';

export type ImportStatus = 'preview' | 'confirmed' | 'superseded';
export type ImportRowClass = 'valid' | 'pending' | 'invalid';

export type PlanImportPreviewInput = MonthlyInjectionPlanResult & { fileName: string };
export type PlanImport = {
  id: number;
  planMonth: string;
  fileName: string;
  sheetName: string | null;
  status: ImportStatus;
  validCount: number;
  pendingCount: number;
  invalidCount: number;
  totalPlannedSteam: number;
  createdAt: string;
  confirmedAt: string | null;
  previousComparison?: PlanImportComparison | null;
};

export type PlanImportComparison = {
  added: number;
  modified: number;
  removed: number;
};

const projectColumns = ['unit', 'boiler', 'planned_start_date', 'planned_end_date', 'gas_support', 'schedule_status', 'source_import_id'];
const confirmationQueues = new WeakMap<DatabaseLike, Promise<void>>();

function queuePlanImportConfirmation<T>(db: DatabaseLike, operation: () => Promise<T>): Promise<T> {
  const previous = confirmationQueues.get(db) ?? Promise.resolve();
  const current = previous.catch(() => undefined).then(operation);
  confirmationQueues.set(db, current.then(() => undefined, () => undefined));
  return current;
}

function toImport(row: any): PlanImport {
  return {
    id: row.id, planMonth: row.plan_month, fileName: row.file_name, sheetName: row.sheet_name,
    status: row.status, validCount: row.valid_count, pendingCount: row.pending_count,
    invalidCount: row.invalid_count, totalPlannedSteam: row.total_planned_steam,
    createdAt: row.created_at, confirmedAt: row.confirmed_at,
  };
}

function rowValues(row: MonthlyInjectionPlanRow, rowClass: ImportRowClass): unknown[] {
  return [
    rowClass, row.unit, row.boiler, row.wellNo, row.plannedSteam, row.gasSupport,
    row.startDate, row.endDate, row.planStatus, row.remark, row.rawWellText,
    row.rawScheduleText, row.sourceCell, JSON.stringify(row),
  ];
}

function rowChanged(previous: any, next: MonthlyInjectionPlanRow): boolean {
  return previous.unit !== next.unit
    || previous.boiler !== next.boiler
    || previous.planned_steam !== next.plannedSteam
    || previous.gas_support !== next.gasSupport
    || previous.planned_start_date !== next.startDate
    || previous.planned_end_date !== next.endDate
    || previous.schedule_status !== next.planStatus
    || previous.remark !== next.remark;
}

async function previousComparison(db: DatabaseLike, input: PlanImportPreviewInput): Promise<PlanImportComparison | null> {
  const previous = await db.get(
    "SELECT id FROM injection_plan_imports WHERE plan_month = ? AND status = 'confirmed' ORDER BY confirmed_at DESC, id DESC LIMIT 1",
    [input.planMonth],
  );
  if (!previous) return null;

  const rows = await db.all('SELECT * FROM injection_plan_import_rows WHERE import_id = ? AND row_class = ?', [previous.id, 'valid']);
  const previousByWell = new Map(rows.map((row) => [row.well_no, row]));
  let added = 0;
  let modified = 0;
  for (const row of input.rows) {
    const before = previousByWell.get(row.wellNo);
    if (!before) added += 1;
    else if (rowChanged(before, row)) modified += 1;
    previousByWell.delete(row.wellNo);
  }
  return { added, modified, removed: previousByWell.size };
}

export async function initMonthlyInjectionPlanImportTables(db: DatabaseLike): Promise<void> {
  await db.exec(`CREATE TABLE IF NOT EXISTS injection_plan_imports (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    plan_month TEXT NOT NULL,
    file_name TEXT NOT NULL,
    sheet_name TEXT,
    status TEXT NOT NULL DEFAULT 'preview',
    valid_count INTEGER NOT NULL DEFAULT 0,
    pending_count INTEGER NOT NULL DEFAULT 0,
    invalid_count INTEGER NOT NULL DEFAULT 0,
    total_planned_steam REAL NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    confirmed_at TEXT
  );
  CREATE TABLE IF NOT EXISTS injection_plan_import_rows (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    import_id INTEGER NOT NULL,
    row_class TEXT NOT NULL,
    unit TEXT, boiler TEXT, well_no TEXT, planned_steam REAL, gas_support TEXT,
    planned_start_date TEXT, planned_end_date TEXT, schedule_status TEXT, remark TEXT,
    raw_well_text TEXT NOT NULL DEFAULT '', raw_schedule_text TEXT NOT NULL DEFAULT '',
    source_cell TEXT NOT NULL DEFAULT '', snapshot_json TEXT NOT NULL DEFAULT '{}',
    FOREIGN KEY(import_id) REFERENCES injection_plan_imports(id)
  );
  CREATE INDEX IF NOT EXISTS idx_injection_plan_imports_month ON injection_plan_imports(plan_month, status);
  CREATE INDEX IF NOT EXISTS idx_injection_plan_import_rows_import ON injection_plan_import_rows(import_id, row_class);`);

  const columns = new Set((await db.all('PRAGMA table_info(injection_projects)')).map((column) => column.name));
  if (columns.size && projectColumns.some((column) => !columns.has(column))) {
    throw new Error('injection_projects must be initialized before confirming plan imports');
  }
}

export async function createPlanPreview(db: DatabaseLike, input: PlanImportPreviewInput): Promise<PlanImport> {
  if (!input.planMonth) throw new Error('planMonth is required');
  if (!input.fileName?.trim()) throw new Error('fileName is required');
  await initMonthlyInjectionPlanImportTables(db);
  const comparison = await previousComparison(db, input);
  const now = new Date().toISOString();
  const result = await db.run(
    `INSERT INTO injection_plan_imports (plan_month, file_name, sheet_name, status, valid_count, pending_count, invalid_count, total_planned_steam, created_at)
     VALUES (?, ?, ?, 'preview', ?, ?, ?, ?, ?)`,
    [input.planMonth, input.fileName.trim(), input.sheetName, input.rows.length, input.pendingRows.length, input.invalidRows.length, input.totalPlannedSteam, now],
  );
  const importId = result.lastID;
  for (const [rowClass, rows] of [['valid', input.rows], ['pending', input.pendingRows], ['invalid', input.invalidRows]] as const) {
    for (const row of rows) {
      await db.run(
        `INSERT INTO injection_plan_import_rows (import_id, row_class, unit, boiler, well_no, planned_steam, gas_support, planned_start_date, planned_end_date, schedule_status, remark, raw_well_text, raw_schedule_text, source_cell, snapshot_json)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [importId, ...rowValues(row, rowClass)],
      );
    }
  }
  return { ...toImport(await db.get('SELECT * FROM injection_plan_imports WHERE id = ?', [importId])), previousComparison: comparison };
}

export async function confirmPlanImport(db: DatabaseLike, importId: number): Promise<PlanImport> {
  return queuePlanImportConfirmation(db, async () => {
    await initMonthlyInjectionPlanImportTables(db);
    await db.exec('BEGIN');
    try {
    const batch = await db.get('SELECT * FROM injection_plan_imports WHERE id = ?', [importId]);
    if (!batch) throw new Error('plan import not found');
    if (batch.status !== 'preview') throw new Error('only preview imports can be confirmed');
    const rows = await db.all('SELECT * FROM injection_plan_import_rows WHERE import_id = ? AND row_class = ? ORDER BY id', [importId, 'valid']);
    const currentProjects = await db.all(
      `SELECT p.* FROM injection_projects p JOIN injection_plan_imports i ON i.id = p.source_import_id
       WHERE i.plan_month = ?`,
      [batch.plan_month],
    );
    const currentByWell = new Map(currentProjects.map((project) => [project.well_no, project]));
    const now = new Date().toISOString();

    await db.run("UPDATE injection_plan_imports SET status = 'superseded' WHERE plan_month = ? AND status = 'confirmed'", [batch.plan_month]);
    await db.run("UPDATE injection_projects SET source_import_id = NULL, schedule_status = 'superseded', updated_at = ? WHERE source_import_id IS NOT NULL AND source_import_id IN (SELECT id FROM injection_plan_imports WHERE plan_month = ?)", [now, batch.plan_month]);

    for (const row of rows) {
      const existing = currentByWell.get(row.well_no);
      const scheduleStatus = row.schedule_status || 'scheduled';
      if (existing) {
        await db.run(
          `UPDATE injection_projects SET block = ?, remark = ?, unit = ?, boiler = ?, planned_steam = ?, planned_start_date = ?, planned_end_date = ?, gas_support = ?, schedule_status = ?, planned_transfer_date = ?, source_import_id = ?, updated_at = ? WHERE id = ?`,
          [row.unit || '', row.remark || '', row.unit, row.boiler, row.planned_steam, row.planned_start_date, row.planned_end_date, row.gas_support, scheduleStatus, row.planned_end_date, importId, now, existing.id],
        );
      } else {
        const projectNo = `ZQ-${Date.now()}-${row.id}`;
        await db.run(
          `INSERT INTO injection_projects (project_no, well_no, block, process_type, planned_steam, planned_transfer_date, owner, remark, plan_status, lifecycle_status, unit, boiler, planned_start_date, planned_end_date, gas_support, schedule_status, source_import_id, created_at, updated_at)
           VALUES (?, ?, ?, 'monthly-import', ?, ?, 'monthly-import', ?, 'draft', 'pending', ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [projectNo, row.well_no, row.unit || '', row.planned_steam, row.planned_end_date, row.remark || '', row.unit, row.boiler, row.planned_start_date, row.planned_end_date, row.gas_support, scheduleStatus, importId, now, now],
        );
      }
    }
    await db.run("UPDATE injection_plan_imports SET status = 'confirmed', confirmed_at = ? WHERE id = ?", [now, importId]);
    await db.exec('COMMIT');
    return toImport(await db.get('SELECT * FROM injection_plan_imports WHERE id = ?', [importId]));
    } catch (error) {
      await db.exec('ROLLBACK');
      throw error;
    }
  });
}

export async function listPlanImports(db: DatabaseLike): Promise<PlanImport[]> {
  await initMonthlyInjectionPlanImportTables(db);
  return (await db.all('SELECT * FROM injection_plan_imports ORDER BY created_at DESC, id DESC')).map(toImport);
}
