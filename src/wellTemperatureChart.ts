export interface WellTemperatureChartPoint {
  depth: number;
  temperature: number | null;
  pressure: number | null;
}

export function getWellTemperatureChartOption(
  title: string,
  seriesName: string,
  unit: string,
  color: string,
  points: WellTemperatureChartPoint[],
  field: 'temperature' | 'pressure',
  top: number | null,
  bottom: number | null,
) {
  const data = points
    .filter((point) => point[field] !== null)
    .map((point) => [point[field] as number, point.depth]);

  return {
    title: { text: title, left: 'center', textStyle: { fontSize: 14 } },
    tooltip: {
      trigger: 'axis',
      formatter: (items: Array<{ value: [number, number] }>) => {
        const value = items[0]?.value;
        return value ? `${seriesName}：${value[0]} ${unit}<br/>井深：${value[1]} m` : '';
      },
    },
    grid: { left: 64, right: 28, top: 52, bottom: 42 },
    xAxis: { type: 'value', name: unit, nameLocation: 'middle', nameGap: 28 },
    yAxis: { type: 'value', name: '井深 (m)', inverse: true },
    series: [{
      name: seriesName,
      type: 'line',
      showSymbol: false,
      data,
      lineStyle: { color, width: 2 },
      itemStyle: { color },
      ...(top !== null && bottom !== null ? {
        markArea: {
          itemStyle: { color: 'rgba(254, 240, 138, 0.45)' },
          label: { show: true, formatter: '射孔段' },
          data: [[{ yAxis: top }, { yAxis: bottom }]],
        },
      } : {}),
    }],
  };
}
