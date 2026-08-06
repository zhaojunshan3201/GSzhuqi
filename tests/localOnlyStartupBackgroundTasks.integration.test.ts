import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import sqlite3 from 'sqlite3';
import { open } from 'sqlite';

async function availablePort() {
  const server = createServer();
  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const address = server.address(); assert.ok(address && typeof address !== 'string');
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  return address.port;
}

test('LOCAL_ONLY readiness starts no later background SQLite writers', { timeout: 30_000 }, async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'local-only-startup-'));
  const dbFile = path.join(directory, 'test.db'); const port = await availablePort();
  const child = spawn(process.execPath, ['--import', 'tsx', 'server.ts'], {
    cwd: process.cwd(), env: { ...process.env, PORT: String(port), LOCAL_ONLY: 'true', NODE_ENV: 'production', LOCAL_DB_FILE: dbFile, AUTH_TOKEN_SECRET: 'local-only-startup-secret' }, stdio: ['ignore', 'pipe', 'pipe'],
  });
  const exited = new Promise<void>((resolve) => { child.once('exit', () => resolve()); child.once('error', () => resolve()); });
  try {
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('server did not start')), 15_000);
      child.stdout?.on('data', (chunk: Buffer) => { if (String(chunk).includes('Server running')) { clearTimeout(timer); resolve(); } });
      child.once('exit', () => { clearTimeout(timer); reject(new Error('server exited before readiness')); }); child.once('error', reject);
    });
    await new Promise((resolve) => setTimeout(resolve, 800));
    const db = await open({ filename: dbFile, driver: sqlite3.Database });
    try {
      assert.equal((await db.get('SELECT COUNT(*) AS count FROM homepage_cache')).count, 0);
      assert.equal((await db.get("SELECT COUNT(*) AS count FROM sync_meta WHERE key IN ('water_cut_formula_version', 'gas_formula_version')")).count, 0);
    } finally { await db.close(); }
  } finally {
    if (child.exitCode === null && child.signalCode === null) child.kill(); await exited;
    await rm(directory, { recursive: true, force: true });
  }
});
