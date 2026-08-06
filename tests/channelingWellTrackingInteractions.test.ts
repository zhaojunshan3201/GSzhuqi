import assert from 'node:assert/strict';
import test from 'node:test';
import { JSDOM } from 'jsdom';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { ChannelingWellTracking } from '../src/components/ChannelingWellTracking.tsx';
import type { ChannelingWellProfile, WellMetrics } from '../src/lib/channelingTrackingApi.ts';

const response = (data: unknown, init: { status?: number; success?: boolean; message?: string } = {}) => Promise.resolve(new Response(JSON.stringify({ success: init.success ?? true, data, message: init.message }), { status: init.status ?? 200 }));
const deferred = <T>() => { let resolve!: (value: T) => void; const promise = new Promise<T>((yes) => { resolve = yes; }); return { promise, resolve }; };

const profile = (id: number, wellNo: string, roles: Array<'injector' | 'producer'> = []): ChannelingWellProfile => ({ id, wellNo, normalizedWellNo: wellNo.toUpperCase(), block: '高3', owner: '周', createdAt: '2026-08-01T00:00:00Z', updatedAt: '2026-08-01T00:00:00Z', roles, relationCount: 1, projectCount: 1 });
const metrics = (roles: Array<'injector' | 'producer'>): WellMetrics => ({
  wellNo: '高3-1', normalizedWellNo: '高3-1', roles, queriedAt: '2026-08-06T08:30:00Z', range: { start: '2026-07-08', end: '2026-08-06' },
  injection: roles.includes('injector') ? { cycleCount: 2, cumulativeSteam: 180, stages: [{ cycleNo: 2, startDate: '2026-08-01', endDate: null, steamVolume: 100, temperature: 255, pressure: 12, dryness: .72, productionHours: 48 }] } : null,
  production: roles.includes('producer') ? { rows: [], latest: { date: '2026-08-05', oil: 12, liquid: 30, waterCut: .6, block: '高3' }, oil: { average: 11, validDays: 30 }, liquid: { average: 29, validDays: 30 }, waterCut: { average: .62, validDays: 30 }, last7Days: { oil: { average: 12, validDays: 7 }, liquid: { average: 31, validDays: 7 }, waterCut: { average: .61, validDays: 7 } }, last30Days: { oil: { average: 11, validDays: 30 }, liquid: { average: 29, validDays: 30 }, waterCut: { average: .62, validDays: 30 } } } : null,
});

function setup() {
  const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', { url: 'http://localhost' });
  Object.defineProperties(globalThis, { window: { configurable: true, value: dom.window }, document: { configurable: true, value: dom.window.document }, navigator: { configurable: true, value: dom.window.navigator }, HTMLElement: { configurable: true, value: dom.window.HTMLElement }, HTMLInputElement: { configurable: true, value: dom.window.HTMLInputElement }, Event: { configurable: true, value: dom.window.Event }, localStorage: { configurable: true, value: dom.window.localStorage }, IS_REACT_ACT_ENVIRONMENT: { configurable: true, value: true } });
  const host = document.getElementById('root')!; const root = createRoot(host); return { dom, host, root };
}
async function cleanup(root: Root, dom: JSDOM) { await act(async () => { root.unmount(); }); dom.window.close(); }
function change(input: HTMLInputElement, value: string) { Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')!.set!.call(input, value); input.dispatchEvent(new Event('input', { bubbles: true })); input.dispatchEvent(new Event('change', { bubbles: true })); }
const clickText = async (host: HTMLElement, text: string) => { const button = [...host.querySelectorAll('button')].find((item) => item.textContent?.includes(text)); assert.ok(button, text); await act(async () => { button.click(); }); };

test('admin can explicitly search and create or reuse a profile without duplicate submission', async () => {
  const { dom, host, root } = setup();
  const post = deferred<Response>(); let posts = 0; const getUrls: string[] = [];
  globalThis.fetch = (async (input, init) => {
    const url = String(input);
    if (init?.method === 'POST') { posts++; return post.promise; }
    getUrls.push(url);
    if (url.startsWith('/api/channeling-wells?')) return response(url.includes('query=H608') ? [profile(1, 'H608')] : []);
    if (url.includes('/metrics?')) return response(metrics([]));
    if (url.endsWith('/relations')) return response([]);
    return response(profile(1, 'H608'));
  }) as typeof fetch;
  await act(async () => { root.render(createElement(ChannelingWellTracking, { role: 'admin' })); });
  const search = host.querySelector('form[aria-label="搜索单井"]') as HTMLFormElement;
  await act(async () => { change(search.elements.namedItem('query') as HTMLInputElement, 'H608'); });
  await act(async () => { search.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); });
  assert.ok(getUrls.some((url) => url === '/api/channeling-wells?query=H608'));
  assert.match(host.textContent || '', /H608/);

  const create = host.querySelector('form[aria-label="新建或复用单井档案"]') as HTMLFormElement;
  await act(async () => { change(create.elements.namedItem('wellNo') as HTMLInputElement, 'H609'); change(create.elements.namedItem('block') as HTMLInputElement, '高4'); change(create.elements.namedItem('owner') as HTMLInputElement, '王'); });
  await act(async () => { create.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); create.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); });
  assert.equal(posts, 1);
  await act(async () => { post.resolve(await response(profile(2, 'H609'))); await post.promise; });
  assert.equal(posts, 1);
  assert.match(host.textContent || '', /H609/);
  assert.equal(host.querySelectorAll('[data-well-id="2"]').length, 1);
  await cleanup(root, dom);
});

