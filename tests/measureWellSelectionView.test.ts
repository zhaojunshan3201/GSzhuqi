import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import test from 'node:test';

import {
  SelectionImportStatusLine,
  SelectionScoreBreakdownText,
  SelectionScoringExplanation,
} from '../src/components/MeasureWellSelection.tsx';

test('renders independent data imports and monthly injection plan controls', () => {
  const component = readFileSync(new URL('../src/components/MeasureWellSelection.tsx', import.meta.url), 'utf8');
  for (const value of [
    '/api/injection-selection/import/stage',
    '/api/injection-selection/import/daily',
    '/api/injection-selection/data-status',
    '/api/injection-selection/rebuild',
    '/api/injection-selection/plans',
    '\u9636\u6bb5\u4ea7\u6cb9', '\u6ce8\u6c7d\u65e5\u6570\u636e', '\u76ee\u6807\u6708\u4efd',
    '\u751f\u6210\u6ce8\u6c7d\u8ba1\u5212', '\u5bfc\u51fa Excel', '\u5efa\u8bae\u6ce8\u6c7d\u91cf',
    '\u63a8\u8350\u9505\u7089', '\u4eba\u5de5\u51b3\u5b9a', '\u5907\u6ce8', '\u6c2e\u6c14', '\u4e8c\u6c27\u5316\u78b3',
  ]) assert.match(component, new RegExp(value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
});

test('patches editable plan item fields to persist manual updates', () => {
  const component = readFileSync(new URL('../src/components/MeasureWellSelection.tsx', import.meta.url), 'utf8');
  assert.match(component, /method:\s*'PATCH'/);
  for (const field of ['suggestedSteam', 'recommendedBoiler', 'decision', 'manualNote']) assert.match(component, new RegExp(field));
});


test('requires both sources and a successful rebuild before plan generation, while showing decision evidence', () => {
  const component = readFileSync(new URL('../src/components/MeasureWellSelection.tsx', import.meta.url), 'utf8');
  for (const value of ['bothSourcesReady', 'rebuildComplete', 'excluded', 'qualityReasons', 'scoreBreakdown', 'skippedRowCount', 'errorMessages']) assert.match(component, new RegExp(value));
  assert.match(component, /disabled=\{rebuilding \|\| !bothSourcesReady\}/);
  assert.match(component, /disabled=\{generating \|\| !bothSourcesReady \|\| !rebuildComplete\}/);
});

test('renders readable import diagnostics and score evidence', () => {
  const status = renderToStaticMarkup(createElement(SelectionImportStatusLine, {
    source: {
      sourceType: 'stage',
      sourceFile: 'stage.xlsx',
      importedAt: '2026-07-28T00:00:00.000Z',
      rowCount: 1,
      skippedRowCount: 1,
      errorMessages: ['? 1178 ??阶段产油不能为空'],
    },
  }));
  assert.match(status, /阶段产油：跳过 1 行/);
  assert.match(status, /导入错误：第 1178 行：阶段产油不能为空/);
  assert.doesNotMatch(status, /\?/);

  const explanation = renderToStaticMarkup(createElement(SelectionScoringExplanation));
  assert.match(explanation, /总分为四项之和，满分 100 分/);
  const breakdown = renderToStaticMarkup(createElement(SelectionScoreBreakdownText, {
    scoreBreakdown: {
      oilSteamRatio: { score: 55, value: 0.5, maxScore: 60 },
      stageOil: { score: 18, value: 300, maxScore: 20 },
      stability: { score: 8, value: 0.8, maxScore: 10 },
      dailyCompleteness: { score: 9, value: 0.9, maxScore: 10 },
    },
  }));
  assert.equal(breakdown, '<span>油汽比 55/60；阶段产油 18/20；稳定性 8/10；日数据完整性 9/10</span>');
  assert.doesNotMatch(breakdown, /\?/);
});

test('renders selected-well reference data before the monthly plan', async () => {
  const { SelectedWellReferencePanel } = await import('../src/components/MeasureWellSelection.tsx');
  const markup = renderToStaticMarkup(createElement(SelectedWellReferencePanel, {
    planItems: [{ id: 1, rankNo: 1, wellNo: 'A-01', score: 88, suggestedSteam: null, recommendedBoiler: null, nitrogen: false, carbonDioxide: false, oilSteamRatio: 0.42, stageOil: 120, decision: 'included', manualNote: null, scoreBreakdown: { oilSteamRatio: { score: 1, value: 1, maxScore: 1 }, stageOil: { score: 1, value: 1, maxScore: 1 }, stability: { score: 1, value: 1, maxScore: 1 }, dailyCompleteness: { score: 1, value: 1, maxScore: 1 } } }],
    selectedWellNo: 'A-01',
    reference: { wellNo: 'A-01', cycles: [{ cycleNo: 3, stopInjectionDate: '2026-01-01', metrics: { stageOil: 12.3, oilSteamRatio: 0.45, steamVolume: 90 }, points: [{ day: 10, oil: 3.2 }, { day: 11, oil: null }], missingReason: null }], similarWells: [{ wellNo: 'B-02', similarity: 92, score: 86, oilSteamRatio: 0.4, stageOil: 100 }], missingReasons: [] },
  }));
  assert.ok(markup.includes('\u5df2\u9009\u4e95\u6548\u679c\u53c2\u8003'));
  assert.ok(markup.includes('\u505c\u6ce8\u6c7d\u65e5\u671f'));
  assert.ok(markup.includes('\u9636\u6bb5\u4ea7\u6cb9'));
  assert.ok(markup.includes('\u540c\u7c7b\u4e95'));
  assert.match(markup, /B-02/);
  assert.match(markup, /12\.3/);
  assert.match(markup, /0\.45/);
  assert.match(markup, /90/);
  const component = readFileSync(new URL('../src/components/MeasureWellSelection.tsx', import.meta.url), 'utf8');
  assert.ok(component.indexOf('planItems={plan.items}') < component.lastIndexOf('SelectionScoringExplanation'));
  assert.match(component, /\/api\/injection-selection\/plans\/\$\{plan\.id\}\/reference\?\$\{params\}/);
});

test('renders the API missing reason instead of fabricated selected-well reference data', async () => {
  const { SelectedWellReferencePanel } = await import('../src/components/MeasureWellSelection.tsx');
  const markup = renderToStaticMarkup(createElement(SelectedWellReferencePanel, {
    planItems: [{ id: 1, rankNo: 1, wellNo: 'A-01', score: 88, suggestedSteam: null, recommendedBoiler: null, nitrogen: false, carbonDioxide: false, oilSteamRatio: 0.42, stageOil: 120, decision: 'locked', manualNote: null, scoreBreakdown: { oilSteamRatio: { score: 1, value: 1, maxScore: 1 }, stageOil: { score: 1, value: 1, maxScore: 1 }, stability: { score: 1, value: 1, maxScore: 1 }, dailyCompleteness: { score: 1, value: 1, maxScore: 1 } } }],
    selectedWellNo: 'A-01',
    reference: { wellNo: 'A-01', cycles: [], similarWells: [], missingReasons: ['\u505c\u6ce8\u6c7d\u540e\u7b2c10\u81f3310\u5929\u7f3a\u5c11\u751f\u4ea7\u65e5\u62a5\u65e5\u4ea7\u6cb9\u6570\u636e'] },
  }));
  assert.ok(markup.includes('\u505c\u6ce8\u6c7d\u540e\u7b2c10\u81f3310\u5929\u7f3a\u5c11\u751f\u4ea7\u65e5\u62a5\u65e5\u4ea7\u6cb9\u6570\u636e'));
  assert.doesNotMatch(markup, /B-02/);
});


test('selected-well reference hides without an eligible plan item and ignores stale requests', () => {
  const component = readFileSync(new URL('../src/components/MeasureWellSelection.tsx', import.meta.url), 'utf8');
  assert.match(component, /plan && selectablePlanItems\.length > 0/);
  assert.match(component, /item\.decision === 'included' \|\| item\.decision === 'locked'/);
  assert.match(component, /new AbortController\(\)/);
  assert.match(component, /setSelectedWellReference\(null\);/);
  assert.match(component, /referenceRequestSequence\.current === requestSequence/);
  assert.match(component, /controller\.abort\(\)/);
});

test('selected-well reference preserves null chart points and exposes all required tables', () => {
  const component = readFileSync(new URL('../src/components/MeasureWellSelection.tsx', import.meta.url), 'utf8');
  assert.match(component, /data: cycle\.points\.map\(\(point\) => \[point\.day, point\.oil\]\)/);
  assert.doesNotMatch(component, /point\.oil \?\? 0/);
  assert.match(component, /table-fixed/);
  assert.match(component, /text-center/);
  for (const token of ['missingReasons', 'similarWells', 'cycle.metrics.stageOil', 'cycle.metrics.oilSteamRatio', 'cycle.metrics.steamVolume']) assert.ok(component.includes(token));
});

test('renders next-month and year-end generation modes with oil eligibility evidence and annual export', () => {
  const component = readFileSync(new URL('../src/components/MeasureWellSelection.tsx', import.meta.url), 'utf8');
  for (const value of [
    '/api/injection-selection/plans/generate',
    'next-month',
    'year-end',
    '生成下个月计划',
    '生成至年末计划',
    '最新实际底产',
    '预测底产',
    '最小可注汽日期',
    '资格说明',
    'Blob',
  ]) assert.ok(component.includes(value), `missing ${value}`);
  assert.match(component, /created\.evidence/);
  assert.match(component, /nextMonthEvidence/);
});
