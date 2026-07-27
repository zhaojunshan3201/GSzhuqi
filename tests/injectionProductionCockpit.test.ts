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
      CREATE TABLE injection_stage_rows (well_no TEXT, steam_volume REAL, stage_oil REAL);
      CREATE TABLE injection_selection_imports (source_type TEXT, imported_at TEXT);
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

test('calculates the oil-steam ratio from new stage rows without legacy cycles', async () => {
  await withDatabase(async (db) => {
    await db.run(`INSERT INTO injection_stage_rows (well_no, steam_volume, stage_oil) VALUES ('A-1', 100, 50)`);

    const result = await buildInjectionProductionCockpit(db, { now: '2026-07-25' });

    assert.equal(result.metrics.oilSteamRatio, 0.5);
  });
});

test('calculates production metrics and creates overdue and low-efficiency alerts', async () => {
  await withDatabase(async (db) => {
    await db.run(`INSERT INTO measure_tracking VALUES (1, 'A-1', 'A', '生产', '2026-07-01', 2, 10, 'D')`);
    await db.run(`INSERT INTO measure_tracking VALUES (2, 'B-1', 'B', '焖井', '2026-06-01', NULL, NULL, NULL)`);
    await db.run(`INSERT INTO measure_tracking VALUES (3, 'C-1', 'C', '转注', '2026-07-10', NULL, NULL, NULL)`);
    await db.run(`INSERT INTO injection_stage_rows (well_no, steam_volume, stage_oil) VALUES ('A-1', 100, 20)`);
    await db.run(`INSERT INTO injection_stage_rows (well_no, steam_volume, stage_oil) VALUES ('B-1', 300, 90)`);

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
    await db.run(`INSERT INTO injection_selection_imports VALUES ('stage', '2026-07-21T08:00:00Z')`);

    const result = await buildInjectionProductionCockpit(db, {
      now: '2026-07-25', syncStatus: { lastSyncStatus: 'error' },
    });

    const production = result.dataFreshness.find((item) => item.source === 'production');
    assert.deepEqual(production, {
      source: 'production', status: 'failed', updatedAt: '2026-07-20', message: '生产数据同步失败',
    });
  });
});

test('uses the stage import timestamp for selection data freshness', async () => {
  await withDatabase(async (db) => {
    await db.run(`INSERT INTO injection_selection_imports VALUES ('daily', '2026-07-24T08:00:00Z')`);
    await db.run(`INSERT INTO injection_selection_imports VALUES ('stage', '2026-07-21T08:00:00Z')`);

    const result = await buildInjectionProductionCockpit(db, { now: '2026-07-25' });

    const selection = result.dataFreshness.find((item) => item.source === 'selection');
    assert.equal(selection?.status, 'normal');
    assert.equal(selection?.updatedAt, '2026-07-21T08:00:00Z');
  });
});

test('aggregates latest lifecycle statuses by zh-CN-sorted block without duplicates', async () => {
  await withDatabase(async (db) => {
    await db.run(`INSERT INTO measure_tracking VALUES (1, 'B-1', 'B区', '焖井', '2026-07-01', NULL, NULL, NULL)`);
    await db.run(`INSERT INTO measure_tracking VALUES (2, 'B-1', 'B区', '生产', '2026-07-20', 3, 8, 'A')`);
    await db.run(`INSERT INTO measure_tracking VALUES (3, 'A-1', 'A区', '正注', '2026-07-20', NULL, NULL, NULL)`);
    await db.run(`INSERT INTO measure_tracking VALUES (4, 'A-2', 'A区', '转注', '2026-07-21', NULL, NULL, NULL)`);
    await db.run(`INSERT INTO measure_tracking VALUES (5, 'U-1', '', NULL, '2026-07-22', NULL, NULL, NULL)`);

    const result = await buildInjectionProductionCockpit(db, { now: '2026-07-25' });

    assert.deepEqual(result.blockStatusSummary, [
      { block: '未标注区块', producing: 0, injecting: 0, soaking: 0, pendingTransfer: 0, needsData: 1 },
      { block: 'A区', producing: 0, injecting: 1, soaking: 0, pendingTransfer: 1, needsData: 0 },
      { block: 'B区', producing: 1, injecting: 0, soaking: 0, pendingTransfer: 0, needsData: 0 },
    ]);
  });
});

test('aggregates finite production performance and valid cycle ratios by block', async () => {
  await withDatabase(async (db) => {
    await db.run(`INSERT INTO measure_tracking VALUES (1, 'A-1', 'A', '生产', '2026-07-20', 2, 10, 'A')`);
    await db.run(`INSERT INTO measure_tracking VALUES (2, 'A-1', 'old', '生产', '2026-01-01', 99, 99, 'A')`);
    await db.run(`INSERT INTO measure_tracking VALUES (3, 'A-2', 'A', '生产', '2026-07-21', 'bad', 5, 'B')`);
    await db.run(`INSERT INTO measure_tracking VALUES (4, 'B-1', 'B', '生产', '2026-07-22', 'bad', 'bad', 'A')`);
    await db.run(`INSERT INTO measure_tracking VALUES (5, 'C-1', 'C', '正注', '2026-07-23', 7, 20, 'A')`);
    await db.run(`INSERT INTO injection_stage_rows VALUES ('A-1', 100, 20)`);
    await db.run(`INSERT INTO injection_stage_rows VALUES ('A-2', 50, 10)`);
    await db.run(`INSERT INTO injection_stage_rows VALUES ('B-1', 0, 10)`);
    await db.run(`INSERT INTO injection_stage_rows VALUES ('C-1', 100, 50)`);
    await db.run(`INSERT INTO injection_stage_rows VALUES ('missing', 100, 100)`);

    const result = await buildInjectionProductionCockpit(db, { now: '2026-07-25' });

    assert.deepEqual(result.blockPerformanceSummary, [
      { block: 'A', dailyOil: 2, cumulativeOilGain: 15, oilSteamRatio: 0.2 },
      { block: 'B', dailyOil: null, cumulativeOilGain: null, oilSteamRatio: null },
      { block: 'C', dailyOil: null, cumulativeOilGain: null, oilSteamRatio: 0.5 },
    ]);
    assert.equal(Number.isFinite(result.metrics.dailyOil), true);
    assert.equal(Number.isFinite(result.metrics.cumulativeOilGain), true);
  });
});

