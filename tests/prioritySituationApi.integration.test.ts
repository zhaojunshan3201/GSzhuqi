import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { createServer } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import sqlite3 from 'sqlite3';
import { open } from 'sqlite';
import * as XLSX from 'xlsx';
import { calculateBlockDeclineRate } from '../src/lib/blockProductionGenerator.ts';
import { formatShanghaiBusinessDate } from '../src/lib/businessDate.ts';

async function availablePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  assert(address && typeof address !== 'string');
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  return address.port;
}

function shiftIsoDate(date: string, days: number): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
}

async function seedDatabase(filename: string) {
  const db = await open({ filename, driver: sqlite3.Database });
  try {
    await db.exec(`
      CREATE TABLE production (
        jh TEXT, rq TEXT, liquid REAL, oil REAL, diluent REAL, water_cut REAL,
        gas REAL, station TEXT, block TEXT, remark TEXT,
        UNIQUE(jh, rq) ON CONFLICT REPLACE
      );
      CREATE TABLE water_lab_records (
        id INTEGER PRIMARY KEY AUTOINCREMENT, jh TEXT, record_date TEXT,
        water_cut REAL, block TEXT, station TEXT, area TEXT, source_file TEXT,
        sheet_name TEXT, created_at TEXT
      );
      CREATE TABLE pump_tracking_uploads (
        id INTEGER PRIMARY KEY AUTOINCREMENT, source_file TEXT, sheet_name TEXT,
        columns_json TEXT, rows_json TEXT, created_at TEXT
      );
      CREATE TABLE measure_tracking (
        id INTEGER PRIMARY KEY AUTOINCREMENT, measure_date TEXT NOT NULL,
        seq_no TEXT, jh TEXT, block TEXT, station TEXT, measure_type TEXT,
        measure_name TEXT, status TEXT, owner TEXT, result_text TEXT,
        oil_gain REAL NOT NULL DEFAULT 0, liquid_gain REAL NOT NULL DEFAULT 0,
        remark TEXT, current_status TEXT, current_round_transfer_time TEXT,
        current_round_measure_type TEXT, production_days REAL, current_liquid REAL,
        current_oil REAL, current_diluent REAL, current_water_cut REAL,
        cumulative_oil_gain REAL, evaluation TEXT, pre_measure_daily_oil REAL,
        previous_period_oil_gain REAL, batch_year TEXT NOT NULL DEFAULT '',
        detail_json TEXT NOT NULL DEFAULT '{}', source_batch TEXT,
        created_at TEXT NOT NULL, updated_at TEXT NOT NULL
      );
      CREATE TABLE soak_transfer_report_rows (
        well_no TEXT PRIMARY KEY, stop_date TEXT NOT NULL, report_date TEXT NOT NULL,
        source_file TEXT NOT NULL, updated_at TEXT NOT NULL
      );
    `);

    const insertProduction = async (well: string, date: string, oil: number | null, block = '', waterCut: number | null = null) => {
      await db.run('INSERT INTO production (jh, rq, oil, block, water_cut) VALUES (?, ?, ?, ?, ?)', [well, date, oil, block, waterCut]);
    };

    await insertProduction('含水井-1', '2026-07-10', 2, '高3', 45);
    await insertProduction('含水井-1', '2026-07-19', 2, '高3', 45);
    await insertProduction('含水边界井', '2026-07-20', 2, '高3', 50);
    await insertProduction('含水最新无效井', '2026-07-10', 2, '高3', 40);
    await db.run(`INSERT INTO water_lab_records
      (jh, record_date, water_cut, block, source_file, created_at)
      VALUES ('含水井-1', '2026-07-10', 90, '高3', '含水化验.xlsx', '2026-07-11T08:00:00.000Z'),
             ('含水井-1', '2026-07-20', 70, '高3', '含水化验.xlsx', '2026-07-21T08:00:00.000Z'),
             ('含水边界井', '2026-07-20', 70, '高3', '含水化验.xlsx', '2026-07-21T08:00:00.000Z'),
             ('含水最新无效井', '2026-07-10', 80, '高3', '含水化验.xlsx', '2026-07-11T08:00:00.000Z'),
             ('含水最新无效井', '2026-07-20', NULL, '高3', '含水化验.xlsx', '2026-07-21T08:00:00.000Z')`);

    for (let day = 26; day <= 30; day += 1) await insertProduction('泵井-未恢复', `2026-07-${day}`, 5);
    for (let day = 15; day <= 19; day += 1) {
      await insertProduction('泵井-库内前后', `2026-07-${day}`, 10);
      await insertProduction('泵井-不足5日', `2026-07-${day}`, 100);
    }
    for (let day = 26; day <= 30; day += 1) await insertProduction('泵井-库内前后', `2026-07-${day}`, 5);
    for (let day = 26; day <= 29; day += 1) await insertProduction('泵井-不足5日', `2026-07-${day}`, 1);
    for (const well of ['泵井-空白', '泵井-百分号', '泵井-吨']) {
      for (let day = 26; day <= 30; day += 1) await insertProduction(well, `2026-07-${day}`, 5);
    }
    const pumpRows = [
      { 井号: '泵井-未恢复', 状态: '已检泵（已恢复）', 本次检泵开日期: '2026-07-20', 检泵前日产油: 10 },
      { 井号: '泵井-正检', 状态: '正检泵', 本次检泵开日期: '2026-07-29', 检泵前日产油: '' },
      { 井号: '泵井-库内前后', 状态: '已检泵（已恢复）', 本次检泵开日期: '2026-07-20', 检泵前日产油: 999 },
      { 井号: '泵井-不足5日', 状态: '已检泵（已恢复）', 本次检泵开日期: '2026-07-20', 检泵前日产油: 10 },
      { 井号: '泵井-空白', 状态: '正检泵', 本次检泵开日期: '2026-07-20', 检泵前日产油: '   ' },
      { 井号: '泵井-百分号', 状态: '正检泵', 本次检泵开日期: '2026-07-20', 检泵前日产油: '%' },
      { 井号: '泵井-吨', 状态: '正检泵', 本次检泵开日期: '2026-07-20', 检泵前日产油: '吨' },
    ];
    await db.run(
      `INSERT INTO pump_tracking_uploads
       (source_file, sheet_name, columns_json, rows_json, created_at)
       VALUES (?, '跟踪', ?, ?, '2026-07-30T01:00:00.000Z')`,
      ['检泵跟踪.xlsx', JSON.stringify(['井号', '状态', '本次检泵开日期', '检泵前日产油']), JSON.stringify(pumpRows)],
    );

    const previousYearOil = [
      300.04, 300.04, 300.04, 300.04, 300.04, 300.04,
      300.04, 300.04, 300.04, 300.04, 300.04, 350.04,
    ];
    for (let month = 1; month <= 12; month += 1) {
      await insertProduction(
        '区块井',
        `2025-${String(month).padStart(2, '0')}-15`,
        previousYearOil[month - 1],
        '高3624',
      );
      await insertProduction(
        `GROUP-${month}`,
        `2025-${String(month).padStart(2, '0')}-15`,
        10.04,
        '3624块(北)L5',
      );
    }
    await insertProduction('区块井', '2026-06-10', 8.04, '高3624');
    await insertProduction('区块井', '2026-06-20', 8.04, '高3624');
    await insertProduction('GROUP-TARGET', '2026-06-10', 2.04, '3624块(北)L5');
    for (let month = 1; month <= 12; month += 1) {
      await insertProduction('跨年区块井', `2024-${String(month).padStart(2, '0')}-15`, 100, '跨年区');
    }
    await insertProduction('跨年区块井', '2025-12-15', 2, '跨年区');
    await insertProduction('缺数区块井', '2025-01-15', null, '缺数区');
    await insertProduction('缺数区块井', '2026-06-15', null, '缺数区');

    for (const [well, currentOil, previousOil] of [
      ['同期变好井', 13, 10],
      ['同期变差井', 7, 10],
    ] as const) {
      await insertProduction(well, '2025-07-01', previousOil, '高3');
      await insertProduction(well, '2025-07-02', previousOil, '高3');
      await insertProduction(well, '2026-07-01', currentOil, '高3');
      await insertProduction(well, '2026-07-02', currentOil, '高3');
      await db.run(
        `INSERT INTO measure_tracking
         (measure_date, jh, block, measure_type, measure_name, status,
          current_status, current_round_transfer_time, batch_year, detail_json,
          source_batch, created_at, updated_at)
         VALUES ('2026-07-01', ?, '高3', '注汽', '吞吐', '生产',
                 '生产', '2026-07-01', '2026', ?, '措施跟踪2026C.xlsx',
                 '2026-07-20T00:00:00.000Z', '2026-07-30T02:00:00.000Z')`,
        [well, JSON.stringify({ previousRound: { 上轮转抽时间: '2025-07-01' } })],
      );
    }
    await insertProduction('同期明细日期井', '2025-07-05', 10, '高3');
    await insertProduction('同期明细日期井', '2025-07-06', 10, '高3');
    await insertProduction('同期明细日期井', '2026-07-05', 13, '高3');
    await insertProduction('同期明细日期井', '2026-07-06', 13, '高3');
    await db.run(
      `INSERT INTO measure_tracking
       (measure_date, jh, block, measure_type, measure_name, status,
        current_status, current_round_transfer_time, batch_year, detail_json,
        source_batch, created_at, updated_at)
       VALUES ('2026-07-30', '同期明细日期井', '高3', '注汽', '吞吐', '生产',
               '生产', NULL, '2026', ?, '措施跟踪2026C.xlsx',
               '2026-07-20T00:00:00.000Z', '2026-07-30T02:00:00.000Z')`,
      [JSON.stringify({
        currentRound: { 转抽时间: '2026-07-05' },
        previousRound: { 转抽时间: '2025-07-05' },
      })],
    );

    await db.run(`INSERT INTO soak_transfer_report_rows
      (well_no, stop_date, report_date, source_file, updated_at)
      VALUES ('焖井-当前', '2026-07-05', '2026-07-30', '焖井转抽.xlsx', '2026-07-30T03:00:00.000Z'),
             ('焖井-已结束', '2026-07-01', '2026-07-30', '焖井转抽.xlsx', '2026-07-30T03:00:00.000Z')`);
    await db.run(
      `INSERT INTO measure_tracking
       (measure_date, jh, measure_type, status, current_status,
        current_round_transfer_time, batch_year, detail_json, source_batch,
        created_at, updated_at)
       VALUES ('2026-07-05', '焖井-当前', '注汽', '正焖井', '正焖井',
               '2026-07-05', '2026', ?, '措施跟踪2026C.xlsx',
               '2026-07-20T00:00:00.000Z', '2026-07-30T02:00:00.000Z'),
              ('2026-07-01', '焖井-已结束', '注汽', '生产', '生产',
               '2026-07-01', '2026', ?, '措施跟踪2026C.xlsx',
               '2026-07-20T00:00:00.000Z', '2026-07-30T02:00:00.000Z')`,
      [
        JSON.stringify({ 计划转抽时间: '2026-08-01' }),
        JSON.stringify({ 实际转抽时间: '2026-07-20' }),
      ],
    );
    await db.run(
      `INSERT INTO measure_tracking
       (measure_date, jh, measure_type, status, current_status,
        current_round_transfer_time, batch_year, detail_json, source_batch,
        created_at, updated_at)
       VALUES ('2026-01-01', '焖井-当前', '日常生产', '生产', '生产',
               '2026-01-01', '2026', '{}', '措施跟踪2026C.xlsx',
               '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z'),
              ('2026-08-01', '焖井-当前', '日常生产', '生产', '生产',
               '2026-08-01', '2026', '{}', '措施跟踪2026C.xlsx',
               '2026-08-01T00:00:00.000Z', '2026-08-01T00:00:00.000Z')`,
    );

    await insertProduction('非注汽措施井', '2025-07-01', 10, '高3');
    await insertProduction('非注汽措施井', '2025-07-02', 10, '高3');
    await insertProduction('非注汽措施井', '2026-07-01', 15, '高3');
    await insertProduction('非注汽措施井', '2026-07-02', 15, '高3');
    await db.run(
      `INSERT INTO measure_tracking
       (measure_date, jh, block, measure_type, measure_name, status,
        current_status, current_round_transfer_time, batch_year, detail_json,
        source_batch, created_at, updated_at)
       VALUES ('2026-07-01', '非注汽措施井', '高3', '检泵', '检泵', '生产',
               '生产', '2026-07-01', '2026', ?, '措施跟踪2026C.xlsx',
               '2026-07-20T00:00:00.000Z', '2026-07-30T02:00:00.000Z')`,
      [JSON.stringify({ previousRound: { 上轮转抽时间: '2025-07-01' } })],
    );

    await insertProduction('复产井-有油', '2026-07-30', 3, '高3');
    await insertProduction('复产井-去年', '2026-07-29', 2, '高3');
    await insertProduction('复产井-过期', '2026-07-20', 4, '高3');
    for (const [date, well, category, year] of [
      ['2026-06-01', '复产井-有油', '捞油复产井', '2026'],
      ['2026-06-02', '复产井-缺数', '新井', '2026'],
      ['2026-06-03', '复产井-过期', '问题井复产井', '2026'],
      ['2025-06-01', '复产井-去年', '问题井复产井', '2025'],
    ]) {
      await db.run(
        `INSERT INTO measure_tracking
         (measure_date, jh, block, measure_type, measure_name, status,
          current_status, current_round_transfer_time, batch_year, detail_json,
          source_batch, created_at, updated_at)
         VALUES (?, ?, '高3', ?, ?, '生产', '生产', ?, ?, '{}',
                 '措施跟踪2026C.xlsx', '2026-07-20T00:00:00.000Z',
                 '2026-07-30T04:00:00.000Z')`,
        [date, well, category, category, date, year],
      );
    }
  } finally {
    await db.close();
  }
}

