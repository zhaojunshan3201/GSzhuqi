import assert from 'node:assert/strict';
import test from 'node:test';
import * as XLSX from 'xlsx';

import { parseMeasureWellWorkbook } from '../src/lib/measureWellImport.ts';

const headers = [
  '区块', '井站', '井号', '上轮转抽时间', '上轮轮次', '上轮设计注汽量',
  '上轮注汽最高压力', '上轮排量', '上轮是否注N2', '上次锅炉', '上轮峰值产油',
  '上轮见油时间（天）', '上轮周期产油',
];

function workbookWithRows(rows: unknown[][]): XLSX.WorkBook {
  const sheet = XLSX.utils.aoa_to_sheet(rows);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, sheet, '措施选井');
  return workbook;
}

test('parses selection headers with whitespace and uses design steam for actual steam', () => {
  const parsed = parseMeasureWellWorkbook(workbookWithRows([
    headers.map((header) => ` ${header.replace('（天）', '\n（天）')} `),
    ['高3', '13站', '高3-4-053', 45596, '补3', 2000, 13.8, 18, '否', '高采03-1', 5.93, 1, 662.4],
  ]));

  assert.deepEqual(parsed.cycles, [{
    block: '高3', station: '13站', wellName: '高3-4-053', transferDate: '2024-10-31',
    round: 3, designSteam: 2000, actualSteam: 2000, maxPressure: 13.8, pressure: 13.8,
    rate: 18, injectN2: false, boiler: '高采03-1', peakOil: 5.93, oilSeeingDays: 1, cycleOil: 662.4,
  }]);
  assert.deepEqual(parsed.skippedRows, []);
});

test('parses dotted dates and reports rows without a well name', () => {
  const parsed = parseMeasureWellWorkbook(workbookWithRows([
    headers,
    ['高21', '12站', '高3-70-68', '2025.8.26', 13, 2500, 16.2, 12, '否', '华66', 3.1, 86, 348],
    ['高21', '12站', '', '2025.8.26', 13, 2500, 16.2, 12, '否', '华66', 3.1, 86, 348],
  ]));

  assert.equal(parsed.cycles[0].transferDate, '2025-08-26');
  assert.deepEqual(parsed.skippedRows, [{ row: 3, reason: '井号不能为空' }]);
});

test('parses two-digit-year dotted dates used by the supplied workbook', () => {
  const parsed = parseMeasureWellWorkbook(workbookWithRows([
    headers,
    ['高21', '12站', '高3-70-68', '25.03.11', 13, 2500, 16.2, 12, '否', '华66', 3.1, 86, 348],
  ]));

  assert.equal(parsed.cycles[0].transferDate, '2025-03-11');
});

test('uses a stable row-number fallback for a round value without digits and ignores blank rows', () => {
  const parsed = parseMeasureWellWorkbook(workbookWithRows([
    headers,
    ['高21', '12站', '高3-70-68', '2025.8.26', '补抽', 2500, 16.2, 12, '是', '华66', 3.1, 86, 348],
    Array(13).fill(''),
  ]));

  assert.equal(parsed.cycles[0].round, 2);
  assert.equal(parsed.cycles[0].injectN2, true);
  assert.equal(parsed.cycles.length, 1);
});
