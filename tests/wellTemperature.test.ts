import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import XLSX from 'xlsx';

import { parseWellTemperatureWorkbook } from '../src/lib/wellTemperature.ts';

const fixtureName = '高2-2-96（2026-06-21）井筒温度压力测试表.xlsx';
const fixturePath = path.join(import.meta.dirname, 'fixtures', fixtureName);

test('解析井温压力测试样例', async () => {
  const buffer = await readFile(fixturePath);
  const result = parseWellTemperatureWorkbook(fixtureName, buffer);

  assert.equal(result.wellNumber, '高2-2-96');
  assert.equal(result.date, '2026-06-21');
  assert.equal(result.perforationTopDepth, 1555.6);
  assert.equal(result.perforationBottomDepth, 1610.1);
  assert.equal(result.points.length, 2291);
  assert.deepEqual(result.points[0], { depth: 0.1, temperature: 31.9, pressure: 0 });
  assert.ok(result.points.every((point, index) => index === 0 || result.points[index - 1].depth < point.depth));
});

test('非工作簿输入会抛出中文错误', () => {
  assert.throws(
    () => parseWellTemperatureWorkbook('invalid.xlsx', Buffer.from('not an excel workbook')),
    /无法读取 Excel 文件|未读取到有效测试测点/,
  );
});
function createWorkbookBuffer(
  rows: unknown[][],
  customizeSheet?: (sheet: XLSX.WorkSheet) => void,
): Buffer {
  const workbook = XLSX.utils.book_new();
  const sheet = XLSX.utils.aoa_to_sheet(rows);
  customizeSheet?.(sheet);
  XLSX.utils.book_append_sheet(workbook, sheet, 'Sheet1');
  return XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });
}

test('规范化表内日期并优先于文件名日期', () => {
  const buffer = createWorkbookBuffer([
    ['header'],
    ['field'],
    [null, null, '表内井', '2026/6/2', 100, 10, 20, 30, 0],
  ]);

  const result = parseWellTemperatureWorkbook('回退井（2026-01-01）测试.xlsx', buffer);

  assert.equal(result.wellNumber, '表内井');
  assert.equal(result.date, '2026-06-02');
});

test('在表内元数据缺失时从文件名回退', () => {
  const buffer = createWorkbookBuffer([
    ['header'],
    ['field'],
    [null, null, null, null, 100, 10, 20, 30, 0],
  ]);

  const result = parseWellTemperatureWorkbook('回退井（2026-01-01）测试.xlsx', buffer);

  assert.equal(result.wellNumber, '回退井');
  assert.equal(result.date, '2026-01-01');
});

test('按 Excel 日期序列和 dd/mm/yy 格式解析测试日期', () => {
  const buffer = createWorkbookBuffer(
    [
      ['header'],
      ['field'],
      [null, null, '日期井', null, 100, 10, 20, 30, 0],
    ],
    (sheet) => {
      sheet.D3 = { t: 'n', v: 46035, z: 'dd/mm/yy', w: '13/01/26' };
    },
  );

  const result = parseWellTemperatureWorkbook('日期井.xlsx', buffer);

  assert.equal(result.date, '2026-01-13');
});

test('用 Excel 日期序列消除 01/02/26 的格式歧义', () => {
  const buffer = createWorkbookBuffer(
    [
      ['header'],
      ['field'],
      [null, null, '日期井', null, 100, 10, 20, 30, 0],
    ],
    (sheet) => {
      sheet.D3 = { t: 'n', v: 46054, z: 'dd/mm/yy', w: '01/02/26' };
    },
  );

  const result = parseWellTemperatureWorkbook('日期井.xlsx', buffer);

  assert.equal(result.date, '2026-02-01');
});

test('解析无文件名回退的数字井号', () => {
  const buffer = createWorkbookBuffer([
    ['header'],
    ['field'],
    [null, null, 12345, '2026-06-02', 100, 10, 20, 30, 0],
  ]);

  const result = parseWellTemperatureWorkbook('测试.xlsx', buffer);

  assert.equal(result.wellNumber, '12345');
});
