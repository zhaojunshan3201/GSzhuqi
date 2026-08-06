import assert from 'node:assert/strict';
import test from 'node:test';
import { JSDOM } from 'jsdom';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { ChannelingTimeline } from '../src/components/ChannelingTimeline.tsx';
import type { TrackingEvent, TrackingEventType, TrackingSubject } from '../src/lib/channelingTrackingApi.ts';

const deferred = <T>() => {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};

const response = (data: unknown, init: { status?: number; success?: boolean; message?: string } = {}) => Promise.resolve(new Response(JSON.stringify({ success: init.success ?? true, data, message: init.message }), {
  status: init.status ?? 200,
  headers: { 'content-type': 'application/json' },
}));

const event = (id: number, eventType: TrackingEventType = 'discovered', overrides: Partial<TrackingEvent> = {}): TrackingEvent => ({
  id,
  eventType,
  occurredOn: '2026-08-05',
  content: `记录内容 ${id}`,
  evidence: `证据 ${id}`,
  owner: `负责人 ${id}`,
  metricsSnapshot: null,
  supersedesEventId: null,
  voidedAt: null,
  voidReason: null,
  createdBy: `创建人 ${id}`,
  createdAt: '2026-08-05T08:00:00.000Z',
  links: [{ subjectType: 'project', subjectId: 7 }],
  ...overrides,
});

function setup() {
  const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', { url: 'http://localhost' });
  Object.defineProperties(globalThis, {
    window: { configurable: true, value: dom.window },
    document: { configurable: true, value: dom.window.document },
    navigator: { configurable: true, value: dom.window.navigator },
    HTMLElement: { configurable: true, value: dom.window.HTMLElement },
    HTMLInputElement: { configurable: true, value: dom.window.HTMLInputElement },
    HTMLTextAreaElement: { configurable: true, value: dom.window.HTMLTextAreaElement },
    HTMLSelectElement: { configurable: true, value: dom.window.HTMLSelectElement },
    Event: { configurable: true, value: dom.window.Event },
    localStorage: { configurable: true, value: dom.window.localStorage },
    IS_REACT_ACT_ENVIRONMENT: { configurable: true, value: true },
  });
  const host = document.getElementById('root')!;
  const root = createRoot(host);
  return { dom, host, root };
}

async function cleanup(root: Root, dom: JSDOM) {
  await act(async () => { root.unmount(); });
  dom.window.close();
}

function change(element: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement, value: string) {
  const prototype = element instanceof HTMLTextAreaElement
    ? window.HTMLTextAreaElement.prototype
    : element instanceof HTMLSelectElement
      ? window.HTMLSelectElement.prototype
      : window.HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(prototype, 'value')!.set!.call(element, value);
  element.dispatchEvent(new Event('input', { bubbles: true }));
  element.dispatchEvent(new Event('change', { bubbles: true }));
}

test('guest timeline renders loading and every event kind with audit fields but no edit controls', async () => {
  const { dom, host, root } = setup();
  const pending = deferred<Response>();
  globalThis.fetch = (async () => pending.promise) as typeof fetch;
  await act(async () => { root.render(createElement(ChannelingTimeline, { role: 'guest', subject: { subjectType: 'project', subjectId: 7 } })); });
  assert.match(host.textContent || '', /正在加载跟踪记录/);

  const types: TrackingEventType[] = ['discovered', 'measure_planned', 'executed', 'evaluated', 'reviewed', 'closed', 'recurred', 'status_changed', 'relation_confirmed', 'relation_released', 'corrected'];
  await act(async () => { pending.resolve(await response(types.map((type, index) => event(index + 1, type, index === 0 ? { voidedAt: '2026-08-06T00:00:00Z', voidReason: '原记录有误' } : {})))); await pending.promise; });
  for (const label of ['发现窜扰', '计划措施', '措施执行', '效果评价', '复查', '关闭', '再次发生', '状态变更', '关系确认', '关系解除', '记录更正']) assert.match(host.textContent || '', new RegExp(label));
  assert.match(host.textContent || '', /2026-08-05/);
  assert.match(host.textContent || '', /记录内容 1/);
  assert.match(host.textContent || '', /证据 1/);
  assert.match(host.textContent || '', /负责人 1/);
  assert.match(host.textContent || '', /创建人 1/);
  assert.match(host.textContent || '', /已作废：原记录有误/);
  assert.equal(host.querySelector('form[data-event-form]'), null);
  assert.equal(host.querySelector('button[aria-label^="更正记录"]'), null);
  await cleanup(root, dom);
});

