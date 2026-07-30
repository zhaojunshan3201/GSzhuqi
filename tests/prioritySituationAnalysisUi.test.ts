import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import test from 'node:test';
import { JSDOM } from 'jsdom';
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { PrioritySituationAnalysis, type PrioritySituationData } from '../src/components/PrioritySituationAnalysis.tsx';
import {
  derivePriorityTrackingImportYear,
  filterPumpTrackingRowsByWell,
  mergePriorityIssueMeasureQuery,
} from '../src/lib/prioritySituationAnalysis.ts';

const componentPath = 'src/components/PrioritySituationAnalysis.tsx';

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
    IS_REACT_ACT_ENVIRONMENT: { configurable: true, value: true },
  });
  return dom;
};

const issue = (id: string, category: 'waterCut' | 'pump') => ({
  id, category, severity: category === 'pump' ? 'high' as const : 'medium' as const,
  wellNo: `${id}井`, comparison: '真实 DTO 对比口径', deviation: category === 'pump' ? -24 : 25,
  deviationText: category === 'pump' ? '-24.0%' : '25.0 个百分点', status: category === 'pump' ? '同期变差' : '含水偏差',
  suggestion: '核查数据', dataDate: '2026-07-30', targetTab: 'measures',
});

const minimumData = (issues = [issue('water', 'waterCut'), issue('pump', 'pump')]): PrioritySituationData => ({
  asOfDate: '2026-07-30', updatedAt: '2026-07-30T08:00:00.000Z',
  summary: { pump: 1, waterCut: 1, blockDecline: 0, soaking: 0, injectionPeriod: 0, restartTracking: 0 },
  issues, blockDeclines: [], soakingWells: [], restartSummary: {},
  sourceStatus: { tracking: { available: true, fileName: '跟踪.xlsx', updatedAt: '2026-07-30T08:00:00.000Z' } },
});

test('priority situation workspace includes categories, shared upload and supporting sections', () => {
  assert.ok(existsSync(componentPath), 'PrioritySituationAnalysis.tsx should exist');
  const source = readFileSync(componentPath, 'utf8');
  for (const label of ['检泵异常', '含水偏差', '区块递减', '焖井', '注采同期变化', '复产井跟踪']) assert.match(source, new RegExp(label));
  assert.match(source, /上传跟踪表/);
  assert.match(source, /重点异常处置清单/);
  assert.match(source, /上月递减率/);
  assert.match(source, /当前焖井/);
});

test('priority situation workspace has no escaped full-width brackets or common mojibake', () => {
  assert.doesNotMatch(readFileSync(componentPath, 'utf8'), /\\\\uff0[89]|锟斤拷|閿|閸|娴滄洖褰?/);
});

