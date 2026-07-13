import assert from 'node:assert/strict';
import test from 'node:test';

import { getWellTemperatureChartOption } from '../src/wellTemperatureChart.ts';

test('builds an inverted depth chart and excludes null values', () => {
  const option = getWellTemperatureChartOption(
    '温度曲线', '温度', '℃', '#ef4444',
    [
      { depth: 1000, temperature: 65, pressure: 12 },
      { depth: 1100, temperature: null, pressure: 14 },
      { depth: 1200, temperature: 72, pressure: null },
    ],
    'temperature', 1050, 1150,
  );

  assert.equal(option.yAxis.inverse, true);
  assert.deepEqual(option.series[0].data, [[65, 1000], [72, 1200]]);
  assert.deepEqual(option.series[0].markArea, {
    itemStyle: { color: 'rgba(254, 240, 138, 0.45)' },
    label: { show: true, formatter: '射孔段' },
    data: [[{ yAxis: 1050 }, { yAxis: 1150 }]],
  });
});

test('omits perforation marking when either depth is missing', () => {
  const option = getWellTemperatureChartOption(
    '压力曲线', '压力', 'MPa', '#3b82f6', [{ depth: 1000, temperature: 65, pressure: 12 }], 'pressure', 1050, null,
  );

  assert.equal(option.series[0].markArea, undefined);
  assert.deepEqual(option.series[0].data, [[12, 1000]]);
});
