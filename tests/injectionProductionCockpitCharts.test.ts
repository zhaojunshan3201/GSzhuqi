import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildAlertDistributionOption,
  buildBlockPerformanceOption,
  buildBlockStatusOption,
  buildStatusDistributionOption,
  hasChartValues,
  hasAlertDistributionData,
  hasBlockStatusData,
  hasPerformanceData,
  lifecycleMeta,
} from '../src/lib/injectionProductionCockpitCharts';

const asAny = (value: unknown): any => value;

test('lifecycle charts keep the approved status order, labels, and colors', () => {
  assert.deepEqual(Object.keys(lifecycleMeta), ['producing', 'injecting', 'soaking', 'pendingTransfer', 'needsData']);
  assert.deepEqual(Object.values(lifecycleMeta), [
    { label: '转抽生产', color: '#10b981' },
    { label: '正注', color: '#3b82f6' },
    { label: '焖井', color: '#f59e0b' },
    { label: '待转抽', color: '#8b5cf6' },
    { label: '数据待补全', color: '#94a3b8' },
  ]);

  const distribution = asAny(buildStatusDistributionOption({ producing: 5, injecting: 4, soaking: 3, pendingTransfer: 2, needsData: 1 }));
  assert.deepEqual(distribution.series[0].data.map((item: any) => [item.name, item.value, item.itemStyle.color]), [
    ['转抽生产', 5, '#10b981'], ['正注', 4, '#3b82f6'], ['焖井', 3, '#f59e0b'], ['待转抽', 2, '#8b5cf6'], ['数据待补全', 1, '#94a3b8'],
  ]);
  assert.match(distribution.tooltip.formatter, /口/);

  const blocks = asAny(buildBlockStatusOption([{ block: 'A', producing: 5, injecting: 4, soaking: 3, pendingTransfer: 2, needsData: 1 }]));
  assert.deepEqual(blocks.series.map((item: any) => [item.name, item.stack, item.itemStyle.color]), [
    ['转抽生产', '井数', '#10b981'], ['正注', '井数', '#3b82f6'], ['焖井', '井数', '#f59e0b'], ['待转抽', '井数', '#8b5cf6'], ['数据待补全', '井数', '#94a3b8'],
  ]);
  assert.equal(typeof blocks.tooltip.formatter, 'function');
});

test('block performance keeps null values and uses oil/ratio axes with explicit units', () => {
  const option = asAny(buildBlockPerformanceOption([
    { block: 'A', dailyOil: null, cumulativeOilGain: 12, oilSteamRatio: null },
    { block: 'B', dailyOil: 3, cumulativeOilGain: null, oilSteamRatio: 0.42 },
  ]));
  assert.deepEqual(option.series.map((item: any) => item.data), [[null, 3], [12, null], [null, 0.42]]);
  assert.deepEqual(option.series.map((item: any) => [item.name, item.type, item.yAxisIndex]), [
    ['日产油', 'bar', 0], ['累计增油', 'bar', 0], ['油汽比', 'line', 1],
  ]);
  assert.equal(typeof option.tooltip.formatter, 'function');
});

test('alert distribution sorts descending, preserves zero, and breaks ties by fixed type order', () => {
  const option = asAny(buildAlertDistributionOption([
    { type: 'transferOverdue', count: 0 },
    { type: 'lowEfficiency', count: 2 },
    { type: 'notEvaluated', count: 2 },
    { type: 'needsData', count: 0 },
    { type: 'soakingOverdue', count: 1 },
  ]));
  assert.deepEqual(option.yAxis.data, ['未评价', '低效井', '焖井逾期', '数据待补全', '待转抽逾期']);
  assert.deepEqual(option.series[0].data, [2, 2, 1, 0, 0]);
  assert.match(option.tooltip.formatter, /条/);
});