test('guest sees a read-only profile list and no creation form', async () => {
  const { dom, host, root } = setup();
  globalThis.fetch = (async (input) => String(input).startsWith('/api/channeling-wells?') ? response([profile(1, '高3-1')]) : String(input).includes('/metrics?') ? response(metrics(['injector'])) : String(input).endsWith('/relations') ? response([]) : response(profile(1, '高3-1', ['injector']))) as typeof fetch;
  await act(async () => { root.render(createElement(ChannelingWellTracking, { role: 'guest' })); });
  assert.equal(host.querySelector('form[aria-label="新建或复用单井档案"]'), null);
  assert.match(host.textContent || '', /高3-1/);
  await cleanup(root, dom);
});

test('overview shows detected roles and a concise latest metric summary', async () => {
  const { dom, host, root } = setup();
  globalThis.fetch = (async (input) => {
    const url = String(input);
    if (url.startsWith('/api/channeling-wells?')) return response([]);
    if (url.includes('/metrics?')) return response(metrics(['injector', 'producer']));
    if (url.endsWith('/relations')) return response([]);
    return response(profile(1, '高3-1', ['injector', 'producer']));
  }) as typeof fetch;
  await act(async () => { root.render(createElement(ChannelingWellTracking, { role: 'guest', selectedWellId: 1 })); });
  for (const text of ['注汽井', '采油井', '最新指标摘要', '累计注汽量 180', '最新日产油 12']) assert.match(host.textContent || '', new RegExp(text));
  await cleanup(root, dom);
});

test('injector-only metrics show cycle count and latest stage fields', async () => {
  const { dom, host, root } = setup();
  globalThis.fetch = (async (input) => {
    const url = String(input);
    if (url.startsWith('/api/channeling-wells?')) return response([]);
    if (url.includes('/metrics?')) return response(metrics(['injector']));
    if (url.endsWith('/relations')) return response([]);
    return response(profile(1, '注井-1', ['injector']));
  }) as typeof fetch;
  await act(async () => { root.render(createElement(ChannelingWellTracking, { role: 'guest', selectedWellId: 1 })); });
  await clickText(host, '生产指标');
  for (const text of ['注汽指标', '周期数 2', '最新周期 2', '开始日期 2026-08-01', '蒸汽量 100', '温度 255', '压力 12', '干度 0.72', '生产时数 48']) assert.match(host.textContent || '', new RegExp(text));
  assert.doesNotMatch(host.textContent || '', /采油井指标/);
  await cleanup(root, dom);
});

test('producer-only metrics show latest and 7/30-day production values', async () => {
  const { dom, host, root } = setup();
  globalThis.fetch = (async (input) => {
    const url = String(input);
    if (url.startsWith('/api/channeling-wells?')) return response([]);
    if (url.includes('/metrics?')) return response(metrics(['producer']));
    if (url.endsWith('/relations')) return response([]);
    return response(profile(2, '采井-1', ['producer']));
  }) as typeof fetch;
  await act(async () => { root.render(createElement(ChannelingWellTracking, { role: 'guest', selectedWellId: 2 })); });
  await clickText(host, '生产指标');
  for (const text of ['采油井指标', '最新日产油 12', '最新日产液 30', '最新含水 0.6', '7日均值 12', '30日均值 11']) assert.match(host.textContent || '', new RegExp(text));
  assert.doesNotMatch(host.textContent || '', /注汽指标/);
  await cleanup(root, dom);
});

