import { ChangeEvent, useEffect, useState } from 'react';
import ReactECharts from 'echarts-for-react';

type Grade = 'recommended' | 'candidate' | 'not_recommended' | 'incomplete';
type Well = { wellName: string; block: string; station: string | null; score: number; grade: Grade };
type Cycle = {
  round: number;
  transferDate: string;
  designSteam?: number | null;
  actualSteam?: number | null;
  maxPressure?: number | null;
  rate?: number | null;
  injectN2?: boolean | null;
  boiler?: string | null;
  peakOil?: number | null;
  oilSeeingDays?: number | null;
  cycleOil?: number | null;
};
type Detail = {
  cycles: Cycle[];
  curves: Array<{ round: number; transferDate: string; oilSeeingDay: number | null; points: Array<{ day: number; oil: number }> }>;
};
type SimilarMatch = {
  wellName: string;
  block: string | null;
  score: number;
  completeness: number;
  confidence: number;
  scoreBreakdown: Record<string, { score: number | null; max: number; reason: string }>;
  caseEffect: { production: number | null; cycleOil: number | null; declineRate: number | null };
};
type SimilarWells = {
  matches: SimilarMatch[];
  parameterRanges: Record<string, { min: number; max: number; median: number; count: number }>;
};
type ApiResponse<T> = { success: boolean; data?: T; message?: string };

const gradeLabel: Record<Grade, string> = {
  recommended: '建议注汽',
  candidate: '备选井',
  not_recommended: '不建议',
  incomplete: '数据待补全',
};

async function requestJson<T>(url: string, options?: RequestInit): Promise<T> {
  const response = await fetch(url, options);
  const payload = await response.json() as ApiResponse<T>;
  if (!response.ok || !payload.success || payload.data === undefined) {
    throw new Error(payload.message ?? '请求失败');
  }
  return payload.data;
}

