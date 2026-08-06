import assert from 'node:assert/strict';
import test from 'node:test';
import { JSDOM } from 'jsdom';
import { act, createElement, StrictMode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { ChannelingRelationDetail } from '../src/components/ChannelingRelationDetail.tsx';

const reply = (data: unknown, status = 200, success = true, message?: string) => Promise.resolve(new Response(JSON.stringify({ success, data, message }), { status }));
const deferred = <T>() => { let resolve!: (value: T) => void; const promise = new Promise<T>((yes) => { resolve = yes; }); return { promise, resolve }; };
const detail = (id = 7) => ({
  relationId: id, injectionWell: `注${id}`, productionWell: `采${id}`,
  range: { beforeStart: '2026-07-01', splitDate: '2026-07-16', afterEnd: '2026-07-31' }, generatedAt: '2026-08-06T01:00:00Z',
  injector: { wellNo: `注${id}`, normalizedWellNo: `注${id}`, roles: ['injector'], queriedAt: '2026-08-06T01:00:00Z', range: { start: '2026-07-01', end: '2026-07-31' }, production: null, injection: { cycleCount: 1, cumulativeSteam: 220, stages: [{ cycleNo: 1, startDate: '2026-07-10', endDate: '2026-07-12', steamVolume: 220, temperature: 260, pressure: 12, dryness: .75, productionHours: 48 }] } },
  producerSeries: [{ date: '2026-07-15', oil: 10, liquid: 30, waterCut: .67, block: '高3' }, { date: '2026-07-20', oil: 13, liquid: 32, waterCut: .59, block: '高3' }],
  comparison: { oil: { beforeAverage: 10, afterAverage: 13, change: 3, changeRate: .3, beforeValidDays: 1, afterValidDays: 1 }, liquid: { beforeAverage: 30, afterAverage: 32, change: 2, changeRate: .067, beforeValidDays: 1, afterValidDays: 1 }, waterCut: { beforeAverage: .67, afterAverage: .59, change: -.08, changeRate: -.119, beforeValidDays: 1, afterValidDays: 1 } },
});
const relation = { id: 7, channelingType: 'steam', injectionWell: '注7', productionWell: '采7', reservoirLayer: 'S1', impactLevel: 'high', confidence: .9, status: 'confirmed', source: 'manual', evidence: '示踪剂', owner: '周', project: { id: 1, name: '项目', block: '高3' } };
function setup() {
  const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', { url: 'http://localhost' });
  Object.defineProperties(globalThis, { window: { configurable: true, value: dom.window }, document: { configurable: true, value: dom.window.document }, navigator: { configurable: true, value: dom.window.navigator }, HTMLElement: { configurable: true, value: dom.window.HTMLElement }, HTMLInputElement: { configurable: true, value: dom.window.HTMLInputElement }, HTMLTextAreaElement: { configurable: true, value: dom.window.HTMLTextAreaElement }, Event: { configurable: true, value: dom.window.Event }, localStorage: { configurable: true, value: dom.window.localStorage }, IS_REACT_ACT_ENVIRONMENT: { configurable: true, value: true } });
  const host = document.getElementById('root')!; return { dom, host, root: createRoot(host) };
}
async function cleanup(root: Root, dom: JSDOM) { await act(async () => root.unmount()); dom.window.close(); }
function input(form: HTMLFormElement, name: string, value: string) { const node = form.elements.namedItem(name) as HTMLInputElement | HTMLTextAreaElement; const proto = node instanceof window.HTMLTextAreaElement ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype; Object.getOwnPropertyDescriptor(proto, 'value')!.set!.call(node, value); node.dispatchEvent(new Event('input', { bubbles: true })); node.dispatchEvent(new Event('change', { bubbles: true })); }
async function click(host: HTMLElement, text: string) { const button = [...host.querySelectorAll('button')].find((node) => node.textContent?.includes(text)); assert.ok(button, text); await act(async () => button.click()); }
function mockReads(id = 7) { return (async (raw: RequestInfo | URL) => { const url = String(raw); if (url.includes('/detail?')) return reply(detail(id)); if (url.startsWith('/api/channeling-wells?')) return reply([{ id: url.includes(encodeURIComponent(`注${id}`)) ? 11 : 12, wellNo: url.includes(encodeURIComponent(`注${id}`)) ? `注${id}` : `采${id}`, normalizedWellNo: '', block: '高3', owner: '周', createdAt: '', updatedAt: '' }]); if (url.endsWith('/relations')) return reply([relation]); if (url.startsWith('/api/channeling-tracking-events?')) return reply([]); throw new Error(`unexpected ${url}`); }) as typeof fetch; }

test('renders relation facts and aligned metrics and opens both well profiles', async () => {
  const { dom, host, root } = setup(); globalThis.fetch = mockReads(); const opened: number[] = [];
  await act(async () => root.render(createElement(ChannelingRelationDetail, { role: 'guest', relationId: 7, onOpenWell: (id) => opened.push(id), onBack: () => {} })));
  assert.match(host.textContent || '', /注7.*采7/); assert.match(host.textContent || '', /已确认/); assert.match(host.textContent || '', /示踪剂/);
  await click(host, '注入井：注7'); await click(host, '生产井：采7'); assert.deepEqual(opened, [11, 12]);
  await click(host, '联动指标'); assert.match(host.textContent || '', /注汽量/); assert.match(host.textContent || '', /日产油/); assert.match(host.textContent || '', /日产液/); assert.match(host.textContent || '', /含水/); assert.match(host.textContent || '', /查询时间/);
  await cleanup(root, dom);
});

test('guest is read-only while admin validates evaluation order and preserves failed input', async () => {
  const guest = setup(); globalThis.fetch = mockReads(); await act(async () => guest.root.render(createElement(ChannelingRelationDetail, { role: 'guest', relationId: 7, onOpenWell: () => {}, onBack: () => {} }))); await click(guest.host, '效果评价'); assert.equal(guest.host.querySelector('form[aria-label="新增效果评价"]'), null); await cleanup(guest.root, guest.dom);
  const admin = setup(); let posts = 0; globalThis.fetch = (async (raw, init) => { if (init?.method === 'POST') { posts++; return reply(null, 500, false, '保存失败'); } return mockReads()(raw, init); }) as typeof fetch;
  await act(async () => admin.root.render(createElement(ChannelingRelationDetail, { role: 'admin', relationId: 7, onOpenWell: () => {}, onBack: () => {} }))); await click(admin.host, '效果评价');
  const form = admin.host.querySelector('form[aria-label="新增效果评价"]') as HTMLFormElement;
  await act(async () => { input(form, 'beforeStart', '2026-07-20'); input(form, 'splitDate', '2026-07-10'); input(form, 'afterEnd', '2026-07-30'); input(form, 'conclusion', '措施有效'); input(form, 'evidence', '日报'); input(form, 'owner', '周'); form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); });
  assert.equal(posts, 0); assert.match(admin.host.textContent || '', /日期顺序/);
  await act(async () => { input(form, 'beforeStart', '2026-07-01'); input(form, 'splitDate', '2026-07-16'); form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); });
  assert.equal(posts, 1); assert.equal((form.elements.namedItem('conclusion') as HTMLTextAreaElement).value, '措施有效'); assert.match(admin.host.textContent || '', /保存失败/);
  await cleanup(admin.root, admin.dom);
});

