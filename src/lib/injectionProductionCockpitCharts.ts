import type { EChartsOption } from 'echarts';
import type {
  BlockStatusSummary,
  CockpitAlertType,
  InjectionLifecycleStatus,
  InjectionProductionCockpit,
} from './injectionProductionCockpit';

export const lifecycleMeta: Record<InjectionLifecycleStatus, { label: string; color: string }> = {
  producing: { label: '转抽生产', color: '#10b981' },
  injecting: { label: '正注', color: '#3b82f6' },
  soaking: { label: '焖井', color: '#f59e0b' },
  pendingTransfer: { label: '待转抽', color: '#8b5cf6' },
  needsData: { label: '数据待补全', color: '#94a3b8' },
};

const lifecycleOrder = Object.keys(lifecycleMeta) as InjectionLifecycleStatus[];
const alertOrder: CockpitAlertType[] = ['needsData', 'notEvaluated', 'lowEfficiency', 'soakingOverdue', 'transferOverdue'];
const alertLabels: Record<CockpitAlertType, string> = {
  needsData: '数据待补全',
  notEvaluated: '未评价',
  lowEfficiency: '低效井',
  soakingOverdue: '焖井逾期',
  transferOverdue: '待转抽逾期',
};

type AxisTooltipParam = {
  axisValueLabel?: unknown;
  marker?: unknown;
  name?: unknown;
  seriesName?: unknown;
  value?: unknown;
};

function tooltipParams(params: unknown): AxisTooltipParam[] {
  return (Array.isArray(params) ? params : [params]) as AxisTooltipParam[];
}

function escapeHtml(text: unknown): string {
  return String(text ?? '').replace(/[&<>"']/g, (character) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  })[character]!);
}

function tooltipHeader(params: AxisTooltipParam[]): string {
  return escapeHtml(params[0]?.axisValueLabel ?? params[0]?.name);
}

function tooltipMarker(param: AxisTooltipParam): string {
  return typeof param.marker === 'string' ? param.marker : '';
}

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
    tooltip: {
      trigger: 'axis',
      axisPointer: { type: 'shadow' },
      formatter: (rawParams) => {
        const params = tooltipParams(rawParams);
        return [
          tooltipHeader(params),
          ...params.map((param) =>
            `${tooltipMarker(param)}${escapeHtml(param.seriesName)}: ${escapeHtml(param.value)} 口`),
        ].join('<br/>');
      },
    },
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
  const units: Record<string, string> = { 日产油: ' 吨/日', 累计增油: ' 吨', 油汽比: '' };
  return {
    tooltip: {
      trigger: 'axis',
      formatter: (rawParams) => {
        const params = tooltipParams(rawParams);
        return [
          tooltipHeader(params),
          ...params.map((param) => {
            const value = param.value;
            const valid = typeof value === 'number' && Number.isFinite(value);
            const seriesName = String(param.seriesName ?? '');
            return `${tooltipMarker(param)}${escapeHtml(seriesName)}: ${valid ? `${value}${units[seriesName] ?? ''}` : '--'}`;
          }),
        ].join('<br/>');
      },
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



