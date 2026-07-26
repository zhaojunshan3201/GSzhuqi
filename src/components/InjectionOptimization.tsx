import { useEffect, useMemo, useState } from 'react';
import ReactECharts from 'echarts-for-react';
import type { EChartsOption } from 'echarts';
import type { InjectionScenarioForecast } from '../lib/injectionScenarioForecast';
import type { InjectionOperationRecommendationResult, RecommendedOperation } from '../lib/injectionOperationOptimizer';
import {
  buildRecommendationBenefitWaterfallOption,
  buildRecommendationComparisonOption,
  buildRecommendationParameterOption,
  buildRecommendationRadarOption,
  buildRecommendationRiskStabilityOption,
  hasRecommendationChartData,
} from '../lib/injectionOperationRecommendationCharts';

const labels = { naturalDecline: '\u81ea\u7136\u9012\u51cf', currentPlan: '\u5f53\u524d\u8ba1\u5212', stableProductionOptimization: '\u7a33\u4ea7\u4f18\u5316', riskConstrained: '\u98ce\u9669\u7ea6\u675f' } as const;
const colors = ['#64748b', '#2563eb', '#16a34a', '#dc2626'];
const ui = {
  empty: '\u6570\u636e\u5f85\u8865\u5168', best: '\u6700\u4f73\u65b9\u6848', table: 'Top 3 \u65b9\u6848\u5bf9\u6bd4', radar: '\u6536\u76ca\u98ce\u9669\u96f7\u8fbe', waterfall: '\u6536\u76ca\u635f\u5931\u7011\u5e03', parameters: '\u8fd0\u884c\u53c2\u6570\u5bf9\u6bd4', risk: '\u98ce\u9669\u7a33\u5b9a\u6027', comparison: '\u65b9\u6848\u6536\u76ca\u4e0e\u7f6e\u4fe1\u5ea6\u5bf9\u6bd4',
};

function display(value: number | null, suffix = '') { return value === null ? ui.empty : `${value.toLocaleString('zh-CN', { maximumFractionDigits: 2 })}${suffix}`; }
function ChartCard({ title, option, empty }: { title: string; option: EChartsOption; empty: boolean }) {
  return <section className="app-card min-w-0 p-5" aria-label={title}><h5 className="font-bold text-slate-800">{title}</h5><div className="mt-3 h-72">{empty ? <div className="grid h-full place-items-center text-sm text-slate-400">{ui.empty}</div> : <ReactECharts option={option} style={{ height: '100%', width: '100%' }} />}</div></section>;
}
function RecommendationTable({ plans }: { plans: readonly RecommendedOperation[] }) {
  return <section className="app-card overflow-hidden" aria-label={ui.table}><div className="app-card-header"><h5 className="font-bold text-slate-800">{ui.table}</h5></div><div className="overflow-x-auto"><table className="w-full min-w-[720px] text-left text-sm"><thead className="bg-slate-50 text-slate-500"><tr><th className="px-4 py-3">{`\u6392\u540d`}</th><th className="px-4 py-3">{`\u65b9\u6848`}</th><th className="px-4 py-3">{`\u51c0\u589e\u6cb9`}</th><th className="px-4 py-3">{`\u51c0\u6536\u76ca`}</th><th className="px-4 py-3">{`\u6ce8\u7a9c\u98ce\u9669`}</th><th className="px-4 py-3">{`\u7f6e\u4fe1\u5ea6`}</th></tr></thead><tbody>{plans.map((plan, index) => <tr key={plan.id} className={`border-t border-slate-100 ${index === 0 ? 'bg-emerald-50 font-semibold' : ''}`}><td className="px-4 py-3">{index === 0 ? ui.best : `#${index + 1}`}</td><td className="px-4 py-3">{plan.name}</td><td className="px-4 py-3">{display(plan.metrics.netIncrementalOil, ' t/d')}</td><td className="px-4 py-3">{display(plan.metrics.netBenefit, ' \u5143')}</td><td className="px-4 py-3">{display(plan.metrics.channelingRisk)}</td><td className="px-4 py-3">{Math.round(plan.confidence * 100)}%</td></tr>)}</tbody></table></div></section>;
}

