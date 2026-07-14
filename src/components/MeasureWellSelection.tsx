import { useEffect, useState } from 'react';
import ReactECharts from 'echarts-for-react';

type Grade = 'recommended' | 'candidate' | 'not_recommended' | 'incomplete';
type Well = { wellName: string; block: string; score: number; grade: Grade };
type Cycle = { round: number; transferDate: string; designSteam?: number | null; actualSteam?: number | null; maxPressure?: number | null; rate?: number | null; injectN2?: boolean | null; boiler?: string | null; peakOil?: number | null; oilSeeingDays?: number | null; cycleOil?: number | null };
type Detail = { cycles: Cycle[]; curves: Array<{ round: number; transferDate: string; oilSeeingDay: number | null; points: Array<{ day: number; oil: number }> }> };
const label: Record<Grade, string> = { recommended: '\u5efa\u8bae\u6ce8\u6c7d', candidate: '\u5907\u9009\u4e95', not_recommended: '\u4e0d\u5efa\u8bae', incomplete: '\u6570\u636e\u5f85\u8865\u5168' };

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
    xAxis: { type: 'value', min: -30, max: 180, name: '\u8f6c\u62bd\u540e\u5929\u6570', axisLabel: { formatter: '{value}\u5929' } },
    yAxis: { type: 'value', name: '\u65e5\u4ea7\u6cb9' },
    series: (detail?.curves ?? []).map((curve, index) => ({
      name: `\u7b2c${curve.round}\u8f6e`, type: 'line', showSymbol: false, connectNulls: false, data: curve.points.map((point) => [point.day, point.oil]),
      markLine: { silent: true, data: [{ xAxis: 0, label: { formatter: '\u8f6c\u62bd\u65e5' } }, ...(curve.oilSeeingDay === null ? [] : [{ xAxis: curve.oilSeeingDay, label: { formatter: '\u89c1\u6cb9\u65e5' } }])], lineStyle: { type: 'dashed', color: ['#2563eb', '#16a34a', '#ea580c'][index] } },
    })),
  };

  return <div className="page-stack animate-in fade-in duration-300">
    <div className="app-card p-6 flex items-center justify-between gap-4"><div><h3 className="text-lg font-bold text-slate-900">\u63aa\u65bd\u9009\u4e95</h3><p className="mt-1 text-sm text-slate-500">\u5386\u53f2\u6ce8\u6c7d\u6548\u679c\u7efc\u5408\u8bc4\u4ef7\uff0c\u9009\u4e2d\u4e95\u53f7\u540e\u540c\u9875\u5207\u6362\u66f2\u7ebf\u4e0e\u53c2\u6570\u3002</p></div><button onClick={() => void recalculate()} disabled={recalculating} className="rounded bg-emerald-600 px-4 py-2 text-sm font-bold text-white disabled:opacity-50">{recalculating ? '\u91cd\u65b0\u8ba1\u7b97\u4e2d...' : '\u91cd\u65b0\u8ba1\u7b97\u8bc4\u5206'}</button></div>
    <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(300px,0.8fr)_minmax(0,1.7fr)]">
      <section className="app-card overflow-hidden"><div className="app-card-header"><h4 className="font-bold text-slate-800">\u9009\u4e95\u5217\u8868</h4><p className="mt-1 text-sm text-slate-500">\u6309\u7efc\u5408\u5f97\u5206\u6392\u5e8f\uff0c\u70b9\u51fb\u4e95\u53f7\u540c\u9875\u67e5\u770b</p></div><div className="max-h-[650px] overflow-y-auto">{loading ? <div className="p-6 text-sm text-slate-400">\u52a0\u8f7d\u4e2d...</div> : wells.map((well) => <button key={`${well.block}-${well.wellName}`} onClick={() => setSelected(well)} className={`flex w-full items-center justify-between border-b border-slate-100 px-4 py-3 text-left hover:bg-slate-50 ${selected?.wellName === well.wellName && selected.block === well.block ? 'bg-emerald-50' : ''}`}><span><b>{well.wellName}</b><small className="ml-2 text-slate-400">{well.block}</small></span><span className="text-right"><b className="text-emerald-700">{well.score.toFixed(1)}</b><small className="ml-2 text-slate-500">{label[well.grade]}</small></span></button>)}</div></section>
      <section className="space-y-6"><div className="app-card overflow-hidden"><div className="app-card-header"><h4 className="font-bold text-slate-800">{selected ? `${selected.wellName}\u8fd1\u4e09\u8f6e\u65e5\u4ea7\u6cb9\u66f2\u7ebf` : '\u8fd1\u4e09\u8f6e\u65e5\u4ea7\u6cb9\u66f2\u7ebf'}</h4><p className="mt-1 text-sm text-slate-500">\u4ee5\u8f6c\u62bd\u65e5\u4e3a 0 \u5929\uff0c\u5c55\u793a\u8f6c\u62bd\u524d 30 \u5929\u4e0e\u540e 180 \u5929\u3002</p></div><ReactECharts option={chartOption} style={{ height: 330 }} /></div>
      <div className="app-card overflow-hidden"><div className="app-card-header"><h4 className="font-bold text-slate-800">\u8fd1\u4e09\u8f6e\u6ce8\u6c7d\u53c2\u6570</h4></div><div className="overflow-x-auto"><table className="w-full min-w-[760px] text-left text-sm"><thead className="bg-slate-50 text-xs text-slate-500"><tr>{['\u8f6e\u6b21','\u8f6c\u62bd\u65f6\u95f4','\u6ce8\u6c7d\u91cf','\u6700\u9ad8\u538b\u529b','\u6392\u91cf','N2','\u9505\u7089','\u5cf0\u503c\u4ea7\u6cb9','\u89c1\u6cb9\u5929\u6570','\u5468\u671f\u4ea7\u6cb9','\u6cb9\u6c7d\u6bd4'].map((name) => <th key={name} className="px-3 py-3 font-semibold">{name}</th>)}</tr></thead><tbody className="divide-y divide-slate-100">{detail?.cycles.map((cycle) => <tr key={`${cycle.transferDate}-${cycle.round}`}><td className="px-3 py-3">{cycle.round}</td><td className="px-3 py-3">{cycle.transferDate}</td><td className="px-3 py-3">{cycle.actualSteam ?? '--'}</td><td className="px-3 py-3">{cycle.maxPressure ?? '--'}</td><td className="px-3 py-3">{cycle.rate ?? '--'}</td><td className="px-3 py-3">{cycle.injectN2 ? '\u662f' : '\u5426'}</td><td className="px-3 py-3">{cycle.boiler ?? '--'}</td><td className="px-3 py-3">{cycle.peakOil ?? '--'}</td><td className="px-3 py-3">{cycle.oilSeeingDays ?? '--'}</td><td className="px-3 py-3">{cycle.cycleOil ?? '--'}</td><td className="px-3 py-3">{cycle.actualSteam && cycle.cycleOil != null ? (cycle.cycleOil / cycle.actualSteam).toFixed(3) : '--'}</td></tr>)}</tbody></table></div></div></section>
    </div></div>;
}
