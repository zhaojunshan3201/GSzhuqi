import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
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
