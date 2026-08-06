import assert from 'node:assert/strict';
import test from 'node:test';
import { JSDOM } from 'jsdom';
import { act, createElement, StrictMode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { buildAlignedRelationRows, buildEvaluationLineages, buildRelationChart, ChannelingRelationDetail, evaluationRangeAroundSplit } from '../src/components/ChannelingRelationDetail.tsx';
import type { RelationDetail, TrackingEvent } from '../src/lib/channelingTrackingApi.ts';

const reply = (data: unknown, status = 200, success = true, message?: string) => Promise.resolve(new Response(JSON.stringify({ success, data, message }), { status }));
const deferred = <T>() => { let resolve!: (value: T) => void; const promise = new Promise<T>((yes) => { resolve = yes; }); return { promise, resolve }; };
const detail = (id = 7): RelationDetail => ({
  relationId: id, injectionWell: `注${id}`, productionWell: `采${id}`,
  range: { beforeStart: '2026-07-01', splitDate: '2026-07-16', afterEnd: '2026-07-31' }, generatedAt: '2026-08-06T01:00:00Z',
  injector: { wellNo: `注${id}`, normalizedWellNo: `注${id}`, roles: ['injector'], queriedAt: '2026-08-06T01:00:00Z', range: { start: '2026-07-01', end: '2026-07-31' }, production: null, injection: { cycleCount: 1, cumulativeSteam: 220, stages: [{ cycleNo: 1, startDate: '2026-07-10', endDate: '2026-07-12', steamVolume: 220, temperature: 260, pressure: 12, dryness: .75, productionHours: 48 }] } },
  producerSeries: [{ date: '2026-07-15', oil: 10, liquid: 30, waterCut: .67, block: '高3' }, { date: '2026-07-20', oil: 13, liquid: 32, waterCut: .59, block: '高3' }],
  comparison: { oil: { beforeAverage: 10, afterAverage: 13, change: 3, changeRate: .3, beforeValidDays: 1, afterValidDays: 1 }, liquid: { beforeAverage: 30, afterAverage: 32, change: 2, changeRate: .067, beforeValidDays: 1, afterValidDays: 1 }, waterCut: { beforeAverage: .67, afterAverage: .59, change: -.08, changeRate: -.119, beforeValidDays: 1, afterValidDays: 1 } },
});
const relation = { id: 7, channelingType: 'steam', injectionWell: '注7', productionWell: '采7', reservoirLayer: 'S1', impactLevel: 'high', confidence: .9, status: 'confirmed', source: 'manual', evidence: '示踪剂', effectiveStartDate: '2026-06-01', effectiveEndDate: '2026-12-31', owner: '周', project: { id: 1, name: '项目', block: '高3' } };
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
  assert.match(host.textContent || '', /影响程度.*高/); assert.match(host.textContent || '', /2026-06-01.*2026-12-31/);
  await click(host, '注入井：注7'); await click(host, '生产井：采7'); assert.deepEqual(opened, [11, 12]);
  await click(host, '联动指标'); assert.match(host.textContent || '', /注汽量/); assert.match(host.textContent || '', /日产油/); assert.match(host.textContent || '', /日产液/); assert.match(host.textContent || '', /含水/); assert.match(host.textContent || '', /查询时间/);
  await cleanup(root, dom);
});

