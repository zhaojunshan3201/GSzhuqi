import assert from 'node:assert/strict';
import test from 'node:test';
import { JSDOM } from 'jsdom';
import { act, createElement, StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { ChannelingProjectManagement } from '../src/components/ChannelingProjectManagement.tsx';

const project = (id: number, name = `项目${id}`) => ({ id, projectName: name, block: '一区', owner: '负责人', status: 'identified', governanceMeasure: '', plannedDate: null, actualDate: null, beforeMetric: null, afterMetric: null, closureEvidence: '', riskLevel: 'medium', estimatedLoss: null, affectedWellCount: null, affectedDailyOil: null, occupiedProduction: null, createdAt: '', updatedAt: '' });
const summary = (id: number) => ({ projectId: id, start: '2026-07-08', end: '2026-08-06', range: { start: '2026-07-08', end: '2026-08-06' }, generatedAt: '2026-08-06T02:03:04.000Z', relationCount: 3, activeRelationCount: 2, releasedRelationCount: 1, injectorCount: 2, producerCount: 2, uniqueWellCount: 3, cumulativeSteam: 120.5, latestTotalOil: 8.2, evaluatedCount: 1, latestEvaluationConclusion: '有效' });
const response = (data: unknown, ok = true, message = '') => {
  const body = JSON.stringify({ success: ok, data, message });
  return Promise.resolve({ ok, status: ok ? 200 : 500, json: async () => JSON.parse(body), text: async () => body } as Response);
};
const expectedDefaultRange = () => {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date()).filter((part) => part.type !== 'literal').map((part) => [part.type, part.value]));
  const end = `${parts.year}-${parts.month}-${parts.day}`;
  const start = new Date(Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day) - 29)).toISOString().slice(0, 10);
  return { start, end };
};

const setup = () => {
  const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', { url: 'http://localhost' });
  Object.defineProperties(globalThis, { window: { configurable: true, value: dom.window }, document: { configurable: true, value: dom.window.document }, navigator: { configurable: true, value: dom.window.navigator }, HTMLElement: { configurable: true, value: dom.window.HTMLElement }, HTMLInputElement: { configurable: true, value: dom.window.HTMLInputElement }, Event: { configurable: true, value: dom.window.Event }, InputEvent: { configurable: true, value: dom.window.InputEvent }, localStorage: { configurable: true, value: dom.window.localStorage }, IS_REACT_ACT_ENVIRONMENT: { configurable: true, value: true } });
  return dom;
};
const changeInput = (input: HTMLInputElement, value: string) => {
  Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')!.set!.call(input, value);
  input.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: value }));
  input.dispatchEvent(new Event('change', { bubbles: true }));
};

const commonFetch = (projects = [project(7)]) => (async (input: RequestInfo | URL) => {
  const url = String(input);
  if (url === '/api/channeling-projects') return response(projects);
  if (url.startsWith('/api/channeling-projects/pending')) return response([]);
  if (url.includes('/relations') || url.includes('/relation-imports')) return response([]);
  if (url.includes('/summary?')) return response(summary(Number(url.match(/projects\/(\d+)/)?.[1])));
  if (url.startsWith('/api/channeling-tracking-events?')) return response([]);
  throw new Error(`unexpected fetch ${url}`);
}) as typeof fetch;

test('selected project exposes overview, relations and project timeline tabs', async () => {
  const dom = setup(); const host = document.getElementById('root')!; const root = createRoot(host); globalThis.fetch = commonFetch();
  await act(async () => root.render(createElement(ChannelingProjectManagement, { role: 'admin' })));
  const tabs = [...host.querySelectorAll('[role="tab"]')] as HTMLButtonElement[];
  assert.deepEqual(tabs.map((tab) => tab.textContent), ['项目概览', '关系清单', '跟踪时间线']);
  assert.equal(tabs[0].getAttribute('aria-selected'), 'true');
  assert.match(host.textContent || '', /关系数量\s*3/);
  assert.match(host.textContent || '', /注入井数量\s*2/);
  assert.match(host.textContent || '', /生产井数量\s*2/);
  assert.match(host.textContent || '', /去重井数\s*3/);
  assert.match(host.textContent || '', /累计注汽量\s*120\.5/);
  assert.match(host.textContent || '', /最新日产油合计\s*8\.2/);
  assert.match(host.textContent || '', /已评价次数\s*1/);
  assert.ok(host.querySelector('form'), 'governance forms remain available');
  await act(async () => tabs[1].click()); assert.ok(host.querySelector('select[aria-label="注窜类型筛选"]'));
  await act(async () => tabs[2].click()); assert.match(host.textContent || '', /跟踪记录/); assert.ok(host.querySelector('form[aria-label="新增跟踪记录"]'));
  await act(async () => root.unmount()); dom.window.close();
});

test('overview validates its date range and reloads a valid Shanghai business range', async () => {
  const dom = setup(); const host = document.getElementById('root')!; const root = createRoot(host); const urls: string[] = [];
  globalThis.fetch = (async (input) => { const url = String(input); urls.push(url); return commonFetch()(input); }) as typeof fetch;
  await act(async () => root.render(createElement(ChannelingProjectManagement, { role: 'guest' })));
  const start = host.querySelector('input[aria-label="汇总开始日期"]') as HTMLInputElement;
  const end = host.querySelector('input[aria-label="汇总结束日期"]') as HTMLInputElement;
  const expected = expectedDefaultRange();
  assert.equal(end.value, expected.end);
  assert.equal(start.value, expected.start);
  await act(async () => changeInput(start, '9999-12-31'));
  assert.match(host.textContent || '', /开始日期不能晚于结束日期/);
  assert.equal(urls.filter((url) => url.includes('/summary?')).length, 1);
  await act(async () => changeInput(start, expected.end));
  assert.ok(urls.some((url) => url.includes(`/summary?start=${expected.end}&end=${expected.end}`)));
  await act(async () => root.unmount()); dom.window.close();
});

