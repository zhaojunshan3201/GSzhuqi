import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildInjectionPeriodIssues,
  buildWaterCutIssues,
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
      { wellNo: '高-1', date: '2026-07-05', waterCut: 20 },
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

test('含水对比仅接受严格ISO日期，非法日历日期不匹配', () => {
  assert.deepEqual(
    buildWaterCutIssues(
      [{ wellNo: '非法化验日期', date: '2026-02-30', waterCut: 70 }],
      [{ wellNo: '非法化验日期', date: '2026-03-01', waterCut: 40 }],
    ),
    [],
  );
  assert.deepEqual(
    buildWaterCutIssues(
      [{ wellNo: '非法报产日期', date: '2026-03-01', waterCut: 70 }],
      [{ wellNo: '非法报产日期', date: '2026-02-30', waterCut: 40 }],
    ),
    [],
  );
  assert.deepEqual(
    buildWaterCutIssues(
      [{ wellNo: '非纯日期', date: '2026-03-01T00:00:00Z', waterCut: 70 }],
      [{ wellNo: '非纯日期', date: '2026-03-01', waterCut: 40 }],
    ),
    [],
  );
});

test('含水输入仅接受0到100之间的有限值，并忽略无效的最近候选', () => {
  for (const waterCut of [Number.NaN, Number.POSITIVE_INFINITY, -1, 101]) {
    assert.deepEqual(
      buildWaterCutIssues(
        [{ wellNo: '非法化验值', date: '2026-07-10', waterCut }],
        [{ wellNo: '非法化验值', date: '2026-07-10', waterCut: 40 }],
      ),
      [],
    );
    assert.deepEqual(
      buildWaterCutIssues(
        [{ wellNo: '非法报产值', date: '2026-07-10', waterCut: 70 }],
        [{ wellNo: '非法报产值', date: '2026-07-10', waterCut }],
      ),
      [],
    );
  }

  const issues = buildWaterCutIssues(
    [{ wellNo: '有效边界值', date: '2026-07-10', waterCut: 100 }],
    [
      { wellNo: '有效边界值', date: '2026-07-10', waterCut: Number.NaN },
      { wellNo: '有效边界值', date: '2026-07-08', waterCut: 0 },
    ],
  );
  assert.equal(issues[0].deviation, 100);
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
    { wellNo: '无穷大', currentAverageOil: Number.POSITIVE_INFINITY, previousAverageOil: 10 },
    { wellNo: '负产油', currentAverageOil: -1, previousAverageOil: 10 },
    { wellNo: '变化溢出', currentAverageOil: Number.MAX_VALUE, previousAverageOil: Number.MIN_VALUE },
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

test('统一清单在所有排序键完全相同时保持输入顺序', () => {
  const items = ['first', 'second', 'third'].map((id) =>
    issue({ id, severity: 'medium', deviation: -21, dataDate: '2026-07-30' }));

  assert.deepEqual(mergePriorityIssues(items).map((item) => item.id), ['first', 'second', 'third']);
});

test('检泵恢复率按百分比保留1位，无效数据返回null', () => {
  assert.equal(calculatePumpRecoveryRate(8.456, 10), 84.6);
  assert.equal(calculatePumpRecoveryRate(null, 10), null);
  assert.equal(calculatePumpRecoveryRate(8, null), null);
  assert.equal(calculatePumpRecoveryRate(8, 0), null);
  assert.equal(calculatePumpRecoveryRate(-1, 10), null);
  assert.equal(calculatePumpRecoveryRate(Number.NaN, 10), null);
  assert.equal(calculatePumpRecoveryRate(8, Number.POSITIVE_INFINITY), null);
  assert.equal(calculatePumpRecoveryRate(Number.MAX_VALUE, Number.MIN_VALUE), null);
  assert.equal(calculatePumpRecoveryRate(Number.MAX_VALUE, 2), null);
});

test('焖井天数使用严格ISO日期计算UTC整天差并且最小为0', () => {
  assert.equal(calculateSoakingDays('2026-07-01', '2026-07-10'), 9);
  assert.equal(calculateSoakingDays('2026-07-10', '2026-07-09'), 0);
  assert.equal(calculateSoakingDays('2024-02-28', '2024-03-01'), 2);
});

test('焖井天数遇到无效或非纯ISO日期时返回null', () => {
  assert.equal(calculateSoakingDays('2026-02-30', '2026-03-01'), null);
  assert.equal(calculateSoakingDays('2026-07-01', '2026-13-01'), null);
  assert.equal(calculateSoakingDays('2026-07-01T00:00:00Z', '2026-07-10'), null);
  assert.equal(calculateSoakingDays('', '2026-07-10'), null);
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
    { year: 2026, category: '复产', currentOil: -3, producing: false },
  ]);

  assert.equal(summary['2026:复产'].totalOil, 2);
  assert.equal(summary['2026:复产'].missingWells, 2);
});

test('复产跟踪无有效产油时总产油为null，真实0保持为0', () => {
  const summary = summarizeRestartTracking([
    { year: 2026, category: '全缺失', currentOil: null, producing: false },
    { year: 2026, category: '全缺失', currentOil: Number.NaN, producing: false },
    { year: 2026, category: '全缺失', currentOil: -1, producing: false },
    { year: 2026, category: '真实零', currentOil: 0, producing: false },
  ]);

  assert.equal(summary['2026:全缺失'].totalOil, null);
  assert.equal(summary['2026:全缺失'].missingWells, 3);
  assert.equal(summary['2026:真实零'].totalOil, 0);
  assert.equal(summary['2026:真实零'].missingWells, 0);
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
