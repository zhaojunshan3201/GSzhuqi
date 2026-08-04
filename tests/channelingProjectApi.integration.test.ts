import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import * as XLSX from 'xlsx';

const relation = { injectionWell: '◊¢A-1', productionWell: '≤…A-2', reservoirLayer: 'S1', impactLevel: 'high', confidence: .8, status: 'confirmed', source: 'manual', evidence: '≤‚ ‘', effectiveStartDate: '2026-07-01', effectiveEndDate: '2026-12-31', owner: '¿Óπ§' };

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
  const serverOptions = { cwd: process.cwd(), env: { ...process.env, PORT: String(port), LOCAL_ONLY: 'true', NODE_ENV: 'production', LOCAL_DB_FILE: path.join(directory, 'test.db'), CHANNELING_TEST_FORCE_ERROR: '1', AUTH_TOKEN_SECRET: 'channeling-integration-test-secret' }, stdio: ['ignore', 'pipe', 'pipe'] as const };
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
    const token = (await login.json() as any).token;
    assert.ok(token);
    const authorized = { authorization: `Bearer ${token}` };
    await stopServer(child);
    child = spawn(process.execPath, ['--import', 'tsx', 'server.ts'], serverOptions);
    await new Promise<void>((resolve, reject) => { const timer = setTimeout(() => reject(new Error('restarted server did not start')), 15000); child.stdout.on('data', (data) => { if (String(data).includes('Server running')) { clearTimeout(timer); resolve(); } }); child.once('error', reject); child.once('exit', (code) => reject(new Error(`restarted server exited ${code}`))); });
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
    const detailResponse = await request(`/api/channeling-relation-imports/${preview.id}`);
    assert.equal(detailResponse.status, 200);
    const detail = (await detailResponse.json() as any).data;
    assert.equal(detail.projectId, null); assert.equal(detail.valid.length, 1); assert.equal(detail.duplicates.length, 1); assert.equal(detail.selfRelations.length, 1); assert.equal(detail.invalid.length, 1);
    assert.equal((await request('/api/channeling-relation-imports/no')).status, 400);
    assert.equal((await request('/api/channeling-relation-imports/99999')).status, 404);
    assert.equal((await request(`/api/channeling-relation-imports/${preview.id}/confirm`, { method: 'POST', headers: authorized, body: JSON.stringify({}) })).status, 400);
    const projectResponse = await request('/api/channeling-projects', { method: 'POST', headers: authorized, body: JSON.stringify({ projectName: 'project', block: 'A', owner: 'tester' }) });
    assert.equal(projectResponse.status, 201); const project = (await projectResponse.json() as any).data;
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
    const created = await request(`/api/channeling-projects/${project.id}/relations`, { method: 'POST', headers: authorized, body: JSON.stringify({ ...relation, injectionWell: 'Z1', productionWell: 'P1' }) });
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
