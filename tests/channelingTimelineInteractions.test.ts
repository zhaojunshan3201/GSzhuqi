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

test('guest can inspect a persisted project evaluation snapshot without affecting relation events', async () => {
  const { dom, host, root } = setup();
  globalThis.fetch = (async () => response([
    event(1, 'evaluated', { metricsSnapshot: { projectId: 7, range: { start: '2026-07-01', end: '2026-07-31' }, relationCount: 3, activeRelationCount: 2, injectorCount: 2, producerCount: 2, cumulativeSteam: 88.5, initialTotalOil: 4, latestTotalOil: 7, totalOilChange: 3 } }),
    event(2, 'evaluated', { links: [{ subjectType: 'relation', subjectId: 9 }], metricsSnapshot: { unexpected: true } }),
  ])) as typeof fetch;
  await act(async () => root.render(createElement(ChannelingTimeline, { role: 'guest', subject: { subjectType: 'project', subjectId: 7 } })));
  assert.match(host.textContent || '', /评价指标快照/); assert.match(host.textContent || '', /2026-07-01 至 2026-07-31/); assert.match(host.textContent || '', /关系数量 3/); assert.match(host.textContent || '', /累计注汽量 88\.5/); assert.match(host.textContent || '', /日产油变化 3/);
  assert.equal(host.querySelectorAll('[aria-label="项目评价指标快照"]').length, 1, 'malformed or relation snapshots remain harmless');
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
  assert.equal(form.getAttribute('aria-label'), '新增跟踪记录');
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

test('pending add disables every draft field and ignores programmatic edits', async () => {
  const { dom, host, root } = setup();
  const pending = deferred<Response>();
  globalThis.fetch = (async (_input, init) => init?.method === 'POST' ? pending.promise : response([])) as typeof fetch;
  await act(async () => { root.render(createElement(ChannelingTimeline, { role: 'admin', subject: { subjectType: 'well', subjectId: 8 } })); });
  const form = host.querySelector('form[data-event-form]') as HTMLFormElement;
  await act(async () => {
    change(form.elements.namedItem('eventType') as HTMLSelectElement, 'executed');
    change(form.elements.namedItem('occurredOn') as HTMLInputElement, '2026-08-06');
    change(form.elements.namedItem('content') as HTMLTextAreaElement, '待保存内容');
    change(form.elements.namedItem('evidence') as HTMLInputElement, '原证据');
    change(form.elements.namedItem('owner') as HTMLInputElement, '原负责人');
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  });
  for (const name of ['eventType', 'occurredOn', 'content', 'evidence', 'owner']) assert.equal((form.elements.namedItem(name) as HTMLInputElement).disabled, true, name);
  await act(async () => {
    change(form.elements.namedItem('eventType') as HTMLSelectElement, 'closed');
    change(form.elements.namedItem('occurredOn') as HTMLInputElement, '2026-08-07');
    change(form.elements.namedItem('content') as HTMLTextAreaElement, '不应写入');
    change(form.elements.namedItem('evidence') as HTMLInputElement, '不应写入');
    change(form.elements.namedItem('owner') as HTMLInputElement, '不应写入');
    pending.resolve(await response(undefined, { status: 400, success: false, message: '保存失败' }));
    await pending.promise;
  });
  assert.equal((form.elements.namedItem('eventType') as HTMLSelectElement).value, 'executed');
  assert.equal((form.elements.namedItem('occurredOn') as HTMLInputElement).value, '2026-08-06');
  assert.equal((form.elements.namedItem('content') as HTMLTextAreaElement).value, '待保存内容');
  assert.equal((form.elements.namedItem('evidence') as HTMLInputElement).value, '原证据');
  assert.equal((form.elements.namedItem('owner') as HTMLInputElement).value, '原负责人');
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
  assert.equal(form.getAttribute('aria-label'), '更正跟踪记录 4');
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

test('pending correction disables every field and ignores programmatic edits', async () => {
  const { dom, host, root } = setup();
  const pending = deferred<Response>();
  globalThis.fetch = (async (_input, init) => init?.method === 'POST' ? pending.promise : response([event(14, 'reviewed')])) as typeof fetch;
  await act(async () => { root.render(createElement(ChannelingTimeline, { role: 'admin', subject: { subjectType: 'project', subjectId: 7 } })); });
  await act(async () => { (host.querySelector('button[aria-label="更正记录 14"]') as HTMLButtonElement).click(); });
  const form = host.querySelector('form[data-correction-for="14"]') as HTMLFormElement;
  const original = { reason: '原更正原因', occurredOn: '2026-08-06', content: '原更正内容', evidence: '原更正证据', owner: '原负责人' };
  await act(async () => {
    for (const [name, value] of Object.entries(original)) change(form.elements.namedItem(name) as HTMLInputElement | HTMLTextAreaElement, value);
  });
  await act(async () => {
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  });
  for (const name of Object.keys(original)) assert.equal((form.elements.namedItem(name) as HTMLInputElement).disabled, true, name);
  await act(async () => {
    for (const name of Object.keys(original)) change(form.elements.namedItem(name) as HTMLInputElement | HTMLTextAreaElement, '不应写入');
    pending.resolve(await response(undefined, { status: 400, success: false, message: '更正失败' }));
    await pending.promise;
  });
  for (const [name, value] of Object.entries(original)) assert.equal((form.elements.namedItem(name) as HTMLInputElement | HTMLTextAreaElement).value, value, name);
  await cleanup(root, dom);
});

test('old add and correction failures do not alter newer subject drafts', async () => {
  const run = async (kind: 'add' | 'correction') => {
    const { dom, host, root } = setup(); const pending = deferred<Response>();
    globalThis.fetch = (async (input, init) => {
      if (init?.method === 'POST') return pending.promise;
      return response(kind === 'correction' ? [event(String(input).includes('subjectId=1') ? 21 : 22, 'reviewed')] : []);
    }) as typeof fetch;
    await act(async () => { root.render(createElement(ChannelingTimeline, { role: 'admin', subject: { subjectType: 'well', subjectId: 1 } })); });
    if (kind === 'add') {
      const form = host.querySelector('form[data-event-form]') as HTMLFormElement;
      await act(async () => { change(form.elements.namedItem('occurredOn') as HTMLInputElement, '2026-08-06'); change(form.elements.namedItem('content') as HTMLTextAreaElement, '旧内容'); change(form.elements.namedItem('owner') as HTMLInputElement, '旧负责人'); form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); });
    } else {
      await act(async () => { (host.querySelector('button[aria-label="更正记录 21"]') as HTMLButtonElement).click(); });
      const form = host.querySelector('form[data-correction-for="21"]') as HTMLFormElement;
      await act(async () => { change(form.elements.namedItem('reason') as HTMLInputElement, '旧原因'); change(form.elements.namedItem('evidence') as HTMLInputElement, '旧证据'); form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); });
    }
    await act(async () => { root.render(createElement(ChannelingTimeline, { role: 'admin', subject: { subjectType: 'well', subjectId: 2 } })); });
    if (kind === 'add') {
      const current = host.querySelector('form[data-event-form]') as HTMLFormElement;
      await act(async () => { change(current.elements.namedItem('content') as HTMLTextAreaElement, '新对象草稿'); });
    } else {
      await act(async () => { (host.querySelector('button[aria-label="更正记录 22"]') as HTMLButtonElement).click(); });
      const current = host.querySelector('form[data-correction-for="22"]') as HTMLFormElement;
      await act(async () => { change(current.elements.namedItem('reason') as HTMLInputElement, '新对象更正草稿'); });
    }
    await act(async () => { pending.resolve(await response(undefined, { status: 400, success: false, message: '旧请求失败' })); await pending.promise; });
    if (kind === 'add') assert.equal(((host.querySelector('form[data-event-form]') as HTMLFormElement).elements.namedItem('content') as HTMLTextAreaElement).value, '新对象草稿');
    else assert.equal(((host.querySelector('form[data-correction-for="22"]') as HTMLFormElement).elements.namedItem('reason') as HTMLInputElement).value, '新对象更正草稿');
    assert.doesNotMatch(host.textContent || '', /旧请求失败/);
    await cleanup(root, dom);
  };
  await run('add'); await run('correction');
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

test('a delayed add from the previous subject cannot reset or reload the current subject', async () => {
  const { dom, host, root } = setup();
  const oldPost = deferred<Response>();
  const getUrls: string[] = [];
  globalThis.fetch = (async (input, init) => {
    const url = String(input);
    if (init?.method === 'POST') return oldPost.promise;
    getUrls.push(url);
    return url.includes('subjectId=1') ? response([]) : response([event(22, 'discovered', { content: '对象 B 的时间线' })]);
  }) as typeof fetch;

  await act(async () => { root.render(createElement(ChannelingTimeline, { role: 'admin', subject: { subjectType: 'well', subjectId: 1 } })); });
  const oldForm = host.querySelector('form[data-event-form]') as HTMLFormElement;
  await act(async () => {
    change(oldForm.elements.namedItem('occurredOn') as HTMLInputElement, '2026-08-06');
    change(oldForm.elements.namedItem('content') as HTMLTextAreaElement, '对象 A 的待提交记录');
    change(oldForm.elements.namedItem('owner') as HTMLInputElement, '甲');
  });
  await act(async () => { oldForm.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); });

  await act(async () => { root.render(createElement(ChannelingTimeline, { role: 'admin', subject: { subjectType: 'well', subjectId: 2 } })); });
  const currentForm = host.querySelector('form[data-event-form]') as HTMLFormElement;
  await act(async () => {
    change(currentForm.elements.namedItem('occurredOn') as HTMLInputElement, '2026-08-07');
    change(currentForm.elements.namedItem('content') as HTMLTextAreaElement, '对象 B 正在填写的记录');
    change(currentForm.elements.namedItem('owner') as HTMLInputElement, '乙');
  });
  assert.match(host.textContent || '', /对象 B 的时间线/);

  await act(async () => { oldPost.resolve(await response(event(11))); await oldPost.promise; });
  assert.equal((currentForm.elements.namedItem('content') as HTMLTextAreaElement).value, '对象 B 正在填写的记录');
  assert.equal((currentForm.elements.namedItem('owner') as HTMLInputElement).value, '乙');
  assert.match(host.textContent || '', /对象 B 的时间线/);
  assert.deepEqual(getUrls, [
    '/api/channeling-tracking-events?subjectType=well&subjectId=1',
    '/api/channeling-tracking-events?subjectType=well&subjectId=2',
  ]);
  await cleanup(root, dom);
});

test('a delayed correction from the previous subject cannot close or reload the current correction', async () => {
  const { dom, host, root } = setup();
  const oldCorrection = deferred<Response>();
  const getUrls: string[] = [];
  globalThis.fetch = (async (input, init) => {
    const url = String(input);
    if (init?.method === 'POST') return oldCorrection.promise;
    getUrls.push(url);
    return url.includes('subjectId=1')
      ? response([event(31, 'reviewed', { content: '对象 A 原记录' })])
      : response([event(32, 'reviewed', { content: '对象 B 原记录' })]);
  }) as typeof fetch;

  await act(async () => { root.render(createElement(ChannelingTimeline, { role: 'admin', subject: { subjectType: 'well', subjectId: 1 } })); });
  await act(async () => { (host.querySelector('button[aria-label="更正记录 31"]') as HTMLButtonElement).click(); });
  const oldForm = host.querySelector('form[data-correction-for="31"]') as HTMLFormElement;
  await act(async () => {
    change(oldForm.elements.namedItem('reason') as HTMLInputElement, '对象 A 更正原因');
    change(oldForm.elements.namedItem('evidence') as HTMLInputElement, '对象 A 复核证据');
  });
  await act(async () => { oldForm.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); });

  await act(async () => { root.render(createElement(ChannelingTimeline, { role: 'admin', subject: { subjectType: 'well', subjectId: 2 } })); });
  await act(async () => { (host.querySelector('button[aria-label="更正记录 32"]') as HTMLButtonElement).click(); });
  const currentCorrection = host.querySelector('form[data-correction-for="32"]') as HTMLFormElement;
  await act(async () => { change(currentCorrection.elements.namedItem('reason') as HTMLInputElement, '对象 B 正在填写的更正原因'); });

  await act(async () => { oldCorrection.resolve(await response(event(33, 'corrected', { supersedesEventId: 31 }))); await oldCorrection.promise; });
  const preserved = host.querySelector('form[data-correction-for="32"]') as HTMLFormElement;
  assert.ok(preserved);
  assert.equal((preserved.elements.namedItem('reason') as HTMLInputElement).value, '对象 B 正在填写的更正原因');
  assert.match(host.textContent || '', /对象 B 原记录/);
  assert.doesNotMatch(host.textContent || '', /对象 A 原记录/);
  assert.deepEqual(getUrls, [
    '/api/channeling-tracking-events?subjectType=well&subjectId=1',
    '/api/channeling-tracking-events?subjectType=well&subjectId=2',
  ]);
  await cleanup(root, dom);
});

test('unmount invalidates a delayed add without starting a follow-up load', async () => {
  const { dom, host, root } = setup();
  const oldPost = deferred<Response>();
  const getUrls: string[] = [];
  globalThis.fetch = (async (input, init) => {
    if (init?.method === 'POST') return oldPost.promise;
    getUrls.push(String(input));
    return response([]);
  }) as typeof fetch;
  await act(async () => { root.render(createElement(ChannelingTimeline, { role: 'admin', subject: { subjectType: 'well', subjectId: 1 } })); });
  const form = host.querySelector('form[data-event-form]') as HTMLFormElement;
  await act(async () => {
    change(form.elements.namedItem('occurredOn') as HTMLInputElement, '2026-08-06');
    change(form.elements.namedItem('content') as HTMLTextAreaElement, '卸载前新增');
    change(form.elements.namedItem('owner') as HTMLInputElement, '甲');
  });
  await act(async () => { form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); });
  await act(async () => { root.unmount(); });
  await act(async () => { oldPost.resolve(await response(event(51))); await oldPost.promise; });
  assert.deepEqual(getUrls, ['/api/channeling-tracking-events?subjectType=well&subjectId=1']);
  dom.window.close();
});

test('unmount invalidates a delayed correction without starting a follow-up load', async () => {
  const { dom, host, root } = setup();
  const oldPost = deferred<Response>();
  const getUrls: string[] = [];
  globalThis.fetch = (async (input, init) => {
    if (init?.method === 'POST') return oldPost.promise;
    getUrls.push(String(input));
    return response([event(52, 'reviewed')]);
  }) as typeof fetch;
  await act(async () => { root.render(createElement(ChannelingTimeline, { role: 'admin', subject: { subjectType: 'well', subjectId: 1 } })); });
  await act(async () => { (host.querySelector('button[aria-label="更正记录 52"]') as HTMLButtonElement).click(); });
  const form = host.querySelector('form[data-correction-for="52"]') as HTMLFormElement;
  await act(async () => {
    change(form.elements.namedItem('reason') as HTMLInputElement, '卸载前更正');
    change(form.elements.namedItem('evidence') as HTMLInputElement, '复核证据');
  });
  await act(async () => { form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); });
  await act(async () => { root.unmount(); });
  await act(async () => { oldPost.resolve(await response(event(53, 'corrected', { supersedesEventId: 52 }))); await oldPost.promise; });
  assert.deepEqual(getUrls, ['/api/channeling-tracking-events?subjectType=well&subjectId=1']);
  dom.window.close();
});

