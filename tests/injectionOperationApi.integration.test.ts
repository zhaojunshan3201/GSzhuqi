import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { open } from 'sqlite';
import sqlite3 from 'sqlite3';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

test('rejects invalid operation adjustment without writing an audit row', { timeout: 30000 }, async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'operation-api-')); const dbFile = path.join(directory, 'test.db'); const port = 39000 + Math.floor(Math.random() * 500);
  const child = spawn(process.execPath, ['--import', 'tsx', 'server.ts'], { cwd: process.cwd(), env: { ...process.env, PORT: String(port), LOCAL_ONLY: 'true', NODE_ENV: 'production', LOCAL_DB_FILE: dbFile, AUTH_TOKEN_SECRET: 'operation-test-secret' }, stdio: ['ignore', 'pipe', 'pipe'] });
  try {
    await new Promise<void>((resolve, reject) => { const timer = setTimeout(() => reject(new Error('server did not start')), 15000); child.stdout!.on('data', (data) => { if (String(data).includes('Server running')) { clearTimeout(timer); resolve(); } }); child.once('exit', (code) => reject(new Error(`server exited ${code}`))); });
    const request = (url: string, init?: RequestInit) => fetch(`http://127.0.0.1:${port}${url}`, { ...init, headers: { 'content-type': 'application/json', ...(init?.headers || {}) } });
    const login = await request('/api/login', { method: 'POST', body: JSON.stringify({ username: 'admin', password: '123456' }) }); const token = (await login.json() as any).token;
    const forbidden = await request('/api/injection-operation-recommendations/stable/adjustments', { method: 'POST', headers: { authorization: `Bearer ${token}` }, body: JSON.stringify({ reason: 'test', patch: { steamVolume: 1301 } }) });
    assert.equal(forbidden.status, 400);
    const db = await open({ filename: dbFile, driver: sqlite3.Database });
    assert.equal((await db.get('SELECT COUNT(*) AS count FROM injection_operation_adjustment_audits')).count, 0);
    await db.close();
  } finally { child.kill(); await new Promise<void>((resolve) => child.once('exit', () => resolve())); await rm(directory, { recursive: true, force: true }); }
});
