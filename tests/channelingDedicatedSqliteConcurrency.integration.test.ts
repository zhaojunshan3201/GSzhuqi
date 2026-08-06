import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import sqlite3 from 'sqlite3';
import { open } from 'sqlite';

async function stopServer(child: ReturnType<typeof spawn>): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return;
  await new Promise<void>((resolve) => {
    const timeout = setTimeout(resolve, 2000); timeout.unref();
    child.once('exit', () => { clearTimeout(timeout); resolve(); });
    child.kill();
  });
}

async function waitForFile(file: string): Promise<void> {
  if (fs.existsSync(file)) return;
  await new Promise<void>((resolve, reject) => {
    const watcher = fs.watch(path.dirname(file), (_event, fileName) => {
      if (String(fileName) === path.basename(file) && fs.existsSync(file)) {
        clearTimeout(timeout);
        watcher.close();
        resolve();
      }
    });
    const timeout = setTimeout(() => {
      watcher.close();
      reject(new Error(`transaction signal was not created: ${file}`));
    }, 5000);
    if (fs.existsSync(file)) {
      clearTimeout(timeout);
      watcher.close();
      resolve();
    }
  });
}

test('dedicated channeling transactions wait alongside local writes and preserve rollback boundaries', { timeout: 30000 }, async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'channeling-sqlite-concurrency-'));
  const databaseFile = path.join(directory, 'test.db');
  const pauseFile = path.join(directory, 'transaction.pause');
  const port = 40000 + Math.floor(Math.random() * 1000);
  const child = spawn(process.execPath, ['--import', 'tsx', 'server.ts'], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      PORT: String(port),
      LOCAL_ONLY: 'true',
      NODE_ENV: 'production',
      LOCAL_DB_FILE: databaseFile,
      AUTH_TOKEN_SECRET: 'channeling-sqlite-concurrency-secret',
      CHANNELING_TEST_FORCE_ERROR: '1',
      CHANNELING_TEST_TRANSACTION_PAUSE_FILE: pauseFile,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let db: Awaited<ReturnType<typeof open>> | undefined;
  try {
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('server did not start')), 15000);
      child.stdout.on('data', (data) => { if (String(data).includes('Server running')) { clearTimeout(timeout); resolve(); } });
      child.once('error', reject);
      child.once('exit', (code) => reject(new Error(`server exited ${code}`)));
    });
    const request = (url: string, init?: RequestInit) => fetch(`http://127.0.0.1:${port}${url}`, {
      ...init,
      headers: { 'content-type': 'application/json', ...(init?.headers || {}) },
    });
    const login = await request('/api/login', { method: 'POST', body: JSON.stringify({ username: 'admin', password: '123456' }) });
    const admin = { authorization: `Bearer ${(await login.json() as any).token}` };
    const createProject = async (name: string) => request('/api/channeling-projects', {
      method: 'POST', headers: admin, body: JSON.stringify({ projectName: name, block: 'A', owner: 'owner' }),
    });
    const projectResponse = await createProject('transaction target');
    const project = (await projectResponse.json() as any).data;
    const relationResponse = await request(`/api/channeling-projects/${project.id}/relations`, {
      method: 'POST', headers: admin, body: JSON.stringify({
        channelingType: 'steam', injectionWell: 'I-LOCK', productionWell: 'P-LOCK', reservoirLayer: 'S1',
        impactLevel: 'high', confidence: 0.9, status: 'confirmed', source: 'manual', evidence: 'field',
        effectiveStartDate: '2026-01-01', effectiveEndDate: '2026-12-31', owner: 'owner',
      }),
    });
    const relation = (await relationResponse.json() as any).data;
    db = await open({ filename: databaseFile, driver: sqlite3.Database });

    const runPaused = async (kind: string, operation: Promise<Response>, concurrentProjectName: string) => {
      await waitForFile(`${pauseFile}.${kind}.ready`);
      let concurrentSettled = false;
      const concurrentWrite = createProject(concurrentProjectName).finally(() => { concurrentSettled = true; });
      await new Promise<void>((resolve) => setImmediate(resolve));
      assert.equal(concurrentSettled, false, `${kind} must keep the second write waiting while its transaction owns the lock`);
      await rm(pauseFile, { force: true });
      const [operationResponse, concurrentResponse] = await Promise.all([operation, concurrentWrite]);
      assert.equal(concurrentResponse.status, 201, `${kind} must let the waiting local write succeed`);
      return operationResponse;
    };

    const evaluatedBefore = (await db.get("SELECT COUNT(*) AS count FROM channeling_tracking_events WHERE event_type = 'evaluated'")).count;
    await writeFile(pauseFile, 'pause');
    const relationEvaluation = request(`/api/channeling-relations/${relation.id}/evaluations`, {
      method: 'POST',
      headers: { ...admin, 'x-channeling-pause-transaction': 'relation-evaluation', 'x-channeling-force-evaluation-after-event': '1' },
      body: JSON.stringify({ occurredOn: '2026-01-02', conclusion: 'relation rollback', owner: 'owner', range: { beforeStart: '2026-01-01', splitDate: '2026-01-02', afterEnd: '2026-01-03' } }),
    });
    assert.equal((await runPaused('relation-evaluation', relationEvaluation, 'after relation evaluation')).status, 500);
    assert.equal((await db.get("SELECT COUNT(*) AS count FROM channeling_tracking_events WHERE event_type = 'evaluated'")).count, evaluatedBefore);

    await db.exec(`CREATE TRIGGER fail_project_evaluation BEFORE INSERT ON channeling_tracking_events
      WHEN NEW.content = 'project rollback' BEGIN SELECT RAISE(ABORT, 'forced project evaluation rollback'); END;`);
    await writeFile(pauseFile, 'pause');
    const projectEvaluation = request(`/api/channeling-projects/${project.id}/evaluations`, {
      method: 'POST', headers: { ...admin, 'x-channeling-pause-transaction': 'project-evaluation' },
      body: JSON.stringify({ occurredOn: '2026-01-02', conclusion: 'project rollback', owner: 'owner', range: { start: '2026-01-01', end: '2026-01-03' } }),
    });
    assert.equal((await runPaused('project-evaluation', projectEvaluation, 'after project evaluation')).status, 500);
    assert.equal((await db.get("SELECT COUNT(*) AS count FROM channeling_tracking_events WHERE content = 'project rollback'")).count, 0);
    await db.exec('DROP TRIGGER fail_project_evaluation');

    const preview = await db.run("INSERT INTO channeling_relation_imports (project_id, file_name, channeling_type, status, valid_count, duplicate_count, self_relation_count, invalid_count, created_at) VALUES (NULL, 'locked.xlsx', 'steam', 'preview', 1, 0, 0, 0, '2026-01-01')");
    await db.run("INSERT INTO channeling_relation_import_rows (import_id, row_class, row_number, snapshot_json) VALUES (?, 'valid', 2, ?)", [preview.lastID, JSON.stringify({ rowNumber: 2, injectorWellNo: 'FAIL-IMPORT', producerWellNo: 'P-IMPORT', channelingType: 'steam' })]);
    await db.exec(`CREATE TRIGGER fail_import_confirmation BEFORE INSERT ON channeling_relations
      WHEN NEW.injection_well = 'FAIL-IMPORT' BEGIN SELECT RAISE(ABORT, 'forced import confirmation rollback'); END;`);
    await writeFile(pauseFile, 'pause');
    const importConfirmation = request(`/api/channeling-relation-imports/${preview.lastID}/confirm`, {
      method: 'POST', headers: { ...admin, 'x-channeling-pause-transaction': 'import-confirmation' }, body: JSON.stringify({ projectId: project.id }),
    });
    assert.equal((await runPaused('import-confirmation', importConfirmation, 'after import confirmation')).status, 500);
    assert.equal((await db.get('SELECT status FROM channeling_relation_imports WHERE id = ?', [preview.lastID])).status, 'preview');
    assert.equal((await db.get("SELECT COUNT(*) AS count FROM channeling_relations WHERE injection_well = 'FAIL-IMPORT'")).count, 0);
  } finally {
    await db?.close();
    await stopServer(child);
    await rm(directory, { recursive: true, force: true });
  }
});
