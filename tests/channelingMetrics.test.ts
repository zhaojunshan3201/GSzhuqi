import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import sqlite3 from 'sqlite3';
import { open } from 'sqlite';

import {
  compareProductionWindows,
  getProjectSummary,
  getRelationMetrics,
  getWellMetrics,
  initChannelingMetricIndexes,
  normalizeMetricWellNo,
} from '../src/lib/channelingMetrics.ts';
import { correctTrackingEvent, createTrackingEvent, initChannelingTrackingTables } from '../src/lib/channelingTrackingStore.ts';

async function withStore(run: (db: any) => Promise<void>) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'channeling-metrics-'));
  const db = await open({ filename: path.join(directory, 'test.db'), driver: sqlite3.Database });
  try {
    await db.exec(`CREATE TABLE channeling_projects (id INTEGER PRIMARY KEY, project_name TEXT);
      CREATE TABLE channeling_relations (id INTEGER PRIMARY KEY, project_id INTEGER, injection_well TEXT, production_well TEXT, status TEXT);
      CREATE TABLE production (jh TEXT, rq TEXT, oil REAL, liquid REAL, water_cut REAL, block TEXT);
      CREATE TABLE injection_stage_rows (well_no TEXT, cycle_no INTEGER, start_date TEXT, end_date TEXT, steam_volume REAL, temperature REAL, pressure REAL, dryness REAL, production_hours REAL);`);
    await initChannelingTrackingTables(db);
    await run(db);
  } finally {
    await db.close();
    await rm(directory, { recursive: true, force: true });
  }
}

test('normalizes well numbers and rejects blank values and invalid calendar ranges', async () => {
  assert.equal(normalizeMetricWellNo(' ab-1 '), 'AB-1');
  assert.throws(() => normalizeMetricWellNo('   '), /wellNo is required/);
  await withStore(async (db) => {
    for (const [start, end] of [['2026-02-29', '2026-03-01'], ['2026-2-01', '2026-03-01'], ['2026-03-02', '2026-03-01']]) {
      await assert.rejects(() => getWellMetrics(db, 'A', start, end), /date range is invalid/);
    }
  });
  assert.throws(() => compareProductionWindows([], { beforeStart: '2026-01-02', splitDate: '2026-01-01', afterEnd: '2026-01-03' }), /comparison range is invalid/);
  assert.throws(() => compareProductionWindows([], { beforeStart: '2026-01-01', splitDate: '2026-01-03', afterEnd: '2026-01-03' }), /comparison range is invalid/);
});

test('detects injector, producer, and dual roles outside the selected range while range modules stay empty', async () => {
  await withStore(async (db) => {
    await db.exec(`INSERT INTO channeling_projects VALUES (1, 'p');
      INSERT INTO channeling_relations VALUES (1, 1, ' relation-injector ', 'relation-producer', 'confirmed');
      INSERT INTO channeling_relations VALUES (2, 1, 'dual', 'dual', 'confirmed');
      INSERT INTO production VALUES ('data-producer', '2025-01-01', 1, 2, 3, 'A');
      INSERT INTO injection_stage_rows VALUES ('data-injector', 1, '2025-01-01', '2025-01-02', 10, 1, 2, 3, 4);`);
    assert.deepEqual((await getWellMetrics(db, 'RELATION-INJECTOR', '2026-01-01', '2026-01-02')).roles, ['injector']);
    assert.deepEqual((await getWellMetrics(db, 'relation-producer', '2026-01-01', '2026-01-02')).roles, ['producer']);
    const dual = await getWellMetrics(db, ' Dual ', '2026-01-01', '2026-01-02');
    assert.deepEqual(dual.roles, ['injector', 'producer']);
    assert.equal(dual.injection, null);
    assert.equal(dual.production, null);
    assert.deepEqual((await getWellMetrics(db, 'data-injector', '2026-01-01', '2026-01-02')).roles, ['injector']);
    assert.deepEqual((await getWellMetrics(db, 'data-producer', '2026-01-01', '2026-01-02')).roles, ['producer']);
  });
});

