import { useEffect, useMemo, useState } from 'react';
import ReactECharts from 'echarts-for-react';
import type { InjectionScenarioForecast } from '../lib/injectionScenarioForecast';
import type { InjectionOperationRecommendationResult } from '../lib/injectionOperationOptimizer';

const labels = { naturalDecline: '自然递减', currentPlan: '当前计划', stableProductionOptimization: '稳产优化', riskConstrained: '风险约束' } as const;
const colors = ['#64748b', '#2563eb', '#16a34a', '#dc2626'];

export function InjectionOptimization() {
  const [block, setBlock] = useState('');
  const [data, setData] = useState<InjectionScenarioForecast | null>(null);
  const [error, setError] = useState('');
  const [recommendations, setRecommendations] = useState<InjectionOperationRecommendationResult | null>(null);
  const [adjustmentReason, setAdjustmentReason] = useState('');
  useEffect(() => {
    const query = block.trim() ? `?block=${encodeURIComponent(block.trim())}` : '';
    void fetch(`/api/injection-scenario-forecast${query}`)
      .then((response) => response.json())
      .then((payload) => { if (!payload.success) throw new Error(payload.message || '预测加载失败'); setData(payload.data); })
      .catch((cause) => setError(cause.message || '预测加载失败'));
    void fetch(`/api/injection-operation-recommendations${query}`).then((response) => response.json()).then((payload) => { if (!payload.success) throw new Error(payload.message || 'Recommendation failed'); setRecommendations(payload.data); }).catch((cause) => setError(cause.message || 'Recommendation failed'));
  }, [block]);
  async function submitAdjustment(planId: string) {
    if (!adjustmentReason.trim()) return;
    const response = await fetch(`/api/injection-operation-recommendations/${encodeURIComponent(planId)}/adjustments`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${localStorage.getItem('token') || ''}` }, body: JSON.stringify({ reason: adjustmentReason.trim(), patch: {} }) });
    const payload = await response.json();
    if (payload.success) { setRecommendations(payload.data); setAdjustmentReason(''); } else setError(payload.message || 'Adjustment failed');
  }

  const option = useMemo(() => ({
    aria: { enabled: true, description: '30、90、180天注汽产量四情景预测曲线' },
    tooltip: { trigger: 'axis' },
    legend: { data: Object.values(labels) },
    xAxis: { type: 'category', name: '天', data: Array.from({ length: 180 }, (_, index) => index + 1) },
    yAxis: { type: 'value', name: '日产油' },
    series: data?.scenarios.map((scenario, index) => ({ name: labels[scenario.id], type: 'line', showSymbol: false, connectNulls: false, itemStyle: { color: colors[index] }, data: scenario.points.map((point) => point.dailyOil) })) ?? [],
  }), [data]);
  return <div className="page-stack">
    <section className="app-card p-5"><h3 className="text-lg font-bold">注汽生产多情景预测</h3><p className="mt-1 text-sm text-slate-500">公式：基线 + 增油贡献 − 注窜损失 − 占产损失；覆盖30、90、180天。</p><label className="mt-3 block max-w-xs text-sm">区块筛选<input className="field-control mt-1" value={block} onChange={(event) => setBlock(event.target.value)} placeholder="全部区块" /></label></section>
    {error ? <div className="status-banner status-banner-error">{error}</div> : !data ? <div className="app-card p-6 text-sm text-slate-500">预测加载中…</div> : <>
      <section className="grid gap-3 md:grid-cols-3"><div className="app-card p-4"><p className="text-sm text-slate-500">预测来源</p><p className="mt-1 font-bold">{data.source === 'historical-fit' ? '历史曲线拟合' : '规则案例'}</p></div><div className="app-card p-4"><p className="text-sm text-slate-500">置信度</p><p className="mt-1 font-bold">{Math.round(data.confidence * 100)}%</p></div><div className="app-card p-4"><p className="text-sm text-slate-500">数据完整度</p><p className="mt-1 font-bold">{Math.round(data.completeness * 100)}%</p></div></section>
      <section className="app-card p-5"><h4 className="font-bold">四情景日产油曲线</h4><div className="mt-3 h-80">{data.scenarios.some((scenario) => scenario.points.some((point) => point.dailyOil !== null)) ? <ReactECharts option={option} style={{ height: '100%' }} /> : <div className="flex h-full items-center justify-center text-sm text-slate-400">数据待补全：损失或基线缺失，不能以0替代</div>}</div></section>
      <section className="app-card p-5"><h4 className="font-bold">假设与可追溯信息</h4><ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-slate-600">{data.assumptions.map((item) => <li key={item}>{item}</li>)}</ul></section>
      <section className="app-card p-5"><h4 className="font-bold">{'\u6700\u4f18\u8fd0\u884c\u63a8\u8350 (Top 3)'}</h4><p className="mt-1 text-sm text-slate-500">{'\u9505\u7089\u80fd\u529b\u3001\u6ce8\u4e95\u5e76\u884c\u6570\u4e0e\u6ce8\u7a9c\u98ce\u9669\u7ea6\u675f\uff1b\u8bc4\u5206\u517c\u987e\u51c0\u589e\u6cb9\u3001\u6ce2\u52a8\u3001\u6ce8\u7a9c\u53ca\u5360\u4ea7\u3002'}</p>{!recommendations ? <p className="mt-3 text-sm text-slate-400">{'\u63a8\u8350\u52a0\u8f7d\u4e2d\u3002'}</p> : <div className="mt-3 grid gap-3 xl:grid-cols-3">{recommendations.recommendations.map((plan, index) => <article className="rounded-lg border border-slate-200 p-4" key={plan.id}><div className="flex justify-between"><b>#{index + 1} {plan.name}</b><span className="text-xs text-slate-500">{'\u7f6e\u4fe1\u5ea6 '}{Math.round(plan.confidence * 100)}% {'\u8bc4\u5206 '}{plan.score === null ? '\u5f85\u8865\u5168' : plan.score.toFixed(0)}</span></div><p className="mt-2 text-sm">{'\u6ce8\u4e95\u987a\u5e8f\uff1a'}{plan.operation.wellOrder.join(' \u2192 ')}{'\uff1b\u9519\u5cf0 '}{plan.operation.staggerDays}{'\u5929'}</p><p className="text-sm">{'\u6ce8\u6c7d\u91cf '}{plan.operation.steamVolume}{'\u5428\uff0c\u538b\u529b '}{plan.operation.pressure} MPa{'\uff0c\u6392\u91cf '}{plan.operation.steamRate} t/d</p><p className="text-sm">{'\u7116\u4e95 '}{plan.operation.soakDays}{'\u5929\uff0c\u7b2c '}{plan.operation.convertToProductionDay}{'\u5929\u8f6c\u62bd\uff1b\u9505\u7089 '}{plan.operation.boiler}</p><p className="mt-2 text-sm">{'\u51c0\u589e\u6cb9\uff1a'}{plan.metrics.netIncrementalOil === null ? '\u5f85\u8865\u5168' : `${plan.metrics.netIncrementalOil.toFixed(1)} t/d`}{'\uff1b\u6210\u672c\u6536\u76ca\uff1a'}{plan.metrics.netBenefit === null ? '\u5f85\u8865\u5168' : plan.metrics.netBenefit.toFixed(0)}</p><ul className="mt-2 list-disc pl-5 text-xs text-slate-500">{[...plan.evidence, ...plan.assumptions].map((item) => <li key={item}>{item}</li>)}</ul><button className="mt-2 rounded bg-slate-800 px-2 py-1 text-xs text-white disabled:opacity-50" disabled={!adjustmentReason.trim()} onClick={() => void submitAdjustment(plan.id)}>{'\u4fdd\u5b58\u4eba\u5de5\u8c03\u6574\u5ba1\u8ba1'}</button></article>)}</div>}{recommendations.rejected.length > 0 && <ul className="mt-3 list-disc pl-5 text-sm text-amber-700">{recommendations.rejected.map((item) => <li key={item.id}>{'\u62d2\u7edd\u65b9\u6848 '}{item.id}{'\uff1a'}{item.reason}</li>)}</ul>}<label className="mt-4 block text-sm">{'\u4eba\u5de5\u8c03\u6574\u539f\u56e0\uff08\u5ba1\u8ba1\uff09'}<input className="field-control mt-1" value={adjustmentReason} onChange={(event) => setAdjustmentReason(event.target.value)} placeholder={'\u4f8b\uff1a\u9505\u7089\u68c0\u4fee\uff0c\u5ef6\u540e\u65bd\u5de5'} /></label></section>
    </>}
  </div>;
}
