import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import sqlite3 from 'sqlite3';
import { open } from 'sqlite';

import { buildInjectionStatusMap, buildInjectionStatusMapResponse, filterInjectionMapWells, summarizeInjectionMap, type InjectionMapWell } from '../src/lib/injectionStatusMap.ts';
import { createInjectionStatusMapHandler } from '../src/lib/injectionStatusMapHandler.ts';

async function withDatabase(run: (db: any) => Promise<void>) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'injection-status-map-'));
  const db = await open({ filename: path.join(directory, 'test.db'), driver: sqlite3.Database });
  try {
    await db.exec(`
      CREATE TABLE injection_projects (
        id INTEGER PRIMARY KEY, well_no TEXT, block TEXT, lifecycle_status TEXT, updated_at TEXT,
        planned_start_date TEXT, planned_end_date TEXT, planned_transfer_date TEXT, planned_steam REAL, owner TEXT
      );
      CREATE TABLE measure_tracking (
        id INTEGER PRIMARY KEY, jh TEXT, block TEXT, station TEXT, current_status TEXT,
        current_round_transfer_time TEXT, current_oil REAL, cumulative_oil_gain REAL, evaluation TEXT
      );
      CREATE TABLE well_map_markers (well_no TEXT PRIMARY KEY, block TEXT, x_percent REAL, y_percent REAL);
      CREATE TABLE measure_well_cycles (well_name TEXT, actual_steam REAL, cycle_oil REAL);
    `);
    await run(db);
  } finally {
    await db.close();
    await rm(directory, { recursive: true, force: true });
  }
}

test('uses the latest open project lifecycle before tracking status', async () => {
  await withDatabase(async (db) => {
    await db.run(`INSERT INTO injection_projects VALUES (1, 'A-1', 'A区', 'closed', '2026-07-25', NULL, NULL, '2026-07-01', 1200, '旧负责人')`);
    await db.run(`INSERT INTO injection_projects VALUES (2, 'A-1', 'A区', 'soaking', '2026-07-25', '2026-07-01', '2026-07-03', '2026-07-10', 1800, '张工')`);
    await db.run(`INSERT INTO measure_tracking VALUES (1, 'A-1', '历史区块', '站-1', '生产', '2026-07-20', 4.2, 30, 'B')`);
    await db.run(`INSERT INTO well_map_markers VALUES ('A-1', 'A区', 21, 34)`);
    await db.run(`INSERT INTO measure_well_cycles VALUES ('A-1', 120, 30)`);

    const result = await buildInjectionStatusMap(db, { today: '2026-07-26' });

    assert.deepEqual(result.wells.find((well) => well.wellNo === 'A-1'), {
      wellNo: 'A-1', block: 'A区', station: '站-1', xPercent: 21, yPercent: 34,
      lifecycleStatus: 'soaking', statusSource: 'project', planMonth: '2026-07',
      projectId: 2, owner: '张工', plannedStartDate: '2026-07-01', plannedEndDate: '2026-07-03',
      actualStartDate: null, actualEndDate: null, plannedTransferDate: '2026-07-10',
      overdueDays: 16, plannedSteam: 1800, actualSteam: null, currentOil: 4.2,
      cumulativeOilGain: 30, oilSteamRatio: 0.25, evaluation: 'B', alertTypes: [],
    });
  });
});

test('falls back to latest tracking when a well has no project', async () => {
  await withDatabase(async (db) => {
    await db.run(`INSERT INTO measure_tracking VALUES (1, 'B-1', 'B区', '站-B', '焖井', '2026-01-01', NULL, NULL, NULL)`);
    await db.run(`INSERT INTO measure_tracking VALUES (2, 'B-1', 'B区', '站-B', '生产', '2026-07-20', 2.5, 10, 'A')`);

    const result = await buildInjectionStatusMap(db, { today: '2026-07-26' });
    const well = result.wells.find((item) => item.wellNo === 'B-1');

    assert.equal(well?.lifecycleStatus, 'producing');
    assert.equal(well?.statusSource, 'tracking');
    assert.equal(well?.currentOil, 2.5);
  });
});

