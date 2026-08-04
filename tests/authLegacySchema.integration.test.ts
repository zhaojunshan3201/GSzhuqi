import assert from 'node:assert/strict';
import { spawn, type SpawnOptionsWithStdioTuple } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import sqlite3 from 'sqlite3';
import { open } from 'sqlite';

async function stopServer(child: ReturnType<typeof spawn>): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return;
  await new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, 2000); timer.unref();
    child.once('exit', () => { clearTimeout(timer); resolve(); });
    child.kill();
  });
}

test('adds the missing users.name column before migrating the legacy admin', { timeout: 30000 }, async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'legacy-users-schema-'));
  const databasePath = path.join(directory, 'test.db');
  const seedDb = await open({ filename: databasePath, driver: sqlite3.Database });
  await seedDb.exec("CREATE TABLE users (id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT UNIQUE, password TEXT, role TEXT DEFAULT 'user', created_at DATETIME DEFAULT CURRENT_TIMESTAMP)");
  await seedDb.run("INSERT INTO users (username, password, role) VALUES (?, ?, ?)", ['admin', '123456', 'admin']);
  await seedDb.close();

  const port = 39000 + Math.floor(Math.random() * 1000);
  const options: SpawnOptionsWithStdioTuple<'ignore', 'pipe', 'pipe'> = {
    cwd: process.cwd(),
    env: { ...process.env, PORT: String(port), LOCAL_ONLY: 'true', NODE_ENV: 'production', LOCAL_DB_FILE: databasePath, AUTH_TOKEN_SECRET: 'legacy-schema-test-secret' },
    stdio: ['ignore', 'pipe', 'pipe'],
  };
  const child = spawn(process.execPath, ['--import', 'tsx', 'server.ts'], options);
  let stderr = '';
  child.stderr.on('data', (data) => { stderr += String(data); });
  try {
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`server did not start: ${stderr}`)), 15000);
      child.stdout.on('data', (data) => { if (String(data).includes('Server running')) { clearTimeout(timer); resolve(); } });
      child.once('error', reject);
      child.once('exit', (code) => reject(new Error(`server exited ${code}: ${stderr}`)));
    });
    const response = await fetch(`http://127.0.0.1:${port}/api/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: 'admin', password: '123456' }) });
    assert.equal(response.status, 200);
    assert.equal((await response.json() as any).user.name, '系统管理员');
  } finally {
    await stopServer(child);
  }

  const verifyDb = await open({ filename: databasePath, driver: sqlite3.Database });
  try {
    assert.ok(await verifyDb.get("SELECT name FROM pragma_table_info('users') WHERE name = 'name'"));
    assert.equal((await verifyDb.get("SELECT name FROM users WHERE username = 'admin'")).name, '系统管理员');
  } finally {
    await verifyDb.close();
    await rm(directory, { recursive: true, force: true });
  }
});
