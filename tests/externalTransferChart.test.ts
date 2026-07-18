import assert from 'node:assert/strict';
import test from 'node:test';
import { getDateLabelInterval, getExternalTransferChartOption } from '../src/lib/externalTransferChart';

test('getDateLabelInterval uses adaptive date label boundaries', () => {
  const cases = [
    [1, 0],
    [12, 0],
    [13, 1],
    [24, 1],
    [25, 2],
    [197, 16],
  ] as const;

  for (const [pointCount, expectedInterval] of cases) {
    assert.equal(getDateLabelInterval(pointCount), expectedInterval);
  }
});

test('getDateLabelInterval keeps visible labels within the readable range', () => {
  for (const pointCount of [13, 24, 25, 197]) {
    const interval = getDateLabelInterval(pointCount);
    const visibleLabelCount = Math.ceil(pointCount / (interval + 1));

    assert.ok(visibleLabelCount >= 6 && visibleLabelCount <= 12);
  }
});

test('getExternalTransferChartOption styles dense two-line charts for readability', () => {
  const daily = Array.from({ length: 20 }, (_, index) => ({
    date: `2026-07-${String(index + 1).padStart(2, '0')}`,
    liquid: index,
    transfer: index + 1,
  }));

  const option = getExternalTransferChartOption('井口液与外输', daily, [
    { name: '日产液总量', metric: 'liquid' },
    { name: '外输', metric: 'transfer' },
  ]);

  assert.deepEqual(option.xAxis.axisLabel, { interval: 1, rotate: 0, hideOverlap: true });
  assert.equal('lineStyle' in option.series[0] && option.series[0].lineStyle.type, 'solid');
  assert.equal('lineStyle' in option.series[1] && option.series[1].lineStyle.type, 'dashed');
  assert.notEqual(option.series[0].itemStyle.color, option.series[1].itemStyle.color);
  assert.equal(option.dataZoom[1].bottom, 14);
});

test('getExternalTransferChartOption styles dual-axis bar and right axis by its series color', () => {
  const option = getExternalTransferChartOption('井口产油', [{ date: '2026-07-01', oil: 10, wellCount: 4 }], [
    { name: '日产油总量', metric: 'oil', type: 'bar' },
    { name: '井数', metric: 'wellCount', yAxisIndex: 1 },
  ], true);

  assert.deepEqual(option.series[0].itemStyle.borderRadius, [4, 4, 0, 0]);
  assert.equal(option.yAxis[1].axisLabel.color, option.series[1].itemStyle.color);
});

test('getExternalTransferChartOption uses the configured secondary-axis series metadata', () => {
  const option = getExternalTransferChartOption('多系列双轴', [{ date: '2026-07-01', liquid: 10, oil: 8, wellCount: 4 }], [
    { name: '日产液总量', metric: 'liquid' },
    { name: '日产油总量', metric: 'oil' },
    { name: '井数', metric: 'wellCount', yAxisIndex: 1 },
  ], true);

  assert.equal(option.yAxis[1].name, '井数');
  assert.equal(option.yAxis[1].axisLabel.color, option.series[2].itemStyle.color);
});

test('getExternalTransferChartOption uses the configured primary-axis series metadata', () => {
  const option = getExternalTransferChartOption('双轴顺序', [{ date: '2026-07-01', wellCount: 4, oil: 8 }], [
    { name: '井数', metric: 'wellCount', yAxisIndex: 1 },
    { name: '日产油总量', metric: 'oil' },
  ], true);

  assert.equal(option.yAxis[0].name, '日产油总量');
  assert.equal(option.yAxis[1].name, '井数');
  assert.equal(option.yAxis[0].axisLabel.color, option.series[1].itemStyle.color);
});

test('uses the approved fixed color for every external transfer metric', () => {
  const option = getExternalTransferChartOption('颜色映射', [{
    date: '2026-07-01', liquid: 1, transfer: 1, diluent: 1, thinOil: 1, oil: 1,
    wellCount: 1, waterCut: 1, transferDifference: 1, sewage: 1, returnFlow: 1,
  }], [
    { name: '日产液总量', metric: 'liquid' }, { name: '外输', metric: 'transfer' },
    { name: '日掺油总量', metric: 'diluent' }, { name: '稀油用量', metric: 'thinOil' },
    { name: '日产油总量', metric: 'oil' }, { name: '井数', metric: 'wellCount' },
    { name: '含水', metric: 'waterCut' }, { name: '外输差值', metric: 'transferDifference' },
    { name: '排污', metric: 'sewage' }, { name: '回流', metric: 'returnFlow' },
  ]);

  assert.deepEqual(option.series.map((item) => item.itemStyle.color), [
    '#ef4444', '#2563eb', '#8b5a2b', '#2563eb', '#ef4444',
    '#1e3a8a', '#16a34a', '#eab308', '#6b7280', '#ec4899',
  ]);
});

test('renders oil as a line and well count as bars', () => {
  const option = getExternalTransferChartOption('井口产油', [{ date: '2026-07-01', oil: 10, wellCount: 4 }], [
    { name: '日产油总量', metric: 'oil' },
    { name: '井数', metric: 'wellCount', type: 'bar', yAxisIndex: 1 },
  ], true);

  assert.equal(option.series[0].type, 'line');
  assert.equal(option.series[1].type, 'bar');
  assert.equal(option.series[0].itemStyle.color, '#ef4444');
  assert.equal(option.series[1].itemStyle.color, '#1e3a8a');
});

test('shows a value label for every ten-day chart point', () => {
  const option = getExternalTransferChartOption('旬均值', [{ date: '2026-07上旬', liquid: 10 }], [
    { name: '日产液总量', metric: 'liquid' },
  ]);

  assert.deepEqual(option.series[0].label, { show: true, position: 'top' });
});
