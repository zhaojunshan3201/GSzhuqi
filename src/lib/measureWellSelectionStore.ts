import type { Database } from 'sqlite';

import type { EvaluatedWell, SelectionCycle, SelectionGrade } from './measureWellSelection.ts';

const writeQueues = new WeakMap<object, Promise<void>>();

function queueWrite<T>(db: Database, operation: () => Promise<T>): Promise<T> {
  const previous = writeQueues.get(db) ?? Promise.resolve();
  const result = previous.catch(() => undefined).then(operation);
  writeQueues.set(db, result.then(() => undefined, () => undefined));
  return result;
}

export interface StoredSelectionCycle extends SelectionCycle {
  station?: string | null;
  maxPressure?: number | null;
  injectN2?: boolean | null;
  boiler?: string | null;
  importId?: number | null;
}

export interface SelectionFilter {
  block?: string;
  station?: string;
  grade?: SelectionGrade;
  limit?: number;
}

export interface SelectionWellSummary extends EvaluatedWell {
  station: string | null;
  calculatedAt: string;
}

export interface SelectionWellDetail {
  score: SelectionWellSummary;
  cycles: StoredSelectionCycle[];
}

export async function initMeasureWellSelectionTables(db: Database): Promise<void> {
  await db.exec(`
    CREATE TABLE IF NOT EXISTS measure_well_imports (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      source_file TEXT,
      imported_at TEXT NOT NULL,
      row_count INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS measure_well_cycles (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      import_id INTEGER,
      well_name TEXT NOT NULL,
      block TEXT,
      station TEXT,
      transfer_date TEXT NOT NULL,
      round_no INTEGER NOT NULL,
      design_steam REAL,
      actual_steam REAL,
      max_pressure REAL,
      rate REAL,
      inject_n2 INTEGER,
      boiler TEXT,
      peak_oil REAL,
      oil_seeing_days REAL,
      cycle_oil REAL,
      raw_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE(well_name, transfer_date, round_no),
      FOREIGN KEY(import_id) REFERENCES measure_well_imports(id)
    );
    CREATE TABLE IF NOT EXISTS measure_well_scores (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      well_name TEXT NOT NULL,
      block TEXT NOT NULL DEFAULT '',
      station TEXT,
      grade TEXT NOT NULL,
      score REAL NOT NULL,
      score_json TEXT NOT NULL,
      calculated_at TEXT NOT NULL,
      UNIQUE(well_name, block)
    );
    CREATE INDEX IF NOT EXISTS idx_measure_well_cycles_well_date ON measure_well_cycles(well_name, transfer_date DESC, round_no DESC);
    CREATE INDEX IF NOT EXISTS idx_measure_well_scores_filters ON measure_well_scores(block, station, grade, score DESC);
  `);
}

export async function createSelectionImport(db: Database, sourceFile: string, rowCount: number): Promise<number> {
  const result = await db.run(
    'INSERT INTO measure_well_imports (source_file, imported_at, row_count) VALUES (?, ?, ?)',
    [sourceFile, new Date().toISOString(), rowCount],
  );
  return result.lastID!;
}

export function upsertSelectionCycles(db: Database, cycles: readonly StoredSelectionCycle[]): Promise<void> {
  return queueWrite(db, async () => {
    const now = new Date().toISOString();
    await db.exec('BEGIN TRANSACTION');
    try {
      for (const cycle of cycles) {
        await db.run(`
          INSERT INTO measure_well_cycles (
            import_id, well_name, block, station, transfer_date, round_no, design_steam,
            actual_steam, max_pressure, rate, inject_n2, boiler, peak_oil, oil_seeing_days,
            cycle_oil, raw_json, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(well_name, transfer_date, round_no) DO UPDATE SET
            import_id = excluded.import_id, block = excluded.block, station = excluded.station,
            design_steam = excluded.design_steam, actual_steam = excluded.actual_steam,
            max_pressure = excluded.max_pressure, rate = excluded.rate, inject_n2 = excluded.inject_n2,
            boiler = excluded.boiler, peak_oil = excluded.peak_oil,
            oil_seeing_days = excluded.oil_seeing_days, cycle_oil = excluded.cycle_oil,
            raw_json = excluded.raw_json, updated_at = excluded.updated_at
        `, [
          cycle.importId ?? null, cycle.wellName, cycle.block ?? null, cycle.station ?? null,
          cycle.transferDate, cycle.round, cycle.designSteam ?? null, cycle.actualSteam ?? null,
          cycle.maxPressure ?? cycle.pressure ?? null, cycle.rate ?? null,
          cycle.injectN2 === undefined || cycle.injectN2 === null ? null : Number(cycle.injectN2),
          cycle.boiler ?? null, cycle.peakOil ?? null, cycle.oilSeeingDays ?? null,
          cycle.cycleOil ?? null, JSON.stringify(cycle), now, now,
        ]);
      }
      await db.exec('COMMIT');
    } catch (error) {
      await db.exec('ROLLBACK');
      throw error;
    }
  });
}