test('summarizes intersecting injection stages without coercing missing values', async () => {
  await withStore(async (db) => {
    await db.exec(`INSERT INTO injection_stage_rows VALUES (' i-1 ', 2, '2026-01-03', NULL, 0, NULL, 12, 0, 24);
      INSERT INTO injection_stage_rows VALUES ('I-1', 1, '2025-12-30', '2026-01-02', NULL, 260, NULL, 70, NULL);
      INSERT INTO injection_stage_rows VALUES ('I-1', 3, '2026-02-01', '2026-02-02', 99, 1, 1, 1, 1);`);
    const result = await getWellMetrics(db, 'i-1', '2026-01-01', '2026-01-31');
    assert.deepEqual(result.injection, {
      stages: [
        { cycleNo: 1, startDate: '2025-12-30', endDate: '2026-01-02', steamVolume: null, temperature: 260, pressure: null, dryness: 70, productionHours: null },
        { cycleNo: 2, startDate: '2026-01-03', endDate: null, steamVolume: 0, temperature: null, pressure: 12, dryness: 0, productionHours: 24 },
      ],
      cumulativeSteam: 0,
      cycleCount: 2,
    });
  });
});

test('preserves production rows, latest nonmissing values, and sparse selected, 7-day, and 30-day averages', async () => {
  await withStore(async (db) => {
    await db.exec(`INSERT INTO production VALUES ('P-1', '2026-01-01', 10, NULL, 0, 'A');
      INSERT INTO production VALUES (' p-1 ', '2026-01-25', NULL, 20, NULL, 'A');
      INSERT INTO production VALUES ('P-1', '2026-01-30', 0, 30, 50, 'A');
      INSERT INTO production VALUES ('P-1', '2026-01-31', 20, NULL, NULL, 'A');`);
    const production = (await getWellMetrics(db, 'p-1', '2026-01-01', '2026-02-05')).production!;
    assert.deepEqual(production.rows[0], { date: '2026-01-01', oil: 10, liquid: null, waterCut: 0, block: 'A' });
    assert.deepEqual(production.latest, { date: '2026-01-31', oil: 20, liquid: 30, waterCut: 50, block: 'A' });
    assert.deepEqual(production.oil, { average: 10, validDays: 3 });
    assert.deepEqual(production.liquid, { average: 25, validDays: 2 });
    assert.deepEqual(production.waterCut, { average: 25, validDays: 2 });
    assert.deepEqual(production.last7Days.oil, { average: 10, validDays: 2 });
    assert.deepEqual(production.last30Days.oil, { average: 10, validDays: 2 });
    assert.deepEqual(production.last30Days.liquid, { average: 25, validDays: 2 });
  });
});

test('uses production history through range end when the selected range has no rows', async () => {
  await withStore(async (db) => {
    await db.exec(`INSERT INTO production VALUES ('P-HISTORY', '2026-07-01', 5, 10, 20, 'A');
      INSERT INTO production VALUES ('P-HISTORY', '2026-07-26', 10, NULL, NULL, 'A');
      INSERT INTO production VALUES ('P-HISTORY', '2026-07-31', 20, NULL, NULL, 'A');`);
    const result = await getWellMetrics(db, 'p-history', '2026-08-01', '2026-08-31');
    assert.deepEqual(result.roles, ['producer']);
    assert.deepEqual(result.production?.rows, []);
    assert.deepEqual(result.production?.oil, { average: null, validDays: 0 });
    assert.deepEqual(result.production?.latest, { date: '2026-07-31', oil: 20, liquid: 10, waterCut: 20, block: 'A' });
    assert.deepEqual(result.production?.last7Days.oil, { average: 15, validDays: 2 });
    assert.deepEqual(result.production?.last30Days.oil, { average: 15, validDays: 2 });
  });
});

test('ends rolling production windows at the latest observed date rather than the selected range end', async () => {
  await withStore(async (db) => {
    await db.exec(`INSERT INTO production VALUES ('P-GAP', '2026-07-20', 40, NULL, NULL, 'A');
      INSERT INTO production VALUES ('P-GAP', '2026-08-10', 10, NULL, NULL, 'A');
      INSERT INTO production VALUES ('P-GAP', '2026-08-15', 20, NULL, NULL, 'A');`);
    const production = (await getWellMetrics(db, 'P-GAP', '2026-08-01', '2026-08-31')).production!;
    assert.deepEqual(production.oil, { average: 15, validDays: 2 });
    assert.equal(production.latest.date, '2026-08-15');
    assert.deepEqual(production.last7Days.oil, { average: 15, validDays: 2 });
    assert.deepEqual(production.last30Days.oil, { average: 70 / 3, validDays: 3 });
  });
});

