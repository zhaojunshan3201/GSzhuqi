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
  deleteChannelingProject,
  deleteChannelingRelation,
  initChannelingProjectTables,
  listChannelingProjects,
  listChannelingRelations,
  updateChannelingProject,
  updateChannelingRelation,
} from '../src/lib/channelingProjectStore.ts';
import { createTrackingEvent, listTrackingEvents } from '../src/lib/channelingTrackingStore.ts';
import { createWellProfile, listWellProfiles } from '../src/lib/channelingWellStore.ts';

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


test('migrates existing relations with steam as the safe default and creates a non-unique pair index', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'channeling-project-store-migration-'));
  const db = await open({ filename: path.join(directory, 'test.db'), driver: sqlite3.Database });
  try {
    await db.exec(`CREATE TABLE channeling_projects (id INTEGER PRIMARY KEY, project_name TEXT NOT NULL, block TEXT NOT NULL, owner TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
      CREATE TABLE channeling_relations (id INTEGER PRIMARY KEY, project_id INTEGER NOT NULL, injection_well TEXT NOT NULL, production_well TEXT NOT NULL, reservoir_layer TEXT NOT NULL, impact_level TEXT NOT NULL, confidence REAL NOT NULL, status TEXT NOT NULL, source TEXT NOT NULL, evidence TEXT NOT NULL, effective_start_date TEXT NOT NULL, effective_end_date TEXT NOT NULL, owner TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
      INSERT INTO channeling_projects VALUES (1, 'p', 'A', 'o', 'now', 'now');
      INSERT INTO channeling_relations VALUES (1, 1, 'Z1', 'C1', 'S1', 'medium', .5, 'confirmed', 'manual', 'e', '2026-01-01', '2026-01-01', 'o', 'now', 'now');`);
    await initChannelingProjectTables(db);
    assert.equal((await listChannelingRelations(db))[0].channelingType, 'steam');
    const index = await db.get("SELECT name, [unique] AS isUnique FROM pragma_index_list('channeling_relations') WHERE name = 'idx_channeling_relations_pair'");
    assert.deepEqual(index, { name: 'idx_channeling_relations_pair', isUnique: 0 });
  } finally { await db.close(); await rm(directory, { recursive: true, force: true }); }
});

test('relation creation reuses normalized well profiles and records a linked confirmation event', async () => {
  await withStore(async (db) => {
    const project = await createChannelingProject(db, projectInput());
    const existing = await createWellProfile(db, { wellNo: ' 注a-1 ', block: '旧区', owner: '原负责人' });
    const created = await createChannelingRelation(db, relationInput(project.id), { createdBy: 'admin' });
    const profiles = await listWellProfiles(db);
    assert.equal(profiles.length, 2);
    assert.equal(profiles.find((item) => item.normalizedWellNo === '注A-1')?.id, existing.id);
    const production = profiles.find((item) => item.normalizedWellNo === '采A-2')!;
    assert.equal(production.block, 'A区');
    assert.equal(production.owner, '李工');
    const events = await listTrackingEvents(db, { subjectType: 'relation', subjectId: created.id });
    assert.equal(events.length, 1);
    assert.equal(events[0].eventType, 'relation_confirmed');
    assert.equal(events[0].content, 'Relation confirmed: 注A-1 -> 采A-2');
    assert.equal(events[0].evidence, '示踪剂响应');
    assert.equal(events[0].owner, '李工');
    assert.equal(events[0].createdBy, 'admin');
    assert.deepEqual(events[0].links, [
      { subjectType: 'project', subjectId: project.id },
      { subjectType: 'relation', subjectId: created.id },
      { subjectType: 'well', subjectId: existing.id },
      { subjectType: 'well', subjectId: production.id },
    ]);
  });
});

test('status transitions create one event and same-status or unrelated updates create none', async () => {
  await withStore(async (db) => {
    const project = await createChannelingProject(db, projectInput());
    const suspected = await createChannelingRelation(db, { ...relationInput(project.id), source: 'suspected', status: 'suspected' });
    assert.equal((await listTrackingEvents(db, { subjectType: 'relation', subjectId: suspected.id })).length, 0);
    await updateChannelingRelation(db, suspected.id, { confidence: 0.7 });
    await updateChannelingRelation(db, suspected.id, { status: 'suspected' });
    await updateChannelingRelation(db, suspected.id, { status: 'confirmed', owner: '王工' }, { createdBy: 'reviewer' });
    await updateChannelingRelation(db, suspected.id, { status: 'confirmed' });
    await updateChannelingRelation(db, suspected.id, { status: 'released' }, { createdBy: 'releaser' });
    const relationEvents = await listTrackingEvents(db, { subjectType: 'relation', subjectId: suspected.id });
    assert.deepEqual(relationEvents.map((event) => [event.eventType, event.owner, event.createdBy]).sort(), [
      ['relation_confirmed', '王工', 'reviewer'],
      ['relation_released', '王工', 'releaser'],
    ]);
    await updateChannelingProject(db, project.id, { owner: '项目新负责人' });
    await updateChannelingProject(db, project.id, { status: 'identified' });
    await updateChannelingProject(db, project.id, { status: 'confirmed' }, { createdBy: 'governor' });
    const projectEvents = await listTrackingEvents(db, { subjectType: 'project', subjectId: project.id });
    assert.equal(projectEvents.filter((event) => event.eventType === 'status_changed').length, 1);
    const statusEvent = projectEvents.find((event) => event.eventType === 'status_changed')!;
    assert.equal(statusEvent.content, 'Project status changed: identified -> confirmed');
    assert.equal(statusEvent.owner, '项目新负责人');
    assert.equal(statusEvent.createdBy, 'governor');
    assert.deepEqual(statusEvent.links, [{ subjectType: 'project', subjectId: project.id }]);
  });
});

