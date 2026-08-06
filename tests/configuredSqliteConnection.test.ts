import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { openConfiguredSqliteDatabase } from '../src/lib/configuredSqliteConnection.ts';

test('configured SQLite connections enforce foreign keys and wait up to five seconds for writers', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'configured-sqlite-'));
  const db = await openConfiguredSqliteDatabase(path.join(directory, 'test.db'));
  try {
    assert.equal((await db.get('PRAGMA foreign_keys')).foreign_keys, 1);
    assert.equal((await db.get('PRAGMA busy_timeout')).timeout, 5000);
  } finally {
    await db.close();
    await rm(directory, { recursive: true, force: true });
  }
});