test('uses the latest project by updated time and id, preferring any open project', async () => {
  await withDatabase(async (db) => {
    await db.run(`INSERT INTO injection_projects VALUES (1, 'C-1', 'C区', 'injecting', '2026-07-20', NULL, NULL, '2026-08-01', NULL, '甲')`);
    await db.run(`INSERT INTO injection_projects VALUES (2, 'C-1', 'C区', 'pendingTransfer', '2026-07-20', NULL, NULL, '2026-08-02', NULL, '乙')`);
    await db.run(`INSERT INTO injection_projects VALUES (3, 'C-1', 'C区', 'closed', '2026-07-26', NULL, NULL, '2026-08-03', NULL, '丙')`);

    const result = await buildInjectionStatusMap(db, { today: '2026-07-26' });
    const well = result.wells.find((item) => item.wellNo === 'C-1');

    assert.equal(well?.projectId, 2);
    assert.equal(well?.lifecycleStatus, 'pendingTransfer');
  });
});

test('filters first and only maps finite coordinates in the 0-100 range', () => {
  const wells: InjectionMapWell[] = [
    { wellNo: 'A-1', block: 'A区', station: null, xPercent: 10, yPercent: 20, lifecycleStatus: 'soaking', statusSource: 'project', planMonth: '2026-07', projectId: 1, owner: null, plannedStartDate: null, plannedEndDate: null, actualStartDate: null, actualEndDate: null, plannedTransferDate: '2026-07-01', overdueDays: 25, plannedSteam: null, actualSteam: null, currentOil: null, cumulativeOilGain: null, oilSteamRatio: null, evaluation: null, alertTypes: ['soakingOverdue'] },
    { wellNo: 'A-2', block: 'A区', station: null, xPercent: null, yPercent: null, lifecycleStatus: 'soaking', statusSource: 'project', planMonth: '2026-07', projectId: 2, owner: null, plannedStartDate: null, plannedEndDate: null, actualStartDate: null, actualEndDate: null, plannedTransferDate: '2026-07-01', overdueDays: 25, plannedSteam: null, actualSteam: null, currentOil: null, cumulativeOilGain: null, oilSteamRatio: null, evaluation: null, alertTypes: ['soakingOverdue'] },
    { wellNo: 'A-3', block: 'A区', station: null, xPercent: 101, yPercent: 20, lifecycleStatus: 'soaking', statusSource: 'project', planMonth: '2026-07', projectId: 3, owner: null, plannedStartDate: null, plannedEndDate: null, actualStartDate: null, actualEndDate: null, plannedTransferDate: '2026-07-01', overdueDays: 25, plannedSteam: null, actualSteam: null, currentOil: null, cumulativeOilGain: null, oilSteamRatio: null, evaluation: null, alertTypes: ['soakingOverdue'] },
    { wellNo: 'B-1', block: 'B区', station: null, xPercent: 20, yPercent: 30, lifecycleStatus: 'producing', statusSource: 'tracking', planMonth: null, projectId: null, owner: null, plannedStartDate: null, plannedEndDate: null, actualStartDate: null, actualEndDate: null, plannedTransferDate: null, overdueDays: null, plannedSteam: null, actualSteam: null, currentOil: null, cumulativeOilGain: null, oilSteamRatio: null, evaluation: null, alertTypes: [] },
  ];

  const result = filterInjectionMapWells(wells, {
    block: 'A区', lifecycleStatus: 'soaking', planMonth: '2026-07', alertType: 'soakingOverdue', overdue: true, keyword: 'A-',
  });

  assert.deepEqual(result.mapWells.map((well) => well.wellNo), ['A-1']);
  assert.deepEqual(result.unlocatedWells.map((well) => well.wellNo), ['A-2', 'A-3']);
  assert.deepEqual(summarizeInjectionMap(result.mapWells, result.unlocatedWells), {
    total: 1, injecting: 0, soaking: 1, pendingTransfer: 0, producing: 0, alerts: 1, unlocated: 2,
  });
});


