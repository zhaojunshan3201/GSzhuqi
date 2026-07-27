import assert from 'node:assert/strict';
import test from 'node:test';
import * as XLSX from 'xlsx';

import {
  detectGasFlags,
  parseDailyInjectionWorkbook,
  parseStageOilWorkbook,
} from '../src/lib/injectionSelectionData.ts';

function workbookWithRows(rows: unknown[][]): XLSX.WorkBook {
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(rows), 'Sheet1');
  return workbook;
}

test('parses a stage-oil workbook into normalized cycle rows', () => {
  const result = parseStageOilWorkbook(workbookWithRows([
    ['井号', '周期序号', '开注汽日期', '停注汽日期', '周期注汽量', '温度', '压力', '干度', '生产时间', '阶段产油', '阶段产水', '油汽比'],
    ['高105-1', 3, 45299, 45309, 1803, 349.6, 15.95, 75, 876.11, 750, 9509, 0.42],
  ]));

  assert.deepEqual(result.rows[0], {
    wellNo: '高105-1', cycleNo: 3, startDate: '2024-01-08', endDate: '2024-01-18',
    steamVolume: 1803, temperature: 349.6, pressure: 15.95, dryness: 75,
    productionHours: 876.11, stageOil: 750, stageWater: 9509, oilSteamRatio: 0.42,
  });
  assert.deepEqual(result.skippedRows, []);
});

test('skips stage rows with missing required fields or invalid values', () => {
  const result = parseStageOilWorkbook(workbookWithRows([
    ['井号', '周期序号', '开注汽日期', '周期注汽量', '阶段产油'],
    ['A', 1, '2026/02/03', '1,200', 300],
    ['', 2, '2026-02-04', 100, 20],
    ['B', 0, '2026-02-04', 100, 20],
    ['C', 2, 'not-a-date', 100, 20],
    ['D', 2, '2026-02-04', 'bad', 20],
    ['E', 2, '2026-02-04', 100, 'bad'],
  ]));

  assert.equal(result.rows.length, 1);
  assert.deepEqual(result.rows[0], {
    wellNo: 'A', cycleNo: 1, startDate: '2026-02-03', endDate: null,
    steamVolume: 1200, temperature: null, pressure: null, dryness: null,
    productionHours: null, stageOil: 300, stageWater: null, oilSteamRatio: null,
  });
  assert.deepEqual(result.skippedRows.map((row) => row.rowNumber), [3, 4, 5, 6, 7]);
  assert.match(result.skippedRows[0].reason, /井号/);
  assert.match(result.skippedRows[1].reason, /周期序号/);
  assert.match(result.skippedRows[2].reason, /开注汽日期/);
  assert.match(result.skippedRows[3].reason, /周期注汽量/);
  assert.match(result.skippedRows[4].reason, /阶段产油/);
});

test('collects boiler and nitrogen or carbon-dioxide flags from daily records', () => {
  const result = parseDailyInjectionWorkbook(workbookWithRows([
    ['井号', '日期', '锅炉编号1', '生产时间', '流量', '日注汽量', '设计注汽量', '累积注汽量', '压力', '干度', '温度', '备注2', '备注1', '备注'],
    ['高105-1', 45299, '高采活-4', 24, 7, 168, 1800, 259, 16, 75, 351, '注氮气', 'CO2辅助', ''],
  ]));

  assert.equal(result.rows[0].boilerNo, '高采活-4');
  assert.deepEqual(result.rows[0].gasFlags, { nitrogen: true, carbonDioxide: true });
  assert.deepEqual(result.rows[0].remarks, ['注氮气', 'CO2辅助']);
});

test('uses the second boiler and skips daily rows without a valid well or date', () => {
  const result = parseDailyInjectionWorkbook(workbookWithRows([
    ['井号', '日期', '锅炉编号1', '锅炉编号2', '日注汽量', '备注'],
    ['A', '2026-02-03', '', '炉-2', '120.5', 'n2'],
    ['', '2026-02-03', '炉-3', '', 120, ''],
    ['C', 'invalid', '炉-3', '', 120, ''],
    ['D', '2026-02-03', '炉-3', '', 'bad', ''],
  ]));

  assert.deepEqual(result.rows[0], {
    wellNo: 'A', recordDate: '2026-02-03', boilerNo: '炉-2', productionHours: null,
    flow: null, dailySteam: 120.5, designSteam: null, cumulativeSteam: null,
    pressure: null, dryness: null, temperature: null,
    gasFlags: { nitrogen: true, carbonDioxide: false }, remarks: ['n2'],
  });
  assert.deepEqual(result.skippedRows.map((row) => row.rowNumber), [3, 4, 5]);
  assert.match(result.skippedRows[2].reason, /日注汽量/);
});

test('detects gas flags case-insensitively across all remarks', () => {
  assert.deepEqual(detectGasFlags(['N2辅助', '通入二氧化碳']), { nitrogen: true, carbonDioxide: true });
  assert.deepEqual(detectGasFlags(['co2']), { nitrogen: false, carbonDioxide: true });
  assert.deepEqual(detectGasFlags([]), { nitrogen: false, carbonDioxide: false });
});