test('priority situation workspace filters DTO rows and dispatches detail/upload actions', async () => {
  const dom = setupDom();
  const host = document.getElementById('root')!;
  const root = createRoot(host);
  const opened: string[] = [];
  const uploaded: File[] = [];
  const render = (data: PrioritySituationData) => createElement(PrioritySituationAnalysis, { data, loading: false, error: '', uploading: false, onRefresh: () => {}, onUpload: (file) => uploaded.push(file), onOpenIssue: (selected) => opened.push(selected.id) });

  await act(async () => { root.render(render(minimumData())); });
  assert.equal(host.querySelector('table')!.querySelectorAll('tbody tr').length, 2, 'default all filter shows both DTO rows');
  const waterButton = [...host.querySelectorAll('button')].find((button) => button.textContent?.includes('含水偏差'))!;
  assert.equal(waterButton.getAttribute('aria-pressed'), 'false', 'inactive category exposes pressed state');
  await act(async () => { waterButton.click(); });
  assert.equal(host.querySelector('table')!.querySelectorAll('tbody tr').length, 1, 'category click filters the real DTO rows');
  assert.equal(waterButton.getAttribute('aria-pressed'), 'true', 'active category exposes pressed state');
  await act(async () => { (host.querySelector('table')!.querySelector('tbody button') as HTMLButtonElement).click(); });
  assert.deepEqual(opened, ['water']);

  const input = host.querySelector('input[type="file"]') as HTMLInputElement;
  const file = new File(['workbook'], '重点跟踪.xlsx', { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  Object.defineProperty(input, 'files', { configurable: true, value: [file] });
  await act(async () => { input.dispatchEvent(new Event('change', { bubbles: true })); });
  assert.deepEqual(uploaded, [file]);

  await act(async () => { root.render(render({ ...minimumData([]), sourceStatus: { tracking: { available: false, unavailableReason: '措施跟踪数据不可用' } } })); });
  assert.match(host.textContent || '', /当前筛选条件下暂无异常记录/);
  assert.match(host.textContent || '', /数据源待补全/);
  assert.match(host.textContent || '', /措施跟踪数据不可用/);
  await act(async () => { root.unmount(); });
  dom.window.close();
});

test('priority situation workspace paginates ten rows and resets to page one when filtering', async () => {
  const dom = setupDom();
  const host = document.getElementById('root')!;
  const root = createRoot(host);
  const waterIssues = Array.from({ length: 12 }, (_, index) => issue(`water-${index + 1}`, 'waterCut'));
  const pumpIssues = Array.from({ length: 12 }, (_, index) => issue(`pump-${index + 1}`, 'pump'));
  const data = minimumData([...waterIssues, ...pumpIssues]);
  data.summary = { ...data.summary, waterCut: 12, pump: 12 };

  await act(async () => {
    root.render(createElement(PrioritySituationAnalysis, {
      data,
      loading: false,
      error: '',
      uploading: false,
      onRefresh: () => {},
      onUpload: () => {},
      onOpenIssue: () => {},
    }));
  });

  const rows = () => [...host.querySelectorAll('table')][0].querySelectorAll('tbody tr');
  assert.equal(rows().length, 10, 'the unified issue table renders only ten rows per page');
  assert.match(host.textContent || '', /共 24 项/, 'the total remains the filtered result count, not the page size');

  const nextButton = host.querySelector('button[aria-label="下一页"]') as HTMLButtonElement;
  assert.ok(nextButton, 'pagination exposes a next-page control');
  await act(async () => { nextButton.click(); });
  assert.match(host.textContent || '', /第 2 页，共 3 页/, 'pagination announces the current and total page count');
  assert.match(rows()[0].textContent || '', /water-11井/, 'page two starts from the eleventh filtered row');

  const waterButton = [...host.querySelectorAll('button')].find((button) => button.textContent?.includes('含水偏差')) as HTMLButtonElement;
  await act(async () => { waterButton.click(); });
  assert.match(host.textContent || '', /第 1 页，共 2 页/, 'changing category resets pagination to page one');
  assert.equal(rows().length, 10);
  assert.match(rows()[0].textContent || '', /water-1井/);
  assert.doesNotMatch(host.textContent || '', /pump-1井/, 'the selected category still filters the DTO rows');

  await act(async () => { root.unmount(); });
  dom.window.close();
});

test('priority situation workspace renders six responsive summary cards with counts and pressed state', async () => {
  const dom = setupDom();
  const host = document.getElementById('root')!;
  const root = createRoot(host);

  await act(async () => {
    root.render(createElement(PrioritySituationAnalysis, {
      data: minimumData(),
      loading: false,
      error: '',
      uploading: false,
      onRefresh: () => {},
      onUpload: () => {},
      onOpenIssue: () => {},
    }));
  });

  const grid = host.querySelector('[data-testid="priority-summary-grid"]');
  assert.ok(grid, 'summary cards are grouped in a responsive grid');
  const cards = grid.querySelectorAll('button[data-category]');
  assert.equal(cards.length, 6);
  assert.equal(cards[0].getAttribute('aria-pressed'), 'false');
  assert.match(cards[0].textContent || '', /检泵异常/);
  assert.match(cards[0].textContent || '', /1/);

  await act(async () => { (cards[0] as HTMLButtonElement).click(); });
  assert.equal(cards[0].getAttribute('aria-pressed'), 'true', 'summary cards remain accessible filter buttons');

  await act(async () => { root.unmount(); });
  dom.window.close();
});

test('App connects the priority workspace to issue and tracking-import APIs', () => {
  const appSource = readFileSync('src/App.tsx', 'utf8');
  assert.match(appSource, /PrioritySituationAnalysis/);
  assert.match(appSource, /\/api\/analysis\/issues/);
  assert.match(appSource, /\/api\/measures\/import/);
  assert.doesNotMatch(appSource, /含水分布诊断[\s\S]{0,500}getPieOption/);
});

test('priority issue detail navigation preserves and applies measure well/block filters', () => {
  const previous = { start: '2026-07-01', end: '2026-07-30', station: '??', status: '??', year: '2026', keyword: '', block: '' };
  const result = mergePriorityIssueMeasureQuery(previous, { category: 'injectionPeriod', wellNo: '?1-2', block: '?46' } as any);
  assert.deepEqual(result, { ...previous, keyword: '?1-2', block: '?46' });

  const appSource = readFileSync('src/App.tsx', 'utf8');
  const handler = appSource.match(/const handlePriorityIssueOpen = \(issue: PriorityIssue\) => \{([\s\S]*?)const loadCompareData/);
  assert.ok(handler, 'priority issue detail handler should exist');
  assert.match(handler[1], /setMeasureQuery\(prev => mergePriorityIssueMeasureQuery\(prev, issue\)\)/);
});

test('priority tracking upload derives its year from the analysis cutoff date', () => {
  assert.equal(derivePriorityTrackingImportYear('2026-07-30', 2030), '2026');
  assert.equal(derivePriorityTrackingImportYear('2026-02-30', 2030), '2030');
  assert.equal(derivePriorityTrackingImportYear('2026-99-99', 2030), '2030');
  assert.equal(derivePriorityTrackingImportYear(undefined, 2030), '2030');

  const appSource = readFileSync('src/App.tsx', 'utf8');
  const handler = appSource.match(/const handlePriorityTrackingUpload = async \(file: File\) => \{([\s\S]*?)const handlePriorityIssueOpen/);
  assert.ok(handler, 'priority tracking upload handler should exist');
  assert.match(handler[1], /derivePriorityTrackingImportYear\(priorityAnalysisData\?\.asOfDate\)/);
  assert.doesNotMatch(handler[1], /measureImportYear/);
});

test('pump issue navigation visibly focuses and filters the selected well', () => {
  const rows = [
    { 井号: '高1-1', 状态: '待检泵' },
    { 井号: '高1-2', 状态: '待检泵' },
  ];
  assert.deepEqual(filterPumpTrackingRowsByWell(rows, ['井号', '状态'], '高1-2'), [rows[1]]);
  assert.deepEqual(filterPumpTrackingRowsByWell(rows, ['井号', '状态'], '不存在'), []);
  assert.deepEqual(filterPumpTrackingRowsByWell(rows, ['井号', '状态'], ''), rows);

  const appSource = readFileSync('src/App.tsx', 'utf8');
  const handler = appSource.match(/const handlePriorityIssueOpen = \(issue: PriorityIssue\) => \{([\s\S]*?)const loadCompareData/);
  assert.ok(handler);
  assert.match(handler[1], /issue\.category === 'pump'[\s\S]*setPriorityPumpWellNo\(issue\.wellNo\)/);
  assert.match(appSource, /重点情况定位井号/);
  assert.match(appSource, /filterPumpTrackingRowsByWell\(pumpAnalysisUpload\.rows, pumpAnalysisUpload\.columns, priorityPumpWellNo\)/);
  assert.match(appSource, /useEffect\(\(\) => \{[\s\S]*?loadPumpProductionOilAnalysis\(pumpOldWellRecoveredOilSeries\.groups\)[\s\S]*?\}, \[activeTab, pumpOldWellRecoveredOilSeries\]\)/);
  assert.match(appSource, /pumpProductionRequestIdRef\.current/);
});

test('soaking issue navigation passes the selected well into the soak-transfer page', () => {
  const appSource = readFileSync('src/App.tsx', 'utf8');
  const handler = appSource.match(/const handlePriorityIssueOpen = \(issue: PriorityIssue\) => \{([\s\S]*?)const loadCompareData/);
  assert.ok(handler);
  assert.match(handler[1], /issue\.category === 'soaking'[\s\S]*setPrioritySoakingWellNo\(issue\.wellNo\)/);
  assert.match(appSource, /initialWellNo=\{prioritySoakingWellNo\}/);
});
