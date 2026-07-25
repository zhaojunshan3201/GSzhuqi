import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import sqlite3 from 'sqlite3';
import { open } from 'sqlite';

import { buildInjectionProductionCockpit } from '../src/lib/injectionProductionCockpit.ts';

async function withDatabase(run: (db: any) => Promise<void>) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'injection-production-cockpit-'));
  const db = await open({ filename: path.join(directory, 'test.db'), driver: sqlite3.Database });
  try {
    await db.exec(`
      CREATE TABLE production (jh TEXT, rq TEXT, oil REAL);
      CREATE TABLE measure_tracking (
        id INTEGER PRIMARY KEY,
        jh TEXT,
        block TEXT,
        current_status TEXT,
        current_round_transfer_time TEXT,
        current_oil REAL,
        cumulative_oil_gain REAL,
        evaluation TEXT
      );
      CREATE TABLE measure_well_cycles (actual_steam REAL, cycle_oil REAL);
      CREATE TABLE measure_well_imports (imported_at TEXT);
    `);
    await run(db);
  } finally {
    await db.close();
    await rm(directory, { recursive: true, force: true });
  }
}

test('uses only the latest injection row for each well', async () => {
  await withDatabase(async (db) => {
    await db.run(`INSERT INTO measure_tracking VALUES (1, 'A-1', 'A', '生产', '2026-01-01', 2, 10, 'A')`);
    await db.run(`INSERT INTO measure_tracking VALUES (2, 'A-1', 'A', '正注', '2026-07-01', NULL, NULL, NULL)`);
    await db.run(`INSERT INTO measure_tracking VALUES (3, 'B-1', 'B', '生产', '2026-07-02', 3, 12, 'B')`);

    const result = await buildInjectionProductionCockpit(db, { now: '2026-07-25' });

    assert.equal(result.statusDistribution.injecting, 1);
    assert.equal(result.statusDistribution.producing, 1);
    assert.deepEqual(result.mapWells.map((well) => [well.wellNo, well.status]), [
      ['A-1', 'injecting'],
      ['B-1', 'producing'],
    ]);
  });
});

test('returns null and a needs-data alert instead of a fake zero', async () => {
  await withDatabase(async (db) => {
    await db.run(`INSERT INTO measure_tracking VALUES (1, 'A-1', 'A', '生产', '2026-07-01', NULL, NULL, NULL)`);

    const result = await buildInjectionProductionCockpit(db, { now: '2026-07-25' });

    assert.equal(result.metrics.dailyOil, null);
    assert.equal(result.alerts.some((alert) => alert.type === 'needsData' && alert.wellNo === 'A-1'), true);
  });
});

test('calculates production metrics and creates overdue and low-efficiency alerts', async () => {
  await withDatabase(async (db) => {
    await db.run(`INSERT INTO measure_tracking VALUES (1, 'A-1', 'A', '生产', '2026-07-01', 2, 10, 'D')`);
    await db.run(`INSERT INTO measure_tracking VALUES (2, 'B-1', 'B', '焖井', '2026-06-01', NULL, NULL, NULL)`);
    await db.run(`INSERT INTO measure_tracking VALUES (3, 'C-1', 'C', '转注', '2026-07-10', NULL, NULL, NULL)`);
    await db.run(`INSERT INTO measure_well_cycles VALUES (100, 20)`);
    await db.run(`INSERT INTO measure_well_cycles VALUES (300, 90)`);

    const result = await buildInjectionProductionCockpit(db, { now: '2026-07-25' });

    assert.equal(result.metrics.dailyOil, 2);
    assert.equal(result.metrics.cumulativeOilGain, 10);
    assert.equal(result.metrics.oilSteamRatio, 0.275);
    assert.deepEqual(result.alerts.map((alert) => alert.type).sort(), [
      'lowEfficiency', 'soakingOverdue', 'transferOverdue',
    ]);
  });
});

test('reports a failed production source without also marking it normal', async () => {
  await withDatabase(async (db) => {
    await db.run(`INSERT INTO production VALUES ('A-1', '2026-07-20', 1)`);
    await db.run(`INSERT INTO measure_well_imports VALUES ('2026-07-21T08:00:00Z')`);

    const result = await buildInjectionProductionCockpit(db, {
      now: '2026-07-25', syncStatus: { lastSyncStatus: 'error' },
    });

    const production = result.dataFreshness.find((item) => item.source === 'production');
    assert.deepEqual(production, {
      source: 'production', status: 'failed', updatedAt: '2026-07-20', message: '生产数据同步失败',
    });
  });
});