async function withSeededPriorityServer(
  prefix: string,
  run: (context: { dbFile: string; baseUrl: string }) => Promise<void>,
) {
  const port = await availablePort();
  const directory = await mkdtemp(path.join(os.tmpdir(), prefix));
  const dbFile = path.join(directory, 'test.db');
  await seedDatabase(dbFile);
  const child = spawn(process.execPath, ['--import', 'tsx', 'server.ts'], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      PORT: String(port),
      LOCAL_ONLY: 'true',
      NODE_ENV: 'production',
      LOCAL_DB_FILE: dbFile,
      AUTH_TOKEN_SECRET: `${prefix}-secret`,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const exitPromise = new Promise<void>((resolve) => {
    child.once('exit', () => resolve());
    child.once('error', () => resolve());
  });
  try {
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('server did not start')), 15_000);
      child.stdout?.on('data', (data: Buffer) => {
        if (String(data).includes('Server running')) {
          clearTimeout(timer);
          resolve();
        }
      });
      child.once('exit', (code, signal) => {
        clearTimeout(timer);
        reject(new Error(`server exited ${code ?? signal}`));
      });
      child.once('error', reject);
    });
    await run({ dbFile, baseUrl: `http://127.0.0.1:${port}` });
  } finally {
    try {
      if (child.exitCode === null && child.signalCode === null) child.kill();
      await exitPromise;
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  }
}