test('role-specific metric modules show explicit empty states', async () => {
  const { dom, host, root } = setup();
  const empty = metrics(['injector', 'producer']); empty.injection = { stages: [], cumulativeSteam: null, cycleCount: 0 }; empty.production = null;
  globalThis.fetch = (async (input) => {
    const url = String(input);
    if (url.startsWith('/api/channeling-wells?')) return response([]);
    if (url.includes('/metrics?')) return response(empty);
    if (url.endsWith('/relations')) return response([]);
    return response(profile(1, '空数据井', ['injector', 'producer']));
  }) as typeof fetch;
  await act(async () => { root.render(createElement(ChannelingWellTracking, { role: 'guest', selectedWellId: 1 })); });
  await clickText(host, '生产指标');
  assert.match(host.textContent || '', /未找到注汽数据/); assert.match(host.textContent || '', /未找到生产数据/); assert.match(host.textContent || '', /查询时间 2026-08-06T08:30:00Z/);
  await cleanup(root, dom);
});

test('failed creation preserves the controlled form values for retry', async () => {
  const { dom, host, root } = setup();
  globalThis.fetch = (async (_input, init) => init?.method === 'POST' ? response(undefined, { status: 409, success: false, message: '档案冲突' }) : response([])) as typeof fetch;
  await act(async () => { root.render(createElement(ChannelingWellTracking, { role: 'admin' })); });
  const form = host.querySelector('form[aria-label="新建或复用单井档案"]') as HTMLFormElement;
  await act(async () => { change(form.elements.namedItem('wellNo') as HTMLInputElement, '保留井'); change(form.elements.namedItem('block') as HTMLInputElement, '高5'); change(form.elements.namedItem('owner') as HTMLInputElement, '李'); });
  await act(async () => { form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); });
  assert.match(host.textContent || '', /档案冲突/); assert.equal((form.elements.namedItem('wellNo') as HTMLInputElement).value, '保留井'); assert.equal((form.elements.namedItem('block') as HTMLInputElement).value, '高5'); assert.equal((form.elements.namedItem('owner') as HTMLInputElement).value, '李');
  await cleanup(root, dom);
});

test('profile list exposes loading, error, retry, and empty states', async () => {
  const { dom, host, root } = setup(); const first = deferred<Response>(); let calls = 0;
  globalThis.fetch = (async () => { calls++; if (calls === 1) return first.promise; return response([]); }) as typeof fetch;
  await act(async () => { root.render(createElement(ChannelingWellTracking, { role: 'guest' })); });
  assert.match(host.textContent || '', /正在加载单井档案/);
  await act(async () => { first.resolve(await response(undefined, { status: 503, success: false, message: '档案服务失败' })); await first.promise; });
  assert.match(host.textContent || '', /档案服务失败/); await clickText(host, '重试'); assert.equal(calls, 2); assert.match(host.textContent || '', /暂无单井档案/);
  await cleanup(root, dom);
});

test('a delayed create cannot overwrite state after external selection changes', async () => {
  const { dom, host, root } = setup(); const pending = deferred<Response>();
  globalThis.fetch = (async (input, init) => {
    const url = String(input);
    if (init?.method === 'POST') return pending.promise;
    if (url.startsWith('/api/channeling-wells?')) return response([profile(1, '原井'), profile(2, '当前井')]);
    if (url.includes('/metrics?')) return response(metrics([]));
    if (url.endsWith('/relations')) return response([]);
    return response(url.endsWith('/2') ? profile(2, '当前井') : profile(1, '原井'));
  }) as typeof fetch;
  await act(async () => { root.render(createElement(ChannelingWellTracking, { role: 'admin', selectedWellId: 1 })); });
  const form = host.querySelector('form[aria-label="新建或复用单井档案"]') as HTMLFormElement;
  await act(async () => { change(form.elements.namedItem('wellNo') as HTMLInputElement, '迟到井'); });
  await act(async () => { form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); });
  await act(async () => { root.render(createElement(ChannelingWellTracking, { role: 'admin', selectedWellId: 2 })); });
  assert.equal((form.elements.namedItem('wellNo') as HTMLInputElement).value, '迟到井'); assert.equal((form.querySelector('button[type="submit"]') as HTMLButtonElement).disabled, false);
  await act(async () => { pending.resolve(await response(profile(3, '迟到井'))); await pending.promise; });
  assert.match(host.textContent || '', /当前井/); assert.equal(host.querySelector('[data-well-id="3"]'), null); assert.equal((form.elements.namedItem('wellNo') as HTMLInputElement).value, '迟到井');
  await cleanup(root, dom);
});

