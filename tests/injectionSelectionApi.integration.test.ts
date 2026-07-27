import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import sqlite3 from 'sqlite3';
import { open } from 'sqlite';
import * as XLSX from 'xlsx';

async function availablePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  assert(address && typeof address !== 'string');
  const port = address.port;
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  return port;
}

function workbookUpload(rows: unknown[][], filename: string): FormData {
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(rows), 'Sheet1');
  const form = new FormData();
  form.append('file', new Blob([XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' })]), filename);
  return form;
}

test('exposes injection-selection status and rejects a malformed plan month', { timeout: 30000 }, async () => {
  const port = await availablePort();
  const directory = await mkdtemp(path.join(os.tmpdir(), 'injection-selection-api-'));
  const dbFile = path.join(directory, 'test.db');
  const child = spawn(process.execPath, ['--import', 'tsx', 'server.ts'], {
    cwd: process.cwd(),
    env: { ...process.env, PORT: String(port), LOCAL_ONLY: 'true', NODE_ENV: 'production', LOCAL_DB_FILE: dbFile, AUTH_TOKEN_SECRET: 'injection-selection-test-secret' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const exitPromise = new Promise<void>((resolve) => {
    child.once('exit', () => resolve());
    child.once('error', () => resolve());
  });
  try {
    await new Promise<void>((resolve, reject) => {
      const cleanup = () => {
        clearTimeout(timer);
        child.stdout?.off('data', onData);
        child.off('exit', onExit);
        child.off('error', onError);
      };
      const succeed = () => { cleanup(); resolve(); };
      const fail = (error: Error) => { cleanup(); reject(error); };
      const onData = (data: Buffer) => {
        if (String(data).includes('Server running')) succeed();
      };
      const onExit = (code: number | null, signal: NodeJS.Signals | null) => fail(new Error(`server exited ${code ?? signal}`));
      const onError = (error: Error) => fail(error);
      const timer = setTimeout(() => fail(new Error('server did not start')), 15000);
      child.stdout?.on('data', onData);
      child.once('exit', onExit);
      child.once('error', onError);
      if (child.exitCode !== null || child.signalCode !== null) onExit(child.exitCode, child.signalCode);
    });
    const status = await fetch(`http://127.0.0.1:${port}/api/injection-selection/data-status`);
    assert.equal(status.status, 200);
    assert.deepEqual((await status.json() as any).data.sources, []);

    const stageImport = await fetch(`http://127.0.0.1:${port}/api/injection-selection/import/stage`, {
      method: 'POST',
      body: workbookUpload([
        ['井号', '周期序号', '开注汽日期', '周期注汽量', '阶段产油'],
        ['A', 1, '2026-02-03', 100, null],
      ], 'stage.xlsx'),
    });
    assert.equal(stageImport.status, 200);
    const dailyImport = await fetch(`http://127.0.0.1:${port}/api/injection-selection/import/daily`, {
      method: 'POST',
      body: workbookUpload([
        ['井号', '日期'],
        ['A', null],
      ], 'daily.xlsx'),
    });
    assert.equal(dailyImport.status, 200);

    const importedStatus = await fetch(`http://127.0.0.1:${port}/api/injection-selection/data-status`);
    assert.equal(importedStatus.status, 200);
    const sources = (await importedStatus.json() as any).data.sources;
    const stageStatus = sources.find((source: any) => source.sourceType === 'stage');
    const dailyStatus = sources.find((source: any) => source.sourceType === 'daily');
    assert.deepEqual(stageStatus.errorMessages, ['第 2 行：阶段产油不能为空']);
    assert.deepEqual(dailyStatus.errorMessages, ['第 2 行：日期不能为空']);
    assert.doesNotMatch([...stageStatus.errorMessages, ...dailyStatus.errorMessages].join(''), /\?/);

    const invalidPlan = await fetch(`http://127.0.0.1:${port}/api/injection-selection/plans`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ month: '2026-13' }),
    });
    assert.equal(invalidPlan.status, 400);
  } finally {
    try {
      if (child.exitCode === null && child.signalCode === null) child.kill();
      await exitPromise;
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  }
});

test('returns selected plan well reference data and validates reference parameters', { timeout: 30000 }, async () => {
  const port = await availablePort();
  const directory = await mkdtemp(path.join(os.tmpdir(), 'injection-selection-reference-api-'));
  const dbFile = path.join(directory, 'test.db');
  const child = spawn(process.execPath, ['--import', 'tsx', 'server.ts'], {
    cwd: process.cwd(),
    env: { ...process.env, PORT: String(port), LOCAL_ONLY: 'true', NODE_ENV: 'production', LOCAL_DB_FILE: dbFile, AUTH_TOKEN_SECRET: 'injection-selection-test-secret' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const exitPromise = new Promise<void>((resolve) => {
    child.once('exit', () => resolve());
    child.once('error', () => resolve());
  });
  try {
    await new Promise<void>((resolve, reject) => {
      const cleanup = () => {
        clearTimeout(timer);
        child.stdout?.off('data', onData);
        child.off('exit', onExit);
        child.off('error', onError);
      };
      const succeed = () => { cleanup(); resolve(); };
      const fail = (error: Error) => { cleanup(); reject(error); };
      const onData = (data: Buffer) => {
        if (String(data).includes('Server running')) succeed();
      };
      const onExit = (code: number | null, signal: NodeJS.Signals | null) => fail(new Error(`server exited ${code ?? signal}`));
      const onError = (error: Error) => fail(error);
      const timer = setTimeout(() => fail(new Error('server did not start')), 15000);
      child.stdout?.on('data', onData);
      child.once('exit', onExit);
      child.once('error', onError);
    });

    const db = await open({ filename: dbFile, driver: sqlite3.Database });
    try {
      await db.run("INSERT INTO injection_selection_imports (source_type, source_file, imported_at, row_count) VALUES ('stage', 'stage.xlsx', '2026-01-01', 4)");
      const stageImportId = (await db.get("SELECT id FROM injection_selection_imports WHERE source_type = 'stage'"))!.id;
      for (const [wellNo, cycleNo, endDate, stageOil] of [
        ['A-1', 1, '2026-01-10', 10], ['A-1', 2, '2026-02-10', 20], ['A-1', 3, '2026-03-10', 30], ['B-1', 1, '2026-03-10', 25],
      ]) {
        await db.run(`INSERT INTO injection_stage_rows (import_id, well_no, cycle_no, start_date, end_date, steam_volume, stage_oil, raw_json)
          VALUES (?, ?, ?, '2026-01-01', ?, 100, ?, '{}')`, [stageImportId, wellNo, cycleNo, endDate, stageOil]);
      }
      await db.run("INSERT INTO injection_selection_imports (source_type, source_file, imported_at, row_count) VALUES ('daily', 'daily.xlsx', '2026-01-01', 2)");
      const dailyImportId = (await db.get("SELECT id FROM injection_selection_imports WHERE source_type = 'daily'"))!.id;
      for (const wellNo of ['A-1', 'B-1']) {
        await db.run(`INSERT INTO injection_daily_rows (import_id, well_no, record_date, nitrogen, carbon_dioxide, remarks_json, raw_json)
          VALUES (?, ?, '2026-03-20', 0, 0, '[]', '{}')`, [dailyImportId, wellNo]);
      }
      await db.run("INSERT INTO production (jh, rq, oil) VALUES ('A-1', '2026-03-20', 12.5)");
      const planResponse = await fetch(`http://127.0.0.1:${port}/api/injection-selection/plans`, {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ month: '2026-04' }),
      });
      assert.equal(planResponse.status, 200);
      const plan = (await planResponse.json() as any).data;
      const planId = plan.id;
      const selectedItemId = plan.items.find((item: any) => item.wellNo === 'A-1').id;

      const url = `http://127.0.0.1:${port}/api/injection-selection/plans/${planId}/reference?wellNo=A-1`;
      const success = await fetch(url);
      assert.equal(success.status, 200);
      const body = await success.json() as any;
      assert.equal(body.data.wellNo, 'A-1');
      assert.equal(body.data.cycles[0].points.find((point: any) => point.day === 10).oil, 12.5);

      const exclude = await fetch(`http://127.0.0.1:${port}/api/injection-selection/plans/${planId}/items/${selectedItemId}`, {
        method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ decision: 'excluded' }),
      });
      assert.equal(exclude.status, 200);
      assert.equal((await fetch(url)).status, 404);
      const lock = await fetch(`http://127.0.0.1:${port}/api/injection-selection/plans/${planId}/items/${selectedItemId}`, {
        method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ decision: 'locked' }),
      });
      assert.equal(lock.status, 200);
      assert.equal((await fetch(url)).status, 200);

      assert.equal((await fetch(`http://127.0.0.1:${port}/api/injection-selection/plans/${planId}/reference?wellNo=not-in-plan`)).status, 404);
      assert.equal((await fetch(`http://127.0.0.1:${port}/api/injection-selection/plans/0/reference?wellNo=A-1`)).status, 400);
      assert.equal((await fetch(`http://127.0.0.1:${port}/api/injection-selection/plans/${planId}/reference?wellNo=`)).status, 400);

      await db.run('DELETE FROM production');
      const missing = await fetch(url);
      assert.equal(missing.status, 200);
      const missingBody = await missing.json() as any;
      assert.ok(missingBody.data.missingReasons.some((reason: string) => reason.includes('缺少生产日报日产油数据')));
    } finally {
      await db.close();
    }
  } finally {
    try {
      if (child.exitCode === null && child.signalCode === null) child.kill();
      await exitPromise;
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  }
});
