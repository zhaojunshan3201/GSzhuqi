import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { createServer } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import sqlite3 from 'sqlite3';
import { open } from 'sqlite';

const northBlock = '3624\u5757(\u5317)L5';
const southBlock = ' 3624\u5757\uff08\u5357\uff09L6 ';
const chartBlock = '\u9ad83624';

async function availablePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  assert(address && typeof address !== 'string');
  await new Promise<void>((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  });
  return address.port;
}

async function seedChartDatabase(dbFile: string) {
  const db = await open({ filename: dbFile, driver: sqlite3.Database });
  try {
    await db.exec(`
      CREATE TABLE production (
        jh TEXT, rq TEXT, liquid REAL, oil REAL, diluent REAL, water_cut REAL,
        gas REAL, station TEXT, block TEXT, remark TEXT,
        UNIQUE(jh, rq) ON CONFLICT REPLACE
      );
      CREATE TABLE dashboard_summary_daily (
        rq TEXT NOT NULL, scope_type TEXT NOT NULL, scope_value TEXT NOT NULL,
        liquid REAL NOT NULL DEFAULT 0, oil REAL NOT NULL DEFAULT 0,
        diluent REAL NOT NULL DEFAULT 0, water_cut REAL NOT NULL DEFAULT 0,
        gas REAL NOT NULL DEFAULT 0, well_count INTEGER NOT NULL DEFAULT 0,
        abnormal_well_count INTEGER NOT NULL DEFAULT 0,
        UNIQUE(rq, scope_type, scope_value) ON CONFLICT REPLACE
      );
      CREATE TABLE sync_meta (key TEXT PRIMARY KEY, value TEXT);
    `);
    await db.run(
      `INSERT INTO sync_meta (key, value) VALUES
        ('water_cut_formula_version', '2026-04-14-v4'),
        ('gas_formula_version', '2026-04-14-v2')`,
    );
    for (const row of [
      ['N-1', 60, 15, 5, 3, northBlock],
      ['N-2', 60, 10, 5, 5, northBlock],
      ['S-1', 80, 30, 0, 7, southBlock],
    ]) {
      await db.run(
        `INSERT INTO production
          (jh, rq, liquid, oil, diluent, water_cut, gas, station, block, remark)
         VALUES (?, '2026-07-01', ?, ?, ?, 0, ?, 'station', ?, '')`,
        row,
      );
    }
    for (const row of [
      [northBlock, 120, 25, 10, 8],
      [southBlock, 80, 30, 0, 7],
    ]) {
      await db.run(
        `INSERT INTO dashboard_summary_daily
          (rq, scope_type, scope_value, liquid, oil, diluent, water_cut, gas)
         VALUES ('2026-07-01', 'block', ?, ?, ?, ?, 0, ?)`,
        row,
      );
    }
  } finally {
    await db.close();
  }
}

function assertAggregatedChart(data: any) {
  assert.deepEqual(data, {
    dates: ['2026-07-01'],
    liquid: [200],
    oil: [55],
    diluent: [10],
    water_cut: [67.5],
    gas: [15],
  });
}

test('block chart uses exact raw SQLite blocks for summary and production fallback', { timeout: 30000 }, async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'block-production-chart-'));
  const dbFile = path.join(directory, 'test.db');
  const port = await availablePort();
  await seedChartDatabase(dbFile);

  const child = spawn(process.execPath, ['--import', 'tsx', 'server.ts'], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      PORT: String(port),
      LOCAL_ONLY: 'true',
      NODE_ENV: 'production',
      LOCAL_DB_FILE: dbFile,
      AUTH_TOKEN_SECRET: 'block-production-chart-test-secret',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const output: string[] = [];
  child.stdout?.on('data', (data) => output.push(String(data)));
  child.stderr?.on('data', (data) => output.push(String(data)));
  const exitPromise = new Promise<void>((resolve) => {
    child.once('exit', () => resolve());
    child.once('error', () => resolve());
  });

  try {
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error(`server did not start\n${output.join('')}`)),
        15000,
      );
      const onData = (data: Buffer) => {
        if (!String(data).includes('Server running')) return;
        clearTimeout(timer);
        child.stdout?.off('data', onData);
        resolve();
      };
      child.stdout?.on('data', onData);
      child.once('exit', (code) => {
        clearTimeout(timer);
        reject(new Error(`server exited ${code}\n${output.join('')}`));
      });
    });

    const wellsResponse = await fetch(`http://127.0.0.1:${port}/api/wells`);
    assert.equal(wellsResponse.status, 200);
    const wells = (await wellsResponse.json() as any).data;
    assert.equal(wells.find((well: any) => well.jh === 'S-1').block, southBlock);

    const summaryResponse = await fetch(
      `http://127.0.0.1:${port}/api/chart/block?block=${encodeURIComponent(chartBlock)}`,
    );
    assert.equal(summaryResponse.status, 200);
    const summary = await summaryResponse.json() as any;
    assert.equal(summary.dataSource, 'summary');
    assertAggregatedChart(summary.data);

    const db = await open({ filename: dbFile, driver: sqlite3.Database });
    try {
      await db.run(`DELETE FROM dashboard_summary_daily WHERE scope_type = 'block'`);
    } finally {
      await db.close();
    }

    const fallbackParams = new URLSearchParams();
    fallbackParams.append('block', chartBlock);
    fallbackParams.append('block', '__production_fallback__');
    const fallbackResponse = await fetch(
      `http://127.0.0.1:${port}/api/chart/block?${fallbackParams}`,
    );
    assert.equal(fallbackResponse.status, 200);
    const fallback = await fallbackResponse.json() as any;
    assert.equal(fallback.dataSource, 'local_production');
    assertAggregatedChart(fallback.data);
  } finally {
    if (child.exitCode === null && child.signalCode === null) child.kill();
    await exitPromise;
    await rm(directory, { recursive: true, force: true });
  }
});
