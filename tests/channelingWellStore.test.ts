import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import sqlite3 from 'sqlite3';
import { open } from 'sqlite';

import {
  createWellProfile,
  getWellProfile,
  initChannelingWellTables,
  listWellProfiles,
  normalizeWellNo,
  updateWellProfile,
} from '../src/lib/channelingWellStore.ts';

async function withStore(run: (db: any) => Promise<void>) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'channeling-well-store-'));
  const db = await open({ filename: path.join(directory, 'test.db'), driver: sqlite3.Database });
  try {
    await initChannelingWellTables(db);
    await run(db);
  } finally {
    await db.close();
    await rm(directory, { recursive: true, force: true });
  }
}

test('normalizes well numbers and rejects blank values', () => {
  assert.equal(normalizeWellNo('  gao3-A  '), 'GAO3-A');
  assert.throws(() => normalizeWellNo('   '), /wellNo is required/);
  assert.throws(() => normalizeWellNo(null), /wellNo is required/);
});

test('creates a profile with defaults and reuses the normalized well number', async () => {
  await withStore(async (db) => {
    const first = await createWellProfile(db, { wellNo: ' gao3-A ' });
    const second = await createWellProfile(db, { wellNo: 'GAO3-a', block: 'B区', owner: '王工' });

    assert.equal(first.id, second.id);
    assert.equal(first.wellNo, 'gao3-A');
    assert.equal(first.normalizedWellNo, 'GAO3-A');
    assert.equal(first.block, '');
    assert.equal(first.owner, '');
    assert.equal((await db.get('SELECT COUNT(*) AS count FROM channeling_well_profiles')).count, 1);
  });
});

