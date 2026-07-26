import type { EChartsOption } from 'echarts';
import type { RecommendedOperation } from './injectionOperationOptimizer';

type ChartPlan = Pick<RecommendedOperation, 'id' | 'name' | 'score' | 'confidence' | 'operation' | 'metrics'>;
type ChartPlanList = readonly ChartPlan[];

const bestColor = '#16a34a';
const planColor = '#2563eb';
const mutedColor = '#94a3b8';
const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);
const value = (item: unknown): number | null => finite(item) ? item : null;

function bestPlanId(plans: ChartPlanList): string | null {
  const scored = plans.filter((plan) => finite(plan.score));
  if (!scored.length) return plans[0]?.id ?? null;
  return scored.reduce((best, plan) => plan.score! > best.score! ? plan : best).id;
}

function planDatum(plan: ChartPlan, bestId: string | null, metric: number | null) {
  if (metric === null) return null;
  return { value: metric, itemStyle: { color: plan.id === bestId ? bestColor : planColor } };
}

function noDataGraphic(text = '暂无推荐方案数据') {
  return { type: 'text', left: 'center', top: 'middle', style: { text, fill: '#94a3b8', fontSize: 14 } };
}

function withAccessibility(description: string, option: EChartsOption, hasData: boolean): EChartsOption {
  return { aria: { enabled: true, description }, ...option, ...(hasData ? {} : { graphic: noDataGraphic() }) };
}

export function hasRecommendationChartData(plans: ChartPlanList): boolean {
  return plans.some((plan) => [
    plan.score, plan.confidence, plan.metrics.netIncrementalOil, plan.metrics.netBenefit,
    plan.metrics.grossIncrementalOil, plan.metrics.channelingLoss, plan.metrics.occupancyLoss,
    plan.metrics.productionVolatility, plan.metrics.channelingRisk, plan.operation.steamVolume,
  ].some(finite));
}

export function buildRecommendationComparisonOption(plans: ChartPlanList): EChartsOption {
  const topPlans = plans.slice(0, 3);
  const bestId = bestPlanId(topPlans);
  return withAccessibility('Top 3 推荐方案对比图表', {
    tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' } },
    legend: { top: 0 },
    grid: { left: 48, right: 30, top: 42, bottom: 35, containLabel: true },
    xAxis: [{ type: 'value', name: '净增油 / 收益' }, { type: 'value', name: '置信度', min: 0, max: 1, position: 'top' }],
    yAxis: { type: 'category', data: topPlans.map((plan) => plan.name) },
    series: [
      { name: '净增油 (t/d)', type: 'bar', data: topPlans.map((plan) => planDatum(plan, bestId, value(plan.metrics.netIncrementalOil))) },
      { name: '净收益 (元)', type: 'bar', data: topPlans.map((plan) => planDatum(plan, bestId, value(plan.metrics.netBenefit))) },
      { name: '置信度', type: 'line', xAxisIndex: 1, data: topPlans.map((plan) => planDatum(plan, bestId, value(plan.confidence))) },
    ],
  }, hasRecommendationChartData(topPlans));
}

export function buildRecommendationRadarOption(plans: ChartPlanList): EChartsOption {
  const topPlans = plans.slice(0, 3);
  const bestId = bestPlanId(topPlans);
  const validPlans = topPlans.filter((plan) => [plan.metrics.netIncrementalOil, plan.metrics.netBenefit, plan.confidence, plan.metrics.productionVolatility, plan.metrics.channelingRisk].every(finite));
  const maxBenefit = Math.max(1, ...validPlans.map((plan) => Math.abs(plan.metrics.netBenefit!)));
  const maxOil = Math.max(1, ...validPlans.map((plan) => Math.abs(plan.metrics.netIncrementalOil!)));
  return withAccessibility('推荐方案收益风险雷达图', {
    tooltip: { trigger: 'item' },
    legend: { bottom: 0 },
    radar: { indicator: [
      { name: '净增油', max: maxOil }, { name: '净收益', max: maxBenefit }, { name: '置信度', max: 1 },
      { name: '生产稳定性', max: 1 }, { name: '注窜安全性', max: 1 },
    ] },
    series: [{ type: 'radar', data: validPlans.map((plan) => ({
      name: plan.name,
      value: [plan.metrics.netIncrementalOil, plan.metrics.netBenefit, plan.confidence, 1 - plan.metrics.productionVolatility!, 1 - plan.metrics.channelingRisk!],
      itemStyle: { color: plan.id === bestId ? bestColor : planColor },
    })) }],
  }, validPlans.length > 0);
}