function buildMeasureWorkbook(rows: Record<string, unknown>[]) {
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(rows), '措施跟踪');
  return XLSX.write(workbook, { bookType: 'xlsx', type: 'buffer' }) as Buffer;
}

async function uploadMeasureWorkbook(
  baseUrl: string,
  endpoint: string,
  fileName: string,
  rows: Record<string, unknown>[],
) {
  const form = new FormData();
  form.append(
    'file',
    new Blob([new Uint8Array(buildMeasureWorkbook(rows))], {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    }),
    fileName,
  );
  return fetch(`${baseUrl}${endpoint}`, { method: 'POST', body: form });
}

test('聚合六类重点情况并对缺少单一来源保持整体可用', { timeout: 30_000 }, async () => {
  const port = await availablePort();
  const directory = await mkdtemp(path.join(os.tmpdir(), 'priority-situation-api-'));
  const dbFile = path.join(directory, 'test.db');
  await seedDatabase(dbFile);
  const child = spawn(process.execPath, ['--import', 'tsx', 'server.ts'], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      PORT: String(port),
      LOCAL_ONLY: 'true',
      NODE_ENV: 'production',
      LOCAL_DB_FILE: dbFile,
      AUTH_TOKEN_SECRET: 'priority-situation-test-secret',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const exitPromise = new Promise<void>((resolve) => {
    child.once('exit', () => resolve());
    child.once('error', () => resolve());
  });

  try {
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('server did not start')), 15_000);
      const onData = (data: Buffer) => {
        if (String(data).includes('Server running')) {
          clearTimeout(timer);
          resolve();
        }
      };
      child.stdout?.on('data', onData);
      child.once('exit', (code, signal) => {
        clearTimeout(timer);
        reject(new Error(`server exited ${code ?? signal}`));
      });
      child.once('error', reject);
    });

    const response = await fetch(`http://127.0.0.1:${port}/api/analysis/issues?asOf=2026-07-30`);
    assert.equal(response.status, 200);
    const body = await response.json() as any;
    assert.deepEqual(Object.keys(body.data).sort(), [
      'asOfDate', 'blockDeclines', 'issues', 'restartSummary', 'soakingWells',
      'sourceStatus', 'summary', 'updatedAt', 'water_cut_pie',
      'top_water_cut_wells', 'decline_warnings',
    ].sort());
    assert.equal(body.data.asOfDate, '2026-07-30');
    assert.equal(body.data.summary.waterCut, 1);
    assert.equal(body.data.summary.pump, 7);
    assert.equal(body.data.summary.soaking, 1);
    assert.equal(body.data.summary.injectionPeriod, 3);
    const waterIssues = body.data.issues.filter((issue: any) => issue.category === 'waterCut');
    assert.equal(waterIssues.length, 1);
    assert.equal(waterIssues[0].deviation, 25);
    assert.equal(waterIssues[0].dataDate, '2026-07-20');
    assert.equal(waterIssues.some((issue: any) => issue.wellNo === '含水最新无效井'), false);
    assert.ok(Array.isArray(body.data.water_cut_pie));
    assert.ok(Array.isArray(body.data.top_water_cut_wells));
    assert.deepEqual(body.data.decline_warnings, []);
    assert.equal(
      body.data.summary.total_wells,
      body.data.water_cut_pie.reduce((sum: number, row: any) => sum + row.value, 0),
    );
    assert.equal(typeof body.data.summary.abnormal_wells, 'number');
    assert.equal(body.data.summary.potential_gain, '--');
    assert.equal(body.data.soakingWells[0].wellNo, '焖井-当前');
    assert.equal(body.data.soakingWells[0].soakingDays, 25);

    // 验证原始区块分别按日舍入，再按生产动态规范组合并的 summary 口径。
    const declines = body.data.blockDeclines.filter((row: any) => row.block === '高3624');
    assert.equal(declines.length, 1);
    const [decline] = declines;
    assert.equal(decline.previousYearOil, 3770);
    assert.equal(decline.monthlyAverageOil, 9);
    assert.equal(
      decline.declineRate,
      Number(calculateBlockDeclineRate(3770, 9, 2026)?.toFixed(1)),
    );
    assert.equal(decline.available, true);
    const unavailableDecline = body.data.blockDeclines.find((row: any) => row.block === '缺数区');
    assert.equal(unavailableDecline.declineRate, null);
    assert.equal(unavailableDecline.available, false);
    assert.equal(unavailableDecline.unavailableReason, '上年1—12月数据不足');

    const pumpIssue = body.data.issues.find((issue: any) => issue.wellNo === '泵井-未恢复');
    assert.equal(pumpIssue.category, 'pump');
    assert.equal(pumpIssue.currentOil, 5);
    assert.equal(pumpIssue.beforeOil, 10);
    assert.equal(pumpIssue.recoveryRate, 50);
    assert.equal(pumpIssue.targetTab, 'pumpAnalysis');
    const missingPumpIssue = body.data.issues.find((issue: any) => issue.wellNo === '泵井-正检');
    assert.equal(missingPumpIssue.status, '数据待补');
    assert.equal(missingPumpIssue.currentOil, null);
    assert.equal(missingPumpIssue.beforeOil, null);
    assert.equal(missingPumpIssue.recoveryRate, null);
    const databaseWindowPump = body.data.issues.find((issue: any) => issue.wellNo === '泵井-库内前后');
    assert.equal(databaseWindowPump.currentOil, 5);
    assert.equal(databaseWindowPump.beforeOil, 10);
    assert.equal(databaseWindowPump.recoveryRate, 50);
    assert.equal(databaseWindowPump.beforeOilSource, 'production-5-days');
    const insufficientPump = body.data.issues.find((issue: any) => issue.wellNo === '泵井-不足5日');
    assert.equal(insufficientPump.status, '数据待补');
    assert.equal(insufficientPump.currentOil, null);
    assert.equal(insufficientPump.currentReportDays, 4);
    assert.equal(insufficientPump.beforeOil, 100);
    for (const wellNo of ['泵井-空白', '泵井-百分号', '泵井-吨']) {
      const issue = body.data.issues.find((item: any) => item.wellNo === wellNo);
      assert.equal(issue.beforeOil, null);
      assert.equal(issue.recoveryRate, null);
    }

    const injectionIssues = body.data.issues.filter((issue: any) => issue.category === 'injectionPeriod');
    assert.deepEqual(new Set(injectionIssues.map((issue: any) => issue.status)), new Set(['同期变好', '同期变差']));
    assert.equal(body.data.restartSummary['2026:捞油复产井'].totalOil, 3);
    assert.equal(body.data.restartSummary['2026:捞油复产井'].averageOil, 3);
    assert.equal(body.data.restartSummary['2026:新井'].totalOil, null);
    assert.equal(body.data.restartSummary['2026:新井'].stoppedOrMissingWells, 1);
    assert.equal(body.data.restartSummary['2026:问题井复产井'].totalOil, null);
    assert.equal(body.data.restartSummary['2026:问题井复产井'].missingWells, 1);
    const staleRestartIssue = body.data.issues.find((issue: any) => issue.wellNo === '复产井-过期');
    assert.equal(staleRestartIssue.currentOil, null);
    assert.equal(body.data.restartSummary['2025:问题井复产井'].wells, 1);
    assert.equal(body.data.sourceStatus.tracking.fileName, '措施跟踪2026C.xlsx');
    assert.equal(body.data.sourceStatus.tracking.available, true);

    const january = await fetch(`http://127.0.0.1:${port}/api/analysis/issues?asOf=2026-01-15`);
    assert.equal(january.status, 200);
    const januaryBody = await january.json() as any;
    const crossYearDecline = januaryBody.data.blockDeclines.find((row: any) => row.block === '跨年区');
    assert.equal(crossYearDecline.previousYear, 2024);
    assert.equal(crossYearDecline.previousYearOil, 1200);
    assert.equal(crossYearDecline.monthlyAverageOil, 2);
    assert.equal(januaryBody.data.sourceStatus.injectionPeriod.available, false);
    assert.equal(januaryBody.data.sourceStatus.injectionPeriod.unavailableReason, '无本轮可比实际施工数据');

    const invalid = await fetch(`http://127.0.0.1:${port}/api/analysis/issues?asOf=2026-02-30`);
    assert.equal(invalid.status, 400);

    const db = await open({ filename: dbFile, driver: sqlite3.Database });
    try {
      await db.exec('DROP TABLE water_lab_records');
    } finally {
      await db.close();
    }
    const partial = await fetch(`http://127.0.0.1:${port}/api/analysis/issues?asOf=2026-07-30`);
    assert.equal(partial.status, 200);
    const partialBody = await partial.json() as any;
    assert.equal(partialBody.data.summary.waterCut, 0);
    assert.equal(partialBody.data.sourceStatus.waterLab.available, false);

    const dbWithoutTracking = await open({ filename: dbFile, driver: sqlite3.Database });
    try {
      await dbWithoutTracking.exec('DROP TABLE measure_tracking');
    } finally {
      await dbWithoutTracking.close();
    }
    const withoutTracking = await fetch(`http://127.0.0.1:${port}/api/analysis/issues?asOf=2026-07-30`);
    assert.equal(withoutTracking.status, 200);
    const withoutTrackingBody = await withoutTracking.json() as any;
    assert.equal(withoutTrackingBody.data.summary.soaking, 0);
    assert.deepEqual(withoutTrackingBody.data.soakingWells, []);
    assert.equal(withoutTrackingBody.data.sourceStatus.soaking.available, false);
    assert.equal(withoutTrackingBody.data.sourceStatus.injectionPeriod.unavailableReason, '措施跟踪数据不可用');
    assert.equal(withoutTrackingBody.data.sourceStatus.restartTracking.unavailableReason, '措施跟踪数据不可用');

    const dbWithoutProduction = await open({ filename: dbFile, driver: sqlite3.Database });
    try {
      await dbWithoutProduction.exec('DROP TABLE production');
    } finally {
      await dbWithoutProduction.close();
    }
    const withoutProduction = await fetch(`http://127.0.0.1:${port}/api/analysis/issues?asOf=2026-07-30`);
    assert.equal(withoutProduction.status, 200);
    const withoutProductionBody = await withoutProduction.json() as any;
    assert.equal(withoutProductionBody.data.summary.pump, 0);
    assert.equal(withoutProductionBody.data.summary.blockDecline, 0);
    assert.equal(withoutProductionBody.data.summary.injectionPeriod, 0);
    assert.equal(withoutProductionBody.data.summary.restartTracking, 0);
    assert.equal(withoutProductionBody.data.sourceStatus.production.available, false);
    assert.equal(withoutProductionBody.data.sourceStatus.pump.available, false);
    assert.equal(withoutProductionBody.data.sourceStatus.restartTracking.available, false);
  } finally {
    try {
      if (child.exitCode === null && child.signalCode === null) child.kill();
      await exitPromise;
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  }
});