test('maps suspected source and aligns irregular injection and production dates on a time axis', () => {
  const irregular = detail(); irregular.injector.injection!.stages.push({ cycleNo: 2, startDate: '2026-07-23', endDate: null, steamVolume: 80, temperature: null, pressure: null, dryness: null, productionHours: null });
  const rows = buildAlignedRelationRows(irregular); assert.deepEqual(rows.map((row) => row.date), ['2026-07-10', '2026-07-15', '2026-07-20', '2026-07-23']);
  assert.equal(rows[0].steamVolume, 220); assert.equal(rows[0].oil, null); assert.equal(rows[1].steamVolume, null); assert.equal(rows[1].waterCutPercent, 67);
  const option = buildRelationChart(irregular); assert.equal((option.xAxis as { type: string }).type, 'time');
  const series = option.series as Array<{ data: unknown[]; connectNulls?: boolean }>;
  assert.deepEqual(series[0].data, [['2026-07-10', 220], ['2026-07-15', null], ['2026-07-20', null], ['2026-07-23', 80]]);
  assert.deepEqual(series[1].data, [['2026-07-10', null], ['2026-07-15', 10], ['2026-07-20', 13], ['2026-07-23', null]]); assert.equal(series[1].connectNulls, false);
  assert.deepEqual(option.yAxis, [{ type: 'value', name: '产量 / 注汽量' }, { type: 'value', name: '含水(%)', min: 0, max: 100, axisLabel: { formatter: '{value}%' } }]);
});

test('builds symmetric calendar-day evaluation ranges without date drift', () => { assert.deepEqual(evaluationRangeAroundSplit('2026-03-01'), { beforeStart: '2026-01-30', splitDate: '2026-03-01', afterEnd: '2026-03-31' }); });

test('resolves an evaluation root to its latest live correction and rejects malformed branches and cycles', () => {
  const event = (id: number, eventType: TrackingEvent['eventType'], supersedesEventId: number | null, voidedAt: string | null): TrackingEvent => ({
    id, eventType, supersedesEventId, voidedAt, occurredOn: '2026-07-31', content: `content ${id}`, evidence: `evidence ${id}`, owner: `owner ${id}`,
    metricsSnapshot: id === 1 ? detail() : null, voidReason: null, createdBy: 'admin', createdAt: `2026-08-0${Math.min(id, 9)}T00:00:00Z`, links: [],
  });
  const events = [
    event(1, 'evaluated', null, '2026-08-01T00:00:00Z'),
    event(2, 'corrected', 1, '2026-08-02T00:00:00Z'),
    event(3, 'corrected', 2, null),
    event(4, 'corrected', 999, null),
    event(5, 'corrected', 6, null),
    event(6, 'corrected', 5, null),
  ];

  const lineages = buildEvaluationLineages(events);
  assert.equal(lineages.length, 1);
  assert.equal(lineages[0].root.id, 1);
  assert.equal(lineages[0].current?.id, 3);
});