test('compares valid observations, missing values, and a real zero baseline', () => {
  const result = compareProductionWindows([
    { date: '2026-01-01', oil: 10, liquid: null, waterCut: 0 },
    { date: '2026-01-02', oil: null, liquid: 4, waterCut: null },
    { date: '2026-01-03', oil: 15, liquid: 8, waterCut: 2 },
  ], { beforeStart: '2026-01-01', splitDate: '2026-01-02', afterEnd: '2026-01-03' });
  assert.deepEqual(result.oil, { beforeAverage: 10, afterAverage: 15, change: 5, changeRate: 0.5, beforeValidDays: 1, afterValidDays: 1 });
  assert.deepEqual(result.liquid, { beforeAverage: 4, afterAverage: 8, change: 4, changeRate: 1, beforeValidDays: 1, afterValidDays: 1 });
  assert.deepEqual(result.waterCut, { beforeAverage: 0, afterAverage: 2, change: 2, changeRate: null, beforeValidDays: 1, afterValidDays: 1 });
  assert.deepEqual(compareProductionWindows([], { beforeStart: '2026-01-01', splitDate: '2026-01-02', afterEnd: '2026-01-03' }).oil,
    { beforeAverage: null, afterAverage: null, change: null, changeRate: null, beforeValidDays: 0, afterValidDays: 0 });
});

test('returns a stable relation snapshot and reports a missing relation', async () => {
  await withStore(async (db) => {
    await assert.rejects(() => getRelationMetrics(db, 404, { beforeStart: '2026-01-01', splitDate: '2026-01-02', afterEnd: '2026-01-03' }), /Relation not found/);
    await db.exec(`INSERT INTO channeling_relations VALUES (1, 1, 'I-1', 'P-1', 'confirmed');
      INSERT INTO production VALUES ('P-1', '2026-01-01', 1, 2, 3, 'A');
      INSERT INTO production VALUES ('P-1', '2026-01-03', 2, 4, 6, 'A');`);
    const result = await getRelationMetrics(db, 1, { beforeStart: '2026-01-01', splitDate: '2026-01-02', afterEnd: '2026-01-03' });
    assert.equal(result.relationId, 1);
    assert.equal(result.injectionWell, 'I-1');
    assert.equal(result.productionWell, 'P-1');
    assert.equal(result.producerSeries.length, 2);
    assert.equal(result.comparison.oil.change, 1);
    assert.match(result.generatedAt, /^\d{4}-\d{2}-\d{2}T/);
  });
});