test('production 表缺失且未传 asOf 时回退当前日期并继续聚合独立来源', { timeout: 30_000 }, async () => {
  const port = await availablePort();
  const directory = await mkdtemp(path.join(os.tmpdir(), 'priority-situation-default-asof-'));
  const dbFile = path.join(directory, 'test.db');
  const today = formatShanghaiBusinessDate(new Date());
  const stopDate = shiftIsoDate(today, -25);
  const historicalProductionDate = shiftIsoDate(stopDate, -1);
  const futureProductionDate = shiftIsoDate(today, 1);
  const expectedTrackingUpdatedAt = `${futureProductionDate}T00:00:00.000Z`;
  await seedDatabase(dbFile);
  const child = spawn(process.execPath, ['--import', 'tsx', 'server.ts'], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      PORT: String(port),
      LOCAL_ONLY: 'true',
      NODE_ENV: 'production',
      LOCAL_DB_FILE: dbFile,
      AUTH_TOKEN_SECRET: 'priority-default-asof-test-secret',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const exitPromise = new Promise<void>((resolve) => {
    child.once('exit', () => resolve());
    child.once('error', () => resolve());
  });

  try {
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('server did not start')), 15_000);
      child.stdout?.on('data', (data: Buffer) => {
        if (String(data).includes('Server running')) {
          clearTimeout(timer);
          resolve();
        }
      });
      child.once('exit', (code, signal) => {
        clearTimeout(timer);
        reject(new Error(`server exited ${code ?? signal}`));
      });
      child.once('error', reject);
    });

    const db = await open({ filename: dbFile, driver: sqlite3.Database });
    try {
      await db.exec('DELETE FROM soak_transfer_report_rows; DELETE FROM measure_tracking');
      await db.run(
        `INSERT INTO soak_transfer_report_rows
         (well_no, stop_date, report_date, source_file, updated_at)
         VALUES ('焖井-当前', ?, ?, '焖井转抽.xlsx', ?)`,
        [stopDate, today, `${today}T00:00:00.000Z`],
      );
      for (const [date, status, updatedAt] of [
        [stopDate, '正焖井', `${today}T00:00:00.000Z`],
        [historicalProductionDate, '生产', `${historicalProductionDate}T00:00:00.000Z`],
        [futureProductionDate, '生产', expectedTrackingUpdatedAt],
      ]) {
        await db.run(
          `INSERT INTO measure_tracking
           (measure_date, jh, measure_type, status, current_status,
            current_round_transfer_time, batch_year, detail_json, source_batch,
            created_at, updated_at)
           VALUES (?, '焖井-当前', '日常生产', ?, ?, ?, ?, '{}',
                   '措施跟踪2026C.xlsx', ?, ?)`,
          [date, status, status, date, date.slice(0, 4), updatedAt, updatedAt],
        );
      }
      await db.exec('DROP TABLE production');
    } finally {
      await db.close();
    }

    const response = await fetch(`http://127.0.0.1:${port}/api/analysis/issues`);
    assert.equal(response.status, 200);
    const body = await response.json() as any;
    assert.equal(body.success, true);
    assert.match(body.data.asOfDate, /^\d{4}-\d{2}-\d{2}$/);
    assert.deepEqual(
      Object.fromEntries(['pump', 'waterCut', 'blockDecline', 'soaking', 'injectionPeriod', 'restartTracking']
        .map((key) => [key, body.data.summary[key]])),
      { pump: 0, waterCut: 0, blockDecline: 0, soaking: 1, injectionPeriod: 0, restartTracking: 0 },
    );
    assert.equal(body.data.summary.total_wells, 0);
    assert.equal(body.data.summary.abnormal_wells, 0);
    assert.equal(body.data.summary.potential_gain, '--');
    assert.deepEqual(body.data.issues.map((issue: any) => issue.category), ['soaking']);
    assert.deepEqual(body.data.blockDeclines, []);
    assert.equal(body.data.soakingWells.length, 1);
    assert.equal(body.data.soakingWells[0].wellNo, '焖井-当前');
    assert.deepEqual(body.data.restartSummary, {});
    assert.equal(body.data.sourceStatus.production.available, false);
    assert.equal(body.data.sourceStatus.tracking.available, true);
    assert.equal(body.data.sourceStatus.tracking.fileName, '措施跟踪2026C.xlsx');
    assert.equal(body.data.sourceStatus.tracking.updatedAt, expectedTrackingUpdatedAt);
    assert.equal(body.data.sourceStatus.soaking.available, true);
    assert.equal(body.data.asOfDate, today);
  } finally {
    try {
      if (child.exitCode === null && child.signalCode === null) child.kill();
      await exitPromise;
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  }
});