export function buildRecommendationBenefitWaterfallOption(plan: ChartPlan | null | undefined, oilPrice: number | null | undefined): EChartsOption {
  const canPrice = plan && finite(oilPrice) && oilPrice >= 0;
  const gross = canPrice && finite(plan!.metrics.grossIncrementalOil) ? plan!.metrics.grossIncrementalOil * oilPrice! : null;
  const channeling = canPrice && finite(plan!.metrics.channelingLoss) ? -plan!.metrics.channelingLoss * oilPrice! : null;
  const occupancy = canPrice && finite(plan!.metrics.occupancyLoss) ? -plan!.metrics.occupancyLoss * oilPrice! : null;
  const steamCost = plan ? -value(plan.metrics.steamCost)! : null;
  const net = [gross, channeling, occupancy, steamCost].every(finite) ? gross! + channeling! + occupancy! + steamCost! : null;
  const rows = [gross, channeling, occupancy, steamCost, net];
  const bases = gross === null || channeling === null || occupancy === null || steamCost === null
    ? [null, null, null, null, null]
    : [0, gross, gross + channeling, gross + channeling + occupancy, 0];
  return withAccessibility('推荐方案收益损失瀑布图', {
    tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' } },
    grid: { left: 48, right: 24, top: 26, bottom: 35, containLabel: true },
    xAxis: { type: 'category', data: ['毛增油收益', '注窜损失', '占产损失', '注汽成本', '净收益'] },
    yAxis: { type: 'value', name: '元' },
    series: [{ name: '累计', type: 'bar', stack: '收益', silent: true, itemStyle: { color: 'transparent' }, data: bases }, {
      name: '收益损失', type: 'bar', stack: '收益', data: rows.map((amount, index) => amount === null ? null : ({ value: amount, itemStyle: { color: index === 4 ? bestColor : amount >= 0 ? planColor : '#dc2626' } })),
    }],
  }, rows.some(finite));
}

export function buildRecommendationParameterOption(plans: ChartPlanList): EChartsOption {
  const topPlans = plans.slice(0, 3);
  const bestId = bestPlanId(topPlans);
  const parameters: Array<[string, (plan: ChartPlan) => number | null]> = [
    ['注汽量 (t)', (plan) => value(plan.operation.steamVolume)], ['压力 (MPa)', (plan) => value(plan.operation.pressure)],
    ['排量 (t/d)', (plan) => value(plan.operation.steamRate)], ['焖井 (天)', (plan) => value(plan.operation.soakDays)], ['错峰 (天)', (plan) => value(plan.operation.staggerDays)],
  ];
  return withAccessibility('Top 3 推荐方案参数对比图表', {
    tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' } },
    legend: { top: 0 },
    grid: { left: 48, right: 24, top: 42, bottom: 35, containLabel: true },
    xAxis: { type: 'category', data: topPlans.map((plan) => plan.name) },
    yAxis: { type: 'value' },
    series: parameters.map(([name, getter]) => ({ name, type: 'bar', data: topPlans.map((plan) => planDatum(plan, bestId, getter(plan))) })),
  }, hasRecommendationChartData(topPlans));
}

export function buildRecommendationRiskStabilityOption(plans: ChartPlanList): EChartsOption {
  const topPlans = plans.slice(0, 3);
  const bestId = bestPlanId(topPlans);
  const data = topPlans.filter((plan) => finite(plan.metrics.channelingRisk) && finite(plan.metrics.productionVolatility) && finite(plan.metrics.netBenefit));
  return withAccessibility('推荐方案风险稳定性散点图', {
    tooltip: { trigger: 'item', formatter: (params: any) => `${params.data[3]}<br/>注窜风险：${params.data[0]}<br/>生产波动：${params.data[1]}<br/>净收益：${params.data[2]}` },
    xAxis: { type: 'value', name: '注窜风险', min: 0 },
    yAxis: { type: 'value', name: '生产波动', min: 0 },
    series: [{ name: '最佳方案', type: 'scatter', symbolSize: 18, data: data.filter((plan) => plan.id === bestId).map((plan) => ({ value: [plan.metrics.channelingRisk, plan.metrics.productionVolatility, plan.metrics.netBenefit, plan.name], itemStyle: { color: bestColor } })) }, {
      name: '备选方案', type: 'scatter', symbolSize: 13, data: data.filter((plan) => plan.id !== bestId).map((plan) => ({ value: [plan.metrics.channelingRisk, plan.metrics.productionVolatility, plan.metrics.netBenefit, plan.name], itemStyle: { color: planColor } })),
    }],
  }, data.length > 0);
}


