import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { spawn } from 'node:child_process';
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

test('channeling tracking, well, and metric APIs enforce their HTTP contracts', { timeout: 30000 }, async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'channeling-tracking-api-'));
  const databaseFile = path.join(directory, 'test.db');
  const secret = 'channeling-tracking-integration-secret';
  const port = 39000 + Math.floor(Math.random() * 1000);
  const child = spawn(process.execPath, ['--import', 'tsx', 'server.ts'], {
    cwd: process.cwd(),
    env: { ...process.env, PORT: String(port), LOCAL_ONLY: 'true', NODE_ENV: 'production', LOCAL_DB_FILE: databaseFile, AUTH_TOKEN_SECRET: secret },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let db: Awaited<ReturnType<typeof open>> | undefined;
  try {
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('server did not start')), 15000);
      child.stdout.on('data', (data) => { if (String(data).includes('Server running')) { clearTimeout(timer); resolve(); } });
      child.once('error', reject);
      child.once('exit', (code) => reject(new Error(`server exited ${code}`)));
    });
    const request = (url: string, init?: RequestInit) => fetch(`http://127.0.0.1:${port}${url}`, {
      ...init,
      headers: { 'content-type': 'application/json', ...(init?.headers || {}) },
    });
    const json = async (response: Response) => (await response.json() as any).data;
    const login = await request('/api/login', { method: 'POST', body: JSON.stringify({ username: 'admin', password: '123456' }) });
    const admin = { authorization: `Bearer ${(await login.json() as any).token}` };
    const userPayload = Buffer.from(JSON.stringify({ username: 'ordinary', role: 'user' })).toString('base64url');
    const userToken = `${userPayload}.${createHmac('sha256', secret).update(userPayload).digest('base64url')}`;
    const ordinary = { authorization: `Bearer ${userToken}` };

    db = await open({ filename: databaseFile, driver: sqlite3.Database });
    const indexes = await db.all("SELECT name, sql FROM sqlite_master WHERE type='index' AND name LIKE 'idx_%normalized_well%'");
    assert.deepEqual(indexes.map((row) => row.name).sort(), [
      'idx_channeling_relations_injection_normalized_well',
      'idx_channeling_relations_production_normalized_well',
      'idx_injection_stage_normalized_well_date',
      'idx_production_normalized_well_date',
    ]);
    assert.ok(indexes.every((row) => /UPPER\s*\(\s*TRIM\s*\(/i.test(row.sql)));

    assert.equal((await request('/api/channeling-wells', { method: 'POST', body: '{}' })).status, 401);
    assert.equal((await request('/api/channeling-wells', { method: 'POST', headers: ordinary, body: JSON.stringify({ wellNo: 'I-1' }) })).status, 403);
    assert.equal((await request('/api/channeling-wells', { method: 'POST', headers: admin, body: JSON.stringify({ wellNo: 'I-1', block: [] }) })).status, 400);
    assert.equal((await request('/api/channeling-wells?block=A&block=B')).status, 400);
    assert.equal((await request('/api/channeling-tracking-events', { method: 'POST', headers: ordinary, body: '{}' })).status, 403);

    const projectResponse = await request('/api/channeling-projects', { method: 'POST', headers: admin, body: JSON.stringify({ projectName: 'Tracking project', block: 'A', owner: 'owner' }) });
    assert.equal(projectResponse.status, 201);
    const project = await json(projectResponse);
    const relationBody = { injectionWell: ' I-1 ', productionWell: 'p-1', reservoirLayer: 'S1', impactLevel: 'high', confidence: 0.9, status: 'confirmed', source: 'manual', evidence: 'field', effectiveStartDate: '2026-01-01', effectiveEndDate: '2026-12-31', owner: 'owner' };
    const relationResponse = await request(`/api/channeling-projects/${project.id}/relations`, { method: 'POST', headers: admin, body: JSON.stringify(relationBody) });
    assert.equal(relationResponse.status, 201);
    const relation = await json(relationResponse);

    const injectorResponse = await request('/api/channeling-wells', { method: 'POST', headers: admin, body: JSON.stringify({ wellNo: 'i-1', block: 'A', owner: 'alice' }) });
    assert.equal(injectorResponse.status, 201);
    const injector = await json(injectorResponse);
    const duplicateResponse = await request('/api/channeling-wells', { method: 'POST', headers: admin, body: JSON.stringify({ wellNo: ' I-1 ', block: 'ignored' }) });
    assert.equal(duplicateResponse.status, 201);
    assert.equal((await json(duplicateResponse)).id, injector.id);
    const producerResponse = await request('/api/channeling-wells', { method: 'POST', headers: admin, body: JSON.stringify({ wellNo: 'P-1', block: 'A', owner: 'bob' }) });
    const producer = await json(producerResponse);

    await db.run("INSERT INTO production (jh, rq, liquid, oil, water_cut, block) VALUES (' p-1 ', '2026-01-01', 20, 10, .5, 'A'), ('P-1', '2026-01-02', 30, 15, .5, 'A'), ('P-1', '2026-01-03', 40, 20, .5, 'A')");
    const stageImport = await db.run("INSERT INTO injection_selection_imports (source_type, source_file, imported_at, row_count, skipped_row_count, error_messages_json) VALUES ('stage', 'fixture.xlsx', '2026-01-01T00:00:00.000Z', 1, 0, '[]')");
    await db.run("INSERT INTO injection_stage_rows (import_id, well_no, cycle_no, start_date, end_date, steam_volume, temperature, pressure, dryness, production_hours, raw_json) VALUES (?, ' i-1 ', 1, '2026-01-01', '2026-01-03', 100, 250, 12, .7, 48, '{}')", [stageImport.lastID]);

    const wells = await request('/api/channeling-wells?query=i-1&block=A');
    assert.equal(wells.status, 200); assert.equal((await json(wells)).length, 1);
    assert.equal((await request(`/api/channeling-wells/${injector.id}`)).status, 200);
    const related = await json(await request(`/api/channeling-wells/${injector.id}/relations`));
    assert.equal(related.length, 1); assert.equal(related[0].project.id, project.id); assert.equal(related[0].project.name, 'Tracking project');

    assert.equal((await request(`/api/channeling-wells/${injector.id}`, { method: 'PATCH', headers: ordinary, body: '{}' })).status, 403);
    assert.equal((await request(`/api/channeling-wells/${injector.id}`, { method: 'PATCH', headers: admin, body: JSON.stringify({ block: 'B' }) })).status, 400);
    assert.equal((await request(`/api/channeling-wells/${injector.id}`, { method: 'PATCH', headers: admin, body: JSON.stringify({ block: 'B', owner: 'alice', updatedAt: injector.updatedAt, extra: true }) })).status, 400);
    const updatedResponse = await request(`/api/channeling-wells/${injector.id}`, { method: 'PATCH', headers: admin, body: JSON.stringify({ block: 'B', owner: 'alice2', updatedAt: injector.updatedAt }) });
    assert.equal(updatedResponse.status, 200); assert.equal((await json(updatedResponse)).block, 'B');
    assert.equal((await request(`/api/channeling-wells/${injector.id}`, { method: 'PATCH', headers: admin, body: JSON.stringify({ block: 'C', owner: 'alice', updatedAt: '2000-01-01T00:00:00.000Z' }) })).status, 409);

    const wellMetrics = await json(await request(`/api/channeling-wells/${producer.id}/metrics?start=2026-01-01&end=2026-01-03`));
    assert.equal(wellMetrics.production.oil.average, 15);
    const summary = await json(await request(`/api/channeling-projects/${project.id}/summary?start=2026-01-01&end=2026-01-03`));
    assert.equal(summary.relationCount, 1); assert.equal(summary.cumulativeSteam, 100); assert.equal(summary.latestTotalOil, 20);
    const detail = await json(await request(`/api/channeling-relations/${relation.id}/detail?beforeStart=2026-01-01&splitDate=2026-01-02&afterEnd=2026-01-03`));
    assert.equal(detail.comparison.oil.beforeAverage, 12.5); assert.equal(detail.comparison.oil.afterAverage, 20);

    for (const url of [
      `/api/channeling-wells/${producer.id}/metrics`,
      `/api/channeling-wells/${producer.id}/metrics?start=2026-01-01&start=2026-01-02&end=2026-01-03`,
      `/api/channeling-projects/${project.id}/summary?start=no&end=2026-01-03`,
      `/api/channeling-relations/${relation.id}/detail?beforeStart=2026-01-02&splitDate=2026-01-02&afterEnd=2026-01-02`,
      '/api/channeling-wells/no',
      '/api/channeling-wells/9007199254740992',
      '/api/channeling-tracking-events?subjectType=project&subjectType=well&subjectId=1',
      '/api/channeling-tracking-events?subjectType=bad&subjectId=1',
    ]) assert.equal((await request(url)).status, 400, url);
    for (const url of ['/api/channeling-wells/99999', '/api/channeling-wells/99999/metrics?start=2026-01-01&end=2026-01-03', '/api/channeling-projects/99999/summary?start=2026-01-01&end=2026-01-03', '/api/channeling-relations/99999/detail?beforeStart=2026-01-01&splitDate=2026-01-02&afterEnd=2026-01-03']) assert.equal((await request(url)).status, 404, url);

    const eventResponse = await request('/api/channeling-tracking-events', { method: 'POST', headers: admin, body: JSON.stringify({ eventType: 'discovered', occurredOn: '2026-01-01', content: 'found', owner: 'alice', createdBy: 'attacker', links: [{ subjectType: 'project', subjectId: project.id }] }) });
    assert.equal(eventResponse.status, 201);
    const event = await json(eventResponse); assert.equal(event.createdBy, 'admin');
    const events = await json(await request(`/api/channeling-tracking-events?subjectType=project&subjectId=${project.id}`));
    assert.equal(events[0].id, event.id);
    const correctionResponse = await request(`/api/channeling-tracking-events/${event.id}/corrections`, { method: 'POST', headers: admin, body: JSON.stringify({ reason: 'wrong wording', occurredOn: '2026-01-02', content: 'corrected', evidence: '', owner: 'alice', createdBy: 'attacker' }) });
    assert.equal(correctionResponse.status, 201); assert.equal((await json(correctionResponse)).createdBy, 'admin');
    assert.equal((await request(`/api/channeling-tracking-events/${event.id}/corrections`, { method: 'POST', headers: admin, body: JSON.stringify({ reason: 'again', occurredOn: '2026-01-02', content: 'again', owner: 'alice' }) })).status, 409);

    const evaluationResponse = await request(`/api/channeling-relations/${relation.id}/evaluations`, { method: 'POST', headers: admin, body: JSON.stringify({ occurredOn: '2026-01-03', conclusion: 'effective', evidence: 'metrics', owner: 'alice', range: { beforeStart: '2026-01-01', splitDate: '2026-01-02', afterEnd: '2026-01-03' } }) });
    assert.equal(evaluationResponse.status, 201);
    const evaluation = await json(evaluationResponse);
    assert.equal(evaluation.eventType, 'evaluated'); assert.equal(evaluation.createdBy, 'admin');
    assert.equal(evaluation.metricsSnapshot.comparison.oil.afterAverage, 20);
    assert.deepEqual(evaluation.links, [{ subjectType: 'project', subjectId: project.id }, { subjectType: 'relation', subjectId: relation.id }, { subjectType: 'well', subjectId: injector.id }, { subjectType: 'well', subjectId: producer.id }]);

    const missingRelationResponse = await request(`/api/channeling-projects/${project.id}/relations`, { method: 'POST', headers: admin, body: JSON.stringify({ ...relationBody, injectionWell: 'missing-i', productionWell: 'missing-p' }) });
    const missingRelation = await json(missingRelationResponse);
    assert.equal((await request(`/api/channeling-relations/${missingRelation.id}/evaluations`, { method: 'POST', headers: admin, body: JSON.stringify({ occurredOn: '2026-01-03', conclusion: 'x', owner: 'alice', range: { beforeStart: '2026-01-01', splitDate: '2026-01-02', afterEnd: '2026-01-03' } }) })).status, 404);
    assert.equal((await request(`/api/channeling-relations/${relation.id}/evaluations`, { method: 'POST', headers: admin, body: JSON.stringify({ occurredOn: '2026-01-03', conclusion: '', owner: 'alice', range: { beforeStart: '2026-01-01', splitDate: '2026-01-02', afterEnd: '2026-01-03' } }) })).status, 400);
  } finally {
    await db?.close();
    await stopServer(child);
    await rm(directory, { recursive: true, force: true });
  }
});