test('water_lab_records 单独缺失只关闭含水来源', { timeout: 30_000 }, async () => {
  await withSeededPriorityServer('priority-missing-water-', async ({ dbFile, baseUrl }) => {
    const db = await open({ filename: dbFile, driver: sqlite3.Database });
    try {
      await db.exec('DROP TABLE water_lab_records');
    } finally {
      await db.close();
    }
    const body = await (await fetch(`${baseUrl}/api/analysis/issues?asOf=2026-07-30`)).json() as any;
    assert.equal(body.data.summary.waterCut, 0);
    assert.equal(body.data.sourceStatus.waterLab.available, false);
    assert.equal(body.data.sourceStatus.tracking.available, true);
    assert.equal(body.data.summary.soaking, 1);
  });
});

test('measure_tracking 单独缺失为同期与复产返回明确原因', { timeout: 30_000 }, async () => {
  await withSeededPriorityServer('priority-missing-tracking-', async ({ dbFile, baseUrl }) => {
    const db = await open({ filename: dbFile, driver: sqlite3.Database });
    try {
      await db.exec('DROP TABLE measure_tracking');
    } finally {
      await db.close();
    }
    const response = await fetch(`${baseUrl}/api/analysis/issues?asOf=2026-07-30`);
    assert.equal(response.status, 200);
    const body = await response.json() as any;
    assert.equal(body.data.summary.injectionPeriod, 0);
    assert.equal(body.data.summary.restartTracking, 0);
    assert.equal(body.data.sourceStatus.injectionPeriod.available, false);
    assert.equal(body.data.sourceStatus.injectionPeriod.unavailableReason, '措施跟踪数据不可用');
    assert.equal(body.data.sourceStatus.restartTracking.available, false);
    assert.equal(body.data.sourceStatus.restartTracking.unavailableReason, '措施跟踪数据不可用');
    assert.equal(body.data.summary.waterCut, 1);
  });
});

