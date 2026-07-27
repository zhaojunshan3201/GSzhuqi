import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

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

test('formats selection import diagnostics and explains the 100 point score', () => {
  const component = readFileSync(new URL('../src/components/MeasureWellSelection.tsx', import.meta.url), 'utf8');
  for (const value of [
    'formatSelectionImportError',
    'formatSelectionScoreBreakdown',
    'selectionSourceLabel',
    '总分为四项之和，满分 100 分',
  ]) assert.match(component, new RegExp(value));
  assert.doesNotMatch(component, /(?:导入错误|\\u5bfc\\u5165\\u9519\\u8bef)\?/);
  assert.doesNotMatch(component, /\}\?\\u9636\\u6bb5\\u4ea7\\u6cb9/);
});
