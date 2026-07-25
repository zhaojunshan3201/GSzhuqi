import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import sqlite3 from 'sqlite3';
import { open } from 'sqlite';

import { createInjectionProject, initInjectionProjectTables, transitionInjectionProject, updatePlanStatus } from '../src/lib/injectionProjectStore.ts';
import { confirmPlanImport, createPlanPreview, initMonthlyInjectionPlanImportTables, listPlanImports } from '../src/lib/monthlyInjectionPlanImportStore.ts';

const valid = (wellNo: string, steam = 100) => ({ unit: 'U1', boiler: 'B1', wellNo, plannedSteam: steam, gasSupport: 'N2', startDate: '2026-08-01', endDate: '2026-08-03', planStatus: null, remark: null, sourceCell: 'C2', rawWellText: `${wellNo} (${steam})`, rawScheduleText: '8.1-8.3' });
const previewInput = (rows: ReturnType<typeof valid>[]) => ({ fileName: 'plan.xlsx', sheetName: 'August', planMonth: '2026-08', rows, pendingRows: [], invalidRows: [], totalPlannedSteam: rows.reduce((sum, row) => sum + (row.plannedSteam ?? 0), 0) });

async function withStore(run: (db: any) => Promise<void>) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'injection-plan-import-'));
  const db = await open({ filename: path.join(directory, 'test.db'), driver: sqlite3.Database });
  try { await initInjectionProjectTables(db); await initMonthlyInjectionPlanImportTables(db); await run(db); } finally { await db.close(); await rm(directory, { recursive: true, force: true }); }
}

test('preview stores snapshots but creates no projects until confirmation', async () => {
  await withStore(async (db) => {
    const preview = await createPlanPreview(db, previewInput([valid('W-1')]));
    assert.equal(preview.status, 'preview');
    assert.equal((await db.get('SELECT COUNT(*) AS count FROM injection_projects')).count, 0);
    assert.equal((await db.get('SELECT COUNT(*) AS count FROM injection_plan_import_rows')).count, 1);
  });
});

test('confirming a revision updates same-month imports, supersedes prior batch, and preserves execution state', async () => {
  await withStore(async (db) => {
    const first = await createPlanPreview(db, previewInput([valid('W-1', 100), valid('W-2', 200)]));
    await confirmPlanImport(db, first.id);
    const issued = await db.get('SELECT * FROM injection_projects WHERE well_no = ?', ['W-1']);
    await updatePlanStatus(db, issued.id, 'issued');
    await transitionInjectionProject(db, issued.id, 'injecting', '2026-08-01');

    const revision = await createPlanPreview(db, previewInput([valid('W-1', 150), valid('W-3', 300)]));
    await confirmPlanImport(db, revision.id);

    const w1 = await db.get('SELECT * FROM injection_projects WHERE well_no = ?', ['W-1']);
    const w2 = await db.get('SELECT * FROM injection_projects WHERE well_no = ?', ['W-2']);
    const w3 = await db.get('SELECT * FROM injection_projects WHERE well_no = ?', ['W-3']);
    assert.deepEqual({ steam: w1.planned_steam, plan: w1.plan_status, lifecycle: w1.lifecycle_status, source: w1.source_import_id }, { steam: 150, plan: 'issued', lifecycle: 'injecting', source: revision.id });
    assert.equal(w2.source_import_id, null);
    assert.equal(w2.schedule_status, 'superseded');
    assert.deepEqual({ plan: w3.plan_status, lifecycle: w3.lifecycle_status, source: w3.source_import_id }, { plan: 'draft', lifecycle: 'pending', source: revision.id });
    assert.deepEqual((await listPlanImports(db)).map((item) => item.status).sort(), ['confirmed', 'superseded']);
  });
});

test('manual projects are not affected by monthly plan confirmation', async () => {
  await withStore(async (db) => {
    const manual = await createInjectionProject(db, { wellNo: 'W-manual', block: 'A', processType: 'manual', plannedTransferDate: '2026-08-02', owner: 'owner' });
    const preview = await createPlanPreview(db, previewInput([valid('W-manual', 999)]));
    await confirmPlanImport(db, preview.id);
    const projects = await db.all('SELECT * FROM injection_projects WHERE well_no = ?', ['W-manual']);
    assert.equal(projects.length, 2);
    assert.equal((await db.get('SELECT * FROM injection_projects WHERE id = ?', [manual.id])).source_import_id, null);
  });
});