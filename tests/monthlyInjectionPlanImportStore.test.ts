import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import sqlite3 from 'sqlite3';
import { open } from 'sqlite';

import { createInjectionProject, initInjectionProjectTables, listInjectionProjects, listProjectPendingItems, transitionInjectionProject, updatePlanStatus } from '../src/lib/injectionProjectStore.ts';
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
    const validRow = { ...valid('W-1'), remark: 'valid remark' };
    const pendingRow = { ...valid('W-pending'), rawWellText: 'raw pending well', sourceCell: 'D2' };
    const invalidRow = { ...valid('W-invalid'), rawScheduleText: 'raw invalid schedule', sourceCell: 'E2' };
    const preview = await createPlanPreview(db, { ...previewInput([validRow]), pendingRows: [pendingRow], invalidRows: [invalidRow] });
    assert.equal(preview.status, 'preview');
    assert.deepEqual(preview.rows, [validRow]);
    assert.deepEqual(preview.pendingRows, [pendingRow]);
    assert.deepEqual(preview.invalidRows, [invalidRow]);
    assert.equal((await db.get('SELECT COUNT(*) AS count FROM injection_projects')).count, 0);
    const stored = await db.all('SELECT row_class, raw_well_text, raw_schedule_text, source_cell, snapshot_json FROM injection_plan_import_rows ORDER BY id');
    assert.deepEqual(stored.map((row: any) => row.row_class), ['valid', 'pending', 'invalid']);
    assert.deepEqual(stored.map((row: any) => JSON.parse(row.snapshot_json)), [validRow, pendingRow, invalidRow]);
    assert.deepEqual(stored.map((row: any) => [row.raw_well_text, row.raw_schedule_text, row.source_cell]), [
      [validRow.rawWellText, validRow.rawScheduleText, validRow.sourceCell],
      [pendingRow.rawWellText, pendingRow.rawScheduleText, pendingRow.sourceCell],
      [invalidRow.rawWellText, invalidRow.rawScheduleText, invalidRow.sourceCell],
    ]);
  });
});

test('preview compares valid rows with the prior confirmed import for the same month', async () => {
  await withStore(async (db) => {
    const first = await createPlanPreview(db, previewInput([valid('W-1', 100), valid('W-2', 200)]));
    await confirmPlanImport(db, first.id);

    const revision = await createPlanPreview(db, previewInput([valid('W-1', 150), valid('W-3', 300)]));

    assert.deepEqual(revision.previousComparison, { added: 1, modified: 1, removed: 1 });
  });
});

test('confirming a revision updates same-month imports, supersedes prior batch, and preserves execution state', async () => {
  await withStore(async (db) => {
    const first = await createPlanPreview(db, previewInput([valid('W-1', 100), valid('W-2', 200)]));
    await confirmPlanImport(db, first.id);
    const issued = await db.get('SELECT * FROM injection_projects WHERE well_no = ?', ['W-1']);
    await updatePlanStatus(db, issued.id, 'issued');
    await transitionInjectionProject(db, issued.id, 'injecting', '2026-08-01');
    const removedExecuted = await db.get('SELECT * FROM injection_projects WHERE well_no = ?', ['W-2']);
    await updatePlanStatus(db, removedExecuted.id, 'issued');
    await transitionInjectionProject(db, removedExecuted.id, 'injecting', '2026-08-01');
    await transitionInjectionProject(db, removedExecuted.id, 'soaking', '2026-08-02');

    const revision = await createPlanPreview(db, previewInput([{ ...valid('W-1', 150), unit: 'U2', boiler: 'B2', gasSupport: 'CO2', startDate: '2026-08-05', endDate: '2026-08-09', planStatus: 'revised', remark: 'revised remark' }, valid('W-3', 300)]));
    await confirmPlanImport(db, revision.id);

    const w1 = await db.get('SELECT * FROM injection_projects WHERE well_no = ?', ['W-1']);
    const w2 = await db.get('SELECT * FROM injection_projects WHERE well_no = ?', ['W-2']);
    const w3 = await db.get('SELECT * FROM injection_projects WHERE well_no = ?', ['W-3']);
    assert.deepEqual({ steam: w1.planned_steam, block: w1.block, unit: w1.unit, boiler: w1.boiler, gas: w1.gas_support, start: w1.planned_start_date, end: w1.planned_end_date, transfer: w1.planned_transfer_date, remark: w1.remark, plan: w1.plan_status, lifecycle: w1.lifecycle_status, source: w1.source_import_id }, { steam: 150, block: 'U2', unit: 'U2', boiler: 'B2', gas: 'CO2', start: '2026-08-05', end: '2026-08-09', transfer: '2026-08-09', remark: 'revised remark', plan: 'issued', lifecycle: 'injecting', source: revision.id });
    assert.equal(w2.source_import_id, null);
    assert.equal(w2.schedule_status, 'superseded');
    assert.equal(w2.lifecycle_status, 'soaking');
    assert.equal((await listInjectionProjects(db)).some((project) => project.id === w2.id), true);
    assert.equal((await listInjectionProjects(db, { includeSuperseded: true })).some((project) => project.id === w2.id), true);
    assert.equal((await listProjectPendingItems(db, '2026-08-10')).some((project) => project.id === w2.id), true);
    assert.deepEqual({ plan: w3.plan_status, lifecycle: w3.lifecycle_status, source: w3.source_import_id }, { plan: 'draft', lifecycle: 'pending', source: revision.id });
    assert.deepEqual((await listPlanImports(db)).map((item) => item.status).sort(), ['confirmed', 'superseded']);
  });
});

