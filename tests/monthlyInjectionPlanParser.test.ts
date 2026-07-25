import assert from 'node:assert/strict';
import test from 'node:test';
import * as XLSX from 'xlsx';

import { parseMonthlyInjectionPlan } from '../src/lib/monthlyInjectionPlanParser.ts';

function workbookFromRows(rows: unknown[][]) {
  const workbook = XLSX.utils.book_new();
  const sheet = XLSX.utils.aoa_to_sheet(rows);
  XLSX.utils.book_append_sheet(workbook, sheet, '2026年7月注汽运行计划表');
  return workbook;
}

test('parses planned wells, inherited unit and boiler, gases, and July dates', () => {
  const result = parseMonthlyInjectionPlan(workbookFromRows([
    ['2026年7月份注汽运行计划表'],
    ['一区', '活6', '高3-4-17CH3（CO2+N+2500）', '高3-莲H3CH（N2+2100）'],
    ['', '', '8.08-8.21', '8月22日-8月25日'],
    ['', '', '高4-5（1500）'],
    ['', '', '8.26-8.30'],
  ]));

  assert.equal(result.sheetName, '2026年7月注汽运行计划表');
  assert.equal(result.planMonth, '2026-07');
  assert.equal(result.totalPlannedSteam, 6100);
  assert.deepEqual(result.rows.map((row) => ({
    unit: row.unit, boiler: row.boiler, wellNo: row.wellNo, plannedSteam: row.plannedSteam,
    gasSupport: row.gasSupport, startDate: row.startDate, endDate: row.endDate, sourceCell: row.sourceCell,
  })), [
    { unit: '一区', boiler: '活6', wellNo: '高3-4-17CH3', plannedSteam: 2500, gasSupport: 'CO2+N2', startDate: '2026-08-08', endDate: '2026-08-21', sourceCell: 'C2' },
    { unit: '一区', boiler: '活6', wellNo: '高3-莲H3CH', plannedSteam: 2100, gasSupport: 'N2', startDate: '2026-08-22', endDate: '2026-08-25', sourceCell: 'D2' },
    { unit: '一区', boiler: '活6', wellNo: '高4-5', plannedSteam: 1500, gasSupport: null, startDate: '2026-08-26', endDate: '2026-08-30', sourceCell: 'C4' },
  ]);
});

test('keeps operational notes as pending rows instead of treating them as well numbers', () => {
  const result = parseMonthlyInjectionPlan(workbookFromRows([
    ['7月份注汽运行计划表'],
    ['二区', '活7', '待定', '停注检修', '接大一站'],
    ['', '', '等通知', '8.10-8.12', '先搬家'],
  ]));

  assert.equal(result.rows.length, 0);
  assert.deepEqual(result.pendingRows.map((row) => ({
    unit: row.unit, boiler: row.boiler, wellNo: row.wellNo, planStatus: row.planStatus,
    remark: row.remark, rawWellText: row.rawWellText, rawScheduleText: row.rawScheduleText,
  })), [
    { unit: '二区', boiler: '活7', wellNo: null, planStatus: '待定', remark: '等通知', rawWellText: '待定', rawScheduleText: '等通知' },
    { unit: '二区', boiler: '活7', wellNo: null, planStatus: '停注检修', remark: '8.10-8.12', rawWellText: '停注检修', rawScheduleText: '8.10-8.12' },
    { unit: '二区', boiler: '活7', wellNo: null, planStatus: '接大一站', remark: '先搬家', rawWellText: '接大一站', rawScheduleText: '先搬家' },
  ]);
});

test('returns unparseable plan cells as invalid rows and ignores non-plan sheets', () => {
  const workbook = workbookFromRows([
    ['7月份注汽运行计划表'],
    ['三区', '活8', '???'],
    ['', '', '8.08-8.09'],
  ]);
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([['其他表'], ['A']]), '汇总');

  const result = parseMonthlyInjectionPlan(workbook);

  assert.equal(result.invalidRows.length, 1);
  assert.deepEqual(result.invalidRows[0], {
    unit: '三区', boiler: '活8', wellNo: null, plannedSteam: null, gasSupport: null,
    startDate: null, endDate: null, planStatus: 'invalid', remark: '无法解析井表达式',
    sourceCell: 'C2', rawWellText: '???', rawScheduleText: '8.08-8.09',
  });
});