test('reuses one profile when two database connections create the same normalized well concurrently', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'channeling-well-concurrent-'));
  const filename = path.join(directory, 'test.db');
  const firstDb = await open({ filename, driver: sqlite3.Database });
  const secondDb = await open({ filename, driver: sqlite3.Database });
  try {
    await initChannelingWellTables(firstDb);
    let waiting = 0;
    let release!: () => void;
    const bothSelected = new Promise<void>((resolve) => { release = resolve; });
    for (const db of [firstDb, secondDb]) {
      const get = db.get.bind(db);
      db.get = async (sql: string, params?: unknown[]) => {
        const row = await get(sql, params);
        if (sql.includes('normalized_well_no') && !row) {
          waiting += 1;
          if (waiting === 2) release();
          await bothSelected;
        }
        return row;
      };
    }

    const [first, second] = await Promise.all([
      createWellProfile(firstDb, { wellNo: ' gao3-a ' }),
      createWellProfile(secondDb, { wellNo: 'GAO3-A' }),
    ]);
    assert.equal(first.id, second.id);
  } finally {
    await firstDb.close();
    await secondDb.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test('lists profiles newest first with well query and exact block filters', async () => {
  await withStore(async (db) => {
    const first = await createWellProfile(db, { wellNo: 'gao3-A', block: 'A区', owner: '李工' });
    const second = await createWellProfile(db, { wellNo: 'Gao4-B', block: 'B区', owner: '王工' });
    const third = await createWellProfile(db, { wellNo: 'gao5-C', block: 'A区-2', owner: '赵工' });
    await db.run('UPDATE channeling_well_profiles SET updated_at = ? WHERE id = ?', ['2026-08-05T01:00:00.000Z', first.id]);
    await db.run('UPDATE channeling_well_profiles SET updated_at = ? WHERE id = ?', ['2026-08-05T03:00:00.000Z', second.id]);
    await db.run('UPDATE channeling_well_profiles SET updated_at = ? WHERE id = ?', ['2026-08-05T02:00:00.000Z', third.id]);

    assert.deepEqual((await listWellProfiles(db)).map((profile) => profile.id), [second.id, third.id, first.id]);
    assert.deepEqual((await listWellProfiles(db, { query: ' gAo ' })).map((profile) => profile.id), [second.id, third.id, first.id]);
    assert.deepEqual((await listWellProfiles(db, { query: '4-b' })).map((profile) => profile.id), [second.id]);
    assert.deepEqual((await listWellProfiles(db, { block: 'A区' })).map((profile) => profile.id), [first.id]);
  });
});

test('treats percent and underscore as literal well query characters', async () => {
  await withStore(async (db) => {
    const percent = await createWellProfile(db, { wellNo: 'G%1' });
    await createWellProfile(db, { wellNo: 'GAB1' });
    const underscore = await createWellProfile(db, { wellNo: 'G_2' });
    await createWellProfile(db, { wellNo: 'GA2' });

    assert.deepEqual((await listWellProfiles(db, { query: '%' })).map((profile) => profile.id), [percent.id]);
    assert.deepEqual((await listWellProfiles(db, { query: '_' })).map((profile) => profile.id), [underscore.id]);
  });
});

test('gets a profile and reports a missing profile', async () => {
  await withStore(async (db) => {
    const created = await createWellProfile(db, { wellNo: 'G1', block: 'A区' });
    assert.deepEqual(await getWellProfile(db, created.id), created);
    await assert.rejects(() => getWellProfile(db, 404), /Well profile not found/);
  });
});

test('updates block and owner using optimistic concurrency', async () => {
  await withStore(async (db) => {
    const created = await createWellProfile(db, { wellNo: 'G1', block: 'A区', owner: '李工' });
    const expectedUpdatedAt = '2026-08-04T00:00:00.000Z';
    await db.run('UPDATE channeling_well_profiles SET updated_at = ? WHERE id = ?', [expectedUpdatedAt, created.id]);

    const updated = await updateWellProfile(db, created.id, { block: ' B区 ', owner: ' 王工 ', updatedAt: expectedUpdatedAt });
    assert.equal(updated.block, 'B区');
    assert.equal(updated.owner, '王工');
    assert.notEqual(updated.updatedAt, expectedUpdatedAt);
  });
});

test('detects a successful guarded update without relying on run changes', async () => {
  await withStore(async (db) => {
    const created = await createWellProfile(db, { wellNo: 'G1', block: 'A区', owner: '李工' });
    const expectedUpdatedAt = '2026-08-04T00:00:00.000Z';
    await db.run('UPDATE channeling_well_profiles SET updated_at = ? WHERE id = ?', [expectedUpdatedAt, created.id]);
    const run = db.run.bind(db);
    db.run = async (sql: string, params?: unknown[]) => {
      const result = await run(sql, params);
      return { lastID: result.lastID };
    };

    const updated = await updateWellProfile(db, created.id, { block: 'B区', owner: '王工', updatedAt: expectedUpdatedAt });
    assert.equal(updated.block, 'B区');
    assert.equal(updated.owner, '王工');
  });
});

test('advances the update token when the wall clock has not advanced', async () => {
  await withStore(async (db) => {
    const created = await createWellProfile(db, { wellNo: 'G1', block: 'A区', owner: '李工' });
    const originalToken = '2026-08-05T00:00:00.000Z';
    await db.run('UPDATE channeling_well_profiles SET updated_at = ? WHERE id = ?', [originalToken, created.id]);

    const RealDate = globalThis.Date;
    globalThis.Date = class extends RealDate {
      constructor(value?: string | number) { super(value ?? originalToken); }
    } as DateConstructor;
    try {
      const updated = await updateWellProfile(db, created.id, { block: 'B区', owner: '王工', updatedAt: originalToken });
      assert.equal(updated.updatedAt, '2026-08-05T00:00:00.001Z');
      await assert.rejects(
        () => updateWellProfile(db, created.id, { block: 'C区', owner: '赵工', updatedAt: originalToken }),
        /Well profile changed; refresh and retry/,
      );
    } finally {
      globalThis.Date = RealDate;
    }
  });
});

test('rejects stale updates without changing the profile', async () => {
  await withStore(async (db) => {
    const created = await createWellProfile(db, { wellNo: 'G1', block: 'A区', owner: '李工' });
    await assert.rejects(
      () => updateWellProfile(db, created.id, { block: 'B区', owner: '王工', updatedAt: 'stale' }),
      /Well profile changed; refresh and retry/,
    );
    assert.equal((await getWellProfile(db, created.id)).block, 'A区');
  });
});

test('preserves the distinct not-found error when updating a missing profile', async () => {
  await withStore(async (db) => {
    await assert.rejects(
      () => updateWellProfile(db, 404, { block: 'B区', owner: '王工', updatedAt: 'missing' }),
      /Well profile not found/,
    );
  });
});