test('检泵 rows_json 损坏时关闭检泵来源并返回原因', { timeout: 30_000 }, async () => {
  await withSeededPriorityServer('priority-corrupt-pump-', async ({ dbFile, baseUrl }) => {
    const db = await open({ filename: dbFile, driver: sqlite3.Database });
    try {
      await db.run("UPDATE pump_tracking_uploads SET rows_json = '{broken-json'");
    } finally {
      await db.close();
    }
    const response = await fetch(`${baseUrl}/api/analysis/issues?asOf=2026-07-30`);
    assert.equal(response.status, 200);
    const body = await response.json() as any;
    assert.equal(body.data.summary.pump, 0);
    assert.equal(body.data.sourceStatus.pump.available, false);
    assert.equal(body.data.sourceStatus.pump.unavailableReason, '检泵上传数据损坏');
    assert.equal(body.data.summary.waterCut, 1);
  });
});

test('pump_tracking_uploads 单独缺失只关闭检泵来源', { timeout: 30_000 }, async () => {
  await withSeededPriorityServer('priority-missing-pump-', async ({ dbFile, baseUrl }) => {
    const db = await open({ filename: dbFile, driver: sqlite3.Database });
    try {
      await db.exec('DROP TABLE pump_tracking_uploads');
    } finally {
      await db.close();
    }
    const body = await (await fetch(`${baseUrl}/api/analysis/issues?asOf=2026-07-30`)).json() as any;
    assert.equal(body.data.summary.pump, 0);
    assert.equal(body.data.sourceStatus.pump.available, false);
    assert.equal(body.data.summary.waterCut, 1);
    assert.equal(body.data.sourceStatus.tracking.available, true);
  });
});

