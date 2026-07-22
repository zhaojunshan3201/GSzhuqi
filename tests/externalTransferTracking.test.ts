import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import * as XLSX from 'xlsx';

import { getExternalTransferStationSummary, selectAllExternalTransferStations, toggleExternalTransferStation } from '../src/lib/externalTransferStationSelector.ts';
import { parseExternalTransferWorkbook, summarizeExternalTransfer, summarizeExternalTransferByTenDayPeriod } from '../src/lib/externalTransferTracking.ts';

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

test('ExternalTransferTracking uses a compact collapsible station selector', async () => {
  const source = await readFile(new URL('../src/components/ExternalTransferTracking.tsx', import.meta.url), 'utf8');

  assert.match(source, /stationSelectorRef/);
  assert.match(source, /isStationSelectorOpen/);
  assert.match(source, /getExternalTransferStationSummary\(selectedStations\)/);
  assert.match(source, /type="checkbox"/);
  assert.doesNotMatch(source, /<select\b[\s\S]*?\bmultiple\b/);
});

test('summarizes all selected external transfer stations', () => {
  assert.equal(getExternalTransferStationSummary(new Set(['一站', '二站'])), '已选 2 个：一站、二站');
});

test('toggles an external transfer station without mutating the existing selection', () => {
  const selectedStations = new Set(['一站', '二站']);
  const withoutFirst = toggleExternalTransferStation(selectedStations, '一站');
  const restored = toggleExternalTransferStation(withoutFirst, '一站');

  assert.deepEqual([...selectedStations], ['一站', '二站']);
  assert.deepEqual([...withoutFirst], ['二站']);
  assert.deepEqual([...restored], ['二站', '一站']);
});

test('selects all external transfer stations without modifying a prior selection', () => {
  const stations = ['一站', '二站', '三站'];
  const priorSelection = new Set(['二站']);
  const allStations = selectAllExternalTransferStations(stations);

  assert.deepEqual([...priorSelection], ['二站']);
  assert.deepEqual([...allStations], stations);
  assert.equal(getExternalTransferStationSummary(allStations), '已选 3 个：一站、二站、三站');
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

test('averages daily external transfer metrics by ten-day period', () => {
  const periods = summarizeExternalTransferByTenDayPeriod([
    { date: '2026-01-01', wellCount: 10, liquid: 100, oil: 30, diluent: 10, waterCut: 60, transfer: 110, transferDifference: 4, sewage: 24, returnFlow: 8, thinOil: 8 },
    { date: '2026-01-10', wellCount: 20, liquid: 200, oil: 50, diluent: 20, waterCut: 80, transfer: 210, transferDifference: 6, sewage: 36, returnFlow: 12, thinOil: null },
    { date: '2026-01-11', wellCount: 30, liquid: 300, oil: 70, diluent: 30, waterCut: 70, transfer: 310, transferDifference: 8, sewage: 48, returnFlow: 16, thinOil: 12 },
  ]);

  assert.deepEqual(periods, [
    { date: '2026-01上旬', wellCount: 15, liquid: 150, oil: 40, diluent: 15, waterCut: 70, transfer: 160, transferDifference: 5, sewage: 30, returnFlow: 10, thinOil: 8 },
    { date: '2026-01中旬', wellCount: 30, liquid: 300, oil: 70, diluent: 30, waterCut: 70, transfer: 310, transferDifference: 8, sewage: 48, returnFlow: 16, thinOil: 12 },
  ]);
});
