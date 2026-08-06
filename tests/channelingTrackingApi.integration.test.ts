import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { spawn } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
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
  const evaluationPauseFile = path.join(directory, 'evaluation.pause');
  const secret = 'channeling-tracking-integration-secret';
  const port = 39000 + Math.floor(Math.random() * 1000);
  const child = spawn(process.execPath, ['--import', 'tsx', 'server.ts'], {
    cwd: process.cwd(),
    env: { ...process.env, PORT: String(port), LOCAL_ONLY: 'true', NODE_ENV: 'production', LOCAL_DB_FILE: databaseFile, AUTH_TOKEN_SECRET: secret, CHANNELING_TEST_FORCE_ERROR: '1', CHANNELING_TEST_EVALUATION_PAUSE_FILE: evaluationPauseFile },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let db: Awaited<ReturnType<typeof open>> | undefined;
  let concurrencyDb: Awaited<ReturnType<typeof open>> | undefined;
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
    await db.run("INSERT INTO injection_stage_rows (import_id, well_no, cycle_no, start_date, end_date, steam_volume, raw_json) VALUES (?, 'p-1', 2, '2026-01-01', '2026-01-03', 50, '{}')", [stageImport.lastID]);

    const wells = await request('/api/channeling-wells?query=i-1&block=A');
    assert.equal(wells.status, 200); assert.deepEqual((await json(wells))[0].roles, ['injector']);
    const injectorWells = await json(await request('/api/channeling-wells?role=injector'));
    assert.deepEqual(injectorWells.map((well: any) => well.normalizedWellNo).sort(), ['I-1', 'P-1']);
    const producerWells = await json(await request('/api/channeling-wells?role=producer'));
    assert.deepEqual(producerWells.map((well: any) => well.normalizedWellNo), ['P-1']);
    const producerDetail = await json(await request(`/api/channeling-wells/${producer.id}`));
    assert.deepEqual(producerDetail.roles, ['injector', 'producer']);
    assert.equal(producerDetail.relationCount, 1); assert.equal(producerDetail.projectCount, 1);
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
    assert.equal(summary.relationCount, 1); assert.equal(summary.cumulativeSteam, 100);
    assert.deepEqual([summary.initialTotalOil, summary.latestTotalOil, summary.totalOilChange], [10, 20, 10]);
    assert.equal(summary.latestAvailableDate, '2026-01-03');
    const defaultSummary = await json(await request(`/api/channeling-projects/${project.id}/summary`));
    assert.deepEqual(defaultSummary.range, { start: '2025-12-05', end: '2026-01-03' });
    const listedProject = (await json(await request('/api/channeling-projects'))).find((item: any) => item.id === project.id);
    assert.deepEqual({ canDelete: listedProject.canDelete, hasTrackingHistory: listedProject.hasTrackingHistory }, { canDelete: false, hasTrackingHistory: true });
    const listedRelation = (await json(await request(`/api/channeling-projects/${project.id}/relations`))).find((item: any) => item.id === relation.id);
    assert.deepEqual({ canDelete: listedRelation.canDelete, hasTrackingHistory: listedRelation.hasTrackingHistory }, { canDelete: false, hasTrackingHistory: true });
    const detail = await json(await request(`/api/channeling-relations/${relation.id}/detail?beforeStart=2026-01-01&splitDate=2026-01-02&afterEnd=2026-01-03`));
    assert.equal(detail.comparison.oil.beforeAverage, 12.5); assert.equal(detail.comparison.oil.afterAverage, 20);

    for (const url of [
      `/api/channeling-wells/${producer.id}/metrics`,
      `/api/channeling-wells/${producer.id}/metrics?start=2026-01-01&start=2026-01-02&end=2026-01-03`,
      `/api/channeling-projects/${project.id}/summary?start=no&end=2026-01-03`,
      `/api/channeling-projects/${project.id}/summary?start=2026-01-01`,
      `/api/channeling-relations/${relation.id}/detail?beforeStart=2026-01-02&splitDate=2026-01-02&afterEnd=2026-01-02`,
      '/api/channeling-wells/no',
      '/api/channeling-wells/9007199254740992',
      '/api/channeling-wells?role=invalid',
      '/api/channeling-wells?role=injector&role=producer',
      '/api/channeling-tracking-events?subjectType=project&subjectType=well&subjectId=1',
      '/api/channeling-tracking-events?subjectType=bad&subjectId=1',
    ]) assert.equal((await request(url)).status, 400, url);
    for (const url of ['/api/channeling-wells/99999', '/api/channeling-wells/99999/metrics?start=2026-01-01&end=2026-01-03', '/api/channeling-projects/99999/summary?start=2026-01-01&end=2026-01-03', '/api/channeling-relations/99999/detail?beforeStart=2026-01-01&splitDate=2026-01-02&afterEnd=2026-01-03']) assert.equal((await request(url)).status, 404, url);

    const eventCountBeforeReserved = (await db.get('SELECT COUNT(*) AS count FROM channeling_tracking_events')).count;
    for (const eventType of ['evaluated', 'status_changed', 'relation_confirmed', 'relation_released', 'corrected']) {
      const reservedEventResponse = await request('/api/channeling-tracking-events', { method: 'POST', headers: admin, body: JSON.stringify({ eventType, occurredOn: '2026-01-01', content: 'invalid reserved event', owner: 'alice', links: [{ subjectType: 'project', subjectId: project.id }] }) });
      assert.equal(reservedEventResponse.status, 400, eventType);
      assert.match((await reservedEventResponse.json() as any).message, eventType === 'corrected' ? /reserved for corrections/ : /reserved for dedicated tracking flows/);
    }
    const snapshotResponse = await request('/api/channeling-tracking-events', { method: 'POST', headers: admin, body: JSON.stringify({ eventType: 'discovered', occurredOn: '2026-01-01', content: 'client snapshot', owner: 'alice', metricsSnapshot: null, links: [{ subjectType: 'project', subjectId: project.id }] }) });
    assert.equal(snapshotResponse.status, 400); assert.match((await snapshotResponse.json() as any).message, /metricsSnapshot.*reserved/);
    assert.equal((await db.get('SELECT COUNT(*) AS count FROM channeling_tracking_events')).count, eventCountBeforeReserved);

    const eventResponse = await request('/api/channeling-tracking-events', { method: 'POST', headers: admin, body: JSON.stringify({ eventType: 'discovered', occurredOn: '2026-01-01', content: 'found', owner: 'alice', createdBy: 'attacker', links: [{ subjectType: 'project', subjectId: project.id }] }) });
    assert.equal(eventResponse.status, 201);
    const event = await json(eventResponse); assert.equal(event.createdBy, 'admin');
    const events = await json(await request(`/api/channeling-tracking-events?subjectType=project&subjectId=${project.id}`));
    assert.equal(events.find((item: any) => item.eventType === 'discovered' && item.content === 'found')?.id, event.id);
    const automaticConfirmation = events.find((item: any) => item.eventType === 'relation_confirmed');
    assert.ok(automaticConfirmation);
    assert.equal(automaticConfirmation.createdBy, 'admin');
    assert.deepEqual(automaticConfirmation.links, [
      { subjectType: 'project', subjectId: project.id },
      { subjectType: 'relation', subjectId: relation.id },
      { subjectType: 'well', subjectId: injector.id },
      { subjectType: 'well', subjectId: producer.id },
    ]);
    const correctionResponse = await request(`/api/channeling-tracking-events/${event.id}/corrections`, { method: 'POST', headers: admin, body: JSON.stringify({ reason: 'wrong wording', occurredOn: '2026-01-02', content: 'corrected', evidence: '', owner: 'alice', createdBy: 'attacker' }) });
    assert.equal(correctionResponse.status, 201); assert.equal((await json(correctionResponse)).createdBy, 'admin');
    assert.equal((await request(`/api/channeling-tracking-events/${event.id}/corrections`, { method: 'POST', headers: admin, body: JSON.stringify({ reason: 'again', occurredOn: '2026-01-02', content: 'again', owner: 'alice' }) })).status, 409);

    const projectEvaluationBody = { occurredOn: '2026-01-03', conclusion: 'project effective', evidence: 'project metrics', owner: 'alice', range: { start: '2026-01-01', end: '2026-01-03' } };
    assert.equal((await request(`/api/channeling-projects/${project.id}/evaluations`, { method: 'POST', body: JSON.stringify(projectEvaluationBody) })).status, 401);
    assert.equal((await request(`/api/channeling-projects/${project.id}/evaluations`, { method: 'POST', headers: ordinary, body: JSON.stringify(projectEvaluationBody) })).status, 403);
    const projectEvaluationResponse = await request(`/api/channeling-projects/${project.id}/evaluations`, { method: 'POST', headers: admin, body: JSON.stringify(projectEvaluationBody) });
    assert.equal(projectEvaluationResponse.status, 201);
    const projectEvaluation = await json(projectEvaluationResponse);
    assert.equal(projectEvaluation.eventType, 'evaluated'); assert.equal(projectEvaluation.createdBy, 'admin');
    assert.deepEqual(projectEvaluation.links, [{ subjectType: 'project', subjectId: project.id }]);
    assert.deepEqual(projectEvaluation.metricsSnapshot.range, projectEvaluationBody.range);
    assert.equal(projectEvaluation.metricsSnapshot.cumulativeSteam, 100);
    assert.equal(projectEvaluation.metricsSnapshot.latestTotalOil, 20);
    assert.equal((await request(`/api/channeling-projects/${project.id}/evaluations`, { method: 'POST', headers: admin, body: JSON.stringify({ ...projectEvaluationBody, metricsSnapshot: { forged: true } }) })).status, 400);
    assert.equal((await request(`/api/channeling-projects/${project.id}/evaluations`, { method: 'POST', headers: admin, body: JSON.stringify({ ...projectEvaluationBody, conclusion: '' }) })).status, 400);
    assert.equal((await request(`/api/channeling-projects/${project.id}/evaluations`, { method: 'POST', headers: admin, body: JSON.stringify({ ...projectEvaluationBody, evidence: [] }) })).status, 400);
    assert.equal((await request(`/api/channeling-projects/${project.id}/evaluations`, { method: 'POST', headers: admin, body: JSON.stringify({ ...projectEvaluationBody, owner: '' }) })).status, 400);
    assert.equal((await request(`/api/channeling-projects/${project.id}/evaluations`, { method: 'POST', headers: admin, body: JSON.stringify({ ...projectEvaluationBody, range: { start: '2026-01-04', end: '2026-01-03' } }) })).status, 400);
    assert.equal((await request('/api/channeling-projects/99999/evaluations', { method: 'POST', headers: admin, body: JSON.stringify(projectEvaluationBody) })).status, 404);

    const evaluationResponse = await request(`/api/channeling-relations/${relation.id}/evaluations`, { method: 'POST', headers: admin, body: JSON.stringify({ occurredOn: '2026-01-03', conclusion: 'effective', evidence: 'metrics', owner: 'alice', range: { beforeStart: '2026-01-01', splitDate: '2026-01-02', afterEnd: '2026-01-03' } }) });
    assert.equal(evaluationResponse.status, 201);
    const evaluation = await json(evaluationResponse);
    assert.equal(evaluation.eventType, 'evaluated'); assert.equal(evaluation.createdBy, 'admin');
    assert.equal(evaluation.metricsSnapshot.comparison.oil.afterAverage, 20);
    assert.deepEqual(evaluation.links, [{ subjectType: 'project', subjectId: project.id }, { subjectType: 'relation', subjectId: relation.id }, { subjectType: 'well', subjectId: injector.id }, { subjectType: 'well', subjectId: producer.id }]);

    const protectedRelationDelete = await request(`/api/channeling-relations/${relation.id}`, { method: 'DELETE', headers: admin });
    assert.equal(protectedRelationDelete.status, 409);
    const releaseResponse = await request(`/api/channeling-relations/${relation.id}`, { method: 'PATCH', headers: admin, body: JSON.stringify({ status: 'released' }) });
    assert.equal(releaseResponse.status, 200);
    assert.equal((await json(releaseResponse)).status, 'released');
    const protectedProjectDelete = await request(`/api/channeling-projects/${project.id}`, { method: 'DELETE', headers: admin });
    assert.equal(protectedProjectDelete.status, 409);
    const relationHistoryResponse = await request(`/api/channeling-tracking-events?subjectType=relation&subjectId=${relation.id}`);
    assert.equal(relationHistoryResponse.status, 200);
    const relationHistory = await json(relationHistoryResponse);
    assert.ok(relationHistory.some((item: any) => item.id === evaluation.id));
    assert.ok(relationHistory.some((item: any) => item.eventType === 'relation_released'));
    assert.equal((await request(`/api/channeling-wells/${injector.id}`)).status, 200);
    assert.equal((await request(`/api/channeling-wells/${producer.id}`)).status, 200);

    const evaluationCountBeforeFailure = (await db.get("SELECT COUNT(*) AS count FROM channeling_tracking_events WHERE event_type = 'evaluated'")).count;
    await writeFile(evaluationPauseFile, 'pause');
    const forcedEvaluationRequest = request(`/api/channeling-relations/${relation.id}/evaluations`, { method: 'POST', headers: { ...admin, 'x-channeling-pause-evaluation': '1', 'x-channeling-force-evaluation-after-event': '1' }, body: JSON.stringify({ occurredOn: '2026-01-04', conclusion: 'must rollback', owner: 'alice', range: { beforeStart: '2026-01-01', splitDate: '2026-01-02', afterEnd: '2026-01-03' } }) });
    const unrelatedDb = concurrencyDb = await open({ filename: databaseFile, driver: sqlite3.Database });
    await unrelatedDb.exec('PRAGMA busy_timeout = 20');
    let evaluationLockedDatabase = false;
    for (let attempt = 0; attempt < 100 && !evaluationLockedDatabase; attempt += 1) {
      try {
        await unrelatedDb.exec('BEGIN IMMEDIATE');
        await unrelatedDb.exec('ROLLBACK');
        await new Promise((resolve) => setTimeout(resolve, 10));
      } catch (error: any) {
        if (error?.code !== 'SQLITE_BUSY') throw error;
        evaluationLockedDatabase = true;
      }
    }
    assert.equal(evaluationLockedDatabase, true);
    await unrelatedDb.exec('PRAGMA busy_timeout = 3000');
    const unrelatedWrite = unrelatedDb.run("INSERT INTO users (username, password, name, role) VALUES ('evaluation-concurrent-user', 'password', 'Concurrent', 'user')");
    await rm(evaluationPauseFile, { force: true });
    const [forcedEvaluation] = await Promise.all([forcedEvaluationRequest, unrelatedWrite]);
    assert.equal(forcedEvaluation.status, 500);
    assert.equal((await forcedEvaluation.json() as any).message, '服务器内部错误');
    assert.equal((await db.get("SELECT COUNT(*) AS count FROM channeling_tracking_events WHERE event_type = 'evaluated'")).count, evaluationCountBeforeFailure);
    assert.equal((await db.get("SELECT COUNT(*) AS count FROM users WHERE username = 'evaluation-concurrent-user'")).count, 1);
    await unrelatedDb.close(); concurrencyDb = undefined;

    const missingRelationResponse = await request(`/api/channeling-projects/${project.id}/relations`, { method: 'POST', headers: admin, body: JSON.stringify({ ...relationBody, injectionWell: 'missing-i', productionWell: 'missing-p' }) });
    const missingRelation = await json(missingRelationResponse);
    const editedRelationResponse = await request(`/api/channeling-relations/${missingRelation.id}`, { method: 'PATCH', headers: admin, body: JSON.stringify({ injectionWell: 'edited-i', productionWell: 'edited-p' }) });
    assert.equal(editedRelationResponse.status, 200);
    const editedProfiles = await db.all("SELECT id, normalized_well_no FROM channeling_well_profiles WHERE normalized_well_no IN ('EDITED-I', 'EDITED-P') ORDER BY normalized_well_no");
    const editedEvaluationResponse = await request(`/api/channeling-relations/${missingRelation.id}/evaluations`, { method: 'POST', headers: admin, body: JSON.stringify({ occurredOn: '2026-01-03', conclusion: 'x', owner: 'alice', range: { beforeStart: '2026-01-01', splitDate: '2026-01-02', afterEnd: '2026-01-03' } }) });
    assert.equal(editedEvaluationResponse.status, 201);
    const editedEvaluation = await json(editedEvaluationResponse);
    assert.deepEqual(editedEvaluation.links, [
      { subjectType: 'project', subjectId: project.id },
      { subjectType: 'relation', subjectId: missingRelation.id },
      { subjectType: 'well', subjectId: editedProfiles[0].id },
      { subjectType: 'well', subjectId: editedProfiles[1].id },
    ]);

    const legacyRelation = await db.run("INSERT INTO channeling_relations (project_id, channeling_type, injection_well, production_well, reservoir_layer, impact_level, confidence, status, source, evidence, effective_start_date, effective_end_date, owner, created_at, updated_at) VALUES (?, 'steam', 'legacy-i', 'legacy-p', 'S1', 'high', .9, 'confirmed', 'manual', 'legacy', '2026-01-01', '2026-12-31', 'owner', ?, ?)", [project.id, new Date().toISOString(), new Date().toISOString()]);
    assert.equal((await request(`/api/channeling-relations/${legacyRelation.lastID}/evaluations`, { method: 'POST', headers: admin, body: JSON.stringify({ occurredOn: '2026-01-03', conclusion: 'x', owner: 'alice', range: { beforeStart: '2026-01-01', splitDate: '2026-01-02', afterEnd: '2026-01-03' } }) })).status, 404);
    assert.equal((await request(`/api/channeling-relations/${relation.id}/evaluations`, { method: 'POST', headers: admin, body: JSON.stringify({ occurredOn: '2026-01-03', conclusion: '', owner: 'alice', range: { beforeStart: '2026-01-01', splitDate: '2026-01-02', afterEnd: '2026-01-03' } }) })).status, 400);
  } finally {
    await concurrencyDb?.close();
    await db?.close();
    await stopServer(child);
    await rm(directory, { recursive: true, force: true });
  }
});