test('unmount invalidates a delayed create mutation', async () => {
  const { dom, host, root } = setup(); const pending = deferred<Response>(); let detailLoads = 0;
  globalThis.fetch = (async (_input, init) => { if (init?.method === 'POST') return pending.promise; detailLoads++; return response([]); }) as typeof fetch;
  await act(async () => { root.render(createElement(ChannelingWellTracking, { role: 'admin' })); });
  const form = host.querySelector('form[aria-label="新建或复用单井档案"]') as HTMLFormElement;
  await act(async () => { change(form.elements.namedItem('wellNo') as HTMLInputElement, '卸载井'); });
  await act(async () => { form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); });
  await cleanup(root, dom); const before = detailLoads;
  await act(async () => { pending.resolve(await response(profile(8, '卸载井'))); await pending.promise; });
  assert.equal(detailLoads, before);
});

test('dual-role metrics, missing values, query time, relations callback, and well timeline are rendered', async () => {
  const { dom, host, root } = setup(); let opened = 0;
  globalThis.fetch = (async (input) => {
    const url = String(input);
    if (url.startsWith('/api/channeling-wells?')) return response([profile(1, '高3-1', ['injector', 'producer'])]);
    if (url.includes('/metrics?')) { const value = metrics(['injector', 'producer']); value.injection!.stages[0].endDate = null; return response(value); }
    if (url.endsWith('/relations')) return response([{ id: 9, injectionWell: '高3-1', productionWell: '高3-2', status: 'confirmed', channelingType: '注汽窜', confidence: null, evidence: '', owner: '周', effectiveStartDate: '2026-08-01', effectiveEndDate: null, project: { id: 3, name: '蒸汽窜', block: '高3' } }]);
    if (url.includes('channeling-tracking-events')) return response([]);
    return response(profile(1, '高3-1', ['injector', 'producer']));
  }) as typeof fetch;
  await act(async () => { root.render(createElement(ChannelingWellTracking, { role: 'guest', selectedWellId: 1, onOpenRelation: (id) => { opened = id; } })); });
  await clickText(host, '生产指标');
  for (const value of ['注汽指标', '周期 2', '累计注汽量 180', '温度 255', '压力 12', '干度 0.72', '生产时数 48', '采油井指标', '最新日产油 12', '7日均值 12', '30日均值 11', '查询时间 2026-08-06T08:30:00Z', '暂无']) assert.match(host.textContent || '', new RegExp(value));
  await clickText(host, '关联关系');
  assert.match(host.textContent || '', /高3-1 → 高3-2/); await clickText(host, '查看关系详情'); assert.equal(opened, 9);
  await clickText(host, '跟踪记录');
  assert.ok(host.querySelector('[aria-label="跟踪记录时间线"]'));
  await cleanup(root, dom);
});

test('detail modules fail independently and expose retry controls', async () => {
  const { dom, host, root } = setup(); let metricCalls = 0;
  globalThis.fetch = (async (input) => {
    const url = String(input);
    if (url.startsWith('/api/channeling-wells?')) return response([profile(1, 'H1')]);
    if (url.includes('/metrics?')) { metricCalls++; return metricCalls === 1 ? response(undefined, { status: 503, success: false, message: '指标加载失败' }) : response(metrics(['injector'])); }
    if (url.endsWith('/relations')) return response(undefined, { status: 500, success: false, message: '关系加载失败' });
    return response(profile(1, 'H1', ['injector']));
  }) as typeof fetch;
  await act(async () => { root.render(createElement(ChannelingWellTracking, { role: 'guest', selectedWellId: 1 })); });
  await clickText(host, '生产指标'); assert.match(host.textContent || '', /指标加载失败/); await clickText(host, '重试指标'); assert.equal(metricCalls, 2); assert.match(host.textContent || '', /注汽指标/);
  await clickText(host, '关联关系'); assert.match(host.textContent || '', /关系加载失败/); assert.match(host.textContent || '', /重试关系/);
  await cleanup(root, dom);
});

test('stale selected-well responses cannot overwrite the current selection', async () => {
  const { dom, host, root } = setup(); const old = deferred<Response>();
  globalThis.fetch = (async (input) => {
    const url = String(input);
    if (url.startsWith('/api/channeling-wells?')) return response([]);
    if (url === '/api/channeling-wells/1') return old.promise;
    if (url === '/api/channeling-wells/2') return response(profile(2, '当前井'));
    if (url.includes('/metrics')) return response(metrics([]));
    if (url.includes('/relations')) return response([]);
    return response([]);
  }) as typeof fetch;
  await act(async () => { root.render(createElement(ChannelingWellTracking, { role: 'guest', selectedWellId: 1 })); });
  await act(async () => { root.render(createElement(ChannelingWellTracking, { role: 'guest', selectedWellId: 2 })); });
  assert.match(host.textContent || '', /当前井/);
  await act(async () => { old.resolve(await response(profile(1, '旧井'))); await old.promise; });
  assert.match(host.textContent || '', /当前井/); assert.doesNotMatch(host.textContent || '', /旧井/);
  await cleanup(root, dom);
});