test('guest and admin use corrected evaluation text with the original snapshot after remount', async () => {
  const rootEvent: TrackingEvent = { id: 91, eventType: 'evaluated', occurredOn: '2026-07-31', content: '原始结论', evidence: '原始证据', owner: '原负责人', metricsSnapshot: detail(), supersedesEventId: null, voidedAt: '2026-08-01T00:00:00Z', voidReason: '措辞更正', createdBy: 'admin', createdAt: '2026-08-01T00:00:00Z', links: [] };
  const firstCorrection: TrackingEvent = { ...rootEvent, id: 92, eventType: 'corrected', content: '第一次更正', evidence: '更正证据一', owner: '负责人一', metricsSnapshot: null, supersedesEventId: 91, voidedAt: '2026-08-02T00:00:00Z', createdAt: '2026-08-02T00:00:00Z' };
  const currentCorrection: TrackingEvent = { ...firstCorrection, id: 93, content: '最终更正结论', evidence: '最终更正证据', owner: '最终负责人', supersedesEventId: 92, voidedAt: null, createdAt: '2026-08-03T00:00:00Z' };
  const events = [currentCorrection, firstCorrection, rootEvent];
  let postedBody: any = null;
  const fetcher = (async (raw: RequestInfo | URL, init?: RequestInit) => {
    const url = String(raw);
    if (init?.method === 'POST') { postedBody = JSON.parse(String(init.body)); return reply({ ...rootEvent, id: 94, voidedAt: null }, 201); }
    if (url.startsWith('/api/channeling-tracking-events?')) return reply(events);
    return mockReads()(raw, init);
  }) as typeof fetch;

  const guest = setup(); globalThis.fetch = fetcher;
  await act(async () => guest.root.render(createElement(ChannelingRelationDetail, { role: 'guest', relationId: 7, onOpenWell: () => {}, onBack: () => {} })));
  await click(guest.host, '效果评价');
  assert.equal(guest.host.querySelectorAll('[data-evaluation-event]').length, 1);
  assert.match(guest.host.textContent || '', /最终更正结论/);
  assert.match(guest.host.textContent || '', /最终更正证据/);
  assert.match(guest.host.textContent || '', /最终负责人/);
  assert.match(guest.host.textContent || '', /2026-07-01.*2026-07-31/);
  assert.doesNotMatch(guest.host.textContent || '', /按最新数据重新计算/);
  await cleanup(guest.root, guest.dom);

  const admin = setup(); globalThis.fetch = fetcher;
  await act(async () => admin.root.render(createElement(ChannelingRelationDetail, { role: 'admin', relationId: 7, onOpenWell: () => {}, onBack: () => {} })));
  await click(admin.host, '效果评价');
  assert.equal(admin.host.querySelectorAll('[data-evaluation-event]').length, 1);
  await click(admin.host, '按最新数据重新计算');
  assert.equal(postedBody.conclusion, '最终更正结论');
  assert.equal(postedBody.evidence, '最终更正证据');
  assert.equal(postedBody.owner, '最终负责人');
  assert.deepEqual(postedBody.range, detail().range);
  await cleanup(admin.root, admin.dom);
});

