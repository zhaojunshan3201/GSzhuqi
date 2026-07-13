import type { Database } from 'sqlite';

export interface WellTemperaturePointInput {
  depth: number;
  temperature: number | null;
  pressure: number | null;
}

export interface WellTemperatureTestInput {
  wellNo: string;
  testDate: string;
  perforationTopDepth?: number;
  perforationBottomDepth?: number;
  points: WellTemperaturePointInput[];
  sourceFile: string;
}

export interface WellTemperatureTestSummary {
  id: number;
  wellNo: string;
  testDate: string;
  perforationTopDepth: number | null;
  perforationBottomDepth: number | null;
  pointCount: number;
  sourceFile: string;
  createdAt: string;
  updatedAt: string;
}

export interface WellTemperatureTestDetail extends WellTemperatureTestSummary {
  points: WellTemperaturePointInput[];
}

function toSummary(row: any): WellTemperatureTestSummary {
  return {
    id: row.id,
    wellNo: row.well_no,
    testDate: row.test_date,
    perforationTopDepth: row.perforation_top_depth,
    perforationBottomDepth: row.perforation_bottom_depth,
    pointCount: row.point_count,
    sourceFile: row.source_file,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function initWellTemperatureTables(db: Database): Promise<void> {
  await db.exec(`
    CREATE TABLE IF NOT EXISTS well_temperature_tests (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      well_no TEXT NOT NULL,
      test_date TEXT NOT NULL,
      perforation_top_depth REAL,
      perforation_bottom_depth REAL,
      point_count INTEGER NOT NULL,
      source_file TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE(well_no, test_date)
    );
    CREATE TABLE IF NOT EXISTS well_temperature_points (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      test_id INTEGER NOT NULL,
      depth REAL NOT NULL,
      temperature REAL,
      pressure REAL,
      FOREIGN KEY(test_id) REFERENCES well_temperature_tests(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_well_temperature_tests_well_date ON well_temperature_tests(well_no, test_date DESC);
    CREATE INDEX IF NOT EXISTS idx_well_temperature_points_test_depth ON well_temperature_points(test_id, depth);
  `);
}

export async function replaceWellTemperatureTest(db: Database, input: WellTemperatureTestInput): Promise<WellTemperatureTestSummary> {
  const now = new Date().toISOString();
  await db.exec('BEGIN TRANSACTION');
  try {
    const existing = await db.get<{ id: number }>(
      'SELECT id FROM well_temperature_tests WHERE well_no = ? AND test_date = ?',
      [input.wellNo, input.testDate],
    );
    if (existing) {
      await db.run('DELETE FROM well_temperature_points WHERE test_id = ?', [existing.id]);
      await db.run('DELETE FROM well_temperature_tests WHERE id = ?', [existing.id]);
    }
    const inserted = await db.run(
      `INSERT INTO well_temperature_tests (
        well_no, test_date, perforation_top_depth, perforation_bottom_depth,
        point_count, source_file, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        input.wellNo,
        input.testDate,
        input.perforationTopDepth ?? null,
        input.perforationBottomDepth ?? null,
        input.points.length,
        input.sourceFile,
        now,
        now,
      ],
    );
    const testId = inserted.lastID!;
    for (const point of input.points) {
      await db.run(
        'INSERT INTO well_temperature_points (test_id, depth, temperature, pressure) VALUES (?, ?, ?, ?)',
        [testId, point.depth, point.temperature, point.pressure],
      );
    }
    await db.exec('COMMIT');
    return (await getWellTemperatureTestSummary(db, testId))!;
  } catch (error) {
    await db.exec('ROLLBACK');
    throw error;
  }
}

async function getWellTemperatureTestSummary(db: Database, id: number): Promise<WellTemperatureTestSummary | undefined> {
  const row = await db.get('SELECT * FROM well_temperature_tests WHERE id = ?', [id]);
  return row ? toSummary(row) : undefined;
}

export async function listWellTemperatureTests(db: Database, wellNo?: string): Promise<WellTemperatureTestSummary[]> {
  const filter = wellNo?.trim();
  const rows = filter
    ? await db.all('SELECT * FROM well_temperature_tests WHERE well_no LIKE ? ORDER BY well_no, test_date DESC, id DESC', [`%${filter}%`])
    : await db.all('SELECT * FROM well_temperature_tests ORDER BY well_no, test_date DESC, id DESC');
  return rows.map(toSummary);
}

export async function getWellTemperatureTest(db: Database, id: number): Promise<WellTemperatureTestDetail | undefined> {
  const summary = await getWellTemperatureTestSummary(db, id);
  if (!summary) return undefined;
  const rows = await db.all('SELECT depth, temperature, pressure FROM well_temperature_points WHERE test_id = ? ORDER BY depth ASC', [id]);
  return { ...summary, points: rows };
}

export async function deleteWellTemperatureTest(db: Database, id: number): Promise<boolean> {
  await db.exec('BEGIN TRANSACTION');
  try {
    const existing = await db.get('SELECT id FROM well_temperature_tests WHERE id = ?', [id]);
    if (!existing) {
      await db.exec('COMMIT');
      return false;
    }
    await db.run('DELETE FROM well_temperature_points WHERE test_id = ?', [id]);
    await db.run('DELETE FROM well_temperature_tests WHERE id = ?', [id]);
    await db.exec('COMMIT');
    return true;
  } catch (error) {
    await db.exec('ROLLBACK');
    throw error;
  }
}
