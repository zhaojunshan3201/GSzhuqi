import type { Database } from 'sqlite';

import type { ExternalTransferRecord } from './externalTransferTracking.ts';

export interface StoredExternalTransferUpload {
  fileName: string;
  records: ExternalTransferRecord[];
}

export async function initExternalTransferTables(db: Database): Promise<void> {
  await db.exec(`
    CREATE TABLE IF NOT EXISTS external_transfer_upload (
      id INTEGER PRIMARY KEY CHECK (id = 1), source_file TEXT NOT NULL, created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS external_transfer_records (
      date TEXT NOT NULL, station TEXT NOT NULL, well_count REAL, liquid REAL, oil REAL, diluent REAL,
      water_cut REAL, transfer REAL, transfer_difference REAL, sewage REAL, return_flow REAL, thin_oil REAL
    );
    CREATE INDEX IF NOT EXISTS idx_external_transfer_records_date ON external_transfer_records(date);
  `);
}

export async function replaceExternalTransferUpload(db: Database, upload: StoredExternalTransferUpload): Promise<void> {
  const now = new Date().toISOString();
  await db.run('BEGIN TRANSACTION');
  try {
    await db.run('DELETE FROM external_transfer_records');
    await db.run('DELETE FROM external_transfer_upload');
    await db.run('INSERT INTO external_transfer_upload (id, source_file, created_at) VALUES (1, ?, ?)', [upload.fileName, now]);
    for (const record of upload.records) {
      await db.run(
        `INSERT INTO external_transfer_records (date, station, well_count, liquid, oil, diluent, water_cut, transfer, transfer_difference, sewage, return_flow, thin_oil)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [record.date, record.station, record.wellCount, record.liquid, record.oil, record.diluent, record.waterCut, record.transfer, record.transferDifference, record.sewage, record.returnFlow, record.thinOil],
      );
    }
    await db.run('COMMIT');
  } catch (error) {
    await db.run('ROLLBACK');
    throw error;
  }
}

export async function getExternalTransferUpload(db: Database): Promise<StoredExternalTransferUpload | null> {
  const upload = await db.get<{ source_file: string }>('SELECT source_file FROM external_transfer_upload WHERE id = 1');
  if (!upload) return null;
  const rows = await db.all<any[]>('SELECT * FROM external_transfer_records ORDER BY date, station');
  return {
    fileName: upload.source_file,
    records: rows.map((row) => ({
      date: row.date, station: row.station, wellCount: row.well_count, liquid: row.liquid, oil: row.oil, diluent: row.diluent,
      waterCut: row.water_cut, transfer: row.transfer, transferDifference: row.transfer_difference, sewage: row.sewage,
      returnFlow: row.return_flow, thinOil: row.thin_oil,
    })),
  };
}
