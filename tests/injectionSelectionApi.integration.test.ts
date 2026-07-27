import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

test('exposes injection-selection status and rejects a malformed plan month', { timeout: 30000 }, async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'injection-selection-api-'));
  const dbFile = path.join(directory, 'test.db');
  const port = 39500 + Math.floor(Math.random() * 400);
  const child = spawn(process.execPath, ['--import', 'tsx', 'server.ts'], {
    cwd: process.cwd(),
    env: { ...process.env, PORT: String(port), LOCAL_ONLY: 'true', NODE_ENV: 'production', LOCAL_DB_FILE: dbFile, AUTH_TOKEN_SECRET: 'injection-selection-test-secret' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  try {
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('server did not start')), 15000);
      child.stdout!.on('data', (data) => {
        if (String(data).includes('Server running')) { clearTimeout(timer); resolve(); }
      });
      child.once('exit', (code) => reject(new Error(`server exited ${code}`)));
    });
    const status = await fetch(`http://127.0.0.1:${port}/api/injection-selection/data-status`);
    assert.equal(status.status, 200);
    assert.deepEqual((await status.json() as any).data.sources, []);
    const invalidPlan = await fetch(`http://127.0.0.1:${port}/api/injection-selection/plans`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ month: '2026-13' }),
    });
    assert.equal(invalidPlan.status, 400);
  } finally {
    child.kill();
    await new Promise<void>((resolve) => child.once('exit', () => resolve()));
    await rm(directory, { recursive: true, force: true });
  }
});
