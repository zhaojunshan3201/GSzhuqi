import assert from 'node:assert/strict';
import test from 'node:test';
import { JSDOM } from 'jsdom';
import { act, createElement, StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { ChannelingProjectManagement } from '../src/components/ChannelingProjectManagement.tsx';

const project = (id: number, name = `项目${id}`) => ({ id, projectName: name, block: '一区', owner: '负责人', status: 'identified', governanceMeasure: '', plannedDate: null, actualDate: null, beforeMetric: null, afterMetric: null, closureEvidence: '', riskLevel: 'medium', estimatedLoss: null, affectedWellCount: null, affectedDailyOil: null, occupiedProduction: null, createdAt: '', updatedAt: '' });
const summary = (id: number) => ({ projectId: id, start: '2026-07-08', end: '2026-08-06', range: { start: '2026-07-08', end: '2026-08-06' }, generatedAt: '2026-08-06T02:03:04.000Z', latestAvailableDate: '2026-08-06', relationCount: 3, activeRelationCount: 2, releasedRelationCount: 1, injectorCount: 2, producerCount: 2, uniqueWellCount: 3, cumulativeSteam: 120.5, initialTotalOil: 6.2, latestTotalOil: 8.2, totalOilChange: 2, evaluatedCount: 1, latestEvaluationConclusion: '有效' });
const response = (data: unknown, ok = true, message = '') => {
  const body = JSON.stringify({ success: ok, data, message });
  return Promise.resolve({ ok, status: ok ? 200 : 500, json: async () => JSON.parse(body), text: async () => body } as Response);
};

const setup = () => {
  const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', { url: 'http://localhost' });
  Object.defineProperties(globalThis, { window: { configurable: true, value: dom.window }, document: { configurable: true, value: dom.window.document }, navigator: { configurable: true, value: dom.window.navigator }, HTMLElement: { configurable: true, value: dom.window.HTMLElement }, HTMLInputElement: { configurable: true, value: dom.window.HTMLInputElement }, Event: { configurable: true, value: dom.window.Event }, InputEvent: { configurable: true, value: dom.window.InputEvent }, KeyboardEvent: { configurable: true, value: dom.window.KeyboardEvent }, localStorage: { configurable: true, value: dom.window.localStorage }, IS_REACT_ACT_ENVIRONMENT: { configurable: true, value: true } });
  return dom;
};
const changeInput = (input: HTMLInputElement, value: string) => {
  Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')!.set!.call(input, value);
  input.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: value }));
  input.dispatchEvent(new Event('change', { bubbles: true }));
};
const changeText = (input: HTMLInputElement | HTMLTextAreaElement, value: string) => {
  const prototype = input instanceof window.HTMLTextAreaElement ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(prototype, 'value')!.set!.call(input, value);
  input.dispatchEvent(new Event('input', { bubbles: true }));
  input.dispatchEvent(new Event('change', { bubbles: true }));
};

const commonFetch = (projects = [project(7)]) => (async (input: RequestInfo | URL) => {
  const url = String(input);
  if (url === '/api/channeling-projects') return response(projects);
  if (url.startsWith('/api/channeling-projects/pending')) return response([]);
  if (url.includes('/relations') || url.includes('/relation-imports')) return response([]);
  if (/\/summary(?:\?|$)/.test(url)) return response(summary(Number(url.match(/projects\/(\d+)/)?.[1])));
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
  assert.match(host.textContent || '', /有效关系数量\s*2/);
  assert.match(host.textContent || '', /已解除关系数量\s*1/);
  assert.match(host.textContent || '', /注入井数量\s*2/);
  assert.match(host.textContent || '', /生产井数量\s*2/);
  assert.match(host.textContent || '', /去重井数\s*3/);
  assert.match(host.textContent || '', /累计注汽量\s*120\.5/);
  assert.match(host.textContent || '', /最新日产油合计\s*8\.2/);
  assert.match(host.textContent || '', /期初日产油合计\s*6\.2/);
  assert.match(host.textContent || '', /日产油合计变化\s*2/);
  assert.match(host.textContent || '', /已评价次数\s*1/);
  assert.match(host.textContent || '', /最新评价结论\s*有效/);
  assert.ok(host.querySelector('form'), 'governance forms remain available');
  await act(async () => tabs[1].click()); assert.ok(host.querySelector('select[aria-label="注窜类型筛选"]'));
  await act(async () => tabs[2].click()); assert.match(host.textContent || '', /跟踪记录/); assert.ok(host.querySelector('form[aria-label="新增跟踪记录"]'));
  await act(async () => root.unmount()); dom.window.close();
});