test('summary error is isolated, retry works and malformed values render as missing', async () => {
  const dom = setup(); const host = document.getElementById('root')!; const root = createRoot(host); let summaryCalls = 0;
  globalThis.fetch = (async (input) => {
    const url = String(input);
    if (url.includes('/summary?')) { summaryCalls++; return summaryCalls === 1 ? response(null, false, '汇总暂不可用') : response({ ...summary(7), cumulativeSteam: Number.NaN, latestTotalOil: null }); }
    return commonFetch()(input);
  }) as typeof fetch;
  await act(async () => root.render(createElement(ChannelingProjectManagement, { role: 'admin' })));
  assert.match(host.textContent || '', /汇总暂不可用/);
  assert.match(host.textContent || '', /保存治理信息/);
  const retry = [...host.querySelectorAll('button')].find((button) => button.textContent === '重试') as HTMLButtonElement;
  await act(async () => retry.click());
  assert.equal(summaryCalls, 2);
  assert.match(host.textContent || '', /累计注汽量\s*暂无数据/);
  assert.match(host.textContent || '', /最新日产油合计\s*暂无数据/);
  await act(async () => root.unmount()); dom.window.close();
});

test('overview has an independent loading state and represents empty metrics explicitly', async () => {
  const dom = setup(); const host = document.getElementById('root')!; const root = createRoot(host); let resolveSummary!: (value: Response) => void;
  const pendingSummary = new Promise<Response>((resolve) => { resolveSummary = resolve; });
  globalThis.fetch = (async (input) => String(input).includes('/summary?') ? pendingSummary : commonFetch()(input)) as typeof fetch;
  await act(async () => root.render(createElement(ChannelingProjectManagement, { role: 'guest' })));
  assert.match(host.textContent || '', /正在加载项目汇总/);
  await act(async () => { resolveSummary(await response({ ...summary(7), relationCount: 0, injectorCount: 0, producerCount: 0, uniqueWellCount: 0, cumulativeSteam: null, latestTotalOil: null, evaluatedCount: 0 })); await pendingSummary; });
  assert.match(host.textContent || '', /关系数量\s*0/);
  assert.match(host.textContent || '', /累计注汽量\s*暂无数据/);
  await act(async () => root.unmount()); dom.window.close();
});

test('does not request a project summary or timeline when no project is selected', async () => {
  const dom = setup(); const host = document.getElementById('root')!; const root = createRoot(host); const fetched: string[] = [];
  globalThis.fetch = (async (input) => { fetched.push(String(input)); return commonFetch([])(input); }) as typeof fetch;
  await act(async () => root.render(createElement(ChannelingProjectManagement, { role: 'guest' })));
  assert.ok(fetched.every((url) => !url.includes('/summary?') && !url.startsWith('/api/channeling-tracking-events?')));
  assert.match(host.textContent || '', /暂无项目详情/);
  await act(async () => root.unmount()); dom.window.close();
});

test('switching projects clears stale summary and timeline subject', async () => {
  const dom = setup(); const host = document.getElementById('root')!; const root = createRoot(host); let resolveOld!: (value: Response) => void;
  const oldSummary = new Promise<Response>((resolve) => { resolveOld = resolve; });
  const fetched: string[] = [];
  globalThis.fetch = (async (input) => {
    const url = String(input);
    fetched.push(url);
    if (url === '/api/channeling-projects') return response([project(7, '旧项目'), project(8, '新项目')]);
    if (url.includes('/7/summary?')) return oldSummary;
    if (url.includes('/8/summary?')) return response({ ...summary(8), relationCount: 8 });
    if (url.startsWith('/api/channeling-projects/pending') || url.includes('/relations') || url.includes('/relation-imports') || url.startsWith('/api/channeling-tracking-events?')) return response([]);
    throw new Error(url);
  }) as typeof fetch;
  await act(async () => root.render(createElement(StrictMode, null, createElement(ChannelingProjectManagement, { role: 'guest' }))));
  const next = [...host.querySelectorAll('button')].find((button) => button.textContent?.includes('新项目')) as HTMLButtonElement;
  await act(async () => next.click());
  assert.match(host.textContent || '', /关系数量\s*8/);
  await act(async () => { resolveOld(await response(summary(7))); await oldSummary; });
  assert.match(host.textContent || '', /关系数量\s*8/);
  const timelineTab = [...host.querySelectorAll('[role="tab"]')].find((tab) => tab.textContent === '跟踪时间线') as HTMLButtonElement;
  await act(async () => timelineTab.click());
  assert.ok(fetched.some((url) => url.includes('subjectType=project') && url.includes('subjectId=8')));
  assert.ok(fetched.filter((url) => url.startsWith('/api/channeling-tracking-events?')).every((url) => !url.includes('subjectId=7')));
  assert.equal(host.querySelector('form[aria-label="新增跟踪记录"]'), null, 'guest timeline remains read-only');
  await act(async () => root.unmount()); dom.window.close();
});