test('relation creation rolls back when automatic tracking fails', async () => {
  await withStore(async (db) => {
    const project = await createChannelingProject(db, projectInput());
    const failingDb = new Proxy(db, {
      get(target, property) {
        if (property === 'run') return async (sql: string, params?: unknown[]) => {
          if (sql.startsWith('INSERT INTO channeling_tracking_events')) throw new Error('injected event failure');
          return target.run(sql, params);
        };
        const value = target[property as keyof typeof target];
        return typeof value === 'function' ? value.bind(target) : value;
      },
    });
    await assert.rejects(() => createChannelingRelation(failingDb, relationInput(project.id)), /injected event failure/);
    assert.equal((await listChannelingRelations(db, { projectId: project.id })).length, 0);
    assert.equal((await listWellProfiles(db)).length, 0);
  });
});

test('project status update rolls back when automatic tracking fails', async () => {
  await withStore(async (db) => {
    const project = await createChannelingProject(db, projectInput());
    const failingDb = new Proxy(db, {
      get(target, property) {
        if (property === 'run') return async (sql: string, params?: unknown[]) => {
          if (sql.startsWith('INSERT INTO channeling_tracking_events')) throw new Error('injected event failure');
          return target.run(sql, params);
        };
        const value = target[property as keyof typeof target];
        return typeof value === 'function' ? value.bind(target) : value;
      },
    });
    await assert.rejects(() => updateChannelingProject(failingDb, project.id, { status: 'confirmed' }), /injected event failure/);
    assert.equal((await listChannelingProjects(db)).find((item) => item.id === project.id)?.status, 'identified');
    assert.equal((await listTrackingEvents(db, { subjectType: 'project', subjectId: project.id })).length, 0);
  });
});

test('tracked entities cannot be deleted while empty entities can and profiles persist', async () => {
  await withStore(async (db) => {
    const project = await createChannelingProject(db, projectInput());
    const relation = await createChannelingRelation(db, relationInput(project.id));
    const profileIds = (await listWellProfiles(db)).map((item) => item.id);
    await assert.rejects(() => deleteChannelingRelation(db, relation.id), /Relation has tracking history/);
    await assert.rejects(() => deleteChannelingProject(db, project.id), /Project has relations or tracking history/);
    await updateChannelingRelation(db, relation.id, { status: 'released' });
    assert.equal((await listTrackingEvents(db, { subjectType: 'relation', subjectId: relation.id })).length, 2);

    const untrackedProject = await createChannelingProject(db, { ...projectInput(), projectName: '未跟踪项目' });
    const untrackedRelation = await createChannelingRelation(db, { ...relationInput(untrackedProject.id), status: 'suspected', source: 'suspected', injectionWell: 'Z9', productionWell: 'P9' });
    await deleteChannelingRelation(db, untrackedRelation.id);
    await deleteChannelingProject(db, untrackedProject.id);
    assert.equal((await listChannelingProjects(db)).some((item) => item.id === untrackedProject.id), false);
    assert.deepEqual((await listWellProfiles(db)).filter((item) => ['Z9', 'P9'].includes(item.normalizedWellNo)).map((item) => item.normalizedWellNo).sort(), ['P9', 'Z9']);
    assert.deepEqual((await listWellProfiles(db)).filter((item) => profileIds.includes(item.id)).map((item) => item.id).sort(), profileIds.sort());

    const historyOnly = await createChannelingProject(db, { ...projectInput(), projectName: '仅项目历史' });
    await createTrackingEvent(db, { eventType: 'reviewed', occurredOn: '2026-08-06', content: 'reviewed', owner: '李工', createdBy: 'admin', links: [{ subjectType: 'project', subjectId: historyOnly.id }] });
    await assert.rejects(() => deleteChannelingProject(db, historyOnly.id), /Project has relations or tracking history/);
  });
});
