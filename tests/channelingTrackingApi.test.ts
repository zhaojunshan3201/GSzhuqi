import assert from 'node:assert/strict';
import test from 'node:test';
import { JSDOM } from 'jsdom';
import { ChannelingApiError, channelingRequest } from '../src/lib/channelingTrackingApi.ts';

test('channelingRequest unwraps successful data and preserves caller headers with the existing auth token', async () => {
  const dom = new JSDOM('', { url: 'http://localhost' });
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: dom.window.localStorage });
  localStorage.setItem('token', 'session-token');
  let captured: RequestInit | undefined;
  globalThis.fetch = (async (_input, init) => {
    captured = init;
    return new Response(JSON.stringify({ success: true, data: { id: 7 } }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  }) as typeof fetch;

  assert.deepEqual(await channelingRequest<{ id: number }>('/api/example', { headers: { 'X-Test': 'yes' } }), { id: 7 });
  const headers = new Headers(captured?.headers);
  assert.equal(headers.get('authorization'), 'Bearer session-token');
  assert.equal(headers.get('x-test'), 'yes');
  dom.window.close();
});

test('channelingRequest accepts an empty 204 response', async () => {
  globalThis.fetch = (async () => new Response(null, { status: 204 })) as typeof fetch;
  assert.equal(await channelingRequest<void>('/api/example', { method: 'DELETE' }), undefined);
});

test('channelingRequest surfaces a server message even for an error status', async () => {
  globalThis.fetch = (async () => new Response(JSON.stringify({ success: false, message: '跟踪记录已被更正' }), {
    status: 409,
    headers: { 'content-type': 'application/json' },
  })) as typeof fetch;
  await assert.rejects(() => channelingRequest('/api/example'), (error: unknown) => {
    assert.ok(error instanceof ChannelingApiError);
    assert.equal(error.status, 409);
    assert.match(error.message, /跟踪记录已被更正/);
    return true;
  });
});

test('channelingRequest reports non-JSON and malformed success envelopes', async (t) => {
  await t.test('non-JSON response', async () => {
    globalThis.fetch = (async () => new Response('<!doctype html>', { status: 200 })) as typeof fetch;
    await assert.rejects(() => channelingRequest('/api/example'), /服务响应格式异常/);
  });
  await t.test('missing data', async () => {
    globalThis.fetch = (async () => new Response(JSON.stringify({ success: true }), { status: 200 })) as typeof fetch;
    await assert.rejects(() => channelingRequest('/api/example'), /服务响应数据缺失/);
  });
});

test('channelingRequest consistently rejects malformed JSON envelopes', async (t) => {
  for (const [name, payload] of [
    ['null', null],
    ['array', []],
    ['missing success', { data: 1 }],
    ['non-boolean success', { success: 'true', data: 1 }],
  ] as const) {
    await t.test(name, async () => {
      globalThis.fetch = (async () => new Response(JSON.stringify(payload), { status: 200 })) as typeof fetch;
      await assert.rejects(() => channelingRequest('/api/example'), /^Error: 服务响应格式异常，请刷新页面或重试$/);
    });
  }
});