test('starting another correction on the same subject isolates it from the pending correction', async () => {
  const { dom, host, root } = setup();
  const oldPost = deferred<Response>();
  let loads = 0;
  globalThis.fetch = (async (_input, init) => {
    if (init?.method === 'POST') return oldPost.promise;
    loads++;
    return response([event(61, 'reviewed'), event(62, 'reviewed')]);
  }) as typeof fetch;
  await act(async () => { root.render(createElement(ChannelingTimeline, { role: 'admin', subject: { subjectType: 'project', subjectId: 7 } })); });
  await act(async () => { (host.querySelector('button[aria-label="更正记录 61"]') as HTMLButtonElement).click(); });
  const first = host.querySelector('form[data-correction-for="61"]') as HTMLFormElement;
  await act(async () => {
    change(first.elements.namedItem('reason') as HTMLInputElement, '第一条更正');
    change(first.elements.namedItem('evidence') as HTMLInputElement, '第一条证据');
  });
  await act(async () => { first.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); });

  await act(async () => { (host.querySelector('button[aria-label="更正记录 62"]') as HTMLButtonElement).click(); });
  const second = host.querySelector('form[data-correction-for="62"]') as HTMLFormElement;
  await act(async () => { change(second.elements.namedItem('reason') as HTMLInputElement, '第二条正在填写'); });
  await act(async () => { oldPost.resolve(await response(event(63, 'corrected', { supersedesEventId: 61 }))); await oldPost.promise; });

  const preserved = host.querySelector('form[data-correction-for="62"]') as HTMLFormElement;
  assert.ok(preserved);
  assert.equal((preserved.elements.namedItem('reason') as HTMLInputElement).value, '第二条正在填写');
  assert.equal(loads, 1, 'the obsolete correction does not refresh the timeline');
  await cleanup(root, dom);
});