test('timeline shows an error, retries, and then renders the empty state', async () => {
  const { dom, host, root } = setup();
  let calls = 0;
  globalThis.fetch = (async () => {
    calls++;
    return calls === 1 ? response(undefined, { status: 503, success: false, message: '服务暂不可用' }) : response([]);
  }) as typeof fetch;
  await act(async () => { root.render(createElement(ChannelingTimeline, { role: 'guest', subject: { subjectType: 'well', subjectId: 2 } })); });
  assert.match(host.textContent || '', /服务暂不可用/);
  const retry = [...host.querySelectorAll('button')].find((button) => button.textContent === '重试')!;
  await act(async () => { retry.click(); });
  assert.equal(calls, 2);
  assert.match(host.textContent || '', /暂无跟踪记录/);
  await cleanup(root, dom);
});

test('admin add form only offers manual types, blocks duplicate submission, and resets after success', async () => {
  const { dom, host, root } = setup();
  const post = deferred<Response>();
  let posts = 0;
  let loads = 0;
  let postedBody: any;
  globalThis.fetch = (async (input, init) => {
    if (String(input) === '/api/channeling-tracking-events' && init?.method === 'POST') {
      posts++;
      postedBody = JSON.parse(String(init.body));
      return post.promise;
    }
    loads++;
    return response(loads === 1 ? [] : [event(9, 'executed')]);
  }) as typeof fetch;
  const subject: TrackingSubject = { subjectType: 'relation', subjectId: 3 };
  await act(async () => { root.render(createElement(ChannelingTimeline, { role: 'admin', subject })); });
  const form = host.querySelector('form[data-event-form]') as HTMLFormElement;
  const select = form.elements.namedItem('eventType') as HTMLSelectElement;
  assert.deepEqual([...select.options].map((option) => option.value), ['discovered', 'measure_planned', 'executed', 'reviewed', 'closed', 'recurred']);
  await act(async () => {
    change(select, 'executed');
    change(form.elements.namedItem('occurredOn') as HTMLInputElement, '2026-08-06');
    change(form.elements.namedItem('content') as HTMLTextAreaElement, '实施封窜措施');
    change(form.elements.namedItem('evidence') as HTMLInputElement, '施工记录');
    change(form.elements.namedItem('owner') as HTMLInputElement, '张工');
  });
  await act(async () => { form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); });
  assert.equal(posts, 1);
  assert.equal((form.querySelector('button[type="submit"]') as HTMLButtonElement).disabled, true);
  assert.deepEqual(postedBody, { eventType: 'executed', occurredOn: '2026-08-06', content: '实施封窜措施', evidence: '施工记录', owner: '张工', links: [subject] });

  await act(async () => { post.resolve(await response(event(9, 'executed'))); await post.promise; });
  assert.equal((form.elements.namedItem('content') as HTMLTextAreaElement).value, '');
  assert.equal((form.elements.namedItem('evidence') as HTMLInputElement).value, '');
  assert.equal((form.elements.namedItem('owner') as HTMLInputElement).value, '');
  assert.match(host.textContent || '', /记录内容 9/);
  await cleanup(root, dom);
});

