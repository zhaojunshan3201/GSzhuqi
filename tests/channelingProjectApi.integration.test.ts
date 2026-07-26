import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

const relation = { injectionWell: '×¢A-1', productionWell: '²ÉA-2', reservoirLayer: 'S1', impactLevel: 'high', confidence: .8, status: 'confirmed', source: 'manual', evidence: '²âÊÔ', effectiveStartDate: '2026-07-01', effectiveEndDate: '2026-12-31', owner: 'Àî¹¤' };

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
    child.kill();
    await new Promise<void>((resolve) => child.once('exit', () => resolve()));
    child = spawn(process.execPath, ['--import', 'tsx', 'server.ts'], serverOptions);
    await new Promise<void>((resolve, reject) => { const timer = setTimeout(() => reject(new Error('restarted server did not start')), 15000); child.stdout.on('data', (data) => { if (String(data).includes('Server running')) { clearTimeout(timer); resolve(); } }); child.once('error', reject); child.once('exit', (code) => reject(new Error(`restarted server exited ${code}`))); });
    const projectResponse = await request('/api/channeling-projects', { method: 'POST', headers: authorized, body: JSON.stringify({ projectName: 'project', block: 'A', owner: 'tester' }) });
    assert.equal(projectResponse.status, 201); const project = (await projectResponse.json() as any).data;
    const created = await request(`/api/channeling-projects/${project.id}/relations`, { method: 'POST', headers: authorized, body: JSON.stringify(relation) });
    assert.equal(created.status, 201); const item = (await created.json() as any).data;
    assert.equal((await request(`/api/channeling-relations/${item.id}`, { method: 'PATCH', headers: authorized, body: JSON.stringify({ status: 'released' }) })).status, 200);
    assert.equal((await request('/api/channeling-projects/no/relations')).status, 400);
    assert.equal((await request(`/api/channeling-projects/${project.id}/relations?status=bad`)).status, 400);
    assert.equal((await request('/api/channeling-projects/99999/relations')).status, 404);
    assert.equal((await request('/api/channeling-relations/99999', { method: 'PATCH', headers: authorized, body: JSON.stringify({ status: 'released' }) })).status, 404);
    assert.equal((await request(`/api/channeling-relations/${item.id}`, { method: 'PATCH', headers: authorized, body: JSON.stringify({ projectId: 2 }) })).status, 400);
    assert.equal((await request(`/api/channeling-projects/${project.id}/relations`, { headers: { 'x-channeling-force-error': '1' } })).status, 500);
  } finally { child.kill(); await new Promise<void>((resolve) => child.once('exit', () => resolve())); await rm(directory, { recursive: true, force: true }); }
});