test('soak_transfer_report_rows 单独缺失只关闭焖井来源', { timeout: 30_000 }, async () => {
  await withSeededPriorityServer('priority-missing-soaking-', async ({ dbFile, baseUrl }) => {
    const db = await open({ filename: dbFile, driver: sqlite3.Database });
    try {
      await db.exec('DROP TABLE soak_transfer_report_rows');
    } finally {
      await db.close();
    }
    const body = await (await fetch(`${baseUrl}/api/analysis/issues?asOf=2026-07-30`)).json() as any;
    assert.equal(body.data.summary.soaking, 0);
    assert.deepEqual(body.data.soakingWells, []);
    assert.equal(body.data.sourceStatus.soaking.available, false);
    assert.equal(body.data.sourceStatus.tracking.available, true);
    assert.equal(body.data.summary.waterCut, 1);
  });
});

test('措施跟踪上传后措施页与重点情况分析共享同一批数据', { timeout: 30_000 }, async () => {
  await withSeededPriorityServer('priority-shared-tracking-', async ({ baseUrl }) => {
    const upload = await uploadMeasureWorkbook(
      baseUrl,
      '/api/measures/import?year=2026',
      '重点跟踪.xlsx',
      [{
        井号: '高3-试1',
        区块: '高三区',
        措施类型: '吞吐',
        目前状态: '生产',
        转抽时间: '2026-07-15',
      }],
    );
    assert.equal(upload.status, 200);
    const uploadBody = await upload.json() as any;
    assert.equal(uploadBody.success, true);
    assert.equal(uploadBody.count, 1);

    const measures2026 = await (await fetch(`${baseUrl}/api/measures?year=2026`)).json() as any;
    assert.deepEqual(measures2026.data.rows.map((row: any) => row.jh), ['高3-试1']);
    assert.equal(measures2026.data.rows[0].source_batch, '重点跟踪.xlsx');

    const measures2025 = await (await fetch(`${baseUrl}/api/measures?year=2025`)).json() as any;
    assert.ok(measures2025.data.rows.length > 0);

    const analysis = await (await fetch(`${baseUrl}/api/analysis/issues?asOf=2026-07-30`)).json() as any;
    assert.equal(analysis.data.sourceStatus.tracking.available, true);
    assert.equal(analysis.data.sourceStatus.tracking.fileName, '重点跟踪.xlsx');
    assert.ok(analysis.data.sourceStatus.tracking.updatedAt);
  });
});

test('措施跟踪预检明确报告缺失的井号、措施类型和日期字段', { timeout: 30_000 }, async () => {
  await withSeededPriorityServer('priority-tracking-validation-', async ({ baseUrl }) => {
    const preview = await uploadMeasureWorkbook(
      baseUrl,
      '/api/measures/import/preview?year=2026',
      '缺少字段.xlsx',
      [{ 区块: '高三区' }],
    );
    assert.equal(preview.status, 400);
    const body = await preview.json() as any;
    assert.match(body.message, /井号/);
    assert.match(body.message, /措施类型|类别/);
    assert.match(body.message, /年份|日期/);
  });
});
