import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildInjectionPeriodIssues,
  buildWaterCutIssues,
  calculateBlockDeclineRate,
  calculatePumpRecoveryRate,
  calculateSoakingDays,
  mergePriorityIssues,
  summarizeRestartTracking,
  type PriorityIssue,
} from '../src/lib/prioritySituationAnalysis.ts';

test('含水绝对偏差必须严格大于20个百分点，并取同井7天内最近报产', () => {
  const issues = buildWaterCutIssues(
    [{ wellNo: '高-1', block: '高区', date: '2026-07-10', waterCut: 68 }],
    [
      { wellNo: '高-1', date: '2026-07-08', waterCut: 47 },
      { wellNo: '高-1', date: '2026-06-30', waterCut: 10 },
      { wellNo: '高-2', date: '2026-07-10', waterCut: 1 },
    ],
  );

  assert.equal(issues.length, 1);
  assert.equal(issues[0].deviation, 21);
  assert.equal(issues[0].severity, 'medium');
  assert.equal(issues[0].category, 'waterCut');
  assert.equal(issues[0].block, '高区');
  assert.equal(issues[0].dataDate, '2026-07-10');
});

test('含水偏差等于20不生成问题，30及以上标记为高风险', () => {
  assert.equal(
    buildWaterCutIssues(
      [{ wellNo: '边界井', date: '2026-07-10', waterCut: 70 }],
      [{ wellNo: '边界井', date: '2026-07-03', waterCut: 50 }],
    ).length,
    0,
  );

  const issues = buildWaterCutIssues(
    [{ wellNo: '高风险井', date: '2026-07-10', waterCut: 80 }],
    [{ wellNo: '高风险井', block: '风险区', date: '2026-07-17', waterCut: 50 }],
  );
  assert.equal(issues.length, 1);
  assert.equal(issues[0].severity, 'high');
  assert.equal(issues[0].block, '风险区');
});

test('含水对比没有7天内有效同井报产时不生成问题', () => {
  assert.deepEqual(
    buildWaterCutIssues(
      [{ wellNo: '无匹配井', date: '2026-07-10', waterCut: 68 }],
      [
        { wellNo: '无匹配井', date: '2026-07-02', waterCut: 10 },
        { wellNo: '其他井', date: '2026-07-10', waterCut: 10 },
      ],
    ),
    [],
  );
});

test('区块递减率按年度折算口径计算并保留1位小数', () => {
  assert.equal(calculateBlockDeclineRate(3650, 8, 365), 20);
  assert.equal(calculateBlockDeclineRate(3000, 7.123, 365), 13.3);
});

test('区块递减率在上年产油无效、非正数或任一参数非数时返回null', () => {
  assert.equal(calculateBlockDeclineRate(0, 8, 365), null);
  assert.equal(calculateBlockDeclineRate(-1, 8, 365), null);
  assert.equal(calculateBlockDeclineRate(Number.NaN, 8, 365), null);
  assert.equal(calculateBlockDeclineRate(3650, Number.POSITIVE_INFINITY, 365), null);
  assert.equal(calculateBlockDeclineRate(3650, 8, Number.NaN), null);
});

test('注汽同期同时保留变好与变差井，并按变化率绝对值倒序', () => {
  const issues = buildInjectionPeriodIssues([
    { wellNo: '好井', block: '一区', currentAverageOil: 12.1, previousAverageOil: 10, dataDate: '2026-07-20' },
    { wellNo: '差井', currentAverageOil: 7.8, previousAverageOil: 10, dataDate: '2026-07-21' },
    { wellNo: '稳定井', currentAverageOil: 11, previousAverageOil: 10 },
  ]);

  assert.deepEqual(issues.map((item) => item.wellNo), ['差井', '好井']);
  assert.deepEqual(issues.map((item) => Math.round(item.deviation!)), [-22, 21]);
  assert.deepEqual(issues.map((item) => item.status), ['同期变差', '同期变好']);
  assert.deepEqual(issues.map((item) => item.severity), ['medium', 'low']);
});

test('注汽同期严格排除正负20%、上轮非正数和非数值行', () => {
  const issues = buildInjectionPeriodIssues([
    { wellNo: '正20', currentAverageOil: 12, previousAverageOil: 10 },
    { wellNo: '负20', currentAverageOil: 8, previousAverageOil: 10 },
    { wellNo: '零基准', currentAverageOil: 10, previousAverageOil: 0 },
    { wellNo: '负基准', currentAverageOil: 10, previousAverageOil: -1 },
    { wellNo: '非数', currentAverageOil: Number.NaN, previousAverageOil: 10 },
  ]);
  assert.deepEqual(issues, []);
});