test('derives alerts solely from the latest tracking row even when a project controls lifecycle', async () => {
  await withDatabase(async (db) => {
    await db.run(`INSERT INTO injection_projects VALUES (1, 'PROJECT-S', 'A', 'soaking', '2026-07-25', NULL, NULL, '2026-01-01', NULL, 'owner')`);
    await db.run(`INSERT INTO measure_tracking VALUES (1, 'PROJECT-S', 'A', NULL, '\u7116\u4e95', '2026-07-20', NULL, NULL, NULL)`);
    await db.run(`INSERT INTO measure_tracking VALUES (2, 'MISSING', 'A', NULL, NULL, '2026-07-20', NULL, NULL, NULL)`);
    await db.run(`INSERT INTO measure_tracking VALUES (3, 'PROD-MISSING-OIL', 'A', NULL, '\u751f\u4ea7', '2026-07-20', NULL, NULL, 'A')`);
    await db.run(`INSERT INTO measure_tracking VALUES (4, 'NOT-EVALUATED', 'A', NULL, '\u751f\u4ea7', '2026-07-20', 1, NULL, NULL)`);
    await db.run(`INSERT INTO measure_tracking VALUES (5, 'LOW', 'A', NULL, '\u751f\u4ea7', '2026-07-20', 1, NULL, 'D')`);
    await db.run(`INSERT INTO measure_tracking VALUES (6, 'SOAK', 'A', NULL, '\u7116\u4e95', '2026-06-01', NULL, NULL, NULL)`);
    await db.run(`INSERT INTO measure_tracking VALUES (7, 'TRANSFER', 'A', NULL, '\u8f6c\u6ce8', '2026-07-01', NULL, NULL, NULL)`);

    const byWell = new Map((await buildInjectionStatusMap(db, { today: '2026-07-26' })).wells.map((well) => [well.wellNo, well]));

    assert.deepEqual(byWell.get('PROJECT-S')?.alertTypes, []);
    assert.deepEqual(byWell.get('MISSING')?.alertTypes, ['needsData']);
    assert.deepEqual(byWell.get('PROD-MISSING-OIL')?.alertTypes, ['needsData']);
    assert.deepEqual(byWell.get('NOT-EVALUATED')?.alertTypes, ['notEvaluated']);
    assert.deepEqual(byWell.get('LOW')?.alertTypes, ['lowEfficiency']);
    assert.deepEqual(byWell.get('SOAK')?.alertTypes, ['soakingOverdue']);
    assert.deepEqual(byWell.get('TRANSFER')?.alertTypes, ['transferOverdue']);
  });
});

test('reads actual steam from supported tracking columns and detail JSON', async () => {
  await withDatabase(async (db) => {
    await db.exec(`ALTER TABLE measure_tracking ADD COLUMN actual_steam REAL; ALTER TABLE measure_tracking ADD COLUMN current_round_steam REAL; ALTER TABLE measure_tracking ADD COLUMN current_steam REAL; ALTER TABLE measure_tracking ADD COLUMN detail_json TEXT;`);
    await db.run(`INSERT INTO measure_tracking (id, jh, block, current_status, current_round_transfer_time, current_oil, evaluation, actual_steam, current_round_steam) VALUES (1, 'STEAM-1', 'A', '\u751f\u4ea7', '2026-07-20', 1, 'A', 180, 120)`);
    await db.run(`INSERT INTO measure_tracking (id, jh, block, current_status, current_round_transfer_time, current_oil, evaluation, current_steam) VALUES (2, 'STEAM-2', 'A', '\u751f\u4ea7', '2026-07-20', 1, 'A', 80)`);
    await db.run(`INSERT INTO measure_tracking (id, jh, block, current_status, current_round_transfer_time, current_oil, evaluation, detail_json) VALUES (3, 'STEAM-3', 'A', '\u751f\u4ea7', '2026-07-20', 1, 'A', '{"currentRound":{"\\u5b9e\\u9645\\u6ce8\\u6c7d\\u91cf":75}}')`);

    const byWell = new Map((await buildInjectionStatusMap(db, { today: '2026-07-26' })).wells.map((well) => [well.wellNo, well]));

    assert.equal(byWell.get('STEAM-1')?.actualSteam, 180);
    assert.equal(byWell.get('STEAM-2')?.actualSteam, 80);
    assert.equal(byWell.get('STEAM-3')?.actualSteam, 75);
  });
});


