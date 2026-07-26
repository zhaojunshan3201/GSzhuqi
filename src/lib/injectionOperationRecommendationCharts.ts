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

function noDataGraphic(text = '\u6682\u65e0\u63a8\u8350\u65b9\u6848\u6570\u636e') {
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
  return withAccessibility('Top 3 \u63a8\u8350\u65b9\u6848\u5bf9\u6bd4\u56fe\u8868', {
    tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' } },
    legend: { top: 0 },
    grid: { left: 48, right: 30, top: 42, bottom: 35, containLabel: true },
    xAxis: [{ type: 'value', name: '\u51c0\u589e\u6cb9 / \u6536\u76ca' }, { type: 'value', name: '\u7f6e\u4fe1\u5ea6', min: 0, max: 1, position: 'top' }],
    yAxis: { type: 'category', data: topPlans.map((plan) => plan.name) },
    series: [
      { name: '\u51c0\u589e\u6cb9 (t/d)', type: 'bar', data: topPlans.map((plan) => planDatum(plan, bestId, value(plan.metrics.netIncrementalOil))) },
      { name: '\u51c0\u6536\u76ca (\u5143)', type: 'bar', data: topPlans.map((plan) => planDatum(plan, bestId, value(plan.metrics.netBenefit))) },
      { name: '\u7f6e\u4fe1\u5ea6', type: 'line', xAxisIndex: 1, data: topPlans.map((plan) => planDatum(plan, bestId, value(plan.confidence))) },
    ],
  }, hasRecommendationChartData(topPlans));
}

export function buildRecommendationRadarOption(plans: ChartPlanList): EChartsOption {
  const topPlans = plans.slice(0, 3);
  const bestId = bestPlanId(topPlans);
  const validPlans = topPlans.filter((plan) => [plan.metrics.netIncrementalOil, plan.metrics.netBenefit, plan.confidence, plan.metrics.productionVolatility, plan.metrics.channelingRisk].every(finite));
  const maxBenefit = Math.max(1, ...validPlans.map((plan) => Math.abs(plan.metrics.netBenefit!)));
  const maxOil = Math.max(1, ...validPlans.map((plan) => Math.abs(plan.metrics.netIncrementalOil!)));
  return withAccessibility('\u63a8\u8350\u65b9\u6848\u6536\u76ca\u98ce\u9669\u96f7\u8fbe\u56fe', {
    tooltip: { trigger: 'item' },
    legend: { bottom: 0 },
    radar: { indicator: [
      { name: '\u51c0\u589e\u6cb9', max: maxOil }, { name: '\u51c0\u6536\u76ca', max: maxBenefit }, { name: '\u7f6e\u4fe1\u5ea6', max: 1 },
      { name: '\u751f\u4ea7\u7a33\u5b9a\u6027', max: 1 }, { name: '\u6ce8\u7a9c\u5b89\u5168\u6027', max: 1 },
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
  return withAccessibility('\u63a8\u8350\u65b9\u6848\u6536\u76ca\u635f\u5931\u7011\u5e03\u56fe', {
    tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' } },
    grid: { left: 48, right: 24, top: 26, bottom: 35, containLabel: true },
    xAxis: { type: 'category', data: ['\u6bdb\u589e\u6cb9\u6536\u76ca', '\u6ce8\u7a9c\u635f\u5931', '\u5360\u4ea7\u635f\u5931', '\u6ce8\u6c7d\u6210\u672c', '\u51c0\u6536\u76ca'] },
    yAxis: { type: 'value', name: '\u5143' },
    series: [{ name: '\u7d2f\u8ba1', type: 'bar', stack: '\u6536\u76ca', silent: true, itemStyle: { color: 'transparent' }, data: bases }, {
      name: '\u6536\u76ca\u635f\u5931', type: 'bar', stack: '\u6536\u76ca', data: rows.map((amount, index) => amount === null ? null : ({ value: amount, itemStyle: { color: index === 4 ? bestColor : amount >= 0 ? planColor : '#dc2626' } })),
    }],
  }, rows.some(finite));
}

export function buildRecommendationParameterOption(plans: ChartPlanList): EChartsOption {
  const topPlans = plans.slice(0, 3);
  const bestId = bestPlanId(topPlans);
  const parameters: Array<[string, (plan: ChartPlan) => number | null]> = [
    ['\u6ce8\u6c7d\u91cf (t)', (plan) => value(plan.operation.steamVolume)], ['\u538b\u529b (MPa)', (plan) => value(plan.operation.pressure)],
    ['\u6392\u91cf (t/d)', (plan) => value(plan.operation.steamRate)], ['\u7116\u4e95 (\u5929)', (plan) => value(plan.operation.soakDays)], ['\u9519\u5cf0 (\u5929)', (plan) => value(plan.operation.staggerDays)],
  ];
  return withAccessibility('Top 3 \u63a8\u8350\u65b9\u6848\u53c2\u6570\u5bf9\u6bd4\u56fe\u8868', {
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
  return withAccessibility('\u63a8\u8350\u65b9\u6848\u98ce\u9669\u7a33\u5b9a\u6027\u6563\u70b9\u56fe', {
    tooltip: { trigger: 'item', formatter: (params: any) => `${params.data[3]}<br/>\u6ce8\u7a9c\u98ce\u9669\uff1a${params.data[0]}<br/>\u751f\u4ea7\u6ce2\u52a8\uff1a${params.data[1]}<br/>\u51c0\u6536\u76ca\uff1a${params.data[2]}` },
    xAxis: { type: 'value', name: '\u6ce8\u7a9c\u98ce\u9669', min: 0 },
    yAxis: { type: 'value', name: '\u751f\u4ea7\u6ce2\u52a8', min: 0 },
    series: [{ name: '\u6700\u4f73\u65b9\u6848', type: 'scatter', symbolSize: 18, data: data.filter((plan) => plan.id === bestId).map((plan) => ({ value: [plan.metrics.channelingRisk, plan.metrics.productionVolatility, plan.metrics.netBenefit, plan.name], itemStyle: { color: bestColor } })) }, {
      name: '\u5907\u9009\u65b9\u6848', type: 'scatter', symbolSize: 13, data: data.filter((plan) => plan.id !== bestId).map((plan) => ({ value: [plan.metrics.channelingRisk, plan.metrics.productionVolatility, plan.metrics.netBenefit, plan.name], itemStyle: { color: planColor } })),
    }],
  }, data.length > 0);
}