test('注汽下降小于-30%为高风险，-30%为中风险，增长大于20%为低风险', () => {
  const issues = buildInjectionPeriodIssues([
    { wellNo: '下降31', currentAverageOil: 6.9, previousAverageOil: 10 },
    { wellNo: '下降30', currentAverageOil: 7, previousAverageOil: 10 },
    { wellNo: '增长25', currentAverageOil: 12.5, previousAverageOil: 10 },
  ]);
  assert.deepEqual(
    Object.fromEntries(issues.map((item) => [item.wellNo, item.severity])),
    { 下降31: 'high', 下降30: 'medium', 增长25: 'low' },
  );
});

test('统一清单按风险、偏差绝对值和数据日期依次排序且不修改原数组', () => {
  const items: PriorityIssue[] = [
    issue({ id: 'medium', severity: 'medium', deviation: 99, dataDate: '2026-07-30' }),
    issue({ id: 'high-old', severity: 'high', deviation: -21, dataDate: '2026-07-28' }),
    issue({ id: 'high-new', severity: 'high', deviation: 21, dataDate: '2026-07-29' }),
    issue({ id: 'high-large', severity: 'high', deviation: -35, dataDate: '2026-07-01' }),
    issue({ id: 'low', severity: 'low', deviation: 200, dataDate: '2026-07-30' }),
  ];

  const sorted = mergePriorityIssues(items);

  assert.deepEqual(sorted.map((item) => item.id), ['high-large', 'high-new', 'high-old', 'medium', 'low']);
  assert.deepEqual(items.map((item) => item.id), ['medium', 'high-old', 'high-new', 'high-large', 'low']);
});

test('检泵恢复率按百分比保留1位，无效数据返回null', () => {
  assert.equal(calculatePumpRecoveryRate(8.456, 10), 84.6);
  assert.equal(calculatePumpRecoveryRate(null, 10), null);
  assert.equal(calculatePumpRecoveryRate(8, null), null);
  assert.equal(calculatePumpRecoveryRate(8, 0), null);
  assert.equal(calculatePumpRecoveryRate(Number.NaN, 10), null);
  assert.equal(calculatePumpRecoveryRate(8, Number.POSITIVE_INFINITY), null);
});

test('焖井天数使用UTC整天差并且最小为0', () => {
  assert.equal(calculateSoakingDays('2026-07-01', '2026-07-10'), 9);
  assert.equal(calculateSoakingDays('2026-07-10T23:59:59+08:00', '2026-07-12T00:01:00+08:00'), 2);
  assert.equal(calculateSoakingDays('2026-07-10', '2026-07-09'), 0);
});

test('复产跟踪按年份和类别聚合，缺失产油只计缺失井不虚构产量', () => {
  const summary = summarizeRestartTracking([
    { year: 2026, category: '复产', currentOil: 3.5, producing: true },
    { year: 2026, category: '复产', currentOil: null, producing: true },
    { year: 2026, category: '复产', currentOil: 0, producing: false },
    { year: 2025, category: '复产', currentOil: 2, producing: true },
    { year: 2026, category: '转抽', currentOil: 1, producing: true },
  ]);

  assert.deepEqual(summary, {
    '2026:复产': {
      year: 2026,
      category: '复产',
      wells: 3,
      producingWells: 2,
      totalOil: 3.5,
      missingWells: 1,
    },
    '2025:复产': {
      year: 2025,
      category: '复产',
      wells: 1,
      producingWells: 1,
      totalOil: 2,
      missingWells: 0,
    },
    '2026:转抽': {
      year: 2026,
      category: '转抽',
      wells: 1,
      producingWells: 1,
      totalOil: 1,
      missingWells: 0,
    },
  });
});

test('复产跟踪总产油只累加有限数值', () => {
  const summary = summarizeRestartTracking([
    { year: 2026, category: '复产', currentOil: 2, producing: true },
    { year: 2026, category: '复产', currentOil: Number.NaN, producing: false },
  ]);

  assert.equal(summary['2026:复产'].totalOil, 2);
  assert.equal(summary['2026:复产'].missingWells, 1);
});

function issue(overrides: Partial<PriorityIssue> & Pick<PriorityIssue, 'id'>): PriorityIssue {
  return {
    category: 'pump',
    severity: 'low',
    comparison: '',
    deviation: null,
    deviationText: '',
    status: '',
    suggestion: '',
    dataDate: null,
    targetTab: 'pumpAnalysis',
    ...overrides,
  };
}