test('renders the actual suspected source as a Chinese label', async () => {
  const { dom, host, root } = setup(); globalThis.fetch = (async (raw, init) => { const url = String(raw); if (url.endsWith('/relations')) return reply([{ ...relation, source: 'suspected' }]); return mockReads()(raw, init); }) as typeof fetch;
  await act(async () => root.render(createElement(ChannelingRelationDetail, { role: 'guest', relationId: 7, onOpenWell: () => {}, onBack: () => {} })));
  assert.match(host.textContent || '', /来源疑似识别/); assert.doesNotMatch(host.textContent || '', /来源suspected/); await cleanup(root, dom);
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

test('keeps primary detail visible when facts fail and restores facts and well links on retry', async () => {
  const { dom, host, root } = setup(); let profileCalls = 0;
  globalThis.fetch = (async (raw) => { const url = String(raw); if (url.includes('/detail?')) return reply(detail()); if (url.startsWith('/api/channeling-tracking-events?')) return reply([]); if (url.startsWith('/api/channeling-wells?')) { profileCalls++; if (profileCalls <= 2) return reply(null, 500, false, '档案服务失败'); return reply([{ id: url.includes('%E6%B3%A8') ? 11 : 12, wellNo: url.includes('%E6%B3%A8') ? '注7' : '采7', normalizedWellNo: url.includes('%E6%B3%A8') ? '注7' : '采7', block: '', owner: '', createdAt: '', updatedAt: '' }]); } if (url.endsWith('/relations')) return reply([relation]); throw new Error(url); }) as typeof fetch;
  await act(async () => root.render(createElement(ChannelingRelationDetail, { role: 'guest', relationId: 7, onOpenWell: () => {}, onBack: () => {} })));
  assert.match(host.textContent || '', /注7.*采7/); assert.match(host.textContent || '', /档案服务失败/); assert.doesNotMatch(host.textContent || '', /未找到注入井档案/);
  await click(host, '重试基础信息'); assert.match(host.textContent || '', /示踪剂/); assert.equal((host.querySelector('button') as HTMLButtonElement).disabled, false);
  await cleanup(root, dom);
});

test('persisted evaluation snapshots survive remount and recompute creates a new immutable event', async () => {
  const oldEvent = { id: 41, eventType: 'evaluated', occurredOn: '2026-07-31', content: '历史有效', evidence: '历史日报', owner: '周', metricsSnapshot: detail(), supersedesEventId: null, voidedAt: null, voidReason: null, createdBy: 'admin', createdAt: '2026-08-01T00:00:00Z', links: [] };
  let events = [oldEvent]; let posts = 0; let postedBody: any;
  const fetcher = (async (raw: RequestInfo | URL, init?: RequestInit) => { const url = String(raw); if (init?.method === 'POST') { posts++; postedBody = JSON.parse(String(init.body)); const created = { ...oldEvent, id: 42, content: postedBody.conclusion, createdAt: '2026-08-02T00:00:00Z' }; events = [created, oldEvent]; return reply(created, 201); } if (url.startsWith('/api/channeling-tracking-events?')) return reply(events); return mockReads()(raw, init); }) as typeof fetch;
  const first = setup(); globalThis.fetch = fetcher; await act(async () => first.root.render(createElement(ChannelingRelationDetail, { role: 'guest', relationId: 7, onOpenWell: () => {}, onBack: () => {} }))); await click(first.host, '效果评价'); assert.match(first.host.textContent || '', /历史有效/); assert.match(first.host.textContent || '', /有效天数.*1.*1/); assert.equal(first.host.textContent?.includes('按最新数据重新计算'), false); await cleanup(first.root, first.dom);
  const second = setup(); globalThis.fetch = fetcher; await act(async () => second.root.render(createElement(ChannelingRelationDetail, { role: 'admin', relationId: 7, onOpenWell: () => {}, onBack: () => {} }))); await click(second.host, '效果评价'); assert.match(second.host.textContent || '', /历史有效/); await click(second.host, '按最新数据重新计算'); assert.equal(posts, 1); assert.deepEqual(postedBody.range, detail().range); assert.equal(postedBody.conclusion, '历史有效'); assert.equal(second.host.querySelectorAll('[data-evaluation-event]').length, 2); assert.match(second.host.textContent || '', /历史有效/);
  await cleanup(second.root, second.dom);
});

test('historical recompute blocks duplicates, keeps the original on failure, and remains retryable', async () => {
  const oldEvent = { id: 51, eventType: 'evaluated', occurredOn: '2026-07-31', content: '原评价', evidence: '原证据', owner: '周', metricsSnapshot: detail(), supersedesEventId: null, voidedAt: null, voidReason: null, createdBy: 'admin', createdAt: '', links: [] };
  const pending = deferred<Response>(); let posts = 0;
  globalThis.fetch = (async (raw, init) => { const url = String(raw); if (init?.method === 'POST') { posts++; return pending.promise; } if (url.startsWith('/api/channeling-tracking-events?')) return reply([oldEvent]); return mockReads()(raw, init); }) as typeof fetch;
  const { dom, host, root } = setup(); await act(async () => root.render(createElement(ChannelingRelationDetail, { role: 'admin', relationId: 7, onOpenWell: () => {}, onBack: () => {} }))); await click(host, '效果评价');
  const button = [...host.querySelectorAll('button')].find((item) => item.textContent === '按最新数据重新计算')!; await act(async () => { button.click(); button.click(); }); assert.equal(posts, 1);
  await act(async () => { pending.resolve(await reply(null, 500, false, '重算失败')); await pending.promise; }); assert.match(host.textContent || '', /重算失败/); assert.match(host.textContent || '', /原评价/); assert.equal((button as HTMLButtonElement).disabled, false);
  await cleanup(root, dom);
});

test('a delayed historical recompute cannot refresh or mutate a different relation', async () => {
  const oldEvent = { id: 61, eventType: 'evaluated', occurredOn: '2026-07-31', content: '旧关系评价', evidence: '证据', owner: '周', metricsSnapshot: detail(), supersedesEventId: null, voidedAt: null, voidReason: null, createdBy: 'admin', createdAt: '', links: [] };
  const pending = deferred<Response>(); let trackingGets = 0;
  globalThis.fetch = (async (raw, init) => { const url = String(raw); if (init?.method === 'POST') return pending.promise; if (url.startsWith('/api/channeling-tracking-events?')) { trackingGets++; return reply(url.includes('subjectId=7') ? [oldEvent] : []); } if (url.includes('/7/detail?')) return reply(detail(7)); if (url.includes('/8/detail?')) return reply(detail(8)); if (url.startsWith('/api/channeling-wells?')) return reply([]); throw new Error(url); }) as typeof fetch;
  const { dom, host, root } = setup(); await act(async () => root.render(createElement(ChannelingRelationDetail, { role: 'admin', relationId: 7, onOpenWell: () => {}, onBack: () => {} }))); await click(host, '效果评价'); await click(host, '按最新数据重新计算');
  await act(async () => root.render(createElement(ChannelingRelationDetail, { role: 'admin', relationId: 8, onOpenWell: () => {}, onBack: () => {} }))); await act(async () => { pending.resolve(await reply({ ...oldEvent, id: 62 }, 201)); await pending.promise; });
  assert.match(host.textContent || '', /注8/); assert.doesNotMatch(host.textContent || '', /旧关系评价/); assert.equal(trackingGets, 2);
  await cleanup(root, dom);
});

test('primary retry does not strand an independent pending evaluation request', async () => {
  const { dom, host, root } = setup(); const history = deferred<Response>(); let detailCalls = 0;
  globalThis.fetch = (async (raw) => { const url = String(raw); if (url.startsWith('/api/channeling-tracking-events?')) return history.promise; if (url.includes('/detail?')) { detailCalls++; return detailCalls === 1 ? reply(null, 500, false, '主指标失败') : reply(detail()); } if (url.startsWith('/api/channeling-wells?')) return reply([]); throw new Error(url); }) as typeof fetch;
  await act(async () => root.render(createElement(ChannelingRelationDetail, { role: 'guest', relationId: 7, onOpenWell: () => {}, onBack: () => {} }))); assert.match(host.textContent || '', /主指标失败/); await click(host, '重试'); assert.match(host.textContent || '', /注7/);
  await act(async () => { history.resolve(await reply([])); await history.promise; }); await click(host, '效果评价'); assert.doesNotMatch(host.textContent || '', /正在加载历史评价/); assert.match(host.textContent || '', /暂无历史评价/); await cleanup(root, dom);
});

test('new evaluation and historical recompute share one write lock in both directions', async () => {
  const oldEvent = { id: 71, eventType: 'evaluated', occurredOn: '2026-07-31', content: '旧评价', evidence: '证据', owner: '周', metricsSnapshot: detail(), supersedesEventId: null, voidedAt: null, voidReason: null, createdBy: 'admin', createdAt: '', links: [] };
  const run = async (first: 'new' | 'recompute') => {
    const { dom, host, root } = setup(); const pending = deferred<Response>(); let posts = 0;
    globalThis.fetch = (async (raw, init) => { const url = String(raw); if (init?.method === 'POST') { posts++; return pending.promise; } if (url.startsWith('/api/channeling-tracking-events?')) return reply([oldEvent]); return mockReads()(raw, init); }) as typeof fetch;
    await act(async () => root.render(createElement(ChannelingRelationDetail, { role: 'admin', relationId: 7, onOpenWell: () => {}, onBack: () => {} }))); await click(host, '效果评价'); const form = host.querySelector('form[aria-label="新增效果评价"]') as HTMLFormElement; await act(async () => { input(form, 'beforeStart', '2026-07-01'); input(form, 'splitDate', '2026-07-16'); input(form, 'afterEnd', '2026-07-31'); input(form, 'conclusion', '新评价'); input(form, 'owner', '周'); });
    const recompute = [...host.querySelectorAll('button')].find((item) => item.textContent === '按最新数据重新计算') as HTMLButtonElement; const submit = form.querySelector('button[type="submit"]') as HTMLButtonElement;
    await act(async () => { if (first === 'new') form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); else recompute.click(); }); assert.equal(posts, 1); assert.equal(submit.disabled, true); assert.equal(recompute.disabled, true);
    await act(async () => { if (first === 'new') recompute.click(); else form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); }); assert.equal(posts, 1);
    await act(async () => { pending.resolve(await reply({ ...oldEvent, id: 72 }, 201)); await pending.promise; }); assert.equal(submit.disabled, false); assert.equal(recompute.disabled, false); await cleanup(root, dom);
  };
  await run('new'); await run('recompute');
});

