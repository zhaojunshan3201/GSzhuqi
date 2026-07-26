import assert from 'node:assert/strict';
import test from 'node:test';

import { buildInjectionOperationReport, buildInjectionOperationReportWorkbook } from '../src/lib/injectionOperationReports.ts';

const input = {
  kind: 'daily' as const,
  block: 'A区',
  date: '2026-07-20',
  production: [
    { date: '2026-07-19', oil: 10, liquid: 20, waterCut: 0.5, well: 'A-1', block: 'A区' },
    { date: '2026-07-20', oil: 12, liquid: 22, waterCut: 0.45, well: 'A-1', block: 'A区' },
  ],
  channelingProjects: [{ id: 1, projectName: 'A区治理', block: 'A区', status: '执行跟踪', estimatedLoss: 2, occupiedProduction: null, riskLevel: '高', plannedDate: '2026-07-19', actualDate: null, afterMetric: null }],
  recommendations: [{ id: 'stable', name: '稳产优先', score: 1500, confidence: 0.7, netBenefit: 2000, assumptions: [] }],
};

test('daily report preserves data source and filters while reporting only measured values', () => {
  const report = buildInjectionOperationReport(input);
  assert.equal(report.title, '注汽运行日报');
  assert.equal(report.filter.block, 'A区');
  assert.equal(report.sources[0].name, '生产日报');
  assert.equal(report.summary.find((item) => item.label === '当日油量')?.value, 12);
  assert.equal(report.trend.length, 1);
  assert.equal(report.recommendations[0].name, '稳产优先');
});

test('weekly report flags missing metrics instead of treating them as zero', () => {
  const report = buildInjectionOperationReport({ ...input, kind: 'weekly', date: '2026-07-20', production: [], recommendations: [] });
  assert.equal(report.title, '注汽运行周报');
  assert.ok(report.missingData.some((item) => item.includes('生产日报')));
  assert.ok(report.missingData.some((item) => item.includes('占产损失')));
  assert.equal(report.summary.find((item) => item.label === '周期油量')?.value, null);
});

test('retrospective report makes outcome unknown when no verified after metric exists', () => {
  const report = buildInjectionOperationReport({ ...input, kind: 'retrospective' });
  assert.equal(report.title, '注汽项目复盘');
  assert.equal(report.details[0].outcome, null);
  assert.ok(report.missingData.some((item) => item.includes('效果验证')));
});

test('xlsx export contains summary, details, trend, and recommended plans sheets', () => {
  const workbook = buildInjectionOperationReportWorkbook(buildInjectionOperationReport(input));
  assert.deepEqual(workbook.SheetNames, ['摘要', '明细', '趋势', '推荐方案']);
  assert.equal(workbook.Sheets['摘要']['A1'].v, '注汽运行日报');
});