test('uses mapped tracking status for alerts when a project lifecycle conflicts', async () => {
  await withDatabase(async (db) => {
    await db.run(`INSERT INTO injection_projects VALUES (1, 'TRACK-SOAK', 'A', 'producing', '2026-07-25', NULL, NULL, NULL, NULL, 'owner')`);
    await db.run(`INSERT INTO injection_projects VALUES (2, 'TRACK-PROD', 'A', 'soaking', '2026-07-25', NULL, NULL, NULL, NULL, 'owner')`);
    await db.run(`INSERT INTO measure_tracking VALUES (1, 'TRACK-SOAK', 'A', NULL, '\u7116\u4e95', '2026-06-01', NULL, NULL, NULL)`);
    await db.run(`INSERT INTO measure_tracking VALUES (2, 'TRACK-PROD', 'A', NULL, '\u751f\u4ea7', '2026-07-20', 1, NULL, 'D')`);

    const byWell = new Map((await buildInjectionStatusMap(db, { today: '2026-07-26' })).wells.map((well) => [well.wellNo, well]));

    assert.equal(byWell.get('TRACK-SOAK')?.lifecycleStatus, 'producing');
    assert.deepEqual(byWell.get('TRACK-SOAK')?.alertTypes, ['soakingOverdue']);
    assert.equal(byWell.get('TRACK-PROD')?.lifecycleStatus, 'soaking');
    assert.deepEqual(byWell.get('TRACK-PROD')?.alertTypes, ['lowEfficiency']);
  });
});

test('marks unknown tracking statuses and invalid calendar dates as needs-data without overdue alerts', async () => {
  await withDatabase(async (db) => {
    await db.run(`INSERT INTO measure_tracking VALUES (1, 'UNKNOWN', 'A', NULL, 'unknown', '2026-07-20', NULL, NULL, NULL)`);
    await db.run(`INSERT INTO measure_tracking VALUES (2, 'BAD-SOAK', 'A', NULL, '\u7116\u4e95', '2026-02-31', NULL, NULL, NULL)`);
    await db.run(`INSERT INTO measure_tracking VALUES (3, 'BAD-TRANSFER', 'A', NULL, '\u8f6c\u6ce8', '2026-99-99', NULL, NULL, NULL)`);

    const byWell = new Map((await buildInjectionStatusMap(db, { today: '2026-07-26' })).wells.map((well) => [well.wellNo, well]));

    assert.equal(byWell.get('UNKNOWN')?.lifecycleStatus, 'needsData');
    assert.deepEqual(byWell.get('UNKNOWN')?.alertTypes, ['needsData']);
    assert.deepEqual(byWell.get('BAD-SOAK')?.alertTypes, ['needsData']);
    assert.deepEqual(byWell.get('BAD-TRANSFER')?.alertTypes, ['needsData']);
  });
});

test('merges nested object detail JSON before extracting actual steam', async () => {
  const tracking = {
    id: 1, jh: 'OBJECT-DETAIL', block: 'A', current_status: '\u751f\u4ea7', current_round_transfer_time: '2026-07-20',
    current_oil: 1, evaluation: 'A', detail_json: { rawExtras: { '\u7d2f\u6ce8\u6c7d\u91cf': 66 } },
  };
  const db = {
    all: async (sql: string) => {
      if (sql.includes('injection_projects')) return [];
      if (sql.includes('measure_tracking')) return [tracking];
      return [];
    },
  };

  const well = (await buildInjectionStatusMap(db, { today: '2026-07-26' })).wells[0];
  assert.equal(well.actualSteam, 66);
});

function injectionMapWell(overrides: Partial<InjectionMapWell>): InjectionMapWell {
  return {
    wellNo: 'WELL-1', block: 'A', station: null, xPercent: 10, yPercent: 20,
    lifecycleStatus: 'soaking', statusSource: 'project', planMonth: '2026-07',
    projectId: 1, owner: null, plannedStartDate: null, plannedEndDate: null,
    actualStartDate: null, actualEndDate: null, plannedTransferDate: '2026-07-01',
    overdueDays: 1, plannedSteam: null, actualSteam: null, currentOil: null,
    cumulativeOilGain: null, oilSteamRatio: null, evaluation: null,
    alertTypes: ['soakingOverdue'],
    ...overrides,
  };
}