test('serializes concurrent confirmations on the same database connection', async () => {
  await withStore(async (db) => {
    const first = await createPlanPreview(db, previewInput([valid('W-1', 100)]));
    const second = await createPlanPreview(db, previewInput([valid('W-2', 200)]));

    const results = await Promise.allSettled([
      confirmPlanImport(db, first.id),
      confirmPlanImport(db, second.id),
    ]);

    assert.deepEqual(results.map((result) => result.status), ['fulfilled', 'fulfilled']);
    assert.deepEqual((await listPlanImports(db)).map((item) => item.status).sort(), ['confirmed', 'superseded']);
  });
});

test('confirmation rolls back all writes when a project write fails', async () => {
  await withStore(async (db) => {
    const first = await createPlanPreview(db, previewInput([valid('W-1', 100)]));
    await confirmPlanImport(db, first.id);
    await db.exec(`CREATE TRIGGER fail_import_project BEFORE INSERT ON injection_projects
      WHEN NEW.well_no = 'W-fail' BEGIN SELECT RAISE(ABORT, 'forced project write failure'); END;`);
    const revision = await createPlanPreview(db, previewInput([valid('W-1', 150), valid('W-fail', 200)]));

    await assert.rejects(() => confirmPlanImport(db, revision.id), /forced project write failure/);

    const original = await db.get('SELECT planned_steam, source_import_id, schedule_status FROM injection_projects WHERE well_no = ?', ['W-1']);
    assert.deepEqual(original, { planned_steam: 100, source_import_id: first.id, schedule_status: 'scheduled' });
    assert.equal((await db.get('SELECT status FROM injection_plan_imports WHERE id = ?', [first.id])).status, 'confirmed');
    assert.equal((await db.get('SELECT status FROM injection_plan_imports WHERE id = ?', [revision.id])).status, 'preview');
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


test('confirmation keeps the last valid row for a duplicate well in one preview batch', async () => {
  await withStore(async (db) => {
    const preview = await createPlanPreview(db, previewInput([
      valid('W-duplicate', 100),
      { ...valid('W-duplicate', 250), unit: 'U2', boiler: 'B2', startDate: '2026-08-04', endDate: '2026-08-06' },
    ]));

    await confirmPlanImport(db, preview.id);

    const projects = await db.all('SELECT * FROM injection_projects WHERE well_no = ?', ['W-duplicate']);
    assert.equal(projects.length, 1);
    assert.deepEqual({ steam: projects[0].planned_steam, unit: projects[0].unit, boiler: projects[0].boiler, start: projects[0].planned_start_date, end: projects[0].planned_end_date }, {
      steam: 250, unit: 'U2', boiler: 'B2', start: '2026-08-04', end: '2026-08-06',
    });
  });
});