test('summarizes projects with normalized deduplication and nonvoided evaluations', async () => {
  await withStore(async (db) => {
    await assert.rejects(() => getProjectSummary(db, 404, '2026-01-01', '2026-01-31'), /Project not found/);
    await db.exec(`INSERT INTO channeling_projects VALUES (1, 'empty'); INSERT INTO channeling_projects VALUES (2, 'full');
      INSERT INTO channeling_relations VALUES (1, 2, ' I-1 ', 'P-1', 'confirmed');
      INSERT INTO channeling_relations VALUES (2, 2, 'i-1', ' p-1 ', 'released');
      INSERT INTO channeling_relations VALUES (3, 2, 'P-1', 'P-2', 'suspected');
      INSERT INTO injection_stage_rows VALUES ('I-1', 1, '2026-01-01', '2026-01-02', 100, NULL, NULL, NULL, NULL);
      INSERT INTO injection_stage_rows VALUES ('P-1', 1, '2026-01-01', '2026-01-02', 50, NULL, NULL, NULL, NULL);
      INSERT INTO production VALUES ('P-1', '2026-01-30', 10, NULL, NULL, 'A');
      INSERT INTO production VALUES ('P-2', '2026-01-29', 0, NULL, NULL, 'A');
      INSERT INTO channeling_tracking_events (id, event_type, occurred_on, content, evidence, owner, voided_at, created_by, created_at) VALUES (1, 'evaluated', '2026-01-10', 'old', '', 'o', NULL, 'u', '2026-01-10T00:00:00Z');
      INSERT INTO channeling_tracking_events (id, event_type, occurred_on, content, evidence, owner, voided_at, created_by, created_at) VALUES (2, 'evaluated', '2026-01-20', 'voided', '', 'o', '2026-01-21', 'u', '2026-01-20T00:00:00Z');
      INSERT INTO channeling_tracking_events (id, event_type, occurred_on, content, evidence, owner, voided_at, created_by, created_at) VALUES (3, 'evaluated', '2026-01-15', 'recent', '', 'o', NULL, 'u', '2026-01-15T00:00:00Z');
      INSERT INTO channeling_tracking_events (id, event_type, occurred_on, content, evidence, owner, voided_at, created_by, created_at) VALUES (4, 'reviewed', '2026-01-30', 'not evaluation', '', 'o', NULL, 'u', '2026-01-30T00:00:00Z');
      INSERT INTO channeling_tracking_event_links VALUES (1, 'project', 2);
      INSERT INTO channeling_tracking_event_links VALUES (2, 'project', 2);
      INSERT INTO channeling_tracking_event_links VALUES (3, 'relation', 1);
      INSERT INTO channeling_tracking_event_links VALUES (4, 'project', 2);`);
    const empty = await getProjectSummary(db, 1, '2026-01-01', '2026-01-31');
    assert.deepEqual([empty.relationCount, empty.injectorCount, empty.producerCount, empty.uniqueWellCount, empty.cumulativeSteam, empty.latestTotalOil], [0, 0, 0, 0, null, null]);
    const result = await getProjectSummary(db, 2, '2026-01-01', '2026-01-31');
    assert.deepEqual([result.relationCount, result.activeRelationCount, result.releasedRelationCount], [3, 2, 1]);
    assert.deepEqual([result.injectorCount, result.producerCount, result.uniqueWellCount], [2, 2, 3]);
    assert.equal(result.cumulativeSteam, 150);
    assert.equal(result.latestTotalOil, 10);
    assert.equal(result.evaluatedCount, 2);
    assert.equal(result.latestEvaluationConclusion, 'recent');
    assert.deepEqual([result.start, result.end], ['2026-01-01', '2026-01-31']);
    assert.deepEqual(result.range, { start: '2026-01-01', end: '2026-01-31' });
    assert.match(result.generatedAt, /^\d{4}-\d{2}-\d{2}T/);
  });
});

test('follows repeated evaluation corrections and counts one effective root evaluation', async () => {
  await withStore(async (db) => {
    await db.run("INSERT INTO channeling_projects VALUES (1, 'p')");
    const original = await createTrackingEvent(db, {
      eventType: 'evaluated', occurredOn: '2026-01-10', content: 'original', owner: 'o', createdBy: 'u',
      links: [{ subjectType: 'project', subjectId: 1 }],
    });
    const first = await correctTrackingEvent(db, original.id, {
      occurredOn: '2026-01-11', content: 'first correction', owner: 'o', createdBy: 'u', reason: 'fix 1',
    });
    await correctTrackingEvent(db, first.id, {
      occurredOn: '2026-01-12', content: 'effective correction', owner: 'o', createdBy: 'u', reason: 'fix 2',
    });
    const summary = await getProjectSummary(db, 1, '2026-01-01', '2026-01-31');
    assert.equal(summary.evaluatedCount, 1);
    assert.equal(summary.latestEvaluationConclusion, 'effective correction');
  });
});

test('orders effective evaluation conclusions by occurred date, creation time, then id', async () => {
  await withStore(async (db) => {
    await db.run("INSERT INTO channeling_projects VALUES (1, 'p')");
    const first = await createTrackingEvent(db, { eventType: 'evaluated', occurredOn: '2026-01-10', content: 'first id', owner: 'o', createdBy: 'u', links: [{ subjectType: 'project', subjectId: 1 }] });
    const second = await createTrackingEvent(db, { eventType: 'evaluated', occurredOn: '2026-01-10', content: 'second id', owner: 'o', createdBy: 'u', links: [{ subjectType: 'project', subjectId: 1 }] });
    await db.run('UPDATE channeling_tracking_events SET created_at = ? WHERE id = ?', ['2026-01-10T02:00:00Z', first.id]);
    await db.run('UPDATE channeling_tracking_events SET created_at = ? WHERE id = ?', ['2026-01-10T01:00:00Z', second.id]);
    assert.equal((await getProjectSummary(db, 1, '2026-01-01', '2026-01-31')).latestEvaluationConclusion, 'first id');
    await db.run('UPDATE channeling_tracking_events SET created_at = ? WHERE id = ?', ['2026-01-10T02:00:00Z', second.id]);
    assert.equal((await getProjectSummary(db, 1, '2026-01-01', '2026-01-31')).latestEvaluationConclusion, 'second id');
  });
});

