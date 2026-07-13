import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import sqlite3 from 'sqlite3';
import { open } from 'sqlite';

import {
  deleteWellTemperatureTest,
  getWellTemperatureTest,
  initWellTemperatureTables,
  listWellTemperatureTests,
  replaceWellTemperatureTest,
} from '../src/lib/wellTemperatureStore.ts';

async function withStore(run: (db: any) => Promise<void>) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'well-temperature-store-'));
  const db = await open({ filename: path.join(directory, 'test.db'), driver: sqlite3.Database });
  try {
    await initWellTemperatureTables(db);
    await run(db);
  } finally {
    await db.close();
    await rm(directory, { recursive: true, force: true });
  }
}

function sample(overrides: Partial<any> = {}) {
  return {
    wellNo: '高2-2-96',
    testDate: '2026-06-21',
    perforationTopDepth: 1555.6,
    perforationBottomDepth: 1610.1,
    sourceFile: '高2-2-96（2026-06-21）井筒温度压力测试表.xlsx',
    points: [
      { depth: 100, temperature: 30, pressure: 1 },
      { depth: 200, temperature: 40, pressure: null },
    ],
    ...overrides,
  };
}

test('首次插入井温测试并返回摘要', async () => {
  await withStore(async (db) => {
    const stored = await replaceWellTemperatureTest(db, sample());
    assert.equal(stored.wellNo, '高2-2-96');
    assert.equal(stored.testDate, '2026-06-21');
    assert.equal(stored.pointCount, 2);
    assert.ok(stored.id > 0);
  });
});

test('同井同日替换后只保留新摘要和新测点', async () => {
  await withStore(async (db) => {
    await replaceWellTemperatureTest(db, sample());
    await replaceWellTemperatureTest(db, sample({ points: [{ depth: 300, temperature: 50, pressure: 2 }] }));
    const tests = await listWellTemperatureTests(db);
    const detail = await getWellTemperatureTest(db, tests[0].id);
    assert.equal(tests.length, 1);
    assert.equal(detail?.pointCount, 1);
    assert.deepEqual(detail?.points, [{ depth: 300, temperature: 50, pressure: 2 }]);
  });
});

test('同井不同日期保留两条摘要', async () => {
  await withStore(async (db) => {
    await replaceWellTemperatureTest(db, sample());
    await replaceWellTemperatureTest(db, sample({ testDate: '2026-06-22' }));
    assert.equal((await listWellTemperatureTests(db)).length, 2);
  });
});

test('详情按深度升序返回测点', async () => {
  await withStore(async (db) => {
    const stored = await replaceWellTemperatureTest(db, sample({ points: [
      { depth: 300, temperature: 50, pressure: null },
      { depth: 100, temperature: 30, pressure: 1 },
    ] }));
    assert.deepEqual((await getWellTemperatureTest(db, stored.id))?.points.map((point: any) => point.depth), [100, 300]);
  });
});

test('删除测试时一并删除测点', async () => {
  await withStore(async (db) => {
    const stored = await replaceWellTemperatureTest(db, sample());
    assert.equal(await deleteWellTemperatureTest(db, stored.id), true);
    assert.equal(await getWellTemperatureTest(db, stored.id), undefined);
    assert.equal((await db.get('SELECT COUNT(*) AS count FROM well_temperature_points')).count, 0);
  });
});

test('列表可按井号模糊筛选', async () => {
  await withStore(async (db) => {
    await replaceWellTemperatureTest(db, sample());
    await replaceWellTemperatureTest(db, sample({ wellNo: '高3-1-1', testDate: '2026-06-22' }));
    assert.deepEqual((await listWellTemperatureTests(db, '2-2')).map((item: any) => item.wellNo), ['高2-2-96']);
  });
});


test('??????????????????', async () => {
  await withStore(async (db) => {
    await replaceWellTemperatureTest(db, sample({ wellNo: 'B-1', testDate: '2026-06-20' }));
    await replaceWellTemperatureTest(db, sample({ wellNo: 'A-1', testDate: '2026-06-19' }));
    await replaceWellTemperatureTest(db, sample({ wellNo: 'B-1', testDate: '2026-06-21' }));
    assert.deepEqual(
      (await listWellTemperatureTests(db)).map((item) => `${item.wellNo}:${item.testDate}`),
      ['A-1:2026-06-19', 'B-1:2026-06-21', 'B-1:2026-06-20'],
    );
  });
});

test('???????', async () => {
  await withStore(async (db) => {
    await initWellTemperatureTables(db);
    await initWellTemperatureTables(db);
    assert.equal((await db.get("SELECT COUNT(*) AS count FROM sqlite_master WHERE type = 'table' AND name = 'well_temperature_tests'")).count, 1);
  });
});

test('????????????????', async () => {
  await withStore(async (db) => {
    const stored = await replaceWellTemperatureTest(db, sample());
    await assert.rejects(() => replaceWellTemperatureTest(db, sample({ points: [{ depth: null as any, temperature: 50, pressure: 2 }] })));
    const detail = await getWellTemperatureTest(db, stored.id);
    assert.equal(detail?.pointCount, 2);
    assert.deepEqual(detail?.points.map((point) => point.depth), [100, 200]);
  });
});
