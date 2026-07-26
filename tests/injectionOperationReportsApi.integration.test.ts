import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

test('serves truthful operation reports and four-sheet xlsx exports', { timeout: 30000 }, async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'operation-reports-api-')); const dbFile = path.join(directory, 'test.db'); const port = 39500 + Math.floor(Math.random() * 300);
  const child = spawn(process.execPath, ['--import', 'tsx', 'server.ts'], { cwd: process.cwd(), env: { ...process.env, PORT: String(port), LOCAL_ONLY: 'true', NODE_ENV: 'production', LOCAL_DB_FILE: dbFile, AUTH_TOKEN_SECRET: 'operation-report-test-secret' }, stdio: ['ignore', 'pipe', 'pipe'] });
  try {
    await new Promise<void>((resolve, reject) => { const timer = setTimeout(() => reject(new Error('server did not start')), 15000); child.stdout!.on('data', (data) => { if (String(data).includes('Server running')) { clearTimeout(timer); resolve(); } }); child.once('exit', (code) => reject(new Error(`server exited ${code}`))); });
    const response = await fetch(`http://127.0.0.1:${port}/api/injection-operation-reports?type=weekly&date=2026-07-20&block=A区`);
    assert.equal(response.status, 200);
    const body = await response.json() as any;
    assert.equal(body.data.title, '注汽运行周报');
    assert.equal(body.data.filter.block, 'A区');
    assert.ok(body.data.missingData.some((item: string) => item.includes('生产日报')));
    const xlsx = await fetch(`http://127.0.0.1:${port}/api/injection-operation-reports.xlsx?type=daily&date=2026-07-20`);
    assert.equal(xlsx.status, 200);
    assert.match(xlsx.headers.get('content-disposition') ?? '', /xlsx/);
  } finally { child.kill(); await new Promise<void>((resolve) => child.once('exit', () => resolve())); await rm(directory, { recursive: true, force: true }); }
});