test('failed add keeps controlled values for correction and retry', async () => {
  const { dom, host, root } = setup();
  globalThis.fetch = (async (_input, init) => init?.method === 'POST'
    ? response(undefined, { status: 400, success: false, message: '内容不符合要求' })
    : response([])) as typeof fetch;
  await act(async () => { root.render(createElement(ChannelingTimeline, { role: 'admin', subject: { subjectType: 'well', subjectId: 8 } })); });
  const form = host.querySelector('form[data-event-form]') as HTMLFormElement;
  await act(async () => {
    change(form.elements.namedItem('occurredOn') as HTMLInputElement, '2026-08-06');
    change(form.elements.namedItem('content') as HTMLTextAreaElement, '保留的内容');
    change(form.elements.namedItem('owner') as HTMLInputElement, '李工');
  });
  await act(async () => { form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); });
  assert.match(host.textContent || '', /内容不符合要求/);
  assert.equal((form.elements.namedItem('content') as HTMLTextAreaElement).value, '保留的内容');
  assert.equal((form.elements.namedItem('owner') as HTMLInputElement).value, '李工');
  await cleanup(root, dom);
});

test('admin correction requires all fields, keeps the original visible, and refreshes after success', async () => {
  const { dom, host, root } = setup();
  const original = event(4, 'reviewed');
  const corrected = event(5, 'corrected', { content: '更正后的内容', supersedesEventId: 4 });
  let loads = 0;
  let correctionBody: any;
  globalThis.fetch = (async (input, init) => {
    if (String(input).endsWith('/4/corrections')) {
      correctionBody = JSON.parse(String(init?.body));
      return response(corrected, { status: 201 });
    }
    loads++;
    return response(loads === 1 ? [original] : [{ ...original, voidedAt: '2026-08-06T00:00:00Z', voidReason: '文字错误' }, corrected]);
  }) as typeof fetch;
  await act(async () => { root.render(createElement(ChannelingTimeline, { role: 'admin', subject: { subjectType: 'project', subjectId: 7 } })); });
  await act(async () => { (host.querySelector('button[aria-label="更正记录 4"]') as HTMLButtonElement).click(); });
  const form = host.querySelector('form[data-correction-for="4"]') as HTMLFormElement;
  await act(async () => {
    for (const [name, value] of [['reason', '文字错误'], ['occurredOn', '2026-08-06'], ['content', '更正后的内容'], ['evidence', '复核记录'], ['owner', '王工']] as const) change(form.elements.namedItem(name) as HTMLInputElement | HTMLTextAreaElement, value);
  });
  await act(async () => { form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); });
  assert.deepEqual(correctionBody, { reason: '文字错误', occurredOn: '2026-08-06', content: '更正后的内容', evidence: '复核记录', owner: '王工' });
  assert.match(host.textContent || '', /记录内容 4/);
  assert.match(host.textContent || '', /更正后的内容/);
  assert.match(host.textContent || '', /已作废：文字错误/);
  await cleanup(root, dom);
});

test('a stale response from the previous subject cannot replace the current subject timeline', async () => {
  const { dom, host, root } = setup();
  const oldResponse = deferred<Response>();
  globalThis.fetch = (async (input) => String(input).includes('subjectId=1') ? oldResponse.promise : response([event(2, 'discovered', { content: '当前井记录' })])) as typeof fetch;
  await act(async () => { root.render(createElement(ChannelingTimeline, { role: 'guest', subject: { subjectType: 'well', subjectId: 1 } })); });
  await act(async () => { root.render(createElement(ChannelingTimeline, { role: 'guest', subject: { subjectType: 'well', subjectId: 2 } })); });
  assert.match(host.textContent || '', /当前井记录/);
  await act(async () => { oldResponse.resolve(await response([event(1, 'discovered', { content: '旧井记录' })])); await oldResponse.promise; });
  assert.match(host.textContent || '', /当前井记录/);
  assert.doesNotMatch(host.textContent || '', /旧井记录/);
  await cleanup(root, dom);
});
