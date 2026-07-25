import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildAlertDistributionOption,
  buildBlockPerformanceOption,
  buildBlockStatusOption,
  buildStatusDistributionOption,
  hasChartValues,
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
  assert.match(blocks.tooltip.formatter, /口/);
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
  assert.match(option.tooltip.formatter, /吨\/日/);
  assert.match(option.tooltip.formatter, /吨/);
  assert.match(option.tooltip.formatter, /油汽比/);
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