test('successful evaluation submits once and shows immutable metric snapshot', async () => {
  const { dom, host, root } = setup(); const pending = deferred<Response>(); let posts = 0;
  globalThis.fetch = (async (raw, init) => { if (init?.method === 'POST') { posts++; return pending.promise; } return mockReads()(raw, init); }) as typeof fetch;
  await act(async () => root.render(createElement(ChannelingRelationDetail, { role: 'admin', relationId: 7, onOpenWell: () => {}, onBack: () => {} }))); await click(host, '效果评价'); const form = host.querySelector('form[aria-label="新增效果评价"]') as HTMLFormElement;
  await act(async () => { input(form, 'beforeStart', '2026-07-01'); input(form, 'splitDate', '2026-07-16'); input(form, 'afterEnd', '2026-07-31'); input(form, 'conclusion', '有效'); input(form, 'evidence', '日报'); input(form, 'owner', '周'); form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); }); assert.equal(posts, 1);
  await act(async () => { pending.resolve(await reply({ id: 99, eventType: 'evaluated', occurredOn: '2026-07-31', content: '有效', evidence: '日报', owner: '周', metricsSnapshot: detail(), supersedesEventId: null, voidedAt: null, voidReason: null, createdBy: 'admin', createdAt: '', links: [] })); await pending.promise; });
  assert.match(host.textContent || '', /已保存评价快照/); assert.match(host.textContent || '', /有效/); assert.match(host.textContent || '', /2026-07-01.*2026-07-31/); assert.equal((form.elements.namedItem('conclusion') as HTMLTextAreaElement).value, '');
  await cleanup(root, dom);
});

test('ignores stale relation responses and is safe in StrictMode and after unmount', async () => {
  const { dom, host, root } = setup(); const old = deferred<Response>();
  globalThis.fetch = (async (raw) => { const url = String(raw); if (url.includes('/7/detail?')) return old.promise; if (url.includes('/8/detail?')) return reply(detail(8)); if (url.startsWith('/api/channeling-wells?')) return reply([]); if (url.startsWith('/api/channeling-tracking-events?')) return reply([]); throw new Error(url); }) as typeof fetch;
  await act(async () => root.render(createElement(StrictMode, null, createElement(ChannelingRelationDetail, { role: 'guest', relationId: 7, onOpenWell: () => {}, onBack: () => {} }))));
  await act(async () => root.render(createElement(StrictMode, null, createElement(ChannelingRelationDetail, { role: 'guest', relationId: 8, onOpenWell: () => {}, onBack: () => {} })))); assert.match(host.textContent || '', /注8/);
  await act(async () => { old.resolve(await reply(detail(7))); await old.promise; }); assert.doesNotMatch(host.textContent || '', /注7/);
  await cleanup(root, dom);
});

test('shows loading, error, retry, and empty relation states', async () => {
  const { dom, host, root } = setup(); const first = deferred<Response>(); let detailCalls = 0;
  globalThis.fetch = (async (raw) => { const url = String(raw); if (url.includes('/detail?')) { detailCalls++; if (detailCalls === 1) return first.promise; if (url.includes('/8/')) return reply(null); return reply(detail()); } if (url.startsWith('/api/channeling-wells?')) return reply([]); throw new Error(url); }) as typeof fetch;
  await act(async () => root.render(createElement(ChannelingRelationDetail, { role: 'guest', relationId: 7, onOpenWell: () => {}, onBack: () => {} }))); assert.match(host.textContent || '', /正在加载关系详情/);
  await act(async () => { first.resolve(await reply(null, 500, false, '详情暂不可用')); await first.promise; }); assert.match(host.textContent || '', /详情暂不可用/);
  await click(host, '重试'); assert.match(host.textContent || '', /注7/);
  await act(async () => root.render(createElement(ChannelingRelationDetail, { role: 'guest', relationId: 8, onOpenWell: () => {}, onBack: () => {} }))); assert.match(host.textContent || '', /暂无关系详情/);
  await cleanup(root, dom);
});
