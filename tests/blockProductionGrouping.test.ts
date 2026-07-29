import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildProductionBlockGroups,
  expandProductionBlockGroups,
  normalizeProductionBlockGroup,
} from '../src/lib/blockProductionGrouping.ts';

test('normalizes production block variants into deterministic groups', () => {
  const cases: Array<[string | null | undefined, string]> = [
    ['246块L5', '高246'],
    [' 246 块 L6 ', '高246'],
    ['3块L7', '高3'],
    ['3618块L4', '高3618'],
    ['3624块(北)L5', '高3624'],
    ['3624块（南）L6', '高3624'],
    ['高21(北)', '高21'],
    ['高21南', '高21'],
    ['高21块（南）', '高21'],
    ['高21块', '高21块'],
    ['高246', '高246'],
    ['高3', '高3'],
    ['高3618', '高3618'],
    ['高3624', '高3624'],
    [' 高10 ', '高10'],
    ['', ''],
    ['   ', ''],
    [null, ''],
    [undefined, ''],
  ];

  for (const [block, expected] of cases) {
    assert.equal(normalizeProductionBlockGroup(block), expected);
  }
});

test('builds a sorted, deduplicated list of production block groups', () => {
  const rawBlocks = [
    '246块L5',
    '246块L6',
    '3624块(北)L5',
    '3624块（南）L6',
    '高10',
    ' ',
  ];

  assert.deepEqual(buildProductionBlockGroups(rawBlocks), ['高10', '高246', '高3624']);
});

test('expands selected groups to sorted, deduplicated raw block names', () => {
  const rawBlocks = [
    '246块L5',
    '246块L6',
    '3624块(北)L5',
    ' 3624块（南）L6 ',
    '3624块(北)L5',
    '高10',
  ];

  assert.deepEqual(expandProductionBlockGroups(['高3624'], rawBlocks), [
    '3624块(北)L5',
    '3624块（南）L6',
  ]);
});
