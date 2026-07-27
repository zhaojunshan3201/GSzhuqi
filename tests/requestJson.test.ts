import assert from 'node:assert/strict';
import test from 'node:test';
import { readJsonResponse } from '../src/lib/requestJson.ts';

test('reports an empty API response without exposing Response.json errors', async () => {
  const response = new Response('', { status: 200 });

  await assert.rejects(
    () => readJsonResponse<unknown>(response),
    /接口返回空内容，请刷新页面或重启服务/,
  );
});

test('reports an outdated server when an API request receives HTML', async () => {
  const response = new Response('<!doctype html><title>app</title>', {
    status: 200,
    headers: { 'content-type': 'text/html' },
  });

  await assert.rejects(
    () => readJsonResponse<unknown>(response),
    /服务版本不匹配，请刷新页面或重启服务/,
  );
});
