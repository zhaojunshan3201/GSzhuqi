import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import * as XLSX from 'xlsx';

import { parseExternalTransferWorkbook, summarizeExternalTransfer } from '../src/lib/externalTransferTracking.ts';

test('ExternalTransferTracking uses the shared chart option helper', async () => {
  const source = await readFile(new URL('../src/components/ExternalTransferTracking.tsx', import.meta.url), 'utf8');

  assert.match(source, /getExternalTransferChartOption/);
  assert.doesNotMatch(source, /function chartOption/);
});

test('ExternalTransferTracking renders oil as a line and well count as bars', async () => {
  const source = await readFile(new URL('../src/components/ExternalTransferTracking.tsx', import.meta.url), 'utf8');

  assert.match(source, /metric: 'oil' \}/);
  assert.match(source, /metric: 'wellCount', type: 'bar', yAxisIndex: 1/);
});

const headers = ['日期', '计量站', '井数', '日产液总量', '日产油总量', '日掺油总量', '综合含水', '外输', '外输差', '排污', '回流', '稀油用量（方）'];

function workbook(sheetName: string, rows: unknown[][]) {
  const result = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(result, XLSX.utils.aoa_to_sheet(rows), sheetName);
  return result;
}

test('parses Sheet1 and normalizes source dates', () => {
  const parsed = parseExternalTransferWorkbook(workbook('Sheet1', [
    headers,
    ['1/2/26', '18站', 24, 151.3, 36.33, 26.5, 70.9, 161.4, 10.1, 24, 8, ''],
  ]));

  assert.deepEqual(parsed.records[0], {
    date: '2026-01-02', station: '18站', wellCount: 24, liquid: 151.3, oil: 36.33,
    diluent: 26.5, waterCut: 70.9, transfer: 161.4, transferDifference: 10.1, sewage: 24, returnFlow: 8, thinOil: null,
  });
});

test('rejects a missing Sheet1 or required column', () => {
  assert.throws(() => parseExternalTransferWorkbook(workbook('数据', [headers])), /Sheet1/);
  assert.throws(() => parseExternalTransferWorkbook(workbook('Sheet1', [headers.filter((header) => header !== '日产液总量')])), /日产液总量/);
});

test('sums metrics and weights water cut by well count', () => {
  const daily = summarizeExternalTransfer([
    { date: '2026-01-01', station: '18站', wellCount: 20, liquid: 100, oil: 30, diluent: 10, waterCut: 60, transfer: 110, transferDifference: 4, sewage: 24, returnFlow: 8, thinOil: 8 },
    { date: '2026-01-01', station: '21站', wellCount: 10, liquid: 50, oil: 15, diluent: 5, waterCut: 80, transfer: 55, transferDifference: -1, sewage: 6, returnFlow: 2, thinOil: 4 },
  ], new Set(['18站', '21站']), '2026-01-01', '2026-01-01');

  assert.deepEqual(daily[0], {
    date: '2026-01-01', wellCount: 30, liquid: 150, oil: 45, diluent: 15,
    waterCut: 66.66666666666667, transfer: 165, transferDifference: 3, sewage: 30, returnFlow: 10, thinOil: 12,
  });
});
