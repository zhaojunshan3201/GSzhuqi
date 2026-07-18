import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import sqlite3 from 'sqlite3';
import { open } from 'sqlite';

import { getExternalTransferUpload, initExternalTransferTables, replaceExternalTransferUpload } from '../src/lib/externalTransferStore.ts';

test('replaces the persisted external transfer upload', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'external-transfer-'));
  const db = await open({ filename: path.join(directory, 'test.db'), driver: sqlite3.Database });
  try {
    await initExternalTransferTables(db);
    await replaceExternalTransferUpload(db, { fileName: 'old.xlsx', records: [{ date: '2026-01-01', station: 'A', wellCount: 1, liquid: 1, oil: 1, diluent: 1, waterCut: 1, transfer: 1, transferDifference: 1, sewage: 1, returnFlow: 1, thinOil: 1 }] });
    await replaceExternalTransferUpload(db, { fileName: 'new.xlsx', records: [{ date: '2026-01-02', station: 'B', wellCount: 2, liquid: 2, oil: 2, diluent: 2, waterCut: 2, transfer: 2, transferDifference: 2, sewage: 2, returnFlow: 2, thinOil: 2 }] });
    assert.deepEqual(await getExternalTransferUpload(db), { fileName: 'new.xlsx', records: [{ date: '2026-01-02', station: 'B', wellCount: 2, liquid: 2, oil: 2, diluent: 2, waterCut: 2, transfer: 2, transferDifference: 2, sewage: 2, returnFlow: 2, thinOil: 2 }] });
  } finally { await db.close(); await rm(directory, { recursive: true, force: true }); }
});
