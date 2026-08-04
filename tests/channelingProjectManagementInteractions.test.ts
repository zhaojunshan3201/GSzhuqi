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