export function InjectionOptimization() {
  const [block, setBlock] = useState('');
  const [data, setData] = useState<InjectionScenarioForecast | null>(null);
  const [scenarioError, setScenarioError] = useState('');
  const [scenarioLoading, setScenarioLoading] = useState(false);
  const [recommendations, setRecommendations] = useState<InjectionOperationRecommendationResult | null>(null);
  const [recommendationError, setRecommendationError] = useState('');
  const [recommendationLoading, setRecommendationLoading] = useState(false);
  const [adjustmentReason, setAdjustmentReason] = useState('');
  const query = block.trim() ? '?block=' + encodeURIComponent(block.trim()) : '';

  async function loadScenarioForecast() {
    setScenarioLoading(true); setScenarioError('');
    try {
      const response = await fetch('/api/injection-scenario-forecast' + query);
      const payload = await response.json().catch(() => null);
      if (!response.ok || !payload?.success) throw new Error(response.status >= 500 ? '\u751f\u4ea7\u6e90 Well \u63a5\u53e3\u6682\u4e0d\u53ef\u7528\uff0c\u8bf7\u7a0d\u540e\u91cd\u8bd5\u3002' : payload?.message || '\u9884\u6d4b\u52a0\u8f7d\u5931\u8d25');
      setData(payload.data);
    } catch (cause: any) { setScenarioError(cause?.message || '\u9884\u6d4b\u63a5\u53e3\u6682\u4e0d\u53ef\u7528\uff0c\u8bf7\u7a0d\u540e\u91cd\u8bd5\u3002'); }
    finally { setScenarioLoading(false); }
  }

  async function loadRecommendations() {
    setRecommendationLoading(true); setRecommendationError('');
    try {
      const response = await fetch('/api/injection-operation-recommendations' + query);
      const payload = await response.json().catch(() => null);
      if (!response.ok || !payload?.success) throw new Error(response.status >= 500 ? '\u63a8\u8350\u63a5\u53e3\u6682\u4e0d\u53ef\u7528\uff0c\u8bf7\u7a0d\u540e\u91cd\u8bd5\u3002' : payload?.message || '\u63a8\u8350\u52a0\u8f7d\u5931\u8d25');
      setRecommendations(payload.data);
    } catch (cause: any) { setRecommendationError(cause?.message || '\u63a8\u8350\u63a5\u53e3\u6682\u4e0d\u53ef\u7528\uff0c\u8bf7\u7a0d\u540e\u91cd\u8bd5\u3002'); }
    finally { setRecommendationLoading(false); }
  }

  useEffect(() => { void loadScenarioForecast(); void loadRecommendations(); }, [block]);

  async function submitAdjustment(planId: string) {
    if (!adjustmentReason.trim()) return;
    const response = await fetch('/api/injection-operation-recommendations/' + encodeURIComponent(planId) + '/adjustments', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + (localStorage.getItem('token') || '') }, body: JSON.stringify({ reason: adjustmentReason.trim(), patch: {} }) });
    const payload = await response.json();
    if (payload.success) { setRecommendations(payload.data); setAdjustmentReason(''); }
    else setRecommendationError(payload.message || '\u8c03\u6574\u4fdd\u5b58\u5931\u8d25');
  }

  const scenarioOption = useMemo<EChartsOption>(() => ({ aria: { enabled: true, description: '30\u300190\u3001180\u5929\u6ce8\u6c7d\u4ea7\u91cf\u56db\u60c5\u666f\u9884\u6d4b\u66f2\u7ebf' }, tooltip: { trigger: 'axis' }, legend: { data: Object.values(labels) }, xAxis: { type: 'category', name: '\u5929', data: Array.from({ length: 180 }, (_, index) => index + 1) }, yAxis: { type: 'value', name: '\u65e5\u4ea7\u6cb9' }, series: data?.scenarios.map((scenario, index) => ({ name: labels[scenario.id], type: 'line', showSymbol: false, connectNulls: false, itemStyle: { color: colors[index] }, data: scenario.points.map((point) => point.dailyOil) })) ?? [] }), [data]);
  const plans = recommendations?.recommendations ?? []; const chartEmpty = !hasRecommendationChartData(plans); const bestPlan = plans[0];
  return <div className="page-stack"><section className="app-card p-5"><h3 className="text-lg font-bold">{'\u6ce8\u6c7d\u751f\u4ea7\u591a\u60c5\u666f\u9884\u6d4b'}</h3><label className="mt-3 block max-w-xs text-sm">{'\u533a\u5757\u7b5b\u9009'}<input className="field-control mt-1" value={block} onChange={(event) => setBlock(event.target.value)} placeholder={'\u5168\u90e8\u533a\u5757'} /></label></section><section className="space-y-3">{scenarioError && <div className="status-banner status-banner-error">{scenarioError}<button type="button" className="ml-3 underline" onClick={() => void loadScenarioForecast()}>{'\u91cd\u8bd5\u9884\u6d4b'}</button></div>}{!data ? <div className="app-card p-6 text-sm text-slate-500">{scenarioLoading ? '\u9884\u6d4b\u52a0\u8f7d\u4e2d\u2026' : '\u6682\u65e0\u9884\u6d4b\u6570\u636e'}</div> : <ChartCard title={'\u56db\u60c5\u666f\u65e5\u4ea7\u6cb9\u66f2\u7ebf'} option={scenarioOption} empty={!data.scenarios.some((scenario) => scenario.points.some((point) => point.dailyOil !== null))} />}</section><section className="app-card p-5"><h4 className="font-bold">{'\u6700\u4f18\u8fd0\u884c\u63a8\u8350 (Top 3)'}</h4>{recommendationError && <div className="status-banner status-banner-error mt-3">{recommendationError}<button type="button" className="ml-3 underline" onClick={() => void loadRecommendations()}>{'\u91cd\u8bd5\u63a8\u8350'}</button></div>}{!recommendations ? <p className="mt-3 text-sm text-slate-400">{recommendationLoading ? '\u63a8\u8350\u52a0\u8f7d\u4e2d\u3002' : '\u6682\u65e0\u8fd0\u884c\u63a8\u8350'}</p> : <><RecommendationTable plans={plans} /><section className="mt-4 grid min-w-0 gap-4 lg:grid-cols-2"><ChartCard title={ui.radar} option={buildRecommendationRadarOption(plans)} empty={chartEmpty} /><ChartCard title={ui.waterfall} option={buildRecommendationBenefitWaterfallOption(bestPlan, recommendations.constraints.oilPrice)} empty={!bestPlan} /><ChartCard title={ui.parameters} option={buildRecommendationParameterOption(plans)} empty={chartEmpty} /><ChartCard title={ui.risk} option={buildRecommendationRiskStabilityOption(plans)} empty={chartEmpty} /></section><ChartCard title={ui.comparison} option={buildRecommendationComparisonOption(plans)} empty={chartEmpty} /></>}{recommendations?.rejected.length ? <ul className="mt-3 list-disc pl-5 text-sm text-amber-700">{recommendations.rejected.map((item) => <li key={item.id}>{'\u62d2\u7edd\u65b9\u6848 '}{item.id}{'\uff1a'}{item.reason}</li>)}</ul> : null}{recommendations && <><label className="mt-4 block text-sm">{'\u4eba\u5de5\u8c03\u6574\u539f\u56e0\uff08\u5ba1\u8ba1\uff09'}<input className="field-control mt-1" value={adjustmentReason} onChange={(event) => setAdjustmentReason(event.target.value)} /></label>{plans.map((plan) => <button key={plan.id} className="mt-2 mr-2 rounded bg-slate-800 px-2 py-1 text-xs text-white disabled:opacity-50" disabled={!adjustmentReason.trim()} onClick={() => void submitAdjustment(plan.id)}>{'\u4fdd\u5b58 '}{plan.name}{' \u4eba\u5de5\u8c03\u6574\u5ba1\u8ba1'}</button>)}</>}</section></div>;
}
