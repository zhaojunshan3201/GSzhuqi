import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import sqlite3 from 'sqlite3';
import { open } from 'sqlite';

import type { DailyInjectionRow, StageOilRow } from '../src/lib/injectionSelectionData.ts';
import {
  initInjectionSelectionTables,
  listDailyRows,
  listStageRows,
  replaceSelectionSource,
} from '../src/lib/injectionSelectionStore.ts';

async function withStore(run: (db: any) => Promise<void>) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'injection-selection-store-'));
  const db = await open({ filename: path.join(directory, 'test.db'), driver: sqlite3.Database });
  try {
    await initInjectionSelectionTables(db);
    await run(db);
  } finally {
    await db.close();
    await rm(directory, { recursive: true, force: true });
  }
}

function stageRow(wellNo: string, cycleNo: number): StageOilRow {
  return {
    wellNo, cycleNo, startDate: '2026-01-01', endDate: '2026-01-10', steamVolume: 1000,
    temperature: 350, pressure: 15, dryness: 75, productionHours: 720,
    stageOil: 500, stageWater: 1200, oilSteamRatio: 0.5,
  };
}

function dailyRow(wellNo: string, recordDate: string): DailyInjectionRow {
  return {
    wellNo, recordDate, boilerNo: '炉-1', productionHours: 24, flow: 7, dailySteam: 168,
    designSteam: 1800, cumulativeSteam: 168, pressure: 15, dryness: 75, temperature: 350,
    gasFlags: { nitrogen: true, carbonDioxide: false }, remarks: ['注氮气'],
  };
}

test('replaces only the current source snapshot and preserves the other source', async () => {
  await withStore(async (db) => {
    await replaceSelectionSource(db, 'stage', '阶段产油.xlsx', [stageRow('A', 1)]);
    await replaceSelectionSource(db, 'daily', '注汽日数据.xlsx', [dailyRow('A', '2026-01-01')]);
    await replaceSelectionSource(db, 'stage', '阶段产油-更新.xlsx', [stageRow('B', 1)]);

    assert.deepEqual((await listStageRows(db)).map((row) => row.wellNo), ['B']);
    assert.deepEqual((await listDailyRows(db)).map((row) => row.wellNo), ['A']);
    assert.equal((await listStageRows(db))[0].oilSteamRatio, 0.5);
    assert.deepEqual((await listDailyRows(db))[0].gasFlags, { nitrogen: true, carbonDioxide: false });
    assert.equal((await db.get("SELECT COUNT(*) AS count FROM injection_selection_imports WHERE source_type = 'stage'"))?.count, 1);
    assert.equal((await db.get("SELECT source_file FROM injection_selection_imports WHERE source_type = 'stage'"))?.source_file, '阶段产油-更新.xlsx');
  });
});

test('serializes reads after a source replacement so they never observe an empty snapshot', async () => {
  await withStore(async (db) => {
    await replaceSelectionSource(db, 'stage', '阶段产油.xlsx', [stageRow('A', 1)]);

    const replacing = replaceSelectionSource(db, 'stage', '阶段产油-更新.xlsx', [stageRow('B', 1)]);
    const rowsAfterReplacementRequest = listStageRows(db);
    await replacing;

    assert.deepEqual((await rowsAfterReplacementRequest).map((row) => row.wellNo), ['B']);
  });
});

test('keeps the last duplicate natural-key row from each imported source batch', async () => {
  await withStore(async (db) => {
    await replaceSelectionSource(db, 'stage', '阶段产油.xlsx', [
      stageRow('A', 1),
      { ...stageRow('A', 1), steamVolume: 1200, stageOil: 600 },
    ]);
    await replaceSelectionSource(db, 'daily', '注汽日数据.xlsx', [
      dailyRow('A', '2026-01-01'),
      { ...dailyRow('A', '2026-01-01'), dailySteam: 180 },
    ]);

    assert.deepEqual((await listStageRows(db)).map((row) => [row.wellNo, row.cycleNo, row.steamVolume]), [['A', 1, 1200]]);
    assert.deepEqual((await listDailyRows(db)).map((row) => [row.wellNo, row.recordDate, row.dailySteam]), [['A', '2026-01-01', 180]]);
  });
});

test('initializes the injection selection source and plan tables with required indexes', async () => {
  await withStore(async (db) => {
    const tables = await db.all("SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('injection_selection_imports', 'injection_stage_rows', 'injection_daily_rows', 'injection_selection_plans', 'injection_selection_plan_items') ORDER BY name");
    assert.deepEqual(tables.map((row: { name: string }) => row.name), [
      'injection_daily_rows',
      'injection_selection_imports',
      'injection_selection_plan_items',
      'injection_selection_plans',
      'injection_stage_rows',
    ]);
    const indexes = await db.all("SELECT name FROM sqlite_master WHERE type = 'index' AND name IN ('idx_injection_stage_rows_well_date', 'idx_injection_daily_rows_well_date', 'idx_injection_selection_plan_items_rank') ORDER BY name");
    assert.deepEqual(indexes.map((row: { name: string }) => row.name), [
      'idx_injection_daily_rows_well_date',
      'idx_injection_selection_plan_items_rank',
      'idx_injection_stage_rows_well_date',
    ]);
  });
});
