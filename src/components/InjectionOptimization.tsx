import { useEffect, useMemo, useState } from 'react';
import ReactECharts from 'echarts-for-react';
import type { InjectionScenarioForecast } from '../lib/injectionScenarioForecast';

const labels = { naturalDecline: '自然递减', currentPlan: '当前计划', stableProductionOptimization: '稳产优化', riskConstrained: '风险约束' } as const;
const colors = ['#64748b', '#2563eb', '#16a34a', '#dc2626'];

export function InjectionOptimization() {
  const [block, setBlock] = useState('');
  const [data, setData] = useState<InjectionScenarioForecast | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    const query = block.trim() ? `?block=${encodeURIComponent(block.trim())}` : '';
    void fetch(`/api/injection-scenario-forecast${query}`)
      .then((response) => response.json())
      .then((payload) => { if (!payload.success) throw new Error(payload.message || '预测加载失败'); setData(payload.data); })
      .catch((cause) => setError(cause.message || '预测加载失败'));
  }, [block]);
  const option = useMemo(() => ({
    aria: { enabled: true, description: '30、90、180天注汽产量四情景预测曲线' },
    tooltip: { trigger: 'axis' },
    legend: { data: Object.values(labels) },
    xAxis: { type: 'category', name: '天', data: Array.from({ length: 180 }, (_, index) => index + 1) },
    yAxis: { type: 'value', name: '日产油' },
    series: data?.scenarios.map((scenario, index) => ({ name: labels[scenario.id], type: 'line', showSymbol: false, connectNulls: false, itemStyle: { color: colors[index] }, data: scenario.points.map((point) => point.dailyOil) })) ?? [],
  }), [data]);
  return <div className="page-stack">
    <section className="app-card p-5"><h3 className="text-lg font-bold">注汽生产多情景预测</h3><p className="mt-1 text-sm text-slate-500">公式：基线 + 增油贡献 ? 注窜损失 ? 占产损失；覆盖30、90、180天。</p><label className="mt-3 block max-w-xs text-sm">区块筛选<input className="field-control mt-1" value={block} onChange={(event) => setBlock(event.target.value)} placeholder="全部区块" /></label></section>
    {error ? <div className="status-banner status-banner-error">{error}</div> : !data ? <div className="app-card p-6 text-sm text-slate-500">预测加载中…</div> : <>
      <section className="grid gap-3 md:grid-cols-3"><div className="app-card p-4"><p className="text-sm text-slate-500">预测来源</p><p className="mt-1 font-bold">{data.source === 'historical-fit' ? '历史曲线拟合' : '规则案例'}</p></div><div className="app-card p-4"><p className="text-sm text-slate-500">置信度</p><p className="mt-1 font-bold">{Math.round(data.confidence * 100)}%</p></div><div className="app-card p-4"><p className="text-sm text-slate-500">数据完整度</p><p className="mt-1 font-bold">{Math.round(data.completeness * 100)}%</p></div></section>
      <section className="app-card p-5"><h4 className="font-bold">四情景日产油曲线</h4><div className="mt-3 h-80">{data.scenarios.some((scenario) => scenario.points.some((point) => point.dailyOil !== null)) ? <ReactECharts option={option} style={{ height: '100%' }} /> : <div className="flex h-full items-center justify-center text-sm text-slate-400">数据待补全：损失或基线缺失，不能以0替代</div>}</div></section>
      <section className="app-card p-5"><h4 className="font-bold">假设与可追溯信息</h4><ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-slate-600">{data.assumptions.map((item) => <li key={item}>{item}</li>)}</ul></section>
    </>}
  </div>;
}
