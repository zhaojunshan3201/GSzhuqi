import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { open } from 'sqlite';
import sqlite3 from 'sqlite3';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import * as XLSX from 'xlsx';

test('serves aggregated report windows, exact daily data, strict dates, and parseable xlsx sheets', { timeout: 30000 }, async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'operation-reports-api-')); const dbFile = path.join(directory, 'test.db'); const port = 39500 + Math.floor(Math.random() * 300);
  const child = spawn(process.execPath, ['--import', 'tsx', 'server.ts'], { cwd: process.cwd(), env: { ...process.env, PORT: String(port), LOCAL_ONLY: 'true', NODE_ENV: 'production', LOCAL_DB_FILE: dbFile, AUTH_TOKEN_SECRET: 'operation-report-test-secret' }, stdio: ['ignore', 'pipe', 'pipe'] });
  try {
    await new Promise<void>((resolve, reject) => { const timer = setTimeout(() => reject(new Error('server did not start')), 15000); child.stdout!.on('data', (data) => { if (String(data).includes('Server running')) { clearTimeout(timer); resolve(); } }); child.once('exit', (code) => reject(new Error(`server exited ${code}`))); });
    const db = await open({ filename: dbFile, driver: sqlite3.Database });
    await db.run("INSERT INTO production (jh, rq, oil, liquid, water_cut, block) VALUES ('A-1', '2026-07-20', 10, 20, 0.5, 'A\u533a'), ('A-2', '2026-07-20', 5, 10, 0.4, 'A\u533a'), ('A-1', '2026-07-19', 7, 14, 0.5, 'A\u533a'), ('A-1', '2026-06-01', 100, 200, 0.5, 'A\u533a')");
    await db.close();
    const request = (path: string) => fetch(`http://127.0.0.1:${port}${path}`);
    const daily = await request('/api/injection-operation-reports?type=daily&date=2026-07-20&block=A%E5%8C%BA');
    assert.equal(daily.status, 200);
    const dailyBody = await daily.json() as any;
    assert.equal(dailyBody.data.summary.find((item: any) => item.label === '\u5f53\u65e5\u6cb9\u91cf').value, 15);
    assert.deepEqual(dailyBody.data.trend.map((item: any) => item.date), ['2026-07-20']);
    const weekly = await request('/api/injection-operation-reports?type=weekly&date=2026-07-20&block=A%E5%8C%BA');
    const weeklyBody = await weekly.json() as any;
    assert.equal(weeklyBody.data.summary.find((item: any) => item.label === '\u5468\u671f\u6cb9\u91cf').value, 22);
    assert.deepEqual(weeklyBody.data.trend.map((item: any) => item.date), ['2026-07-19', '2026-07-20']);
    assert.ok(weeklyBody.data.missingData.some((item: string) => item.includes('\u8986\u76d6\u4e0d\u5168')));
    const emptyDaily = await request('/api/injection-operation-reports?type=daily&date=2026-07-18&block=A%E5%8C%BA');
    const emptyBody = await emptyDaily.json() as any;
    assert.equal(emptyBody.data.summary.find((item: any) => item.label === '\u5f53\u65e5\u6cb9\u91cf').value, null);
    assert.ok(emptyBody.data.missingData.some((item: string) => item.includes('\u751f\u4ea7\u65e5\u62a5')));
    assert.equal((await request('/api/injection-operation-reports?date=2026-02-31')).status, 400);
    const xlsx = await request('/api/injection-operation-reports.xlsx?type=daily&date=2026-07-20&block=A%E5%8C%BA');
    assert.equal(xlsx.status, 200);
    const workbook = XLSX.read(Buffer.from(await xlsx.arrayBuffer()), { type: 'buffer' });
    assert.deepEqual(workbook.SheetNames, ['\u6458\u8981', '\u660e\u7ec6', '\u8d8b\u52bf', '\u63a8\u8350\u65b9\u6848']);
  } finally { child.kill(); await new Promise<void>((resolve) => child.once('exit', () => resolve())); await rm(directory, { recursive: true, force: true }); }
});