test('overview drafts dates without requests and applies one valid final range', async () => {
  const dom = setup(); const host = document.getElementById('root')!; const root = createRoot(host); const urls: string[] = [];
  globalThis.fetch = (async (input) => { const url = String(input); urls.push(url); return commonFetch()(input); }) as typeof fetch;
  await act(async () => root.render(createElement(ChannelingProjectManagement, { role: 'guest' })));
  const start = host.querySelector('input[aria-label="汇总开始日期"]') as HTMLInputElement;
  const end = host.querySelector('input[aria-label="汇总结束日期"]') as HTMLInputElement;
  assert.equal(end.value, '2026-08-06');
  assert.equal(start.value, '2026-07-08');
  assert.ok(urls.includes('/api/channeling-projects/7/summary'), 'initial range comes from the backend default summary');
  assert.equal(urls.filter((url) => /\/summary(?:\?|$)/.test(url)).length, 1, 'backend defaults do not trigger a second explicit-range load');
  await act(async () => changeInput(start, '9999-12-31'));
  assert.doesNotMatch(host.textContent || '', /开始日期不能晚于结束日期/);
  assert.equal(urls.filter((url) => url.includes('/summary?')).length, 0);
  const apply = [...host.querySelectorAll('button')].find((button) => button.textContent === '应用统计范围') as HTMLButtonElement;
  await act(async () => apply.click());
  assert.match(host.textContent || '', /开始日期不能晚于结束日期/);
  assert.equal(urls.filter((url) => url.includes('/summary?')).length, 0);
  await act(async () => changeInput(start, '2026-08-01'));
  assert.equal(urls.filter((url) => url.includes('/summary?')).length, 0);
  await act(async () => apply.click());
  assert.ok(urls.some((url) => url.includes('/summary?start=2026-08-01&end=2026-08-06')));
  await act(async () => root.unmount()); dom.window.close();
});

test('summary error is isolated, retry works and malformed values render as missing', async () => {
  const dom = setup(); const host = document.getElementById('root')!; const root = createRoot(host); let summaryCalls = 0;
  globalThis.fetch = (async (input) => {
    const url = String(input);
    if (/\/summary(?:\?|$)/.test(url)) { summaryCalls++; return summaryCalls <= 2 ? response(null, false, '汇总暂不可用') : response({ ...summary(7), cumulativeSteam: Number.NaN, latestTotalOil: null }); }
    return commonFetch()(input);
  }) as typeof fetch;
  await act(async () => root.render(createElement(ChannelingProjectManagement, { role: 'admin' })));
  assert.match(host.textContent || '', /汇总暂不可用/);
  assert.match(host.textContent || '', /保存治理信息/);
  const timeline = [...host.querySelectorAll('[role="tab"]')].find((tab) => tab.textContent === '跟踪时间线') as HTMLButtonElement;
  await act(async () => timeline.click());
  assert.match(host.textContent || '', /新增跟踪记录/);
  const overview = [...host.querySelectorAll('[role="tab"]')].find((tab) => tab.textContent === '项目概览') as HTMLButtonElement;
  await act(async () => overview.click());
  const retry = [...host.querySelectorAll('button')].find((button) => button.textContent === '重试') as HTMLButtonElement;
  await act(async () => retry.click());
  assert.equal(summaryCalls, 3);
  assert.match(host.textContent || '', /累计注汽量\s*暂无数据/);
  assert.match(host.textContent || '', /最新日产油合计\s*暂无数据/);
  await act(async () => root.unmount()); dom.window.close();
});

