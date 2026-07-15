import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import sqlite3 from 'sqlite3';
import { open } from 'sqlite';

import {
  createSelectionImport,
  getSelectionWellDetail,
  initMeasureWellSelectionTables,
  listSelectionWells,
  replaceSelectionScores,
  upsertSelectionCycles,
} from '../src/lib/measureWellSelectionStore.ts';

async function withStore(run: (db: any) => Promise<void>) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'measure-well-selection-store-'));
  const db = await open({ filename: path.join(directory, 'test.db'), driver: sqlite3.Database });
  try {
    await initMeasureWellSelectionTables(db);
    await run(db);
  } finally {
    await db.close();
    await rm(directory, { recursive: true, force: true });
  }
}

function cycle(overrides: Partial<any> = {}) {
  return {
    wellName: 'A-1',
    block: 'Block A',
    station: 'Station 1',
    transferDate: '2026-01-01',
    round: 3,
    actualSteam: 2000,
    cycleOil: 662.4,
    ...overrides,
  } as any;
}

function score(overrides: Partial<any> = {}) {
  return {
    wellName: 'A-1',
    block: 'Block A',
    score: 82,
    grade: 'recommended' as const,
    missingReasons: [],
    scoreBreakdown: {},
    cycles: [],
    ...overrides,
  } as any;
}

test('upserts a duplicate well cycle instead of storing it twice', async () => {
  await withStore(async (db) => {
    await upsertSelectionCycles(db, [cycle()]);
    await upsertSelectionCycles(db, [cycle({ actualSteam: 2100 })]);

    assert.equal((await db.get('SELECT COUNT(*) AS count FROM measure_well_cycles')).count, 1);
    assert.equal((await db.get('SELECT actual_steam FROM measure_well_cycles')).actual_steam, 2100);
  });
});

test('replaces the score snapshot and lists scores using filters', async () => {
  await withStore(async (db) => {
    await replaceSelectionScores(db, [score({ station: 'Station 1' } as any), score({ wellName: 'B-1', grade: 'candidate', score: 65, station: 'Station 2' } as any)]);
    await replaceSelectionScores(db, [score({ score: 88, station: 'Station 1' } as any)]);

    assert.equal((await db.get('SELECT COUNT(*) AS count FROM measure_well_scores')).count, 1);
    assert.deepEqual(
      (await listSelectionWells(db, { block: 'Block A', station: 'Station 1', grade: 'recommended' })).map((item) => item.wellName),
      ['A-1'],
    );
  });
});

test('returns a well score and its three newest cycles', async () => {
  await withStore(async (db) => {
    await upsertSelectionCycles(db, [
      cycle({ round: 1, transferDate: '2024-01-01' }),
      cycle({ round: 2, transferDate: '2025-01-01' }),
      cycle({ round: 3, transferDate: '2026-01-01' }),
      cycle({ round: 4, transferDate: '2026-06-01' }),
    ]);
    await replaceSelectionScores(db, [score()]);

    const detail = await getSelectionWellDetail(db, 'A-1');
    assert.equal(detail?.score.score, 82);
    assert.deepEqual(detail?.cycles.map((item) => item.round), [4, 3, 2]);
  });
});

test('records an import batch and scopes a well detail to its block', async () => {
  await withStore(async (db) => {
    const importId = await createSelectionImport(db, '措施选井.xlsx', 2);
    await upsertSelectionCycles(db, [
      cycle({ importId, block: 'A', transferDate: '2026-01-01', round: 3 }),
      cycle({ importId, block: 'B', transferDate: '2026-06-01', round: 4 }),
    ]);
    await replaceSelectionScores(db, [
      score({ block: 'A', score: 82 }),
      score({ block: 'B', score: 70 }),
    ]);

    assert.equal((await db.get('SELECT row_count FROM measure_well_imports WHERE id = ?', [importId])).row_count, 2);
    const detail = await getSelectionWellDetail(db, 'A-1', 'B');
    assert.equal(detail?.score.block, 'B');
    assert.deepEqual(detail?.cycles.map((item) => item.block), ['B']);

    const legacyDetail = await getSelectionWellDetail(db, 'A-1');
    assert.equal(legacyDetail?.score.block, 'A');
    assert.deepEqual(legacyDetail?.cycles.map((item) => item.block), ['B', 'A']);
  });
});

test('initializes the cycle, score, and import tables', async () => {
  await withStore(async (db) => {
    const tables = await db.all("SELECT name FROM sqlite_master WHERE type = 'table' AND name LIKE 'measure_well_%' ORDER BY name");
    assert.deepEqual(tables.map((item: any) => item.name), ['measure_well_cycles', 'measure_well_imports', 'measure_well_scores']);
  });
});


