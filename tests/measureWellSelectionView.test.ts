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
  assert.match(component, /disabled=\{generating \|\| !month \|\| !bothSourcesReady \|\| !rebuildComplete\}/);
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
