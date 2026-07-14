import { useEffect, useState } from 'react';
import ReactECharts from 'echarts-for-react';

type Grade = 'recommended' | 'candidate' | 'not_recommended' | 'incomplete';
type Well = { wellName: string; block: string; score: number; grade: Grade };
type Cycle = { round: number; transferDate: string; designSteam?: number | null; actualSteam?: number | null; maxPressure?: number | null; rate?: number | null; injectN2?: boolean | null; boiler?: string | null; peakOil?: number | null; oilSeeingDays?: number | null; cycleOil?: number | null };
type Detail = { cycles: Cycle[]; curves: Array<{ round: number; transferDate: string; oilSeeingDay: number | null; points: Array<{ day: number; oil: number }> }> };
const label: Record<Grade, string> = { recommended: '建议注汽', candidate: '备选井', not_recommended: '不建议', incomplete: '数据待补全' };

export function MeasureWellSelection() {
  const [wells, setWells] = useState<Well[]>([]);
  const [selected, setSelected] = useState<Well | null>(null);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [loading, setLoading] = useState(true);
  const [recalculating, setRecalculating] = useState(false);

  const loadWells = async () => {
    setLoading(true);
    try {
      const response = await fetch('/api/measure-well-selection/wells');
      const body = await response.json();
      const data = body.success ? body.data as Well[] : [];
      setWells(data); setSelected((current) => data.find((item) => item.wellName === current?.wellName) ?? data[0] ?? null);
    } finally { setLoading(false); }
  };
  useEffect(() => { void loadWells(); }, []);
  useEffect(() => {
    if (!selected) { setDetail(null); return; }
    void fetch(`/api/measure-well-selection/wells/${encodeURIComponent(selected.wellName)}`).then((response) => response.json()).then((body) => setDetail(body.success ? body.data : null)).catch(() => setDetail(null));
  }, [selected]);
  const recalculate = async () => { setRecalculating(true); try { await fetch('/api/measure-well-selection/recalculate', { method: 'POST' }); await loadWells(); } finally { setRecalculating(false); } };

  const chartOption = {
    tooltip: { trigger: 'axis' }, legend: { top: 8 }, grid: { left: 54, right: 24, top: 46, bottom: 38 },
    xAxis: { type: 'value', min: -30, max: 180, name: '转抽后天数', axisLabel: { formatter: '{value}天' } },
    yAxis: { type: 'value', name: '日产油' },
    series: (detail?.curves ?? []).map((curve, index) => ({
      name: `第${curve.round}轮`, type: 'line', showSymbol: false, connectNulls: false, data: curve.points.map((point) => [point.day, point.oil]),
      markLine: { silent: true, data: [{ xAxis: 0, label: { formatter: '转抽日' } }, ...(curve.oilSeeingDay === null ? [] : [{ xAxis: curve.oilSeeingDay, label: { formatter: '见油日' } }])], lineStyle: { type: 'dashed', color: ['#2563eb', '#16a34a', '#ea580c'][index] } },
    })),
  };

  return <div className="page-stack animate-in fade-in duration-300">
    <div className="app-card p-6 flex items-center justify-between gap-4"><div><h3 className="text-lg font-bold text-slate-900">措施选井</h3><p className="mt-1 text-sm text-slate-500">历史注汽效果综合评价，选中井号后同页切换曲线与参数。</p></div><button onClick={() => void recalculate()} disabled={recalculating} className="rounded bg-emerald-600 px-4 py-2 text-sm font-bold text-white disabled:opacity-50">{recalculating ? '重新计算中...' : '重新计算评分'}</button></div>
    <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(300px,0.8fr)_minmax(0,1.7fr)]">
      <section className="app-card overflow-hidden"><div className="app-card-header"><h4 className="font-bold text-slate-800">选井列表</h4><p className="mt-1 text-sm text-slate-500">按综合得分排序，点击井号同页查看</p></div><div className="max-h-[650px] overflow-y-auto">{loading ? <div className="p-6 text-sm text-slate-400">加载中...</div> : wells.map((well) => <button key={`${well.block}-${well.wellName}`} onClick={() => setSelected(well)} className={`flex w-full items-center justify-between border-b border-slate-100 px-4 py-3 text-left hover:bg-slate-50 ${selected?.wellName === well.wellName && selected.block === well.block ? 'bg-emerald-50' : ''}`}><span><b>{well.wellName}</b><small className="ml-2 text-slate-400">{well.block}</small></span><span className="text-right"><b className="text-emerald-700">{well.score.toFixed(1)}</b><small className="ml-2 text-slate-500">{label[well.grade]}</small></span></button>)}</div></section>
      <section className="space-y-6"><div className="app-card overflow-hidden"><div className="app-card-header"><h4 className="font-bold text-slate-800">{selected ? `${selected.wellName}近三轮日产油曲线` : '近三轮日产油曲线'}</h4><p className="mt-1 text-sm text-slate-500">以转抽日为 0 天，展示转抽前 30 天与后 180 天。</p></div><ReactECharts option={chartOption} style={{ height: 330 }} /></div>
      <div className="app-card overflow-hidden"><div className="app-card-header"><h4 className="font-bold text-slate-800">近三轮注汽参数</h4></div><div className="overflow-x-auto"><table className="w-full min-w-[760px] text-left text-sm"><thead className="bg-slate-50 text-xs text-slate-500"><tr>{['轮次','转抽时间','注汽量','最高压力','排量','N2','锅炉','峰值产油','见油天数','周期产油','油汽比'].map((name) => <th key={name} className="px-3 py-3 font-semibold">{name}</th>)}</tr></thead><tbody className="divide-y divide-slate-100">{detail?.cycles.map((cycle) => <tr key={`${cycle.transferDate}-${cycle.round}`}><td className="px-3 py-3">{cycle.round}</td><td className="px-3 py-3">{cycle.transferDate}</td><td className="px-3 py-3">{cycle.actualSteam ?? '--'}</td><td className="px-3 py-3">{cycle.maxPressure ?? '--'}</td><td className="px-3 py-3">{cycle.rate ?? '--'}</td><td className="px-3 py-3">{cycle.injectN2 ? '是' : '否'}</td><td className="px-3 py-3">{cycle.boiler ?? '--'}</td><td className="px-3 py-3">{cycle.peakOil ?? '--'}</td><td className="px-3 py-3">{cycle.oilSeeingDays ?? '--'}</td><td className="px-3 py-3">{cycle.cycleOil ?? '--'}</td><td className="px-3 py-3">{cycle.actualSteam && cycle.cycleOil != null ? (cycle.cycleOil / cycle.actualSteam).toFixed(3) : '--'}</td></tr>)}</tbody></table></div></div></section>
    </div></div>;
}