export function replaceSelectionScores(db: Database, rows: readonly EvaluatedWell[]): Promise<void> {
  return queueWrite(db, async () => {
    const calculatedAt = new Date().toISOString();
    await db.exec('BEGIN TRANSACTION');
    try {
      await db.run('DELETE FROM measure_well_scores');
      for (const row of rows) {
        const station = (row as EvaluatedWell & { station?: string }).station
          ?? (await db.get<{ station: string | null }>(
            'SELECT station FROM measure_well_cycles WHERE well_name = ? AND block IS ? ORDER BY transfer_date DESC, round_no DESC LIMIT 1',
            [row.wellName, row.block],
          ))?.station
          ?? null;
        await db.run(
          `INSERT INTO measure_well_scores (well_name, block, station, grade, score, score_json, calculated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
          [row.wellName, row.block, station, row.grade, row.score, JSON.stringify(row), calculatedAt],
        );
      }
      await db.exec('COMMIT');
    } catch (error) {
      await db.exec('ROLLBACK');
      throw error;
    }
  });
}

export async function listSelectionCycles(db: Database): Promise<StoredSelectionCycle[]> {
  const rows = await db.all(
    'SELECT * FROM measure_well_cycles ORDER BY transfer_date DESC, round_no DESC, well_name ASC',
  );
  return rows.map(toCycle);
}

export async function listSelectionWells(db: Database, filter: SelectionFilter = {}): Promise<SelectionWellSummary[]> {
  const where: string[] = [];
  const values: unknown[] = [];
  for (const [column, value] of [['block', filter.block], ['station', filter.station], ['grade', filter.grade]] as const) {
    if (value?.trim()) {
      where.push(`${column} = ?`);
      values.push(value);
    }
  }
  const limit = Number.isInteger(filter.limit) && filter.limit! > 0 ? ` LIMIT ${filter.limit}` : '';
  const rows = await db.all(
    `SELECT score_json, station, calculated_at FROM measure_well_scores${where.length ? ` WHERE ${where.join(' AND ')}` : ''} ORDER BY score DESC, well_name ASC${limit}`,
    values,
  );
  return rows.map((row: any) => ({ ...JSON.parse(row.score_json), station: row.station, calculatedAt: row.calculated_at }));
}

export async function getSelectionWellDetail(db: Database, wellName: string, block?: string): Promise<SelectionWellDetail | undefined> {
  const blockFilter = block === undefined ? '' : ' AND block = ?';
  const values = block === undefined ? [wellName] : [wellName, block];
  const scoreRow = await db.get(
    `SELECT score_json, station, calculated_at FROM measure_well_scores WHERE well_name = ?${blockFilter} ORDER BY score DESC, block ASC LIMIT 1`,
    values,
  );
  if (!scoreRow) return undefined;
  const cycles = await db.all(
    `SELECT * FROM measure_well_cycles WHERE well_name = ?${blockFilter} ORDER BY transfer_date DESC, round_no DESC LIMIT 3`,
    values,
  );
  return {
    score: { ...JSON.parse((scoreRow as any).score_json), station: (scoreRow as any).station, calculatedAt: (scoreRow as any).calculated_at },
    cycles: cycles.map(toCycle),
  };
}

function toCycle(row: any): StoredSelectionCycle {
  return {
    wellName: row.well_name,
    block: row.block ?? '',
    station: row.station,
    transferDate: row.transfer_date,
    round: row.round_no,
    designSteam: row.design_steam,
    actualSteam: row.actual_steam,
    maxPressure: row.max_pressure,
    pressure: row.max_pressure,
    rate: row.rate,
    injectN2: row.inject_n2 === null ? null : Boolean(row.inject_n2),
    boiler: row.boiler,
    peakOil: row.peak_oil,
    oilSeeingDays: row.oil_seeing_days,
    cycleOil: row.cycle_oil,
    importId: row.import_id,
  };
}