export function MeasureWellSelection() {
  const [wells, setWells] = useState<Well[]>([]);
  const [selected, setSelected] = useState<Well | null>(null);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [similar, setSimilar] = useState<SimilarWells | null>(null);
  const [similarLoading, setSimilarLoading] = useState(false);
  const [loading, setLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
  const [importing, setImporting] = useState(false);
  const [recalculating, setRecalculating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [importMessage, setImportMessage] = useState<string | null>(null);

  const refreshWells = async () => {
    setLoading(true);
    try {
      const data = await requestJson<Well[]>('/api/measure-well-selection/wells');
      setWells(data);
      setSelected((current) => data.find((item) => item.wellName === current?.wellName && item.block === current?.block) ?? data[0] ?? null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '加载选井数据失败');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void refreshWells(); }, []);

  useEffect(() => {
    if (!selected) {
      setDetail(null);
      return;
    }
    let active = true;
    setDetailLoading(true);
    setDetail(null);
    const query = new URLSearchParams({ block: selected.block });
    void requestJson<Detail>(`/api/measure-well-selection/wells/${encodeURIComponent(selected.wellName)}?${query}`)
      .then((data) => { if (active) setDetail(data); })
      .catch((cause) => { if (active) setError(cause instanceof Error ? cause.message : '加载井详情失败'); })
      .finally(() => { if (active) setDetailLoading(false); });
    return () => { active = false; };
  }, [selected]);

  useEffect(() => {
    if (!selected) { setSimilar(null); return; }
    let active = true;
    setSimilarLoading(true);
    const query = new URLSearchParams({ block: selected.block });
    void requestJson<SimilarWells>(`/api/measure-well-selection/wells/${encodeURIComponent(selected.wellName)}/similar?${query}`)
      .then((data) => { if (active) setSimilar(data); })
      .catch((cause) => { if (active) setError(cause instanceof Error ? cause.message : '加载同类井失败'); })
      .finally(() => { if (active) setSimilarLoading(false); });
    return () => { active = false; };
  }, [selected]);

  const importWorkbook = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    setImporting(true);
    setError(null);
    setImportMessage(null);
    try {
      const formData = new FormData();
      formData.append('file', file);
      const result = await requestJson<{ importedCount: number; skippedRows?: Array<{ row: number; reason: string }>; wellCount?: number }>(
        '/api/measure-well-selection/import',
        { method: 'POST', body: formData },
      );
      await refreshWells();
      const skipped = result.skippedRows?.length ? `，跳过 ${result.skippedRows.length} 行` : '';
      setImportMessage(`已导入 ${result.importedCount} 条轮次数据${skipped}，当前 ${result.wellCount ?? wells.length} 口井已评分。`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Excel 导入失败');
    } finally {
      setImporting(false);
    }
  };

  const recalculate = async () => {
    setRecalculating(true);
    setError(null);
    try {
      await requestJson<unknown>('/api/measure-well-selection/recalculate', { method: 'POST' });
      await refreshWells();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '重新计算评分失败');
    } finally {
      setRecalculating(false);
    }
  };

  const chartOption = {
    tooltip: { trigger: 'axis' },
    legend: { top: 8 },
    grid: { left: 54, right: 24, top: 46, bottom: 38 },
    xAxis: { type: 'value', min: -30, max: 180, name: '转抽后天数', axisLabel: { formatter: '{value}天' } },
    yAxis: { type: 'value', name: '日产油' },
    series: (detail?.curves ?? []).map((curve, index) => ({
      name: `第${curve.round}轮`, type: 'line', showSymbol: false, connectNulls: false,
      data: curve.points.map((point) => [point.day, point.oil]),
      markLine: {
        silent: true,
        data: [
          { xAxis: 0, label: { formatter: '转抽日' } },
          ...(curve.oilSeeingDay === null ? [] : [{ xAxis: curve.oilSeeingDay, label: { formatter: '见油日' } }]),
        ],
        lineStyle: { type: 'dashed', color: ['#2563eb', '#16a34a', '#ea580c'][index] },
      },
    })),
  };

  return <div className="page-stack animate-in fade-in duration-300">
    <div className="app-card p-6 flex flex-wrap items-center justify-between gap-4">
      <div>
        <h3 className="text-lg font-bold text-slate-900">措施选井</h3>
        <p className="mt-1 text-sm text-slate-500">导入历史注汽数据后自动评分，点击井号查看近三轮曲线与参数。</p>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <label className="cursor-pointer rounded bg-emerald-600 px-4 py-2 text-sm font-bold text-white disabled:cursor-not-allowed disabled:opacity-50">
          {importing ? '导入中…' : '导入 Excel'}
          <input className="sr-only" type="file" accept=".xlsx,.xls" disabled={importing} onChange={(event) => void importWorkbook(event)} />
        </label>
        <button onClick={() => void recalculate()} disabled={recalculating || importing} className="rounded border border-emerald-600 px-4 py-2 text-sm font-bold text-emerald-700 disabled:opacity-50">
          {recalculating ? '重新计算中…' : '重新计算评分'}
        </button>
      </div>
    </div>
    {error && <div className="rounded border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}
    {importMessage && <div className="rounded border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">{importMessage}</div>}
    <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(300px,0.8fr)_minmax(0,1.7fr)]">
      <section className="app-card overflow-hidden">
        <div className="app-card-header"><h4 className="font-bold text-slate-800">选井列表（{wells.length}）</h4><p className="mt-1 text-sm text-slate-500">按综合评分排序，点击井号同页查看。</p></div>
        <div className="max-h-[650px] overflow-y-auto">
          {loading ? <div className="p-6 text-sm text-slate-400">加载中…</div>
            : wells.length === 0 ? <div className="p-6 text-sm text-slate-500">暂无评分数据，请先导入 Excel。</div>
              : wells.map((well) => <button key={`${well.block}-${well.wellName}`} onClick={() => setSelected(well)} className={`flex w-full items-center justify-between border-b border-slate-100 px-4 py-3 text-left hover:bg-slate-50 ${selected?.wellName === well.wellName && selected.block === well.block ? 'bg-emerald-50' : ''}`}>
                <span><b>{well.wellName}</b><small className="ml-2 text-slate-400">{well.block} · {well.station ?? '未设置井站'}</small></span>
                <span className="text-right"><b className="text-emerald-700">{well.score.toFixed(1)}</b><small className="ml-2 text-slate-500">{gradeLabel[well.grade]}</small></span>
              </button>)}
        </div>
      </section>
      <section className="space-y-6">
        <div className="app-card overflow-hidden"><div className="app-card-header"><h4 className="font-bold text-slate-800">{selected ? `${selected.wellName}近三轮日产油曲线` : '近三轮日产油曲线'}</h4><p className="mt-1 text-sm text-slate-500">以转抽日为第 0 天，展示转抽前 30 天与后 180 天。</p></div>{detailLoading ? <div className="flex h-[330px] items-center justify-center text-sm text-slate-400">加载详情中…</div> : <ReactECharts option={chartOption} style={{ height: 330 }} />}</div>
        <div className="app-card overflow-hidden"><div className="app-card-header"><h4 className="font-bold text-slate-800">近三轮注汽参数</h4></div><div className="overflow-x-auto"><table className="w-full min-w-[760px] text-left text-sm"><thead className="bg-slate-50 text-xs text-slate-500"><tr>{['轮次', '转抽时间', '注汽量', '最高压力', '排量', 'N2', '锅炉', '峰值产油', '见油天数', '周期产油', '油汽比'].map((name) => <th key={name} className="px-3 py-3 font-semibold">{name}</th>)}</tr></thead><tbody className="divide-y divide-slate-100">{detail?.cycles.map((cycle) => <tr key={`${cycle.transferDate}-${cycle.round}`}><td className="px-3 py-3">{cycle.round}</td><td className="px-3 py-3">{cycle.transferDate}</td><td className="px-3 py-3">{cycle.actualSteam ?? cycle.designSteam ?? '--'}</td><td className="px-3 py-3">{cycle.maxPressure ?? '--'}</td><td className="px-3 py-3">{cycle.rate ?? '--'}</td><td className="px-3 py-3">{cycle.injectN2 === null || cycle.injectN2 === undefined ? '--' : cycle.injectN2 ? '是' : '否'}</td><td className="px-3 py-3">{cycle.boiler ?? '--'}</td><td className="px-3 py-3">{cycle.peakOil ?? '--'}</td><td className="px-3 py-3">{cycle.oilSeeingDays ?? '--'}</td><td className="px-3 py-3">{cycle.cycleOil ?? '--'}</td><td className="px-3 py-3">{cycle.actualSteam && cycle.cycleOil != null ? (cycle.cycleOil / cycle.actualSteam).toFixed(3) : '--'}</td></tr>)}{!detailLoading && selected && detail?.cycles.length === 0 && <tr><td className="px-3 py-5 text-slate-400" colSpan={11}>暂无轮次参数。</td></tr>}</tbody></table></div></div>
        <div className="app-card overflow-hidden">
          <div className="app-card-header"><h4 className="font-bold text-slate-800">同类注汽井（Top 10）</h4><p className="mt-1 text-sm text-slate-500">评分由区块、层系、井型、工艺、生产/递减、注汽方案、风险与效果组成；缺失字段不计分并降低置信度。</p></div>
          {similarLoading ? <div className="p-5 text-sm text-slate-400">加载同类井中…</div> : !similar?.matches.length ? <div className="p-5 text-sm text-slate-500">暂无可比较的同类井数据。</div> : <>
            <div className="overflow-x-auto"><table className="w-full min-w-[680px] text-left text-sm"><thead className="bg-slate-50 text-xs text-slate-500"><tr><th className="px-3 py-3">井号</th><th className="px-3 py-3">综合相似度</th><th className="px-3 py-3">完整度/置信度</th><th className="px-3 py-3">案例效果</th><th className="px-3 py-3">评分依据</th></tr></thead><tbody className="divide-y divide-slate-100">{similar.matches.map((match) => <tr key={`${match.block}-${match.wellName}`}><td className="px-3 py-3 font-semibold">{match.wellName}<small className="ml-2 text-slate-400">{match.block ?? '--'}</small></td><td className="px-3 py-3 text-emerald-700">{match.score.toFixed(1)}</td><td className="px-3 py-3">{(match.completeness * 100).toFixed(0)}% / {(match.confidence * 100).toFixed(0)}%</td><td className="px-3 py-3">峰值 {match.caseEffect.production ?? '--'}；周期油 {match.caseEffect.cycleOil ?? '--'}</td><td className="px-3 py-3 text-xs text-slate-500">{Object.entries(match.scoreBreakdown).filter(([, part]) => part.score !== null).map(([name, part]) => `${name} ${part.score?.toFixed(1)}/${part.max}`).join('，')}</td></tr>)}</tbody></table></div>
            <div className="border-t border-slate-100 px-4 py-3 text-xs text-slate-500">参数范围：{Object.entries(similar.parameterRanges).map(([name, range]) => `${name} ${range.min}–${range.max}（中位 ${range.median}，${range.count} 例）`).join('；')}</div>
          </>}
        </div>
      </section>
    </div>
  </div>;
}
