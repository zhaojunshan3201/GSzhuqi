import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { spawn, type SpawnOptionsWithStdioTuple } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import sqlite3 from 'sqlite3';
import { open } from 'sqlite';
import * as XLSX from 'xlsx';

const relation = { injectionWell: '注A-1', productionWell: '采A-2', reservoirLayer: 'S1', impactLevel: 'high', confidence: .8, status: 'confirmed', source: 'manual', evidence: '测试', effectiveStartDate: '2026-07-01', effectiveEndDate: '2026-12-31', owner: '李工' };

function matrixWorkbookBuffer(dataRows: unknown[][] = [['Z1', 'P1', 'Z1', 'P1'], ['', 'P2', '', '']]): Buffer {
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([
    ['\u6ce8\u6c7d\u4e95', '\u4e95\u53f71', '\u4e95\u53f72', '\u4e95\u53f73'],
    ...dataRows,
  ]), 'relations');
  return XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });
}

function importForm(channelingType?: string, fileName = 'relations.xlsx', buffer = matrixWorkbookBuffer()): FormData {
  const form = new FormData();
  form.append('file', new Blob([new Uint8Array(buffer)]), fileName);
  if (channelingType !== undefined) form.append('channelingType', channelingType);
  return form;
}

async function stopServer(child: ReturnType<typeof spawn>): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return;
  await new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, 2000); timer.unref();
    child.once('exit', () => { clearTimeout(timer); resolve(); });
    child.kill();
  });
}