test('requires a worksheet cell title instead of selecting a sheet by name alone', () => {
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([
    ['普通数据'], ['一区', '活6', '高3-4-17CH3（2500）'], ['', '', '8.08-8.21'],
  ]), '注汽运行计划表');

  assert.deepEqual(parseMonthlyInjectionPlan(workbook), {
    sheetName: null, planMonth: null, rows: [], pendingRows: [], invalidRows: [], totalPlannedSteam: 0,
  });
});

test('puts valid well expressions without a complete date range into invalid rows', () => {
  const result = parseMonthlyInjectionPlan(workbookFromRows([
    ['7月份注汽运行计划表'],
    ['一区', '活6', '高1（100）', '高2（200）', '高3（300）'],
    ['', '', '', '8.08', '等待通知'],
  ]));

  assert.deepEqual(result.invalidRows.map((row) => ({
    wellNo: row.wellNo, plannedSteam: row.plannedSteam, remark: row.remark, rawScheduleText: row.rawScheduleText,
  })), [
    { wellNo: '高1', plannedSteam: 100, remark: '无法解析日期', rawScheduleText: '' },
    { wellNo: '高2', plannedSteam: 200, remark: '无法解析日期', rawScheduleText: '8.08' },
    { wellNo: '高3', plannedSteam: 300, remark: '无法解析日期', rawScheduleText: '等待通知' },
  ]);
});

test('marks a stopped schedule as pending and preserves its text', () => {
  const result = parseMonthlyInjectionPlan(workbookFromRows([
    ['7月份注汽运行计划表'],
    ['一区', '活6', '高1（100）'],
    ['', '', '7.20停注'],
  ]));

  assert.deepEqual(result.pendingRows[0], {
    unit: '一区', boiler: '活6', wellNo: '高1', plannedSteam: 100, gasSupport: null,
    startDate: null, endDate: null, planStatus: 'stopped', remark: '7.20停注',
    sourceCell: 'C2', rawWellText: '高1（100）', rawScheduleText: '7.20停注',
  });
});

test('uses the current year by default and retains each month in a cross-month range', () => {
  const currentYear = new Date().getFullYear();
  const result = parseMonthlyInjectionPlan(workbookFromRows([
    ['7月份注汽运行计划表'],
    ['一区', '活6', '高1（100）'],
    ['', '', '7.30-8.02'],
  ]));

  assert.equal(result.planMonth, `${currentYear}-07`);
  assert.deepEqual(result.rows[0] && { startDate: result.rows[0].startDate, endDate: result.rows[0].endDate }, {
    startDate: `${currentYear}-07-30`, endDate: `${currentYear}-08-02`,
  });
});

test('rejects calendar-invalid dates even when the range syntax is valid', () => {
  const result = parseMonthlyInjectionPlan(workbookFromRows([
    ['7月份注汽运行计划表'],
    ['一区', '活6', '高1（100）'],
    ['', '', '2.30-3.02'],
  ]));

  assert.equal(result.rows.length, 0);
  assert.deepEqual(result.invalidRows[0] && {
    wellNo: result.invalidRows[0].wellNo,
    startDate: result.invalidRows[0].startDate,
    endDate: result.invalidRows[0].endDate,
    remark: result.invalidRows[0].remark,
  }, {
    wellNo: '高1', startDate: null, endDate: null, remark: '无法解析日期',
  });
});

test('skips field headers below the title before parsing two-row plan blocks', () => {
  const result = parseMonthlyInjectionPlan(workbookFromRows([
    ['2026年7月份注汽运行计划表'],
    ['单位', '注汽炉', '正注井一', '正注井二'],
    ['一区', '活6', '高1（CO2+100）', '高2（N+200）'],
    ['', '', '8.08-8.09', '8.10-8.11'],
    ['二区', '活7', '高3（300）'],
    ['', '', '8.12-8.13'],
  ]));

  assert.deepEqual(result.rows.map((row) => ({
    unit: row.unit, boiler: row.boiler, wellNo: row.wellNo, plannedSteam: row.plannedSteam,
    gasSupport: row.gasSupport, sourceCell: row.sourceCell,
  })), [
    { unit: '一区', boiler: '活6', wellNo: '高1', plannedSteam: 100, gasSupport: 'CO2', sourceCell: 'C3' },
    { unit: '一区', boiler: '活6', wellNo: '高2', plannedSteam: 200, gasSupport: 'N2', sourceCell: 'D3' },
    { unit: '二区', boiler: '活7', wellNo: '高3', plannedSteam: 300, gasSupport: null, sourceCell: 'C5' },
  ]);
  assert.equal(result.invalidRows.some((row) => row.rawWellText.includes('正注井')), false);
});