test('a newly applied range aborts the prior pending applied request', async () => {
  const dom = setup(); const host = document.getElementById('root')!; const root = createRoot(host); const pendingSignals: AbortSignal[] = []; let explicitCalls = 0;
  globalThis.fetch = (async (input, init) => {
    const url = String(input);
    if (url.endsWith('/summary')) return response(summary(7));
    if (url.includes('/summary?')) { explicitCalls++; if (init?.signal) pendingSignals.push(init.signal); return new Promise<Response>(() => {}); }
    return commonFetch()(input);
  }) as typeof fetch;
  await act(async () => root.render(createElement(ChannelingProjectManagement, { role: 'guest' })));
  const start = host.querySelector('input[aria-label="汇总开始日期"]') as HTMLInputElement;
  await act(async () => changeInput(start, '2026-08-01'));
  assert.equal(explicitCalls, 0, 'editing a draft does not fetch');
  const apply = [...host.querySelectorAll('button')].find((button) => button.textContent === '应用统计范围') as HTMLButtonElement;
  await act(async () => apply.click());
  assert.match(host.textContent || '', /正在加载项目汇总/);
  await act(async () => changeInput(start, '2026-07-01'));
  assert.equal(explicitCalls, 1);
  await act(async () => apply.click());
  assert.equal(explicitCalls, 2);
  assert.equal(pendingSignals[0]?.aborted, true);
  assert.equal(pendingSignals[1]?.aborted, false);
  await act(async () => root.unmount()); dom.window.close();
});

test('a delayed default response preserves a user-edited draft field and hydrates the untouched field', async () => {
  const dom = setup(); const host = document.getElementById('root')!; const root = createRoot(host); let resolveDefault!: (value: Response) => void; const fetched: string[] = [];
  const pendingDefault = new Promise<Response>((resolve) => { resolveDefault = resolve; });
  globalThis.fetch = (async (input) => { const url = String(input); fetched.push(url); return url.endsWith('/summary') ? pendingDefault : commonFetch()(input); }) as typeof fetch;
  await act(async () => root.render(createElement(ChannelingProjectManagement, { role: 'guest' })));
  const start = host.querySelector('input[aria-label="汇总开始日期"]') as HTMLInputElement;
  const end = host.querySelector('input[aria-label="汇总结束日期"]') as HTMLInputElement;
  await act(async () => changeInput(start, '2026-08-01'));
  await act(async () => { resolveDefault(await response(summary(7))); await pendingDefault; });
  assert.equal(start.value, '2026-08-01');
  assert.equal(end.value, '2026-08-06');
  assert.equal(fetched.filter((url) => /\/summary(?:\?|$)/.test(url)).length, 1);
  await act(async () => root.unmount()); dom.window.close();
});

test('a delayed default response preserves both user-edited draft fields without another request', async () => {
  const dom = setup(); const host = document.getElementById('root')!; const root = createRoot(host); let resolveDefault!: (value: Response) => void; const fetched: string[] = [];
  const pendingDefault = new Promise<Response>((resolve) => { resolveDefault = resolve; });
  globalThis.fetch = (async (input) => { const url = String(input); fetched.push(url); return url.endsWith('/summary') ? pendingDefault : commonFetch()(input); }) as typeof fetch;
  await act(async () => root.render(createElement(ChannelingProjectManagement, { role: 'guest' })));
  const start = host.querySelector('input[aria-label="汇总开始日期"]') as HTMLInputElement;
  const end = host.querySelector('input[aria-label="汇总结束日期"]') as HTMLInputElement;
  await act(async () => { changeInput(start, '2026-07-01'); changeInput(end, '2026-07-31'); });
  await act(async () => { resolveDefault(await response(summary(7))); await pendingDefault; });
  assert.deepEqual([start.value, end.value], ['2026-07-01', '2026-07-31']);
  assert.equal(fetched.filter((url) => /\/summary(?:\?|$)/.test(url)).length, 1);
  await act(async () => root.unmount()); dom.window.close();
});