test('defaults evaluation around latest executed event, then falls back to effective start', async () => {
  const renderDates = async (events: unknown[], effectiveStartDate: string) => { const view = setup(); globalThis.fetch = (async (raw, init) => { const url = String(raw); if (url.startsWith('/api/channeling-tracking-events?')) return reply(events); if (url.endsWith('/relations')) return reply([{ ...relation, effectiveStartDate }]); return mockReads()(raw, init); }) as typeof fetch; await act(async () => view.root.render(createElement(ChannelingRelationDetail, { role: 'admin', relationId: 7, onOpenWell: () => {}, onBack: () => {} }))); await click(view.host, '效果评价'); const form = view.host.querySelector('form[aria-label="新增效果评价"]') as HTMLFormElement; const dates = ['beforeStart', 'splitDate', 'afterEnd'].map((name) => (form.elements.namedItem(name) as HTMLInputElement).value); await cleanup(view.root, view.dom); return dates; };
  const event = (occurredOn: string, voidedAt: string | null = null) => ({ id: occurredOn.endsWith('20') ? 2 : 1, eventType: 'executed', occurredOn, content: '执行', evidence: '', owner: '周', metricsSnapshot: null, supersedesEventId: null, voidedAt, voidReason: null, createdBy: 'admin', createdAt: '', links: [] });
  assert.deepEqual(await renderDates([event('2026-06-10'), event('2026-06-20', '2026-06-21')], '2026-05-01'), ['2026-05-11', '2026-06-10', '2026-07-10']);
  assert.deepEqual(await renderDates([], '2026-05-01'), ['2026-04-01', '2026-05-01', '2026-05-31']);
});