test('hasChartValues accepts only finite positive numeric values', () => {
  assert.equal(hasChartValues([null, undefined, 0, -1, Number.NaN, Number.POSITIVE_INFINITY]), false);
  assert.equal(hasChartValues([null, 0, 0.01]), true);
  assert.equal(hasChartValues([{ value: 3 }]), false);
});


 test('block status tooltip lists every stacked lifecycle series with well units', () => {
  const option = asAny(buildBlockStatusOption([{ block: 'A', producing: 5, injecting: 4, soaking: 3, pendingTransfer: 2, needsData: 1 }]));
  const text = option.tooltip.formatter([
    { axisValueLabel: 'A', marker: '●', seriesName: '转抽生产', value: 5 },
    { axisValueLabel: 'A', marker: '●', seriesName: '正注', value: 4 },
    { axisValueLabel: 'A', marker: '●', seriesName: '焖井', value: 3 },
    { axisValueLabel: 'A', marker: '●', seriesName: '待转抽', value: 2 },
    { axisValueLabel: 'A', marker: '●', seriesName: '数据待补全', value: 1 },
  ]);
  assert.match(text, /^A<br\/>/);
  for (const entry of ['●转抽生产: 5 口', '●正注: 4 口', '●焖井: 3 口', '●待转抽: 2 口', '●数据待补全: 1 口']) {
    assert.ok(text.includes(entry), entry);
  }
});

test('block performance tooltip formats missing and valid metrics without dangling units', () => {
  const option = asAny(buildBlockPerformanceOption([]));
  const missing = option.tooltip.formatter([
    { axisValueLabel: 'A', marker: '●', seriesName: '日产油', value: null },
    { axisValueLabel: 'A', marker: '●', seriesName: '累计增油', value: undefined },
    { axisValueLabel: 'A', marker: '●', seriesName: '油汽比', value: Number.NaN },
  ]);
  assert.equal(missing, 'A<br/>●日产油: --<br/>●累计增油: --<br/>●油汽比: --');
  assert.doesNotMatch(missing, /--\s*(吨|吨\/日)/);

  const valid = option.tooltip.formatter([
    { axisValueLabel: 'B', marker: '●', seriesName: '日产油', value: 3 },
    { axisValueLabel: 'B', marker: '●', seriesName: '累计增油', value: 12 },
    { axisValueLabel: 'B', marker: '●', seriesName: '油汽比', value: 0.42 },
  ]);
  assert.equal(valid, 'B<br/>●日产油: 3 吨/日<br/>●累计增油: 12 吨<br/>●油汽比: 0.42');
});

test('axis tooltip callbacks escape dynamic labels while preserving ECharts markers', () => {
  const maliciousBlock = '<img src=x onerror=alert(1)> & "A"';
  const maliciousSeries = "<script>alert('x')</script>";
  const statusOption = asAny(buildBlockStatusOption([]));
  const statusText = statusOption.tooltip.formatter([{
    axisValueLabel: maliciousBlock,
    marker: '<span class="marker"></span>',
    seriesName: maliciousSeries,
    value: 5,
  }]);

  assert.ok(statusText.includes('<span class="marker"></span>'));
  assert.ok(statusText.includes('&lt;img src=x onerror=alert(1)&gt; &amp; &quot;A&quot;'));
  assert.ok(statusText.includes('&lt;script&gt;alert(&#39;x&#39;)&lt;/script&gt;'));
  assert.ok(!statusText.includes('<img'));
  assert.ok(!statusText.includes('<script>'));
  assert.ok(!statusText.includes('onerror=alert(1)>'));

  const performanceOption = asAny(buildBlockPerformanceOption([]));
  const performanceText = performanceOption.tooltip.formatter([{
    name: maliciousBlock,
    marker: '<span class="marker"></span>',
    seriesName: maliciousSeries,
    value: 3,
  }]);
  assert.ok(performanceText.includes('&lt;img src=x onerror=alert(1)&gt; &amp; &quot;A&quot;'));
  assert.ok(performanceText.includes('&lt;script&gt;alert(&#39;x&#39;)&lt;/script&gt;'));
  assert.ok(!performanceText.includes('<img'));
  assert.ok(!performanceText.includes('<script>'));
});

test('chart availability keeps legitimate zero operational data visible', () => {
  assert.equal(hasAlertDistributionData([{ type: 'needsData', count: 0 }]), true);
  assert.equal(hasAlertDistributionData([]), false);
  assert.equal(hasPerformanceData([{ block: '一区', dailyOil: 0, cumulativeOilGain: null, oilSteamRatio: 0 }]), true);
  assert.equal(hasPerformanceData([{ block: '一区', dailyOil: null, cumulativeOilGain: null, oilSteamRatio: null }]), false);
  assert.equal(hasBlockStatusData([{ block: '一区', producing: 0, injecting: 0, soaking: 0, pendingTransfer: 0, needsData: 0 }]), true);
  assert.equal(hasBlockStatusData([]), false);
});