test('project detail tabs support roving keyboard navigation', async () => {
  const dom = setup(); const host = document.getElementById('root')!; const root = createRoot(host); globalThis.fetch = commonFetch();
  await act(async () => root.render(createElement(ChannelingProjectManagement, { role: 'guest' })));
  const tabs = [...host.querySelectorAll('[role="tab"]')] as HTMLButtonElement[];
  assert.deepEqual(tabs.map((tab) => tab.tabIndex), [0, -1, -1]);
  tabs[0].focus();
  await act(async () => tabs[0].dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true })));
  assert.equal(tabs[1].getAttribute('aria-selected'), 'true'); assert.equal(document.activeElement, tabs[1]);
  await act(async () => tabs[1].dispatchEvent(new KeyboardEvent('keydown', { key: 'End', bubbles: true })));
  assert.equal(tabs[2].getAttribute('aria-selected'), 'true'); assert.equal(document.activeElement, tabs[2]);
  await act(async () => tabs[2].dispatchEvent(new KeyboardEvent('keydown', { key: 'Home', bubbles: true })));
  assert.equal(tabs[0].getAttribute('aria-selected'), 'true'); assert.equal(document.activeElement, tabs[0]);
  await act(async () => root.unmount()); dom.window.close();
});

test('switching projects from an active timeline resets synchronously without fetching the new project timeline', async () => {
  const dom = setup(); const host = document.getElementById('root')!; const root = createRoot(host); const fetched: string[] = [];
  globalThis.fetch = (async (input) => { const url = String(input); fetched.push(url); return commonFetch([project(7, '旧项目'), project(8, '新项目')])(input); }) as typeof fetch;
  await act(async () => root.render(createElement(ChannelingProjectManagement, { role: 'guest' })));
  const timeline = [...host.querySelectorAll('[role="tab"]')].find((tab) => tab.textContent === '跟踪时间线') as HTMLButtonElement;
  await act(async () => timeline.click());
  assert.ok(fetched.some((url) => url.includes('subjectId=7')));
  const next = [...host.querySelectorAll('button')].find((button) => button.textContent?.includes('新项目')) as HTMLButtonElement;
  await act(async () => next.click());
  assert.equal([...host.querySelectorAll('[role="tab"]')].find((tab) => tab.textContent === '项目概览')?.getAttribute('aria-selected'), 'true');
  assert.ok(fetched.every((url) => !url.includes('subjectId=8')));
  await act(async () => root.unmount()); dom.window.close();
});

test('StrictMode unmount aborts every unresolved default summary request', async () => {
  const dom = setup(); const host = document.getElementById('root')!; const root = createRoot(host); const signals: AbortSignal[] = [];
  globalThis.fetch = (async (input, init) => {
    if (String(input).endsWith('/summary')) { if (init?.signal) signals.push(init.signal); return new Promise<Response>(() => {}); }
    return commonFetch()(input);
  }) as typeof fetch;
  await act(async () => root.render(createElement(StrictMode, null, createElement(ChannelingProjectManagement, { role: 'guest' }))));
  assert.ok(signals.length >= 1);
  await act(async () => root.unmount());
  assert.ok(signals.every((signal) => signal.aborted));
  dom.window.close();
});

