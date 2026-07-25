import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import sqlite3 from 'sqlite3';
import { open } from 'sqlite';

import { buildInjectionPlanActualComparison } from '../src/lib/injectionPlanActualComparison.ts';

async function withDatabase(run: (db: any) => Promise<void>) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'injection-plan-actual-comparison-'));
  const db = await open({ filename: path.join(directory, 'test.db'), driver: sqlite3.Database });
  try {
    await db.exec(`
      CREATE TABLE injection_plan_imports (id INTEGER PRIMARY KEY, plan_month TEXT);
      CREATE TABLE injection_projects (
        id INTEGER PRIMARY KEY, well_no TEXT, unit TEXT, boiler TEXT, process_type TEXT,
        planned_start_date TEXT, planned_end_date TEXT, planned_steam REAL, source_import_id INTEGER
      );
      CREATE TABLE measure_tracking (
        id INTEGER PRIMARY KEY, jh TEXT, detail_json TEXT,
        current_round_start_time TEXT, current_round_stop_time TEXT,
        current_round_boiler TEXT, current_round_steam REAL, current_round_process TEXT, current_round_measure_type TEXT
      );
    `);
    await run(db);
  } finally {
    await db.close();
    await rm(directory, { recursive: true, force: true });
  }
}

async function insertProject(db: any, values: { id: number; wellNo: string; unit?: string; boiler?: string; process?: string; start?: string | null; end?: string | null; steam?: number | null; importId?: number | null }) {
  await db.run(
    `INSERT INTO injection_projects VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [values.id, values.wellNo, values.unit ?? '一队', values.boiler ?? '锅炉-A', values.process ?? '吞吐', values.start ?? '2026-07-10', values.end ?? '2026-07-20', values.steam ?? 100, values.importId ?? 1],
  );
}

test('uses the latest actual injection start for normalized well numbers and calculates early and delayed variances', async () => {
  await withDatabase(async (db) => {
    await db.run(`INSERT INTO injection_plan_imports VALUES (1, '2026-07')`);
    await insertProject(db, { id: 1, wellNo: ' a-1 ', start: '2026-07-10', end: '2026-07-20' });
    await insertProject(db, { id: 2, wellNo: 'B-1', start: '2026-07-10', end: '2026-07-20' });
    await db.run(`INSERT INTO measure_tracking (id, jh, detail_json) VALUES (1, 'A-1', ?)`, [JSON.stringify({ 开注时间: '2026-07-09', 停注时间: '2026-07-19', 锅炉编号: '锅炉-A', 累注汽量: 80, 措施类型: '吞吐' })]);
    await db.run(`INSERT INTO measure_tracking (id, jh, detail_json) VALUES (2, ' A-1 ', ?)`, [JSON.stringify({ 开注时间: '2026-07-11', 停注时间: '2026-07-22', 锅炉编号: '锅炉-A', 累注汽量: 100, 措施类型: '吞吐' })]);
    await db.run(`INSERT INTO measure_tracking (id, jh, detail_json) VALUES (3, 'B-1', ?)`, [JSON.stringify({ 开注时间: '2026-07-08', 停注时间: '2026-07-18', 锅炉编号: '锅炉-A', 累注汽量: 50, 措施类型: '吞吐' })]);

    const result = await buildInjectionPlanActualComparison(db);

    assert.equal(result.rows.length, 2);
    assert.deepEqual(result.rows.map((row) => [row.wellNo, row.actualStartDate, row.startVarianceDays, row.endVarianceDays, row.comparisonStatus]), [
      ['A-1', '2026-07-11', 1, 2, 'delayed'],
      ['B-1', '2026-07-08', -2, -2, 'early'],
    ]);
  });
});

test('classifies running, unstarted, and incomplete rows', async () => {
  await withDatabase(async (db) => {
    await db.run(`INSERT INTO injection_plan_imports VALUES (1, '2026-07')`);
    await insertProject(db, { id: 1, wellNo: 'RUN-1' });
    await insertProject(db, { id: 2, wellNo: 'WAIT-1' });
    await insertProject(db, { id: 3, wellNo: 'BAD-1', boiler: '', steam: null });
    await db.run(`INSERT INTO measure_tracking (id, jh, detail_json) VALUES (1, 'RUN-1', ?)`, [JSON.stringify({ 开注时间: '2026-07-10', 锅炉编号: '锅炉-A', 累注汽量: 10, 措施类型: '吞吐' })]);
    await db.run(`INSERT INTO measure_tracking (id, jh, detail_json) VALUES (2, 'BAD-1', ?)`, [JSON.stringify({ 开注时间: '2026-07-10' })]);

    const result = await buildInjectionPlanActualComparison(db);

    assert.equal(result.rows.find((row) => row.wellNo === 'RUN-1')?.comparisonStatus, 'in_progress');
    assert.equal(result.rows.find((row) => row.wellNo === 'WAIT-1')?.comparisonStatus, 'not_started');
    assert.equal(result.rows.find((row) => row.wellNo === 'BAD-1')?.comparisonStatus, 'incomplete');
  });
});

test('reads current-round columns, exposes boiler and steam comparisons, and filters by plan month, unit, boiler, and status', async () => {
  await withDatabase(async (db) => {
    await db.run(`INSERT INTO injection_plan_imports VALUES (1, '2026-07'), (2, '2026-08')`);
    await insertProject(db, { id: 1, wellNo: 'C-1', unit: '一队', boiler: '锅炉-A', steam: 100, importId: 1 });
    await insertProject(db, { id: 2, wellNo: 'D-1', unit: '二队', boiler: '锅炉-B', importId: 2 });
    await db.run(`INSERT INTO measure_tracking VALUES (1, 'C-1', NULL, '2026-07-10', '2026-07-20', '\u9505\u7089-X', 120, '\u84b8\u6c7d\u541e\u5410', NULL)`);

    const all = await buildInjectionPlanActualComparison(db);
    const row = all.rows.find((item) => item.wellNo === 'C-1')!;
    assert.deepEqual([row.actualBoiler, row.boilerMatches, row.actualSteam, row.steamVariance, row.completionRate, row.actualProcess, row.comparisonStatus], ['锅炉-X', false, 120, 20, 1.2, '蒸汽吞吐', 'on_schedule']);

    const filtered = await buildInjectionPlanActualComparison(db, { planMonth: '2026-07', unit: '一队', boiler: '锅炉-A', status: 'on_schedule' });
    assert.deepEqual(filtered.rows.map((item) => item.wellNo), ['C-1']);
    assert.equal((await buildInjectionPlanActualComparison(db, { planMonth: '2026-08' })).rows.find((item) => item.wellNo === 'D-1')?.wellNo, 'D-1');
  });
});



test('normalizes Chinese well numbers, parses Excel date serials, prefers the greatest id on the same latest date, and applies the one-day schedule threshold', async () => {
  await withDatabase(async (db) => {
    await db.run(`INSERT INTO injection_plan_imports VALUES (1, '2026-07')`);
    await insertProject(db, { id: 1, wellNo: '高 2 - 2 - 96', start: '2026-07-10', end: '2026-07-20', process: '蒸汽吞吐' });
    await insertProject(db, { id: 2, wellNo: 'EARLY-1', start: '2026-07-10', end: '2026-07-20', process: '蒸汽吞吐' });
    await insertProject(db, { id: 3, wellNo: 'LATE-1', start: '2026-07-10', end: '2026-07-20', process: '蒸汽吞吐' });

    await db.run(`INSERT INTO measure_tracking (id, jh, detail_json, current_round_boiler, current_round_steam, current_round_measure_type) VALUES (1, ' 高2-2-96 ', ?, '锅炉-A', 90, '蒸汽吞吐')`, [JSON.stringify({ '开注时间': 46213, '停注时间': 46223 })]);
    await db.run(`INSERT INTO measure_tracking (id, jh, detail_json, current_round_boiler, current_round_steam, current_round_measure_type) VALUES (2, '高 2 - 2 - 96', ?, '锅炉-A', 101, '蒸汽吞吐')`, [JSON.stringify({ '开注时间': 46213, '停注时间': 46224 })]);
    await db.run(`INSERT INTO measure_tracking (id, jh, detail_json, current_round_boiler, current_round_steam, current_round_measure_type) VALUES (3, 'EARLY-1', ?, '锅炉-A', 100, '蒸汽吞吐')`, [JSON.stringify({ '开注时间': '2026/07/08', '停注时间': '2026/07/18' })]);
    await db.run(`INSERT INTO measure_tracking (id, jh, detail_json, current_round_boiler, current_round_steam, current_round_measure_type) VALUES (4, 'LATE-1', ?, '锅炉-A', 100, '蒸汽吞吐')`, [JSON.stringify({ '开注时间': '2026-07-12', '停注时间': '2026-07-22' })]);

    const result = await buildInjectionPlanActualComparison(db);

    assert.deepEqual(result.rows.map((row) => [row.wellNo, row.actualStartDate, row.actualEndDate, row.actualSteam, row.actualProcess, row.comparisonStatus]), [
      ['高2-2-96', '2026-07-10', '2026-07-21', 101, '蒸汽吞吐', 'on_schedule'],
      ['EARLY-1', '2026-07-08', '2026-07-18', 100, '蒸汽吞吐', 'early'],
      ['LATE-1', '2026-07-12', '2026-07-22', 100, '蒸汽吞吐', 'delayed'],
    ]);
  });
});

test('limits rows to the requested month and its previous natural month', async () => {
  await withDatabase(async (db) => {
    await db.run(`INSERT INTO injection_plan_imports VALUES (1, '2026-06'), (2, '2026-07'), (3, '2026-08')`);
    await insertProject(db, { id: 1, wellNo: 'JUNE-1', importId: 1 });
    await insertProject(db, { id: 2, wellNo: 'JULY-1', importId: 2 });
    await insertProject(db, { id: 3, wellNo: 'AUGUST-1', importId: 3 });

    const result = await buildInjectionPlanActualComparison(db, { planMonth: '2026-07' });

    assert.deepEqual(result.rows.map((row) => row.wellNo), ['JULY-1', 'JUNE-1']);
  });
});

test('summarizes execution deviations and excludes suspected other cycles from variance buckets', async () => {
  await withDatabase(async (db) => {
    await db.run(`INSERT INTO injection_plan_imports VALUES (1, '2026-07')`);
    await insertProject(db, { id: 1, wellNo: 'ON-1', boiler: '活6', process: 'monthly-import', steam: 1000 });
    await insertProject(db, { id: 2, wellNo: 'EARLY-1', boiler: '活6', steam: 1500 });
    await insertProject(db, { id: 3, wellNo: 'OTHER-1', boiler: '活6', steam: 500 });
    await insertProject(db, { id: 4, wellNo: 'WAIT-1', boiler: '活7', steam: 100 });
    await db.run(`INSERT INTO measure_tracking (id, jh, detail_json) VALUES
      (1, 'ON-1', ?),
      (2, 'EARLY-1', ?),
      (3, 'OTHER-1', ?)`, [
      JSON.stringify({ 开注时间: '2026-07-10', 停注时间: '2026-07-20', 锅炉编号: '活6', 累注汽量: 1000, 措施类型: '吞吐' }),
      JSON.stringify({ 开注时间: '2026-07-08', 停注时间: '2026-07-18', 锅炉编号: '活6', 累注汽量: 1000, 措施类型: '吞吐' }),
      JSON.stringify({ 开注时间: '2026-09-10', 停注时间: '2026-09-20', 锅炉编号: '活6', 累注汽量: 500, 措施类型: '吞吐' }),
    ]);

    const result = await buildInjectionPlanActualComparison(db, { planMonth: '2026-07' });
    const otherCycle = result.rows.find((row) => row.wellNo === 'OTHER-1')!;
    const monthlyImport = result.rows.find((row) => row.wellNo === 'ON-1')!;

    assert.equal(otherCycle.comparisonStatus, 'suspected_other_cycle');
    assert.equal(monthlyImport.plannedProcess, '月度注汽计划');
    assert.deepEqual(result.summary, {
      planned: 4, executed: 3, onSchedule: 1, early: 1, delayed: 0, notStarted: 1, suspectedOtherCycle: 1,
    });
    assert.deepEqual(result.charts.startVarianceBuckets, [
      { label: '提前', count: 1 }, { label: '按计划', count: 1 }, { label: '滞后', count: 0 }, { label: '严重滞后', count: 0 },
    ]);
    assert.deepEqual(result.charts.endVarianceBuckets, [
      { label: '提前', count: 1 }, { label: '按计划', count: 1 }, { label: '滞后', count: 0 }, { label: '严重滞后', count: 0 },
    ]);
    assert.deepEqual(result.charts.boilerSteamTotals, [
      { boiler: '活6', plannedSteam: 3000, actualSteam: 2500 },
      { boiler: '活7', plannedSteam: 100, actualSteam: 0 },
    ]);
  });
});

test('marks a 61-day variance as another cycle but keeps an exactly 60-day variance', async () => {
  await withDatabase(async (db) => {
    await db.run(`INSERT INTO injection_plan_imports VALUES (1, '2026-07')`);
    await insertProject(db, { id: 1, wellNo: 'SIXTY-ONE-1', boiler: '锅炉-A', process: '吞吐', steam: 100 });
    await insertProject(db, { id: 2, wellNo: 'SIXTY-1', boiler: '锅炉-A', process: '吞吐', steam: 100 });
    await db.run(`INSERT INTO measure_tracking (id, jh, detail_json) VALUES
      (1, 'SIXTY-ONE-1', ?),
      (2, 'SIXTY-1', ?)`, [
      JSON.stringify({ 开注时间: '2026-09-09', 停注时间: '2026-09-19', 锅炉编号: '锅炉-A', 累注汽量: 100, 措施类型: '吞吐' }),
      JSON.stringify({ 开注时间: '2026-09-08', 停注时间: '2026-09-18', 锅炉编号: '锅炉-A', 累注汽量: 100, 措施类型: '吞吐' }),
    ]);

    const result = await buildInjectionPlanActualComparison(db, { planMonth: '2026-07' });

    assert.equal(result.rows.find((row) => row.wellNo === 'SIXTY-ONE-1')?.comparisonStatus, 'suspected_other_cycle');
    assert.equal(result.rows.find((row) => row.wellNo === 'SIXTY-1')?.comparisonStatus, 'delayed');
  });
});

test('uses -- for a missing actual process', async () => {
  await withDatabase(async (db) => {
    await db.run(`INSERT INTO injection_plan_imports VALUES (1, '2026-07')`);
    await insertProject(db, { id: 1, wellNo: 'PROCESS-1' });
    await db.run(`INSERT INTO measure_tracking (id, jh, detail_json) VALUES (1, 'PROCESS-1', ?)`, [JSON.stringify({ 开注时间: '2026-07-10' })]);

    const result = await buildInjectionPlanActualComparison(db, { planMonth: '2026-07' });

    assert.equal(result.rows[0].actualProcess, '--');
  });
});
