import assert from 'node:assert/strict';
import test from 'node:test';
import { JSDOM } from 'jsdom';
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { ChannelingProjectManagement } from '../src/components/ChannelingProjectManagement.tsx';

const deferred = <T>() => {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};

const payload = (data: unknown) => Promise.resolve({ ok: true, status: 200, json: async () => ({ success: true, data }) } as Response);
const project = { id: 7, projectName: '测试项目', block: '一区', owner: '负责人', status: 'identified', governanceMeasure: '', plannedDate: null, actualDate: null, beforeMetric: null, afterMetric: null, closureEvidence: '', riskLevel: 'medium', estimatedLoss: null, affectedWellCount: null, affectedDailyOil: null, occupiedProduction: null, createdAt: '', updatedAt: '' };
const preview = { id: 31, projectId: null, fileName: '关系.xlsx', channelingType: 'steam', status: 'preview', validCount: 1, duplicateCount: 0, selfRelationCount: 0, invalidCount: 0, createdAt: '', confirmedAt: null, valid: [{ rowNumber: 2, injectorWellNo: '注1', producerWellNo: '采1', channelingType: 'steam' }], duplicates: [], selfRelations: [], invalid: [] };
const relation = (well: string, channelingType: 'steam' | 'nitrogen') => ({ id: channelingType === 'steam' ? 1 : 2, projectId: 7, channelingType, injectionWell: well, productionWell: `采-${well}`, reservoirLayer: 'S1', impactLevel: 'medium', confidence: .5, status: 'confirmed', source: 'manual', evidence: '证据', effectiveStartDate: '2026-08-05', effectiveEndDate: '2026-08-05', owner: '负责人', block: '一区', createdAt: '', updatedAt: '' });

const setupDom = () => {
  const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', { url: 'http://localhost' });
  Object.defineProperties(globalThis, {
    window: { configurable: true, value: dom.window },
    document: { configurable: true, value: dom.window.document },
    navigator: { configurable: true, value: dom.window.navigator },
    HTMLElement: { configurable: true, value: dom.window.HTMLElement },
    HTMLInputElement: { configurable: true, value: dom.window.HTMLInputElement },
    Event: { configurable: true, value: dom.window.Event },
    File: { configurable: true, value: dom.window.File },
    localStorage: { configurable: true, value: dom.window.localStorage },
    IS_REACT_ACT_ENVIRONMENT: { configurable: true, value: true },
  });
  return dom;
};

