import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import sqlite3 from 'sqlite3';
import { open } from 'sqlite';
import { createChannelingProject, initChannelingProjectTables, listChannelingGovernanceTodos, updateChannelingProject } from '../src/lib/channelingProjectStore.ts';

async function withStore(run: (db: any) => Promise<void>) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'channeling-governance-'));
  const db = await open({ filename: path.join(directory, 'test.db'), driver: sqlite3.Database });
  try { await initChannelingProjectTables(db); await run(db); } finally { await db.close(); await rm(directory, { recursive: true, force: true }); }
}
const project = (name: string) => ({ projectName: name, block: 'A区', owner: '李工' });

test('records channeling governance fields and closes only with closure evidence', async () => {
  await withStore(async (db) => {
    const created = await createChannelingProject(db, project('注窜治理一期'));
    const governed = await updateChannelingProject(db, created.id, {
      status: 'governing', governanceMeasure: '调剖封窜', owner: '王工', plannedDate: '2026-08-01', actualDate: '2026-08-03',
      beforeMetric: 120, afterMetric: 80, riskLevel: 'high', estimatedLoss: 30, affectedWellCount: 4,
    });
    assert.equal(governed.status, 'governing');
    assert.equal(governed.governanceMeasure, '调剖封窜');
    assert.equal(governed.afterMetric, 80);
    await assert.rejects(() => updateChannelingProject(db, created.id, { status: 'closed' }), /closureEvidence/);
    const closed = await updateChannelingProject(db, created.id, { status: 'closed', closureEvidence: '示踪剂复测无响应' });
    assert.equal(closed.status, 'closed');
  });
});

test('orders governance todos by risk, overdue, loss, and affected well count', async () => {
  await withStore(async (db) => {
    const high = await createChannelingProject(db, project('高风险'));
    const overdue = await createChannelingProject(db, project('超期'));
    const loss = await createChannelingProject(db, project('损失高'));
    await updateChannelingProject(db, high.id, { riskLevel: 'high', estimatedLoss: 1, affectedWellCount: 1, plannedDate: '2026-12-01' });
    await updateChannelingProject(db, overdue.id, { riskLevel: 'medium', estimatedLoss: 99, affectedWellCount: 9, plannedDate: '2026-01-01' });
    await updateChannelingProject(db, loss.id, { riskLevel: 'medium', estimatedLoss: 100, affectedWellCount: 10, plannedDate: '2026-12-01' });
    assert.deepEqual((await listChannelingGovernanceTodos(db, '2026-07-26')).map((item) => item.projectName), ['高风险', '超期', '损失高']);
  });
});
