import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { ChannelingWorkspace } from '../src/components/ChannelingWorkspace.tsx';

const source = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8');
test('App renders the shared workspace for both sidebar branches', () => { assert.match(source, /ChannelingWorkspace/); assert.match(source, /channelingProjectManagement[^\n]+initialView="projects"/); assert.match(source, /channelingWellTracking[^\n]+initialView="wells"/); });

test('workspace resets navigation when initialView changes', async () => {
  const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', { url: 'http://localhost' });
  Object.defineProperties(globalThis, { window: { configurable: true, value: dom.window }, document: { configurable: true, value: dom.window.document }, navigator: { configurable: true, value: dom.window.navigator }, HTMLElement: { configurable: true, value: dom.window.HTMLElement }, Event: { configurable: true, value: dom.window.Event }, localStorage: { configurable: true, value: dom.window.localStorage }, IS_REACT_ACT_ENVIRONMENT: { configurable: true, value: true } });
  globalThis.fetch = (async (raw) => { const url = String(raw); if (url === '/api/channeling-projects' || url.startsWith('/api/channeling-wells?') || url.includes('/pending')) return new Response(JSON.stringify({ success: true, data: [] })); throw new Error(url); }) as typeof fetch;
  const host = document.getElementById('root')!; const root = createRoot(host);
  await act(async () => root.render(createElement(ChannelingWorkspace, { role: 'guest', initialView: 'projects' }))); assert.match(host.textContent || '', /注窜项目台账/);
  await act(async () => root.render(createElement(ChannelingWorkspace, { role: 'guest', initialView: 'wells' }))); assert.match(host.textContent || '', /单井跟踪台账/); assert.doesNotMatch(host.textContent || '', /注窜关系识别/);
  await act(async () => root.unmount()); dom.window.close();
});

test('workspace navigates project to relation to either well and back coherently', async () => {
  const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', { url: 'http://localhost' });
  Object.defineProperties(globalThis, { window: { configurable: true, value: dom.window }, document: { configurable: true, value: dom.window.document }, navigator: { configurable: true, value: dom.window.navigator }, HTMLElement: { configurable: true, value: dom.window.HTMLElement }, HTMLInputElement: { configurable: true, value: dom.window.HTMLInputElement }, Event: { configurable: true, value: dom.window.Event }, localStorage: { configurable: true, value: dom.window.localStorage }, IS_REACT_ACT_ENVIRONMENT: { configurable: true, value: true } });
  const envelope = (data: unknown) => Promise.resolve(new Response(JSON.stringify({ success: true, data })));
  const project = { id: 1, projectName: '联动项目', block: '高3', owner: '周', status: 'confirmed', governanceMeasure: '', plannedDate: null, actualDate: null, beforeMetric: null, afterMetric: null, closureEvidence: '', riskLevel: 'medium', estimatedLoss: null, affectedWellCount: null, affectedDailyOil: null, occupiedProduction: null, createdAt: '', updatedAt: '' };
  const relation = { id: 7, projectId: 1, channelingType: 'steam', injectionWell: '注7', productionWell: '采7', reservoirLayer: 'S1', impactLevel: 'high', confidence: .9, status: 'confirmed', source: 'manual', evidence: '示踪剂', effectiveStartDate: '2026-07-01', effectiveEndDate: null, owner: '周', project: { id: 1, name: '联动项目', block: '高3' } };
  const profile = (id: number, wellNo: string) => ({ id, wellNo, normalizedWellNo: wellNo, block: '高3', owner: '周', createdAt: '', updatedAt: '', roles: id === 11 ? ['injector'] : ['producer'], relationCount: 1, projectCount: 1 });
  const detail = { relationId: 7, injectionWell: '注7', productionWell: '采7', range: { beforeStart: '2026-07-01', splitDate: '2026-07-16', afterEnd: '2026-07-31' }, generatedAt: '', injector: { wellNo: '注7', normalizedWellNo: '注7', roles: ['injector'], queriedAt: '', range: { start: '2026-07-01', end: '2026-07-31' }, production: null, injection: null }, producerSeries: [], comparison: { oil: { beforeAverage: null, afterAverage: null, change: null, changeRate: null, beforeValidDays: 0, afterValidDays: 0 }, liquid: { beforeAverage: null, afterAverage: null, change: null, changeRate: null, beforeValidDays: 0, afterValidDays: 0 }, waterCut: { beforeAverage: null, afterAverage: null, change: null, changeRate: null, beforeValidDays: 0, afterValidDays: 0 } } };
  globalThis.fetch = (async (raw) => {
    const url = String(raw);
    if (url === '/api/channeling-projects') return envelope([project]);
    if (url.startsWith('/api/channeling-projects/pending')) return envelope([]);
    if (url === '/api/channeling-projects/1/relations') return envelope([relation]);
    if (url === '/api/channeling-projects/1/relation-imports') return envelope([]);
    if (url.includes('/api/channeling-relations/7/detail?')) return envelope(detail);
    if (url.startsWith('/api/channeling-wells?')) { if (url.includes('%E6%B3%A87')) return envelope([profile(11, '注7')]); if (url.includes('%E9%87%877')) return envelope([profile(12, '采7')]); return envelope([profile(11, '注7'), profile(12, '采7')]); }
    if (url === '/api/channeling-wells/11' || url === '/api/channeling-wells/12') return envelope(profile(url.endsWith('11') ? 11 : 12, url.endsWith('11') ? '注7' : '采7'));
    if (url.includes('/metrics?')) return envelope({ wellNo: '采7', normalizedWellNo: '采7', roles: ['producer'], queriedAt: '', range: { start: '2026-07-01', end: '2026-07-31' }, production: null, injection: null });
    if (url.endsWith('/relations')) return envelope([relation]);
    throw new Error(url);
  }) as typeof fetch;
  const host = document.getElementById('root')!; const root = createRoot(host);
  const click = async (text: string) => { const button = [...host.querySelectorAll('button')].find((node) => node.textContent?.includes(text)); assert.ok(button, text); await act(async () => button.click()); };
  await act(async () => root.render(createElement(ChannelingWorkspace, { role: 'guest', initialView: 'projects' })));
  await click('关系清单');
  await click('查看详情/跟踪记录'); assert.match(host.textContent || '', /注入井：注7/);
  await click('生产井：采7'); assert.match(host.textContent || '', /单井跟踪台账/); assert.match(host.textContent || '', /采7/);
  await click('关联关系'); await click('查看关系详情'); assert.ok(host.querySelector('section[aria-label="注窜关系详情"]'));
  await click('返回'); assert.match(host.textContent || '', /单井跟踪台账/);
  await act(async () => root.unmount()); dom.window.close();
});
