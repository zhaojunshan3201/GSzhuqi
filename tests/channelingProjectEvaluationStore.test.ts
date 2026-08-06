import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import sqlite3 from 'sqlite3';
import { open } from 'sqlite';

import { createProjectEvaluation } from '../src/lib/channelingProjectEvaluationStore.ts';
import { createChannelingProject, createChannelingRelation, initChannelingProjectTables } from '../src/lib/channelingProjectStore.ts';
import { listTrackingEvents } from '../src/lib/channelingTrackingStore.ts';

test('creates an immutable project evaluation with a server-derived summary snapshot', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'channeling-project-evaluation-'));
  const db = await open({ filename: path.join(directory, 'test.db'), driver: sqlite3.Database });
  try {
    await db.exec(`CREATE TABLE production (jh TEXT, rq TEXT, oil REAL, liquid REAL, water_cut REAL, block TEXT);
      CREATE TABLE injection_stage_rows (well_no TEXT, cycle_no INTEGER, start_date TEXT, end_date TEXT, steam_volume REAL, temperature REAL, pressure REAL, dryness REAL, production_hours REAL);`);
    await initChannelingProjectTables(db);
    const project = await createChannelingProject(db, { projectName: 'evaluation', block: 'A', owner: 'owner' });
    await createChannelingRelation(db, {
      projectId: project.id, channelingType: 'steam', injectionWell: 'I-1', productionWell: 'P-1', reservoirLayer: 'S1', impactLevel: 'high', confidence: .9,
      status: 'suspected', source: 'suspected', evidence: 'field', effectiveStartDate: '2026-01-01', effectiveEndDate: '2026-12-31', owner: 'owner',
    });
    await db.run("INSERT INTO production (jh, rq, oil, liquid, water_cut, block) VALUES ('P-1', '2026-01-01', 10, 20, .5, 'A'), ('P-1', '2026-01-03', 18, 30, .4, 'A')");
    await db.run("INSERT INTO injection_stage_rows (well_no, cycle_no, start_date, end_date, steam_volume) VALUES ('I-1', 1, '2026-01-01', '2026-01-03', 100)");

    const event = await createProjectEvaluation(db, {
      projectId: project.id, start: '2026-01-01', end: '2026-01-03', occurredOn: '2026-01-03', content: '治理有效', evidence: '日报', owner: 'alice', createdBy: 'admin',
    });

    assert.equal(event.eventType, 'evaluated');
    assert.equal(event.createdBy, 'admin');
    assert.deepEqual(event.links, [{ subjectType: 'project', subjectId: project.id }]);
    assert.equal((event.metricsSnapshot as any).projectId, project.id);
    assert.deepEqual((event.metricsSnapshot as any).range, { start: '2026-01-01', end: '2026-01-03' });
    assert.equal((event.metricsSnapshot as any).cumulativeSteam, 100);
    assert.equal((event.metricsSnapshot as any).latestTotalOil, 18);
    assert.deepEqual((await listTrackingEvents(db, { subjectType: 'project', subjectId: project.id })).map((item) => item.id), [event.id]);
  } finally {
    await db.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test('validates project evaluation input before writing history', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'channeling-project-evaluation-validation-'));
  const db = await open({ filename: path.join(directory, 'test.db'), driver: sqlite3.Database });
  try {
    await db.exec('CREATE TABLE production (jh TEXT, rq TEXT, oil REAL, liquid REAL, water_cut REAL, block TEXT); CREATE TABLE injection_stage_rows (well_no TEXT, cycle_no INTEGER, start_date TEXT, end_date TEXT, steam_volume REAL);');
    await initChannelingProjectTables(db);
    const project = await createChannelingProject(db, { projectName: 'evaluation', block: 'A', owner: 'owner' });
    const valid = { projectId: project.id, start: '2026-01-01', end: '2026-01-03', occurredOn: '2026-01-03', content: 'ok', evidence: '', owner: 'owner', createdBy: 'admin' };
    await assert.rejects(() => createProjectEvaluation(db, { ...valid, projectId: 999 }), /Project not found/);
    await assert.rejects(() => createProjectEvaluation(db, { ...valid, start: '2026-01-04' }), /date range is invalid/);
    await assert.rejects(() => createProjectEvaluation(db, { ...valid, content: ' ' }), /content is required/);
    await assert.rejects(() => createProjectEvaluation(db, { ...valid, owner: ' ' }), /owner is required/);
    assert.equal((await db.get("SELECT COUNT(*) AS count FROM channeling_tracking_events WHERE event_type = 'evaluated'")).count, 0);
  } finally {
    await db.close();
    await rm(directory, { recursive: true, force: true });
  }
});