test('partial and malformed legacy snapshots render safely with known range and a clear warning', async () => {
  const events = [{ id: 81, eventType: 'evaluated', occurredOn: '2026-07-31', content: '部分快照', evidence: '', owner: '周', metricsSnapshot: { range: { beforeStart: '2026-07-01', splitDate: '2026-07-16', afterEnd: '2026-07-31' }, comparison: 'broken', injector: 7, producerSeries: {} }, supersedesEventId: null, voidedAt: null, voidReason: null, createdBy: 'admin', createdAt: '', links: [] }, { id: 82, eventType: 'evaluated', occurredOn: '2026-08-01', content: '不可用快照', evidence: '', owner: '周', metricsSnapshot: { range: 'bad' }, supersedesEventId: null, voidedAt: null, voidReason: null, createdBy: 'admin', createdAt: '', links: [] }];
  const { dom, host, root } = setup(); globalThis.fetch = (async (raw, init) => String(raw).startsWith('/api/channeling-tracking-events?') ? reply(events) : mockReads()(raw, init)) as typeof fetch; await act(async () => root.render(createElement(ChannelingRelationDetail, { role: 'guest', relationId: 7, onOpenWell: () => {}, onBack: () => {} }))); await click(host, '效果评价'); assert.match(host.textContent || '', /2026-07-01.*2026-07-31/); assert.match(host.textContent || '', /部分字段不可用/); assert.match(host.textContent || '', /没有可读取的指标快照/); await cleanup(root, dom);
});