test('canonicalizes normalized production aliases to the latest inserted row per date everywhere', async () => {
  await withStore(async (db) => {
    await db.exec(`INSERT INTO channeling_projects VALUES (1, 'p');
      INSERT INTO channeling_relations VALUES (1, 1, 'I-1', 'P-1', 'confirmed');
      INSERT INTO production VALUES ('P-1', '2026-01-01', 10, 20, 30, 'A');
      INSERT INTO production VALUES (' p-1 ', '2026-01-01', 20, 40, 50, 'A');
      INSERT INTO production VALUES ('P-1', '2026-01-03', 30, 60, 70, 'A');
      INSERT INTO production VALUES (' p-1 ', '2026-01-03', 40, 80, 90, 'A');`);
    const well = await getWellMetrics(db, 'p-1', '2026-01-01', '2026-01-03');
    assert.deepEqual(well.production?.rows.map((row) => [row.date, row.oil]), [['2026-01-01', 20], ['2026-01-03', 40]]);
    assert.deepEqual(well.production?.oil, { average: 30, validDays: 2 });
    assert.deepEqual(well.production?.last7Days.oil, { average: 30, validDays: 2 });
    const relation = await getRelationMetrics(db, 1, { beforeStart: '2026-01-01', splitDate: '2026-01-02', afterEnd: '2026-01-03' });
    assert.deepEqual(relation.producerSeries.map((row) => row.oil), [20, 40]);
    assert.deepEqual(relation.comparison.oil, { beforeAverage: 20, afterAverage: 40, change: 20, changeRate: 1, beforeValidDays: 1, afterValidDays: 1 });
    assert.equal((await getProjectSummary(db, 1, '2026-01-01', '2026-01-03')).latestTotalOil, 40);
  });
});

test('creates normalized source indexes that single-well query plans use', async () => {
  await withStore(async (db) => {
    await initChannelingMetricIndexes(db);
    const names = (await db.all("SELECT name FROM sqlite_master WHERE type = 'index' AND name LIKE 'idx_%_normalized_well%' ORDER BY name")).map((row: any) => row.name);
    assert.deepEqual(names, [
      'idx_channeling_relations_injection_normalized_well',
      'idx_channeling_relations_production_normalized_well',
      'idx_injection_stage_normalized_well_date',
      'idx_production_normalized_well_date',
    ]);
    const productionPlan = await db.all('EXPLAIN QUERY PLAN SELECT rq FROM production WHERE UPPER(TRIM(jh)) = ? AND rq BETWEEN ? AND ?', ['P-1', '2026-01-01', '2026-01-31']);
    const stagePlan = await db.all('EXPLAIN QUERY PLAN SELECT start_date FROM injection_stage_rows WHERE UPPER(TRIM(well_no)) = ? AND start_date <= ?', ['I-1', '2026-01-31']);
    assert.match(productionPlan.map((row: any) => row.detail).join(' '), /idx_production_normalized_well_date/);
    assert.match(stagePlan.map((row: any) => row.detail).join(' '), /idx_injection_stage_normalized_well_date/);
  });
});

test('keeps project summary source-query count constant as project wells grow', async () => {
  await withStore(async (db) => {
    await db.run("INSERT INTO channeling_projects VALUES (1, 'p')");
    for (let index = 1; index <= 20; index += 1) {
      await db.run('INSERT INTO channeling_relations VALUES (?, 1, ?, ?, ?)', [index, `I-${index}`, `P-${index}`, 'confirmed']);
      await db.run('INSERT INTO injection_stage_rows VALUES (?, 1, ?, ?, ?, NULL, NULL, NULL, NULL)', [`I-${index}`, '2026-01-01', '2026-01-02', index]);
      await db.run('INSERT INTO production VALUES (?, ?, ?, NULL, NULL, ?)', [`P-${index}`, '2026-01-31', index, 'A']);
    }
    const all = db.all.bind(db);
    let calls = 0;
    db.all = async (sql: string, params?: unknown[]) => { calls += 1; return all(sql, params); };
    const summary = await getProjectSummary(db, 1, '2026-01-01', '2026-01-31');
    assert.deepEqual([summary.injectorCount, summary.producerCount, summary.cumulativeSteam, summary.latestTotalOil], [20, 20, 210, 210]);
    assert.ok(calls <= 5, `expected at most 5 set-based all() calls, received ${calls}`);
  });
});