const uploadPreview = async (host: HTMLElement) => {
  const input = host.querySelector('input[type="file"]') as HTMLInputElement;
  const file = new File(['workbook'], '关系.xlsx', { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  Object.defineProperty(input, 'files', { configurable: true, value: [file] });
  await act(async () => { input.dispatchEvent(new Event('change', { bubbles: true })); });
};
const openRelations = async (host: HTMLElement) => {
  const tab = [...host.querySelectorAll('[role="tab"]')].find((item) => item.textContent === '关系清单') as HTMLButtonElement;
  await act(async () => tab.click());
};

test('preview selects the current project when projects finish loading after upload', async () => {
  const dom = setupDom();
  const host = document.getElementById('root')!;
  const root = createRoot(host);
  const projectsResponse = deferred<Response>();
  globalThis.fetch = (async (input) => {
    const url = String(input);
    if (url === '/api/channeling-projects') return projectsResponse.promise;
    if (url.startsWith('/api/channeling-projects/pending')) return payload([]);
    if (url === '/api/channeling-relation-imports/preview') return payload(preview);
    if (url.includes('/relations') || url.includes('/relation-imports')) return payload([]);
    throw new Error(`unexpected fetch ${url}`);
  }) as typeof fetch;

  await act(async () => { root.render(createElement(ChannelingProjectManagement, { role: 'admin' })); });
  await uploadPreview(host);
  assert.equal((host.querySelector('label select') as HTMLSelectElement).value, '', 'preview starts without a target while projects are pending');

  await act(async () => { projectsResponse.resolve(await payload([project])); await projectsResponse.promise; });
  const target = [...host.querySelectorAll('select')].find((item) => item.parentElement?.textContent?.includes('确认到项目')) as HTMLSelectElement;
  const confirm = [...host.querySelectorAll('button')].find((item) => item.textContent === '确认导入') as HTMLButtonElement;
  assert.equal(target.value, '7');
  assert.equal(confirm.disabled, false);

  await act(async () => { root.unmount(); });
  dom.window.close();
});

test('every visible relation row exposes the detail and tracking callback', async () => {
  const dom = setupDom(); const host = document.getElementById('root')!; const root = createRoot(host); let opened = 0;
  globalThis.fetch = (async (input) => { const url = String(input); if (url === '/api/channeling-projects') return payload([project]); if (url.startsWith('/api/channeling-projects/pending')) return payload([]); if (url.includes('/relations')) return payload([relation('注1', 'steam'), relation('注2', 'nitrogen')]); if (url.includes('/relation-imports')) return payload([]); throw new Error(url); }) as typeof fetch;
  await act(async () => root.render(createElement(ChannelingProjectManagement, { role: 'guest', onOpenRelation: (id: number) => { opened = id; } })));
  await openRelations(host);
  const buttons = [...host.querySelectorAll('button')].filter((item) => item.textContent === '查看详情/跟踪记录'); assert.equal(buttons.length, 2);
  await act(async () => buttons[1].click()); assert.equal(opened, 2);
  await act(async () => root.unmount()); dom.window.close();
});

test('confirmation submits once and keeps success semantics when refresh fails', async () => {
  const dom = setupDom();
  const host = document.getElementById('root')!;
  const root = createRoot(host);
  const confirmation = deferred<Response>();
  let projectLoads = 0;
  let confirmationCalls = 0;
  globalThis.fetch = (async (input) => {
    const url = String(input);
    if (url === '/api/channeling-projects') {
      projectLoads++;
      if (projectLoads > 1) throw new Error('refresh unavailable');
      return payload([project]);
    }
    if (url.startsWith('/api/channeling-projects/pending')) return payload([]);
    if (url === '/api/channeling-relation-imports/preview') return payload(preview);
    if (url === `/api/channeling-relation-imports/${preview.id}/confirm`) { confirmationCalls++; return confirmation.promise; }
    if (url.includes('/relations') || url.includes('/relation-imports')) return payload([]);
    throw new Error(`unexpected fetch ${url}`);
  }) as typeof fetch;

  await act(async () => { root.render(createElement(ChannelingProjectManagement, { role: 'admin' })); });
  await uploadPreview(host);
  const confirm = [...host.querySelectorAll('button')].find((item) => item.textContent === '确认导入') as HTMLButtonElement;
  await act(async () => { confirm.click(); confirm.click(); });
  assert.equal(confirmationCalls, 1, 'a pending confirmation blocks duplicate submission');
  assert.equal(confirm.disabled, true);

  await act(async () => { confirmation.resolve(await payload({ ...preview, status: 'confirmed', projectId: 7 })); await confirmation.promise; });
  assert.match(host.textContent || '', /已确认，但刷新失败/);
  assert.doesNotMatch(host.textContent || '', /确认失败/);
  assert.doesNotMatch(host.textContent || '', /关系\.xlsx/);
  const banner = host.querySelector('[aria-live="polite"]');
  assert.ok(banner?.className.includes('status-banner-warning'));

  await act(async () => { root.unmount(); });
  dom.window.close();
});

test('an older relation response cannot replace the latest type-filter result', async () => {
  const dom = setupDom();
  const host = document.getElementById('root')!;
  const root = createRoot(host);
  const steam = deferred<Response>();
  const nitrogen = deferred<Response>();
  globalThis.fetch = (async (input) => {
    const url = String(input);
    if (url === '/api/channeling-projects') return payload([project]);
    if (url.startsWith('/api/channeling-projects/pending')) return payload([]);
    if (url.endsWith('/relations')) return steam.promise;
    if (url.includes('channelingType=nitrogen')) return nitrogen.promise;
    if (url.includes('/relation-imports')) return payload([]);
    throw new Error(`unexpected fetch ${url}`);
  }) as typeof fetch;

  await act(async () => { root.render(createElement(ChannelingProjectManagement, { role: 'guest' })); });
  await openRelations(host);
  const filter = host.querySelector('select[aria-label="注窜类型筛选"]') as HTMLSelectElement;
  await act(async () => { filter.value = 'nitrogen'; filter.dispatchEvent(new Event('change', { bubbles: true })); });
  await act(async () => { nitrogen.resolve(await payload([relation('氮井', 'nitrogen')])); await nitrogen.promise; });
  assert.match(host.textContent || '', /氮井/);

  await act(async () => { steam.resolve(await payload([relation('汽井', 'steam')])); await steam.promise; });
  assert.match(host.textContent || '', /氮井/);
  assert.doesNotMatch(host.textContent || '', /汽井/);

  await act(async () => { root.unmount(); });
  dom.window.close();
});

test('switching projects clears prior relation and import actions before the new response', async () => {
  const dom = setupDom();
  const host = document.getElementById('root')!;
  const root = createRoot(host);
  const secondProject = { ...project, id: 8, projectName: '第二项目', block: '二区' };
  const nextRelations = deferred<Response>();
  const nextImports = deferred<Response>();
  const oldImport = { ...preview, id: 41, projectId: 7, fileName: '旧项目关系.xlsx' };
  globalThis.fetch = (async (input) => {
    const url = String(input);
    if (url === '/api/channeling-projects') return payload([project, secondProject]);
    if (url.startsWith('/api/channeling-projects/pending')) return payload([]);
    if (url === '/api/channeling-projects/7/relations') return payload([relation('旧项目井', 'steam')]);
    if (url === '/api/channeling-projects/7/relation-imports') return payload([oldImport]);
    if (url === '/api/channeling-projects/8/relations') return nextRelations.promise;
    if (url === '/api/channeling-projects/8/relation-imports') return nextImports.promise;
    throw new Error(`unexpected fetch ${url}`);
  }) as typeof fetch;

  await act(async () => { root.render(createElement(ChannelingProjectManagement, { role: 'admin' })); });
  await openRelations(host);
  assert.match(host.textContent || '', /旧项目井/);
  assert.match(host.textContent || '', /旧项目关系\.xlsx/);

  const projectButton = [...host.querySelectorAll('button')].find((item) => item.textContent?.includes('第二项目')) as HTMLButtonElement;
  await act(async () => { projectButton.click(); });
  await openRelations(host);
  assert.doesNotMatch(host.textContent || '', /旧项目井/);
  assert.doesNotMatch(host.textContent || '', /旧项目关系\.xlsx/);
  assert.equal([...host.querySelectorAll('button')].some((item) => item.textContent === '确认导入'), false, 'stale import action is removed while the next project loads');

  await act(async () => { nextRelations.resolve(await payload([])); nextImports.resolve(await payload([])); await Promise.all([nextRelations.promise, nextImports.promise]); });
  await act(async () => { root.unmount(); });
  dom.window.close();
});

test('a delayed confirmation cannot restore the project or type filter active when it started', async () => {
  const dom = setupDom();
  const host = document.getElementById('root')!;
  const root = createRoot(host);
  const secondProject = { ...project, id: 8, projectName: '第二项目', block: '二区' };
  const confirmation = deferred<Response>();
  globalThis.fetch = (async (input) => {
    const url = String(input);
    if (url === '/api/channeling-projects') return payload([project, secondProject]);
    if (url.startsWith('/api/channeling-projects/pending')) return payload([]);
    if (url === '/api/channeling-relation-imports/preview') return payload(preview);
    if (url === `/api/channeling-relation-imports/${preview.id}/confirm`) return confirmation.promise;
    if (url === '/api/channeling-projects/8/relations?channelingType=nitrogen') return payload([relation('当前氮气井', 'nitrogen')]);
    if (url.includes('/relations') || url.includes('/relation-imports')) return payload([]);
    throw new Error(`unexpected fetch ${url}`);
  }) as typeof fetch;

  await act(async () => { root.render(createElement(ChannelingProjectManagement, { role: 'admin' })); });
  await uploadPreview(host);
  const confirm = [...host.querySelectorAll('button')].find((item) => item.textContent === '确认导入') as HTMLButtonElement;
  await act(async () => { confirm.click(); });
  const secondProjectButton = [...host.querySelectorAll('button')].find((item) => item.textContent?.includes('第二项目')) as HTMLButtonElement;
  await act(async () => { secondProjectButton.click(); });
  await openRelations(host);
  const typeFilter = host.querySelector('select[aria-label="注窜类型筛选"]') as HTMLSelectElement;
  await act(async () => { typeFilter.value = 'nitrogen'; typeFilter.dispatchEvent(new Event('change', { bubbles: true })); });
  assert.match(host.textContent || '', /当前氮气井/);

  await act(async () => { confirmation.resolve(await payload({ ...preview, status: 'confirmed', projectId: 7 })); await confirmation.promise; });
  assert.ok(secondProjectButton.className.includes('bg-red-50'), 'the project selected while confirming remains active');
  assert.equal(typeFilter.value, 'nitrogen');
  assert.match(host.textContent || '', /当前氮气井/);

  await act(async () => { root.unmount(); });
  dom.window.close();
});

test('history-protected relation deletion becomes non-executable while release and unrelated relations remain available', async () => {
  const dom = setupDom(); const host = document.getElementById('root')!; const root = createRoot(host);
  Object.defineProperty(window, 'confirm', { configurable: true, value: () => true });
  const first = relation('受保护注入井', 'steam');
  const other = relation('普通注入井', 'nitrogen');
  let deleteCalls = 0; let releaseCalls = 0; let unrelatedDeleteCalls = 0;
  globalThis.fetch = (async (input, init) => {
    const url = String(input);
    if (url === '/api/channeling-projects') return payload([project]);
    if (url.startsWith('/api/channeling-projects/pending')) return payload([]);
    if (url === '/api/channeling-projects/7/relations') return payload([first, other]);
    if (url === '/api/channeling-projects/7/relation-imports') return payload([]);
    if (url === '/api/channeling-relations/1' && init?.method === 'DELETE') { deleteCalls++; return new Response(JSON.stringify({ success: false, message: 'Relation has tracking history' }), { status: 409 }); }
    if (url === '/api/channeling-relations/1' && init?.method === 'PATCH') { releaseCalls++; return new Response(JSON.stringify({ success: true, data: { ...first, status: 'released' } }), { status: 200 }); }
    if (url === '/api/channeling-relations/2' && init?.method === 'DELETE') { unrelatedDeleteCalls++; return new Response(JSON.stringify({ success: false, message: 'Concurrent update conflict' }), { status: 409 }); }
    throw new Error(`unexpected fetch ${url}`);
  }) as typeof fetch;

  await act(async () => root.render(createElement(ChannelingProjectManagement, { role: 'admin' })));
  await openRelations(host);
  const deleteButtons = [...host.querySelectorAll('button')].filter((button) => button.textContent === '删除关系') as HTMLButtonElement[];
  assert.equal(deleteButtons.length, 2);
  const protectedDelete = deleteButtons[0]; const protectedRow = protectedDelete.parentElement!;
  await act(async () => protectedDelete.click());
  assert.equal(deleteCalls, 1);
  assert.equal(protectedDelete.disabled, true);
  assert.match(protectedRow.textContent || '', /已有跟踪历史，请解除关系并保留历史/);
  await act(async () => protectedDelete.click());
  assert.equal(deleteCalls, 1);
  const release = [...protectedRow.querySelectorAll('button')].find((button) => button.textContent === '解除关系') as HTMLButtonElement;
  assert.equal(release.disabled, false);
  await act(async () => release.click());
  assert.equal(releaseCalls, 1);
  const currentDeletes = [...host.querySelectorAll('button')].filter((button) => button.textContent === '删除关系') as HTMLButtonElement[];
  assert.equal(currentDeletes[1].disabled, false);
  await act(async () => currentDeletes[1].click());
  assert.equal(unrelatedDeleteCalls, 1);
  assert.equal(currentDeletes[1].disabled, false);
  assert.doesNotMatch(currentDeletes[1].parentElement?.textContent || '', /已有跟踪历史/);
  await act(async () => root.unmount()); dom.window.close();
});

test('history-protected project deletion disables only that project hard delete', async () => {
  const dom = setupDom(); const host = document.getElementById('root')!; const root = createRoot(host);
  Object.defineProperty(window, 'confirm', { configurable: true, value: () => true });
  const otherProject = { ...project, id: 8, projectName: '普通项目' };
  let protectedDeletes = 0;
  globalThis.fetch = (async (input, init) => {
    const url = String(input);
    if (url === '/api/channeling-projects') return payload([project, otherProject]);
    if (url.startsWith('/api/channeling-projects/pending')) return payload([]);
    if (url.endsWith('/relations') || url.endsWith('/relation-imports')) return payload([]);
    if (url === '/api/channeling-projects/7' && init?.method === 'DELETE') { protectedDeletes++; return new Response(JSON.stringify({ success: false, message: 'Project has relations or tracking history' }), { status: 409 }); }
    throw new Error(`unexpected fetch ${url}`);
  }) as typeof fetch;

  await act(async () => root.render(createElement(ChannelingProjectManagement, { role: 'admin' })));
  const protectedDelete = [...host.querySelectorAll('button')].find((button) => button.textContent === '删除项目') as HTMLButtonElement;
  await act(async () => protectedDelete.click());
  assert.equal(protectedDeletes, 1);
  assert.equal(protectedDelete.disabled, true);
  assert.match(host.textContent || '', /项目已有关系或跟踪历史，应保留历史记录/);
  await act(async () => protectedDelete.click());
  assert.equal(protectedDeletes, 1);
  const otherButton = [...host.querySelectorAll('button')].find((button) => button.textContent?.includes('普通项目')) as HTMLButtonElement;
  await act(async () => otherButton.click());
  const otherDelete = [...host.querySelectorAll('button')].find((button) => button.textContent === '删除项目') as HTMLButtonElement;
  assert.equal(otherDelete.disabled, false);
  assert.doesNotMatch(host.textContent || '', /项目已有关系或跟踪历史，应保留历史记录/);
  await act(async () => root.unmount()); dom.window.close();
});

test('a delayed manual relation create cannot reload or pollute a newly selected project', async () => {
  const dom = setupDom(); const host = document.getElementById('root')!; const root = createRoot(host);
  const secondProject = { ...project, id: 8, projectName: '当前项目' };
  const pending = deferred<Response>(); let oldRelationLoads = 0;
  globalThis.fetch = (async (input, init) => {
    const url = String(input);
    if (url === '/api/channeling-projects') return payload([project, secondProject]);
    if (url.startsWith('/api/channeling-projects/pending')) return payload([]);
    if (url === '/api/channeling-projects/7/relations' && !init?.method) { oldRelationLoads++; return payload([relation('旧井', 'steam')]); }
    if (url === '/api/channeling-projects/7/relations' && init?.method === 'POST') return pending.promise;
    if (url === '/api/channeling-projects/8/relations') return payload([{ ...relation('当前井', 'nitrogen'), id: 82, projectId: 8 }]);
    if (url.endsWith('/relation-imports')) return payload([]);
    throw new Error(`unexpected fetch ${url}`);
  }) as typeof fetch;
  await act(async () => root.render(createElement(ChannelingProjectManagement, { role: 'admin' })));
  await openRelations(host);
  const form = [...host.querySelectorAll('form')].find((item) => item.textContent?.includes('手工新增关系'))!;
  await act(async () => form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
  const second = [...host.querySelectorAll('button')].find((item) => item.textContent?.includes('当前项目')) as HTMLButtonElement;
  await act(async () => second.click()); await openRelations(host);
  assert.match(host.textContent || '', /当前井/);
  await act(async () => { pending.resolve(await payload(relation('新增井', 'steam'))); await pending.promise; });
  assert.equal(oldRelationLoads, 1); assert.match(host.textContent || '', /当前井/); assert.doesNotMatch(host.textContent || '', /新增井/);
  await act(async () => root.unmount()); dom.window.close();
});

for (const operation of ['提交疑似确认', '解除关系'] as const) test(`a delayed ${operation} cannot reload or pollute a newly selected project`, async () => {
  const dom = setupDom(); const host = document.getElementById('root')!; const root = createRoot(host);
  const secondProject = { ...project, id: 8, projectName: '当前项目' };
  const old = { ...relation('旧井', 'steam'), status: operation === '提交疑似确认' ? 'suspected' : 'confirmed' };
  const pending = deferred<Response>(); let oldRelationLoads = 0;
  globalThis.fetch = (async (input, init) => {
    const url = String(input);
    if (url === '/api/channeling-projects') return payload([project, secondProject]);
    if (url.startsWith('/api/channeling-projects/pending')) return payload([]);
    if (url === '/api/channeling-projects/7/relations') { oldRelationLoads++; return payload([old]); }
    if (url === `/api/channeling-relations/${old.id}` && init?.method === 'PATCH') return pending.promise;
    if (url === '/api/channeling-projects/8/relations') return payload([{ ...relation('当前井', 'nitrogen'), id: 82, projectId: 8 }]);
    if (url.endsWith('/relation-imports')) return payload([]);
    throw new Error(`unexpected fetch ${url}`);
  }) as typeof fetch;
  await act(async () => root.render(createElement(ChannelingProjectManagement, { role: 'admin' })));
  await openRelations(host);
  const action = [...host.querySelectorAll('button')].find((item) => item.textContent === operation) as HTMLButtonElement;
  await act(async () => action.click());
  const second = [...host.querySelectorAll('button')].find((item) => item.textContent?.includes('当前项目')) as HTMLButtonElement;
  await act(async () => second.click()); await openRelations(host);
  assert.match(host.textContent || '', /当前井/);
  await act(async () => { pending.resolve(await payload({ ...old, status: operation === '提交疑似确认' ? 'confirmed' : 'released' })); await pending.promise; });
  assert.equal(oldRelationLoads, 1); assert.match(host.textContent || '', /当前井/); assert.doesNotMatch(host.textContent || '', /旧井/);
  await act(async () => root.unmount()); dom.window.close();
});

test('server-derived delete capabilities disable hard deletes before any probing request', async () => {
  const dom = setupDom(); const host = document.getElementById('root')!; const root = createRoot(host); let deletes = 0;
  const protectedProject = { ...project, canDelete: false, hasTrackingHistory: false, relationCount: 1 };
  const tracked = { ...relation('跟踪井', 'steam'), canDelete: false, hasTrackingHistory: true };
  const clean = { ...relation('干净井', 'nitrogen'), canDelete: true, hasTrackingHistory: false };
  globalThis.fetch = (async (input, init) => {
    const url = String(input); if (init?.method === 'DELETE') { deletes++; return payload(undefined); }
    if (url === '/api/channeling-projects') return payload([protectedProject]);
    if (url.startsWith('/api/channeling-projects/pending')) return payload([]);
    if (url === '/api/channeling-projects/7/relations') return payload([tracked, clean]);
    if (url.endsWith('/relation-imports')) return payload([]);
    throw new Error(url);
  }) as typeof fetch;
  await act(async () => root.render(createElement(ChannelingProjectManagement, { role: 'admin' })));
  const deleteProjectButton = [...host.querySelectorAll('button')].find((button) => button.textContent === '删除项目') as HTMLButtonElement;
  assert.equal(deleteProjectButton.disabled, true); assert.match(host.textContent || '', /项目存在 1 条关系，请保留项目历史/);
  await openRelations(host);
  const deleteRelations = [...host.querySelectorAll('button')].filter((button) => button.textContent === '删除关系') as HTMLButtonElement[];
  assert.equal(deleteRelations[0].disabled, true); assert.equal(deleteRelations[1].disabled, false);
  assert.match(deleteRelations[0].parentElement?.textContent || '', /已有跟踪历史，请解除关系并保留历史/);
  await act(async () => { deleteProjectButton.click(); deleteRelations[0].click(); }); assert.equal(deletes, 0);
  await act(async () => root.unmount()); dom.window.close();
});
