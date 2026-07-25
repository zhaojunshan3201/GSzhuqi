import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import sqlite3 from 'sqlite3';
import { open } from 'sqlite';

import { createInjectionProject, initInjectionProjectTables, listProjectPendingItems, transitionInjectionProject, updatePlanStatus } from '../src/lib/injectionProjectStore.ts';

async function withStore(run: (db: any) => Promise<void>) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'injection-project-store-'));
  const db = await open({ filename: path.join(directory, 'test.db'), driver: sqlite3.Database });
  try { await initInjectionProjectTables(db); await run(db); } finally { await db.close(); await rm(directory, { recursive: true, force: true }); }
}

const draft = () => ({ wellNo: 'A-1', block: 'A', processType: '分层注汽', plannedTransferDate: '2026-07-10', owner: '张工' });

test('requires an issued plan and only allows the agreed lifecycle sequence', async () => {
  await withStore(async (db) => {
    const project = await createInjectionProject(db, draft());
    await assert.rejects(() => transitionInjectionProject(db, project.id, 'injecting', '2026-07-01'), /已下达/);
    await updatePlanStatus(db, project.id, 'issued');
    await transitionInjectionProject(db, project.id, 'injecting', '2026-07-01');
    await assert.rejects(() => transitionInjectionProject(db, project.id, 'producing', '2026-07-02'), /无效/);
    const soaking = await transitionInjectionProject(db, project.id, 'soaking', '2026-07-02', '开始焖井');
    assert.equal(soaking.lifecycleStatus, 'soaking');
    assert.equal((await db.get('SELECT COUNT(*) AS count FROM injection_project_transitions')).count, 2);
  });
});

test('validates plans and calculates overdue pending items', async () => {
  await withStore(async (db) => {
    await assert.rejects(() => createInjectionProject(db, { ...draft(), wellNo: '' }), /井号/);
    const project = await createInjectionProject(db, draft());
    await updatePlanStatus(db, project.id, 'issued');
    await transitionInjectionProject(db, project.id, 'injecting', '2026-07-01');
    await transitionInjectionProject(db, project.id, 'soaking', '2026-07-02');

    const pending = await listProjectPendingItems(db, '2026-07-25');

    assert.deepEqual(pending.map((item) => ({ wellNo: item.wellNo, overdueDays: item.overdueDays })), [{ wellNo: 'A-1', overdueDays: 15 }]);
  });
});
