import type { EChartsOption } from 'echarts';
import type {
  BlockStatusSummary,
  CockpitAlertType,
  InjectionLifecycleStatus,
  InjectionProductionCockpit,
} from './injectionProductionCockpit';

export const lifecycleMeta: Record<InjectionLifecycleStatus, { label: string; color: string }> = {
  producing: { label: '生产中', color: '#10b981' },
  injecting: { label: '注汽中', color: '#3b82f6' },
  soaking: { label: '焖井中', color: '#f59e0b' },
  pendingTransfer: { label: '待转抽', color: '#8b5cf6' },
  needsData: { label: '数据待补', color: '#94a3b8' },
};

const lifecycleOrder = Object.keys(lifecycleMeta) as InjectionLifecycleStatus[];
const alertOrder: CockpitAlertType[] = ['needsData', 'notEvaluated', 'lowEfficiency', 'soakingOverdue', 'transferOverdue'];
const alertLabels: Record<CockpitAlertType, string> = {
  needsData: '数据待补',
  notEvaluated: '待评价',
  lowEfficiency: '低效井',
  soakingOverdue: '焖井超期',
  transferOverdue: '转抽超期',
};

export function hasChartValues(values: readonly unknown[]): boolean {
  return values.some((value) => typeof value === 'number' && Number.isFinite(value) && value > 0);
}

export function buildStatusDistributionOption(
  distribution: Record<InjectionLifecycleStatus, number>,
): EChartsOption {
  return {
    tooltip: { trigger: 'item', formatter: '{b}: {c} 口 ({d}%)' },
    legend: { bottom: 0 },
    series: [{
      type: 'pie',
      radius: ['48%', '72%'],
      data: lifecycleOrder.map((status) => ({
        name: lifecycleMeta[status].label,
        value: distribution[status],
        itemStyle: { color: lifecycleMeta[status].color },
      })),
    }],
  };
}

export function buildBlockStatusOption(rows: BlockStatusSummary[]): EChartsOption {
  return {
    tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' }, formatter: '{b}<br/>{a}: {c} 口' },
    legend: { top: 0 },
    grid: { left: 42, right: 18, top: 42, bottom: 36, containLabel: true },
    xAxis: { type: 'category', data: rows.map((row) => row.block) },
    yAxis: { type: 'value', name: '井数（口）', minInterval: 1 },
    series: lifecycleOrder.map((status) => ({
      name: lifecycleMeta[status].label,
      type: 'bar',
      stack: '井数',
      data: rows.map((row) => row[status]),
      itemStyle: { color: lifecycleMeta[status].color },
    })),
  };
}

export function buildBlockPerformanceOption(
  rows: InjectionProductionCockpit['blockPerformanceSummary'],
): EChartsOption {
  return {
    tooltip: {
      trigger: 'axis',
      formatter: '{b}<br/>日产油: {c0} 吨/日<br/>累计增油: {c1} 吨<br/>油汽比: {c2}',
    },
    legend: { top: 0 },
    grid: { left: 48, right: 54, top: 42, bottom: 36, containLabel: true },
    xAxis: { type: 'category', data: rows.map((row) => row.block) },
    yAxis: [
      { type: 'value', name: '油量（吨）' },
      { type: 'value', name: '油汽比', position: 'right' },
    ],
    series: [
      { name: '日产油', type: 'bar', yAxisIndex: 0, data: rows.map((row) => row.dailyOil), itemStyle: { color: '#10b981' } },
      { name: '累计增油', type: 'bar', yAxisIndex: 0, data: rows.map((row) => row.cumulativeOilGain), itemStyle: { color: '#3b82f6' } },
      { name: '油汽比', type: 'line', yAxisIndex: 1, data: rows.map((row) => row.oilSteamRatio), itemStyle: { color: '#f59e0b' }, connectNulls: false },
    ],
  };
}

export function buildAlertDistributionOption(
  distribution: InjectionProductionCockpit['alertDistribution'],
): EChartsOption {
  const rank = new Map(alertOrder.map((type, index) => [type, index]));
  const sorted = [...distribution].sort((left, right) =>
    right.count - left.count || (rank.get(left.type) ?? alertOrder.length) - (rank.get(right.type) ?? alertOrder.length));
  return {
    tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' }, formatter: '{b}: {c} 条' },
    grid: { left: 18, right: 24, top: 12, bottom: 24, containLabel: true },
    xAxis: { type: 'value', name: '告警（条）', minInterval: 1 },
    yAxis: { type: 'category', data: sorted.map((item) => alertLabels[item.type]) },
    series: [{ type: 'bar', data: sorted.map((item) => item.count), itemStyle: { color: '#ef4444' } }],
  };
}