test('builds a normalized injection status map response for valid query filters', () => {
  const result = { wells: [
    injectionMapWell({ wellNo: 'WELL-MAP' }),
    injectionMapWell({ wellNo: 'WELL-UNLOCATED', xPercent: null, yPercent: null }),
    injectionMapWell({ wellNo: 'OTHER', block: 'B' }),
  ] };

  const response = buildInjectionStatusMapResponse(result, {
    block: 'A', lifecycleStatus: 'soaking', planMonth: '2026-07',
    alertType: 'soakingOverdue', overdue: 'true', keyword: 'well',
  });

  assert.deepEqual(Object.keys(response).sort(), ['filters', 'mapWells', 'summary', 'unlocatedWells']);
  assert.deepEqual(response.filters, {
    block: 'A', lifecycleStatus: 'soaking', planMonth: '2026-07',
    alertType: 'soakingOverdue', overdue: true, keyword: 'well',
  });
  assert.deepEqual(response.mapWells.map((well) => well.wellNo), ['WELL-MAP']);
  assert.deepEqual(response.unlocatedWells.map((well) => well.wellNo), ['WELL-UNLOCATED']);
  assert.deepEqual(response.summary, {
    total: 1, injecting: 0, soaking: 1, pendingTransfer: 0, producing: 0, alerts: 1, unlocated: 1,
  });
});

test('safely ignores invalid lifecycle status and treats only string true as overdue', () => {
  const result = { wells: [
    injectionMapWell({ wellNo: 'OVERDUE', overdueDays: 2 }),
    injectionMapWell({ wellNo: 'ON-TIME', overdueDays: 0 }),
  ] };

  const invalidLifecycle = buildInjectionStatusMapResponse(result, { lifecycleStatus: 'unknown-status' });
  const booleanOverdue = buildInjectionStatusMapResponse(result, { overdue: true });
  const uppercaseOverdue = buildInjectionStatusMapResponse(result, { overdue: 'TRUE' });
  const stringOverdue = buildInjectionStatusMapResponse(result, { overdue: 'true' });

  assert.deepEqual(invalidLifecycle.filters, {});
  assert.equal(invalidLifecycle.mapWells.length, 2);
  assert.equal(booleanOverdue.mapWells.length, 2);
  assert.equal(uppercaseOverdue.mapWells.length, 2);
  assert.deepEqual(stringOverdue.mapWells.map((well) => well.wellNo), ['OVERDUE']);
});

test('injection status map handler forwards query and returns the response payload', async () => {
  const result = { wells: [injectionMapWell({ wellNo: 'HANDLER-WELL' })] };
  let receivedToday = '';
  let payload: unknown;
  const handler = createInjectionStatusMapHandler({
    buildMap: async ({ today }) => {
      receivedToday = today;
      return result;
    },
    today: () => '2026-07-26',
  });

  await handler(
    { query: { block: 'A', overdue: 'true' } },
    { json: (value) => { payload = value; }, status: () => ({ json: (value) => { payload = value; } }) },
  );

  assert.equal(receivedToday, '2026-07-26');
  assert.deepEqual(payload, {
    success: true,
    data: {
      filters: { block: 'A', overdue: true },
      mapWells: result.wells,
      unlocatedWells: [],
      summary: { total: 1, injecting: 0, soaking: 1, pendingTransfer: 0, producing: 0, alerts: 1, unlocated: 0 },
    },
  });
});

test('injection status map handler returns a 500 error message when map building fails', async () => {
  let statusCode: number | undefined;
  let payload: unknown;
  const handler = createInjectionStatusMapHandler({
    buildMap: async () => { throw new Error('fixture failure'); },
    today: () => '2026-07-26',
  });

  await handler(
    { query: {} },
    {
      json: (value) => { payload = value; },
      status: (code) => {
        statusCode = code;
        return { json: (value) => { payload = value; } };
      },
    },
  );

  assert.equal(statusCode, 500);
  assert.deepEqual(payload, { success: false, message: 'fixture failure' });
});