test('overview has an independent loading state and represents empty metrics explicitly', async () => {
  const dom = setup(); const host = document.getElementById('root')!; const root = createRoot(host); let resolveSummary!: (value: Response) => void;
  const pendingSummary = new Promise<Response>((resolve) => { resolveSummary = resolve; });
  globalThis.fetch = (async (input) => /\/summary(?:\?|$)/.test(String(input)) ? pendingSummary : commonFetch()(input)) as typeof fetch;
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
  assert.ok(fetched.every((url) => !/\/summary(?:\?|$)/.test(url) && !url.startsWith('/api/channeling-tracking-events?')));
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
    if (url.endsWith('/7/summary')) return oldSummary;
    if (url.endsWith('/8/summary')) return response({ ...summary(8), relationCount: 8 });
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

test('admin submits one manual project evaluation for the applied range and refreshes the automatic summary', async () => {
  const dom = setup(); const host = document.getElementById('root')!; const root = createRoot(host);
  let summaryCalls = 0; let posts = 0; let posted: any; let resolvePost!: (value: Response) => void;
  const pendingPost = new Promise<Response>((resolve) => { resolvePost = resolve; });
  let resolveRefresh!: (value: Response) => void; const pendingRefresh = new Promise<Response>((resolve) => { resolveRefresh = resolve; });
  globalThis.fetch = (async (input, init) => {
    const url = String(input);
    if (url.endsWith('/evaluations') && init?.method === 'POST') { posts++; posted = JSON.parse(String(init.body)); return pendingPost; }
    if (/\/summary(?:\?|$)/.test(url)) { summaryCalls++; return summaryCalls === 1 ? response(summary(7)) : pendingRefresh; }
    return commonFetch()(input);
  }) as typeof fetch;
  await act(async () => root.render(createElement(ChannelingProjectManagement, { role: 'admin' })));
  const form = host.querySelector('form[aria-label="人工项目评价"]') as HTMLFormElement; assert.ok(form);
  await act(async () => { changeText(form.elements.namedItem('conclusion') as HTMLTextAreaElement, '治理有效'); changeText(form.elements.namedItem('evidence') as HTMLInputElement, '日报附件'); changeText(form.elements.namedItem('owner') as HTMLInputElement, '评价人'); });
  await act(async () => { form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); });
  assert.equal(posts, 1); assert.deepEqual(posted, { occurredOn: '2026-08-06', conclusion: '治理有效', evidence: '日报附件', owner: '评价人', range: { start: '2026-07-08', end: '2026-08-06' } });
  const summaryStart = host.querySelector('input[aria-label="汇总开始日期"]') as HTMLInputElement; const summaryEnd = host.querySelector('input[aria-label="汇总结束日期"]') as HTMLInputElement;
  const conclusion = form.elements.namedItem('conclusion') as HTMLTextAreaElement; const evidence = form.elements.namedItem('evidence') as HTMLInputElement; const owner = form.elements.namedItem('owner') as HTMLInputElement;
  assert.ok(summaryStart.disabled && summaryEnd.disabled && conclusion.disabled && evidence.disabled && owner.disabled);
  await act(async () => { changeInput(summaryStart, '2026-08-01'); changeText(conclusion, '迟到新结论'); changeText(evidence, '迟到新证据'); changeText(owner, '迟到新负责人'); });
  await act(async () => root.render(createElement(ChannelingProjectManagement, { role: 'admin' })));
  assert.deepEqual([summaryStart.value, summaryEnd.value, conclusion.value, evidence.value, owner.value], ['2026-07-08', '2026-08-06', '治理有效', '日报附件', '评价人']);
  await act(async () => { resolvePost(await response({ id: 44, eventType: 'evaluated' })); await pendingPost; });
  assert.equal(summaryCalls, 2); assert.match(host.textContent || '', /项目评价已保存/); assert.match(host.textContent || '', /正在加载项目汇总/);
  await act(async () => { resolveRefresh(await response({ ...summary(7), evaluatedCount: 2, latestEvaluationConclusion: '治理有效' })); await pendingRefresh; });
  assert.match(host.textContent || '', /已评价次数\s*2/); assert.match(host.textContent || '', /最新评价结论\s*治理有效/);
  const refreshedForm = host.querySelector('form[aria-label="人工项目评价"]') as HTMLFormElement; assert.equal((refreshedForm.elements.namedItem('conclusion') as HTMLTextAreaElement).value, ''); assert.equal((refreshedForm.querySelector('button[type="submit"]') as HTMLButtonElement).disabled, false);
  await act(async () => root.unmount()); dom.window.close();
});

test('manual project evaluation is admin-only and preserves drafts on API failure', async () => {
  const guest = setup(); const guestHost = document.getElementById('root')!; const guestRoot = createRoot(guestHost); globalThis.fetch = commonFetch();
  await act(async () => guestRoot.render(createElement(ChannelingProjectManagement, { role: 'guest' })));
  assert.equal(guestHost.querySelector('form[aria-label="人工项目评价"]'), null); await act(async () => guestRoot.unmount()); guest.window.close();

  const dom = setup(); const host = document.getElementById('root')!; const root = createRoot(host);
  globalThis.fetch = (async (input, init) => String(input).endsWith('/evaluations') && init?.method === 'POST' ? response(undefined, false, '评价保存失败') : commonFetch()(input)) as typeof fetch;
  await act(async () => root.render(createElement(ChannelingProjectManagement, { role: 'admin' })));
  const form = host.querySelector('form[aria-label="人工项目评价"]') as HTMLFormElement;
  await act(async () => { changeText(form.elements.namedItem('conclusion') as HTMLTextAreaElement, '保留结论'); changeText(form.elements.namedItem('evidence') as HTMLInputElement, '保留证据'); changeText(form.elements.namedItem('owner') as HTMLInputElement, '保留负责人'); });
  await act(async () => form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
  assert.match(host.textContent || '', /评价保存失败/); assert.equal((form.elements.namedItem('conclusion') as HTMLTextAreaElement).value, '保留结论'); assert.equal((form.elements.namedItem('evidence') as HTMLInputElement).value, '保留证据');
  await act(async () => root.unmount()); dom.window.close();
});

test('a delayed manual evaluation cannot refresh or acknowledge after switching projects', async () => {
  const dom = setup(); const host = document.getElementById('root')!; const root = createRoot(host); let resolvePost!: (value: Response) => void; const pending = new Promise<Response>((resolve) => { resolvePost = resolve; }); const summaryUrls: string[] = [];
  globalThis.fetch = (async (input, init) => {
    const url = String(input); if (url.endsWith('/evaluations') && init?.method === 'POST') return pending;
    if (url.includes('/summary')) { summaryUrls.push(url); return response(summary(Number(url.match(/projects\/(\d+)/)?.[1]))); }
    return commonFetch([project(7, '旧项目'), project(8, '新项目')])(input);
  }) as typeof fetch;
  await act(async () => root.render(createElement(StrictMode, null, createElement(ChannelingProjectManagement, { role: 'admin' }))));
  const form = host.querySelector('form[aria-label="人工项目评价"]') as HTMLFormElement;
  await act(async () => { changeText(form.elements.namedItem('conclusion') as HTMLTextAreaElement, '迟到结论'); changeText(form.elements.namedItem('owner') as HTMLInputElement, '评价人'); });
  await act(async () => form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
  const next = [...host.querySelectorAll('button')].find((button) => button.textContent?.includes('新项目')) as HTMLButtonElement; await act(async () => next.click());
  await act(async () => { resolvePost(await response({ id: 55, eventType: 'evaluated' })); await pending; });
  assert.doesNotMatch(host.textContent || '', /项目评价已保存/); assert.match(host.textContent || '', /新项目/); assert.equal(summaryUrls.filter((url) => url.includes('/7/summary')).length, 2, 'StrictMode initial loads only; no mutation refresh');
  await act(async () => root.unmount()); dom.window.close();
});