test('channeling endpoints enforce request contracts over HTTP', { timeout: 30000 }, async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'channeling-api-'));
  const port = 38000 + Math.floor(Math.random() * 1000);
  const serverOptions: SpawnOptionsWithStdioTuple<'ignore', 'pipe', 'pipe'> = { cwd: process.cwd(), env: { ...process.env, PORT: String(port), LOCAL_ONLY: 'true', NODE_ENV: 'production', LOCAL_DB_FILE: path.join(directory, 'test.db'), CHANNELING_TEST_FORCE_ERROR: '1', AUTH_TOKEN_SECRET: 'channeling-integration-test-secret' }, stdio: ['ignore', 'pipe', 'pipe'] };
  let child = spawn(process.execPath, ['--import', 'tsx', 'server.ts'], serverOptions);
  try {
    await new Promise<void>((resolve, reject) => { const timer = setTimeout(() => reject(new Error('server did not start')), 15000); child.stdout.on('data', (data) => { if (String(data).includes('Server running')) { clearTimeout(timer); resolve(); } }); child.once('error', reject); child.once('exit', (code) => reject(new Error(`server exited ${code}`))); });
    const request = async (url: string, init?: RequestInit) => fetch(`http://127.0.0.1:${port}${url}`, { ...init, headers: { 'content-type': 'application/json', ...(init?.headers || {}) } });
    const unauthenticated = await request('/api/channeling-projects', { method: 'POST', body: JSON.stringify({ projectName: 'unauthorized', block: 'A', owner: 'tester' }) });
    assert.equal(unauthenticated.status, 401);
    const forgedHeader = await request('/api/channeling-projects', { method: 'POST', headers: { 'x-channeling-role': 'admin' }, body: JSON.stringify({ projectName: 'forged', block: 'A', owner: 'tester' }) });
    assert.equal(forgedHeader.status, 401);
    const forgedPayload = Buffer.from(JSON.stringify({ username: 'attacker', role: 'admin' })).toString('base64url');
    const forgedToken = `${forgedPayload}.${createHmac('sha256', 'oil-system-local-auth-v1').update(forgedPayload).digest('base64url')}`;
    const forgedTokenResponse = await request('/api/channeling-projects', { method: 'POST', headers: { authorization: `Bearer ${forgedToken}` }, body: JSON.stringify({ projectName: 'forged-token', block: 'A', owner: 'tester' }) });
    assert.equal(forgedTokenResponse.status, 401);
    const login = await request('/api/login', { method: 'POST', body: JSON.stringify({ username: 'admin', password: '123456' }) });
    assert.equal(login.status, 200);
    const loginPayload = await login.json() as any;
    assert.equal(loginPayload.user.name, '系统管理员');
    const token = loginPayload.token;
    assert.ok(token);
    let authorized = { authorization: `Bearer ${token}` };
    await stopServer(child);
    const seededDb = await open({ filename: path.join(directory, 'test.db'), driver: sqlite3.Database });
    await seededDb.run("UPDATE users SET name = '登录失败，请重试' WHERE username = 'admin'");
    await seededDb.run("INSERT INTO users (username, password, name, role) VALUES (?, ?, ?, ?)", ['ordinary-user', 'password', '登录失败，请重试', 'user']);
    await seededDb.close();
    child = spawn(process.execPath, ['--import', 'tsx', 'server.ts'], serverOptions);
    await new Promise<void>((resolve, reject) => { const timer = setTimeout(() => reject(new Error('restarted server did not start')), 15000); child.stdout.on('data', (data) => { if (String(data).includes('Server running')) { clearTimeout(timer); resolve(); } }); child.once('error', reject); child.once('exit', (code) => reject(new Error(`restarted server exited ${code}`))); });
    const migratedLogin = await request('/api/login', { method: 'POST', body: JSON.stringify({ username: 'admin', password: '123456' }) });
    const migratedLoginPayload = await migratedLogin.json() as any;
    assert.equal(migratedLoginPayload.user.name, '系统管理员');
    authorized = { authorization: `Bearer ${migratedLoginPayload.token}` };
    const ordinaryLogin = await request('/api/login', { method: 'POST', body: JSON.stringify({ username: 'ordinary-user', password: 'password' }) });
    assert.equal((await ordinaryLogin.json() as any).user.name, '登录失败，请重试');
    const multipartRequest = (url: string, body: FormData, headers: Record<string, string> = {}) => fetch(`http://127.0.0.1:${port}${url}`, { method: 'POST', headers, body });
    assert.equal((await multipartRequest('/api/channeling-relation-imports/preview', importForm('nitrogen'))).status, 401);
    const userPayload = Buffer.from(JSON.stringify({ username: 'operator', role: 'user' })).toString('base64url');
    const userToken = `${userPayload}.${createHmac('sha256', 'channeling-integration-test-secret').update(userPayload).digest('base64url')}`;
    assert.equal((await multipartRequest('/api/channeling-relation-imports/preview', importForm('nitrogen'), { authorization: `Bearer ${userToken}` })).status, 403);
    const invalidTypeResponse = await multipartRequest('/api/channeling-relation-imports/preview', importForm('water'), authorized);
    assert.equal(invalidTypeResponse.status, 400); assert.match((await invalidTypeResponse.json() as any).message, /steam.*nitrogen/);
    const invalidFileResponse = await multipartRequest('/api/channeling-relation-imports/preview', importForm('steam', 'relations.csv'), authorized);
    assert.equal(invalidFileResponse.status, 400); assert.match((await invalidFileResponse.json() as any).message, /\.xlsx.*\.xls/);
    const missingFileForm = new FormData(); missingFileForm.append('channelingType', 'steam');
    assert.equal((await multipartRequest('/api/channeling-relation-imports/preview', missingFileForm, authorized)).status, 400);
    const previewResponse = await multipartRequest('/api/channeling-relation-imports/preview', importForm('nitrogen'), authorized);
    assert.equal(previewResponse.status, 201);
    const preview = (await previewResponse.json() as any).data;
    assert.equal(preview.projectId, null); assert.equal(preview.channelingType, 'nitrogen');
    assert.deepEqual({ valid: preview.validCount, duplicates: preview.duplicateCount, selfRelations: preview.selfRelationCount, invalid: preview.invalidCount }, { valid: 1, duplicates: 1, selfRelations: 1, invalid: 1 });
    assert.equal(preview.valid.length, 1); assert.equal(preview.duplicates.length, 1); assert.equal(preview.selfRelations.length, 1); assert.equal(preview.invalid.length, 1);
    assert.equal((await request(`/api/channeling-relation-imports/${preview.id}`)).status, 401);
    assert.equal((await request(`/api/channeling-relation-imports/${preview.id}`, { headers: { authorization: `Bearer ${userToken}` } })).status, 403);
    const detailResponse = await request(`/api/channeling-relation-imports/${preview.id}`, { headers: authorized });
    assert.equal(detailResponse.status, 200);
    const detail = (await detailResponse.json() as any).data;
    assert.equal(detail.projectId, null); assert.equal(detail.valid.length, 1); assert.equal(detail.duplicates.length, 1); assert.equal(detail.selfRelations.length, 1); assert.equal(detail.invalid.length, 1);
    assert.equal((await request('/api/channeling-relation-imports/no', { headers: authorized })).status, 400);
    assert.equal((await request('/api/channeling-relation-imports/99999', { headers: authorized })).status, 404);
    assert.equal((await request(`/api/channeling-relation-imports/${preview.id}/confirm`, { method: 'POST', headers: authorized, body: JSON.stringify({}) })).status, 400);
    const projectResponse = await request('/api/channeling-projects', { method: 'POST', headers: authorized, body: JSON.stringify({ projectName: 'project', block: 'A', owner: 'tester' }) });
    assert.equal(projectResponse.status, 201); const project = (await projectResponse.json() as any).data;
    assert.equal((await request(`/api/channeling-projects/${project.id}`, { method: 'PATCH', headers: authorized, body: JSON.stringify({ status: 'confirmed', createdBy: 'attacker' }) })).status, 400);
    assert.equal((await request(`/api/channeling-projects/${project.id}`, { method: 'PATCH', headers: authorized, body: JSON.stringify({ status: 'confirmed' }) })).status, 200);
    const projectHistory = (await (await request(`/api/channeling-tracking-events?subjectType=project&subjectId=${project.id}`)).json() as any).data;
    const projectStatusEvent = projectHistory.find((event: any) => event.eventType === 'status_changed');
    assert.equal(projectStatusEvent.createdBy, 'admin');
    assert.equal(projectStatusEvent.content, '项目状态变更：识别/导入（identified）→ 确认（confirmed）');
    const malformedBytes = Buffer.from([0, 1, 2, 3]);
    const unrecognizedWorkbook = XLSX.write({ SheetNames: ['bad'], Sheets: { bad: XLSX.utils.aoa_to_sheet([['unexpected'], ['value']]) } }, { type: 'buffer', bookType: 'xlsx' });
    assert.equal((await multipartRequest('/api/channeling-relation-imports/preview', importForm('steam', 'broken.xlsx', malformedBytes), authorized)).status, 400);
    assert.equal((await multipartRequest(`/api/channeling-projects/${project.id}/relation-imports/preview`, importForm('steam', 'broken.xlsx', malformedBytes), authorized)).status, 400);
    assert.equal((await multipartRequest('/api/channeling-relation-imports/preview', importForm('steam', 'headers.xlsx', unrecognizedWorkbook), authorized)).status, 400);
    assert.equal((await multipartRequest(`/api/channeling-projects/${project.id}/relation-imports/preview`, importForm('steam', 'headers.xlsx', unrecognizedWorkbook), authorized)).status, 400);
    const legacyPreviewResponse = await multipartRequest(`/api/channeling-projects/${project.id}/relation-imports/preview`, importForm(undefined, 'legacy.xlsx', matrixWorkbookBuffer([['ZL', 'PL', '', '']])), authorized);
    assert.equal(legacyPreviewResponse.status, 201);
    const legacyPreview = (await legacyPreviewResponse.json() as any).data;
    assert.equal(legacyPreview.projectId, project.id); assert.equal(legacyPreview.channelingType, 'steam');
    const legacyConfirmResponse = await request(`/api/channeling-relation-imports/${legacyPreview.id}/confirm`, { method: 'POST', headers: authorized });
    assert.equal(legacyConfirmResponse.status, 200); assert.equal((await legacyConfirmResponse.json() as any).data.projectId, project.id);
    const importedRelations = (await (await request(`/api/channeling-projects/${project.id}/relations?channelingType=steam`)).json() as any).data;
    const importedRelation = importedRelations.find((entry: any) => entry.injectionWell === 'ZL' && entry.productionWell === 'PL');
    const importedHistory = (await (await request(`/api/channeling-tracking-events?subjectType=relation&subjectId=${importedRelation.id}`)).json() as any).data;
    assert.equal(importedHistory.find((event: any) => event.eventType === 'relation_confirmed')?.createdBy, 'system');
    const created = await request(`/api/channeling-projects/${project.id}/relations`, { method: 'POST', headers: authorized, body: JSON.stringify({ ...relation, injectionWell: 'Z1', productionWell: 'P1', createdBy: 'attacker' }) });
    assert.equal(created.status, 201); const item = (await created.json() as any).data;
    assert.equal(item.channelingType, 'steam');
    assert.equal((await request(`/api/channeling-relation-imports/${preview.id}/confirm`, { method: 'POST', headers: { ...authorized, 'x-channeling-force-error': '1' }, body: JSON.stringify({ projectId: project.id }) })).status, 500);
    const confirmedResponse = await request(`/api/channeling-relation-imports/${preview.id}/confirm`, { method: 'POST', headers: authorized, body: JSON.stringify({ projectId: project.id }) });
    assert.equal(confirmedResponse.status, 200);
    const confirmed = (await confirmedResponse.json() as any).data;
    assert.equal(confirmed.projectId, project.id); assert.equal(confirmed.status, 'confirmed');
    assert.equal((await request(`/api/channeling-relation-imports/${preview.id}/confirm`, { method: 'POST', headers: authorized, body: JSON.stringify({ projectId: project.id }) })).status, 409);
    assert.equal((await request('/api/channeling-relation-imports/99999/confirm', { method: 'POST', headers: authorized, body: JSON.stringify({ projectId: project.id }) })).status, 404);
    const steamRelations = await request(`/api/channeling-projects/${project.id}/relations?channelingType=steam`); const steamItems = (await steamRelations.json() as any).data;
    const nitrogenRelations = await request(`/api/channeling-projects/${project.id}/relations?channelingType=nitrogen`); const nitrogenItems = (await nitrogenRelations.json() as any).data;
    assert.equal(steamRelations.status, 200); assert.equal(nitrogenRelations.status, 200); assert.equal(steamItems.length, 2); assert.equal(nitrogenItems.length, 1);
    const matchingSteam = steamItems.find((entry: any) => entry.injectionWell === 'Z1'); assert.ok(matchingSteam); assert.equal(matchingSteam.productionWell, nitrogenItems[0].productionWell);
    assert.equal((await request(`/api/channeling-projects/${project.id}/relations?channelingType=water`)).status, 400);
    assert.equal((await request(`/api/channeling-projects/${project.id}/relations?channelingType=steam&channelingType=nitrogen`)).status, 400);
    const explicitTypeResponse = await request(`/api/channeling-projects/${project.id}/relations`, { method: 'POST', headers: authorized, body: JSON.stringify({ ...relation, channelingType: 'nitrogen', injectionWell: 'Z2', productionWell: 'P2' }) });
    assert.equal(explicitTypeResponse.status, 201); const explicitTypeItem = (await explicitTypeResponse.json() as any).data;
    assert.equal(explicitTypeItem.channelingType, 'nitrogen');
    const patchedTypeResponse = await request(`/api/channeling-relations/${explicitTypeItem.id}`, { method: 'PATCH', headers: authorized, body: JSON.stringify({ channelingType: 'steam' }) });
    assert.equal(patchedTypeResponse.status, 200); assert.equal((await patchedTypeResponse.json() as any).data.channelingType, 'steam');
    assert.equal((await request(`/api/channeling-relations/${item.id}`, { method: 'PATCH', headers: authorized, body: JSON.stringify({ status: 'released' }) })).status, 200);
    const relationHistoryResponse = await request(`/api/channeling-tracking-events?subjectType=relation&subjectId=${item.id}`);
    assert.equal(relationHistoryResponse.status, 200);
    const relationHistory = (await relationHistoryResponse.json() as any).data;
    assert.deepEqual(relationHistory.map((event: any) => event.eventType).sort(), ['relation_confirmed', 'relation_released']);
    assert.ok(relationHistory.every((event: any) => event.createdBy === 'admin'));
    assert.equal((await request(`/api/channeling-relations/${item.id}`, { method: 'PATCH', headers: authorized, body: JSON.stringify({ status: 'released', createdBy: 'attacker' }) })).status, 400);
    const protectedRelationDelete = await request(`/api/channeling-relations/${item.id}`, { method: 'DELETE', headers: authorized });
    assert.equal(protectedRelationDelete.status, 409);
    assert.equal((await protectedRelationDelete.json() as any).message, 'Relation has tracking history');
    const protectedProjectDelete = await request(`/api/channeling-projects/${project.id}`, { method: 'DELETE', headers: authorized });
    assert.equal(protectedProjectDelete.status, 409);
    assert.equal((await protectedProjectDelete.json() as any).message, 'Project has relations or tracking history');
    const emptyProjectResponse = await request('/api/channeling-projects', { method: 'POST', headers: authorized, body: JSON.stringify({ projectName: 'empty', block: 'A', owner: 'tester' }) });
    const emptyProject = (await emptyProjectResponse.json() as any).data;
    assert.equal((await request(`/api/channeling-projects/${emptyProject.id}`, { method: 'DELETE', headers: authorized })).status, 204);
    assert.equal((await request('/api/channeling-projects/no/relations')).status, 400);
    assert.equal((await request(`/api/channeling-projects/${project.id}/relations?status=bad`)).status, 400);
    assert.equal((await request('/api/channeling-projects/99999/relations')).status, 404);
    assert.equal((await request('/api/channeling-relations/99999', { method: 'PATCH', headers: authorized, body: JSON.stringify({ status: 'released' }) })).status, 404);
    assert.equal((await request(`/api/channeling-relations/${item.id}`, { method: 'PATCH', headers: authorized, body: JSON.stringify({ projectId: 2 }) })).status, 400);
    assert.equal((await request(`/api/channeling-relations/${item.id}`, { method: 'PATCH', headers: authorized, body: JSON.stringify({}) })).status, 400);
    assert.equal((await request(`/api/channeling-relations/${item.id}`, { method: 'PATCH', headers: authorized, body: JSON.stringify([]) })).status, 400);
    assert.equal((await request(`/api/channeling-projects/${project.id}/relations`, { headers: { 'x-channeling-force-error': '1' } })).status, 500);
  } finally { await stopServer(child); await rm(directory, { recursive: true, force: true }); }
});
