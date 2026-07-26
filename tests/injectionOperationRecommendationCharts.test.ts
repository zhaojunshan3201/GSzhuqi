import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildRecommendationBenefitWaterfallOption,
  buildRecommendationComparisonOption,
  buildRecommendationParameterOption,
  buildRecommendationRadarOption,
  buildRecommendationRiskStabilityOption,
  hasRecommendationChartData,
} from '../src/lib/injectionOperationRecommendationCharts.ts';

const plans: any[] = [
  { id: 'best', name: '稳产优先', score: 7000, confidence: 0.86, operation: { steamVolume: 900, pressure: 11, steamRate: 18, soakDays: 6, staggerDays: 3 }, metrics: { netIncrementalOil: 15, netBenefit: 4500, grossIncrementalOil: 20, channelingLoss: 2, occupancyLoss: 3, steamCost: 3000, productionVolatility: 0.1, channelingRisk: 0.1 } },
  { id: 'alternative', name: '备选方案', score: 4800, confidence: 0.72, operation: { steamVolume: 1000, pressure: 13, steamRate: 20, soakDays: 4, staggerDays: 1 }, metrics: { netIncrementalOil: null, netBenefit: null, grossIncrementalOil: 22, channelingLoss: null, occupancyLoss: 3, steamCost: 3500, productionVolatility: 0.4, channelingRisk: 0.3 } },
];
const asAny = (value: unknown): any => value;
const values = (items: any[]) => items.map((item) => item?.value ?? item);

test('Top 3 comparison keeps unknown metrics null and highlights the best plan', () => {
  const option = asAny(buildRecommendationComparisonOption(plans));
  assert.deepEqual(option.aria, { enabled: true, description: 'Top 3 推荐方案对比图表' });
  assert.deepEqual(option.yAxis.data, ['稳产优先', '备选方案']);
  assert.deepEqual(option.series.map((series: any) => values(series.data)), [[15, null], [4500, null], [0.86, 0.72]]);
  assert.equal(option.series[0].data[0].itemStyle.color, '#16a34a');
  assert.equal(option.series[0].data[1], null);
});

test('radar and risk-stability scatter preserve unknown plans and identify the best plan', () => {
  const radar = asAny(buildRecommendationRadarOption(plans));
  assert.deepEqual(radar.series[0].data.map((item: any) => [item.name, item.value]), [['稳产优先', [15, 4500, 0.86, 0.9, 0.9]]]);
  assert.equal(radar.series[0].data[0].itemStyle.color, '#16a34a');

  const scatter = asAny(buildRecommendationRiskStabilityOption(plans));
  assert.deepEqual(scatter.series[0].data[0].value, [0.1, 0.1, 4500, '稳产优先']);
  assert.equal(scatter.series[0].data[0].itemStyle.color, '#16a34a');
  assert.deepEqual(scatter.series[1].data, []);
});

test('benefit waterfall and parameter bars model losses as negative and retain unknowns', () => {
  const waterfall = asAny(buildRecommendationBenefitWaterfallOption(plans[0], 500));
  assert.deepEqual(waterfall.xAxis.data, ['毛增油收益', '注窜损失', '占产损失', '注汽成本', '净收益']);
  assert.deepEqual(values(waterfall.series[1].data), [10000, -1000, -1500, -3000, 4500]);
  assert.equal(waterfall.aria.enabled, true);

  const parameters = asAny(buildRecommendationParameterOption(plans));
  assert.deepEqual(parameters.series.map((series: any) => values(series.data)), [[900, 1000], [11, 13], [18, 20], [6, 4], [3, 1]]);
  assert.equal(parameters.series[0].data[0].itemStyle.color, '#16a34a');
});

test('all options expose accessible no-data graphics and do not treat zeros as empty', () => {
  assert.equal(hasRecommendationChartData([]), false);
  assert.equal(hasRecommendationChartData([{ ...plans[0], metrics: { ...plans[0].metrics, netBenefit: 0 } }]), true);
  const option = asAny(buildRecommendationComparisonOption([]));
  assert.equal(option.graphic.style.text, '暂无推荐方案数据');
  assert.equal(option.aria.enabled, true);
});