test('keeps valid production values when another value or evaluation is missing', async () => {
  await withDatabase(async (db) => {
    await db.run(`INSERT INTO measure_tracking VALUES (1, 'A-1', 'A', '生产', '2026-07-20', 2, NULL, NULL)`);
    await db.run(`INSERT INTO measure_tracking VALUES (2, 'A-2', 'A', '生产', '2026-07-21', NULL, 5, 'A')`);
    await db.run(`INSERT INTO measure_tracking VALUES (3, 'B-1', 'B', '生产', '2026-07-22', NULL, NULL, 'A')`);

    const result = await buildInjectionProductionCockpit(db, { now: '2026-07-25' });

    assert.deepEqual(result.blockPerformanceSummary, [
      { block: 'A', dailyOil: 2, cumulativeOilGain: 5, oilSteamRatio: null },
      { block: 'B', dailyOil: null, cumulativeOilGain: null, oilSteamRatio: null },
    ]);
    assert.equal(result.metrics.dailyOil, 2);
    assert.equal(result.metrics.cumulativeOilGain, 5);
    assert.equal(result.alerts.some((alert) => alert.type === 'notEvaluated' && alert.wellNo === 'A-1'), true);
    assert.equal(result.alerts.some((alert) => alert.type === 'needsData' && alert.wellNo === 'A-2'), true);
  });
});

test('uses valid paired cycles for consistently rounded global and trimmed-block ratios', async () => {
  await withDatabase(async (db) => {
    await db.run(`INSERT INTO measure_tracking VALUES (1, ' A-1 ', 'A', '生产', '2026-07-20', 2, 5, 'A')`);
    await db.run(`INSERT INTO injection_stage_rows VALUES ('A-1', 100, 0)`);
    await db.run(`INSERT INTO injection_stage_rows VALUES (' A-1 ', 100, 30)`);
    await db.run(`INSERT INTO injection_stage_rows VALUES ('A-1', 100, NULL)`);
    await db.run(`INSERT INTO injection_stage_rows VALUES ('A-1', NULL, 40)`);
    await db.run(`INSERT INTO injection_stage_rows VALUES ('A-1', '   ', 20)`);
    await db.run(`INSERT INTO injection_stage_rows VALUES ('A-1', 50, '   ')`);

    const result = await buildInjectionProductionCockpit(db, { now: '2026-07-25' });

    assert.equal(result.metrics.oilSteamRatio, 0.15);
    assert.deepEqual(result.blockPerformanceSummary, [
      { block: 'A', dailyOil: 2, cumulativeOilGain: 5, oilSteamRatio: 0.15 },
    ]);
  });
});

test('keeps zero cycle oil for block ratio while preserving the global null convention', async () => {
  await withDatabase(async (db) => {
    await db.run(`INSERT INTO measure_tracking VALUES (1, 'A-1', 'A', '生产', '2026-07-20', 2, 5, 'A')`);
    await db.run(`INSERT INTO injection_stage_rows VALUES ('A-1', 100, 0)`);

    const result = await buildInjectionProductionCockpit(db, { now: '2026-07-25' });

    assert.equal(result.metrics.oilSteamRatio, null);
    assert.equal(result.blockPerformanceSummary[0].oilSteamRatio, 0);
  });
});

test('returns all alert distribution types in fixed order with counts from final alerts', async () => {
  await withDatabase(async (db) => {
    await db.run(`INSERT INTO measure_tracking VALUES (1, 'A-1', 'A', '生产', '2026-07-20', NULL, NULL, NULL)`);
    await db.run(`INSERT INTO measure_tracking VALUES (2, 'B-1', 'B', '生产', '2026-07-20', 2, 10, 'D')`);
    await db.run(`INSERT INTO measure_tracking VALUES (3, 'C-1', 'C', '焖井', '2026-06-01', NULL, NULL, NULL)`);
    await db.run(`INSERT INTO measure_tracking VALUES (4, 'D-1', 'D', '转注', '2026-07-01', NULL, NULL, NULL)`);
    await db.run(`INSERT INTO measure_tracking VALUES (5, 'E-1', 'E', '生产', '2026-07-20', 3, 12, NULL)`);

    const result = await buildInjectionProductionCockpit(db, { now: '2026-07-25' });

    assert.deepEqual(result.alertDistribution, [
      { type: 'needsData', count: 1 },
      { type: 'notEvaluated', count: 1 },
      { type: 'lowEfficiency', count: 1 },
      { type: 'soakingOverdue', count: 1 },
      { type: 'transferOverdue', count: 1 },
    ]);
    assert.equal(result.alertDistribution.reduce((sum, item) => sum + item.count, 0), result.alerts.length);
  });
});
