import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import sqlite3 from 'sqlite3';
import { open } from 'sqlite';

import {
  createChannelingProject,
  createChannelingRelation,
  initChannelingProjectTables,
  listChannelingProjects,
  listChannelingRelations,
  updateChannelingRelation,
} from '../src/lib/channelingProjectStore.ts';

async function withStore(run: (db: any) => Promise<void>) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'channeling-project-store-'));
  const db = await open({ filename: path.join(directory, 'test.db'), driver: sqlite3.Database });
  try { await initChannelingProjectTables(db); await run(db); } finally { await db.close(); await rm(directory, { recursive: true, force: true }); }
}

const projectInput = () => ({ projectName: '注窜治理一期', block: 'A区', owner: '李工' });
const relationInput = (projectId: number) => ({
  projectId, channelingType: 'steam' as const, injectionWell: '注A-1', productionWell: '采A-2', reservoirLayer: 'S1', impactLevel: 'high' as const,
  confidence: 0.85, status: 'confirmed' as const, source: 'manual' as const, evidence: '示踪剂响应',
  effectiveStartDate: '2026-07-01', effectiveEndDate: '2026-12-31', owner: '李工',
});

test('creates and lists channeling projects', async () => {
  await withStore(async (db) => {
    const created = await createChannelingProject(db, projectInput());
    assert.equal(created.projectName, '注窜治理一期');
    assert.equal(created.block, 'A区');
    assert.equal((await listChannelingProjects(db, { block: 'A区' })).length, 1);
    await assert.rejects(() => createChannelingProject(db, { ...projectInput(), projectName: '' }), /projectName/);
  });
});

test('creates relations and filters by project, status, source, and block', async () => {
  await withStore(async (db) => {
    const project = await createChannelingProject(db, projectInput());
    const relation = await createChannelingRelation(db, relationInput(project.id));
    assert.equal(relation.confidence, 0.85);
    assert.equal(relation.channelingType, 'steam');
    assert.deepEqual((await listChannelingRelations(db, { projectId: project.id, channelingType: 'steam', status: 'confirmed', source: 'manual', block: 'A区' })).map((item) => item.id), [relation.id]);
  });
});

test('rejects missing fields, invalid enums, confidence, and non-calendar dates', async () => {
  await withStore(async (db) => {
    const project = await createChannelingProject(db, projectInput());
    await assert.rejects(() => createChannelingRelation(db, { ...relationInput(project.id), injectionWell: '' }), /injectionWell/);
    await assert.rejects(() => createChannelingRelation(db, { ...relationInput(project.id), impactLevel: 'critical' as any }), /impactLevel/);
    await assert.rejects(() => createChannelingRelation(db, { ...relationInput(project.id), channelingType: 'water' as any }), /channelingType/);
    await assert.rejects(() => createChannelingRelation(db, { ...relationInput(project.id), confidence: 1.1 }), /confidence/);
    await assert.rejects(() => createChannelingRelation(db, { ...relationInput(project.id), effectiveStartDate: '2026-02-30' }), /effectiveStartDate/);
    await assert.rejects(() => createChannelingRelation(db, { ...relationInput(project.id), effectiveEndDate: '2026-06-30' }), /effectiveEndDate/);
  });
});

test('updates a relation and reports missing project or relation', async () => {
  await withStore(async (db) => {
    await assert.rejects(() => createChannelingRelation(db, relationInput(404)), /Project not found/);
    const project = await createChannelingProject(db, projectInput());
    const relation = await createChannelingRelation(db, relationInput(project.id));
    const updated = await updateChannelingRelation(db, relation.id, { status: 'released', confidence: 0.4 });
    assert.equal(updated.status, 'released');
    assert.equal(updated.confidence, 0.4);
    await assert.rejects(() => updateChannelingRelation(db, 404, { status: 'released' }), /Relation not found/);
  });
});

test('rejects invalid relation list enum filters instead of silently returning no rows', async () => {
  await withStore(async (db) => {
    await assert.rejects(() => listChannelingRelations(db, { status: 'invalid' }), /status/);
    await assert.rejects(() => listChannelingRelations(db, { source: 'invalid' }), /source/);
    await assert.rejects(() => listChannelingRelations(db, { channelingType: 'invalid' as any }), /channelingType/);
  });
});

test('migrates existing relations with steam as the safe default', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'channeling-project-store-migration-'));
  const db = await open({ filename: path.join(directory, 'test.db'), driver: sqlite3.Database });
  try {
    await db.exec(`CREATE TABLE channeling_projects (id INTEGER PRIMARY KEY, project_name TEXT NOT NULL, block TEXT NOT NULL, owner TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
      CREATE TABLE channeling_relations (id INTEGER PRIMARY KEY, project_id INTEGER NOT NULL, injection_well TEXT NOT NULL, production_well TEXT NOT NULL, reservoir_layer TEXT NOT NULL, impact_level TEXT NOT NULL, confidence REAL NOT NULL, status TEXT NOT NULL, source TEXT NOT NULL, evidence TEXT NOT NULL, effective_start_date TEXT NOT NULL, effective_end_date TEXT NOT NULL, owner TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
      INSERT INTO channeling_projects VALUES (1, 'p', 'A', 'o', 'now', 'now');
      INSERT INTO channeling_relations VALUES (1, 1, 'Z1', 'C1', 'S1', 'medium', .5, 'confirmed', 'manual', 'e', '2026-01-01', '2026-01-01', 'o', 'now', 'now');`);
    await initChannelingProjectTables(db);
    assert.equal((await listChannelingRelations(db))[0].channelingType, 'steam');
  } finally { await db.close(); await rm(directory, { recursive: true, force: true }); }
});
