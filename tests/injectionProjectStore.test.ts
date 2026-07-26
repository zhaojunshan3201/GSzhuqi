import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import sqlite3 from 'sqlite3';
import { open } from 'sqlite';

import { createInjectionProject, initInjectionProjectTables, listInjectionProjects, listProjectPendingItems, transitionInjectionProject, updatePlanStatus } from '../src/lib/injectionProjectStore.ts';

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

test('stores optional monthly-plan fields as nullable without changing lifecycle behavior', async () => {
  await withStore(async (db) => {
    const project = await createInjectionProject(db, draft());
    const row = await db.get('SELECT unit, boiler, planned_start_date, planned_end_date, gas_support, schedule_status, source_import_id FROM injection_projects WHERE id = ?', [project.id]);
    assert.deepEqual(row, { unit: null, boiler: null, planned_start_date: null, planned_end_date: null, gas_support: null, schedule_status: null, source_import_id: null });
    await updatePlanStatus(db, project.id, 'issued');
    assert.equal((await transitionInjectionProject(db, project.id, 'injecting', '2026-07-01')).lifecycleStatus, 'injecting');
  });
});

test('migrates an existing project table by adding monthly-plan columns', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'injection-project-migration-'));
  const db = await open({ filename: path.join(directory, 'test.db'), driver: sqlite3.Database });
  try {
    await db.exec(`CREATE TABLE injection_projects (
      id INTEGER PRIMARY KEY AUTOINCREMENT, project_no TEXT NOT NULL UNIQUE, well_no TEXT NOT NULL, block TEXT NOT NULL, process_type TEXT NOT NULL,
      planned_steam REAL, planned_pressure REAL, planned_rate REAL, planned_transfer_date TEXT NOT NULL, owner TEXT NOT NULL, remark TEXT,
      plan_status TEXT NOT NULL DEFAULT 'draft', lifecycle_status TEXT NOT NULL DEFAULT 'pending', created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    )`);
    await initInjectionProjectTables(db);
    const columns = (await db.all('PRAGMA table_info(injection_projects)')).map((column: any) => column.name);
    for (const column of ['unit', 'boiler', 'planned_start_date', 'planned_end_date', 'gas_support', 'schedule_status', 'source_import_id']) assert.ok(columns.includes(column));
  } finally { await db.close(); await rm(directory, { recursive: true, force: true }); }
});

test('returns the soaking transition date with listed projects', async () => {
  await withStore(async (db) => {
    const project = await createInjectionProject(db, draft());
    await updatePlanStatus(db, project.id, 'issued');
    await transitionInjectionProject(db, project.id, 'injecting', '2026-07-01');
    await transitionInjectionProject(db, project.id, 'soaking', '2026-07-02');

    assert.equal((await listInjectionProjects(db))[0].soakStartDate, '2026-07-02');
  });
});
