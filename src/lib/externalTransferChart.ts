export function getDateLabelInterval(pointCount: number): number {
  return Math.max(0, Math.ceil(pointCount / 12) - 1);
}

export interface ExternalTransferChartSeries<T extends string> {
  name: string;
  metric: T;
  type?: 'line' | 'bar';
  yAxisIndex?: 0 | 1;
}

const metricColors: Record<string, string> = {
  liquid: '#ef4444',
  transfer: '#2563eb',
  diluent: '#8b5a2b',
  thinOil: '#2563eb',
  oil: '#ef4444',
  wellCount: '#1e3a8a',
  waterCut: '#16a34a',
  transferDifference: '#eab308',
  sewage: '#6b7280',
  returnFlow: '#ec4899',
};

const fallbackColors = ['#2563eb', '#84cc16', '#f59e0b', '#8b5cf6'];
const valueLabel = {
  show: true,
  position: 'top',
  formatter: ({ value }: { value: unknown }) => typeof value === 'number' ? value.toFixed(1) : '',
};

export function getExternalTransferChartOption<T extends string>(
  title: string,
  daily: Array<{ date: string } & Record<T, number | null>>,
  series: ExternalTransferChartSeries<T>[],
  dualAxis = false,
) {
  const seriesColors = series.map((item, index) => metricColors[item.metric] ?? fallbackColors[index % fallbackColors.length]);
  const configuredPrimaryAxisIndex = series.findIndex((item) => item.yAxisIndex !== 1);
  const configuredSecondaryAxisIndex = series.findIndex((item) => item.yAxisIndex === 1);
  const primaryAxisIndex = configuredPrimaryAxisIndex === -1 ? 0 : configuredPrimaryAxisIndex;
  const secondaryAxisIndex = configuredSecondaryAxisIndex === -1 ? Math.min(1, series.length - 1) : configuredSecondaryAxisIndex;

  return {
    title: { text: title, left: 'center', textStyle: { color: '#1f2937', fontSize: 17, fontWeight: 600 } },
    tooltip: { trigger: 'axis' },
    legend: { top: 34, data: series.map((item) => item.name) },
    grid: { top: 78, right: dualAxis ? 58 : 24, bottom: 82, left: 54 },
    dataZoom: [{ type: 'inside' }, { type: 'slider', height: 16, bottom: 14 }],
    xAxis: {
      type: 'category',
      data: daily.map((item) => item.date),
      axisLabel: { interval: getDateLabelInterval(daily.length), rotate: 0, hideOverlap: true },
    },
    yAxis: dualAxis
      ? [
        {
          type: 'value',
          name: series[primaryAxisIndex]?.name,
          axisLabel: { color: seriesColors[primaryAxisIndex] },
          axisLine: { lineStyle: { color: seriesColors[primaryAxisIndex] } },
        },
        {
          type: 'value',
          name: series[secondaryAxisIndex]?.name,
          position: 'right',
          axisLabel: { color: seriesColors[secondaryAxisIndex] },
          axisLine: { lineStyle: { color: seriesColors[secondaryAxisIndex] } },
        },
      ]
      : { type: 'value' },
    series: series.map((item, index) => {
      const color = seriesColors[index];
      const type = item.type ?? 'line';

      return {
        name: item.name,
        type,
        yAxisIndex: item.yAxisIndex ?? 0,
        data: daily.map((row) => row[item.metric]),
        ...(type === 'bar'
          ? { barMaxWidth: 28, itemStyle: { color, borderRadius: [4, 4, 0, 0] }, label: valueLabel }
          : {
            symbol: 'circle',
            symbolSize: 5,
            smooth: true,
            connectNulls: false,
            lineStyle: { width: 2.5, type: index === 0 ? 'solid' : 'dashed' },
            itemStyle: { color },
            label: valueLabel,
          }),
      };
    }),
  };
}
