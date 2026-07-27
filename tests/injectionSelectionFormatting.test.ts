import assert from 'node:assert/strict';
import test from 'node:test';

import {
  formatSelectionImportError,
  formatSelectionScoreBreakdown,
  selectionSourceLabel,
} from '../src/lib/injectionSelectionFormatting.ts';

test('formats legacy selection import errors', () => {
  assert.equal(
    formatSelectionImportError('? 1178 ??阶段产油不能为空'),
    '第 1178 行：阶段产油不能为空',
  );
});

test('trims legacy selection import errors before formatting', () => {
  assert.equal(
    formatSelectionImportError('  ? 1178 ??  阶段产油不能为空  '),
    '第 1178 行：阶段产油不能为空',
  );
});

test('keeps already formatted selection import errors unchanged', () => {
  assert.equal(
    formatSelectionImportError('第 8 行：井号不能为空'),
    '第 8 行：井号不能为空',
  );
});

test('labels selection import sources', () => {
  assert.equal(selectionSourceLabel('stage'), '阶段产油');
  assert.equal(selectionSourceLabel('daily'), '注汽日数据');
});

test('formats selection score breakdown with Chinese separators', () => {
  assert.equal(
    formatSelectionScoreBreakdown({
      oilSteamRatio: { score: 53.27, maxScore: 60 },
      stageOil: { score: 9.06, maxScore: 20 },
      stability: { score: 10, maxScore: 10 },
      dailyCompleteness: { score: 9.58, maxScore: 10 },
    }),
    '油汽比 53.27/60；阶段产油 9.06/20；稳定性 10/10；日数据完整性 9.58/10',
  );
});
