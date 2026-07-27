import { ChangeEvent, useEffect, useMemo, useState } from 'react';
import ReactECharts from 'echarts-for-react';

type ApiResponse<T> = { success: boolean; data?: T; message?: string };
type SourceStatus = { sourceType: 'stage' | 'daily'; sourceFile: string; importedAt: string; rowCount: number; skippedRowCount?: number; errorMessages?: string[] };
type ScorePart = { score: number; value: number | null; maxScore: number };
type Candidate = { wellNo: string; score: number; oilSteamRatio: number; stageOil: number; qualityReasons: string[]; scoreBreakdown: { oilSteamRatio: ScorePart; stageOil: ScorePart; stability: ScorePart; dailyCompleteness: ScorePart } };
type ExcludedCandidate = { wellNo: string; reason: string };
type PlanDecision = 'included' | 'locked' | 'excluded';
type PlanItem = { id: number; rankNo: number; wellNo: string; score: number; suggestedSteam: number | null; recommendedBoiler: string | null; nitrogen: boolean; carbonDioxide: boolean; oilSteamRatio: number; stageOil: number; decision: PlanDecision; manualNote: string | null };
type Plan = { id: number; month: string; maxWells: number; generatedAt: string; items: PlanItem[] };
type LegacyWell = { wellName: string; block: string; station: string | null; score: number };
type LegacyDetail = { curves: Array<{ round: number; points: Array<{ day: number; oil: number }> }> };
type Similar = { matches: Array<{ wellName: string; block: string | null; score: number; confidence: number }> };

async function requestJson<T>(url: string, options?: RequestInit): Promise<T> {
  const response = await fetch(url, options);
  const payload = await response.json() as ApiResponse<T>;
  if (!response.ok || !payload.success || payload.data === undefined) throw new Error(payload.message ?? '请求失败');
  return payload.data;
}

function nextMonth(): string {
  const date = new Date();
  return `${date.getFullYear() + (date.getMonth() === 11 ? 1 : 0)}-${String((date.getMonth() + 1) % 12 + 1).padStart(2, '0')}`;
}

export function MeasureWellSelection() {
  const [sources, setSources] = useState<SourceStatus[]>([]);
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [excluded, setExcluded] = useState<ExcludedCandidate[]>([]);
  const [rebuildComplete, setRebuildComplete] = useState(false);
  const [plan, setPlan] = useState<Plan | null>(null);
  const [month, setMonth] = useState(nextMonth);
  const [busySource, setBusySource] = useState<'stage' | 'daily' | null>(null);
  const [rebuilding, setRebuilding] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [savingId, setSavingId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [legacyWells, setLegacyWells] = useState<LegacyWell[]>([]);
  const [selectedLegacy, setSelectedLegacy] = useState<LegacyWell | null>(null);
  const [detail, setDetail] = useState<LegacyDetail | null>(null);
  const [similar, setSimilar] = useState<Similar | null>(null);

  const sourceByType = useMemo(() => new Map(sources.map((source) => [source.sourceType, source])), [sources]);
  const bothSourcesReady = sourceByType.has('stage') && sourceByType.has('daily');
  const refreshSources = async () => setSources((await requestJson<{ sources: SourceStatus[] }>('/api/injection-selection/data-status')).sources);
  const refreshLegacy = async () => {
    try {
      const wells = await requestJson<LegacyWell[]>('/api/measure-well-selection/wells');
      setLegacyWells(wells);
      setSelectedLegacy((current) => wells.find((well) => well.wellName === current?.wellName && well.block === current?.block) ?? wells[0] ?? null);
    } catch { /* 新数据功能不依赖历史展示接口 */ }
  };

  useEffect(() => { void refreshSources().catch(showError); void refreshLegacy(); }, []);
  useEffect(() => {
    if (!selectedLegacy) { setDetail(null); setSimilar(null); return; }
    const block = new URLSearchParams({ block: selectedLegacy.block });
    void requestJson<LegacyDetail>(`/api/measure-well-selection/wells/${encodeURIComponent(selectedLegacy.wellName)}?${block}`).then(setDetail).catch(() => setDetail(null));
    void requestJson<Similar>(`/api/measure-well-selection/wells/${encodeURIComponent(selectedLegacy.wellName)}/similar?${block}`).then(setSimilar).catch(() => setSimilar(null));
  }, [selectedLegacy]);

  function showError(cause: unknown) { setError(cause instanceof Error ? cause.message : '操作失败'); }
  async function upload(source: 'stage' | 'daily', event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]; event.target.value = '';
    if (!file) return;
    setBusySource(source); setError(null); setMessage(null);
    try {
      const body = new FormData(); body.append('file', file);
      const endpoint = source === 'stage' ? '/api/injection-selection/import/stage' : '/api/injection-selection/import/daily';
      const result = await requestJson<{ rows: unknown[]; skippedRows: unknown[] }>(endpoint, { method: 'POST', body });
      await refreshSources();
      setCandidates([]); setExcluded([]); setPlan(null); setRebuildComplete(false);
      setMessage(`${source === 'stage' ? '阶段产油' : '注汽日数据'}已导入 ${result.rows.length} 行${result.skippedRows.length ? `，跳过 ${result.skippedRows.length} 行` : ''}。`);
    } catch (cause) { showError(cause); } finally { setBusySource(null); }
  }
  async function rebuild() {
    setRebuilding(true); setError(null);
    try {
      const result = await requestJson<{ candidates: Candidate[]; excluded: ExcludedCandidate[] }>('/api/injection-selection/rebuild', { method: 'POST' });
      setCandidates(result.candidates); setExcluded(result.excluded); setRebuildComplete(true); setMessage(`已重建 ${result.candidates.length} 口候选井。`);
    } catch (cause) { showError(cause); } finally { setRebuilding(false); }
  }
  async function generatePlan() {
    if (!bothSourcesReady || !rebuildComplete) { setError('\u8bf7\u5148\u5bfc\u5165\u4e24\u4efd\u6570\u636e\u5e76\u6210\u529f\u91cd\u5efa\u5019\u9009\u4e95\u3002'); return; }
    setGenerating(true); setError(null);
    try {
      const created = await requestJson<Plan>('/api/injection-selection/plans', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ month }) });
      setPlan(created); setMessage(`已生成 ${created.month} 注汽计划（${created.items.length}/${created.maxWells} 口）。`);
    } catch (cause) { showError(cause); } finally { setGenerating(false); }
  }
  async function patchItem(item: PlanItem, patch: Partial<Pick<PlanItem, 'suggestedSteam' | 'recommendedBoiler' | 'decision' | 'manualNote'>>) {
    if (!plan) return;
    setSavingId(item.id); setError(null);
    try {
      const updated = await requestJson<Plan>(`/api/injection-selection/plans/${plan.id}/items/${item.id}`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify(patch) });
      setPlan(updated);
    } catch (cause) { showError(cause); } finally { setSavingId(null); }
  }
  const chartOption = { tooltip: { trigger: 'axis' }, xAxis: { type: 'value', name: '转抽后天数' }, yAxis: { type: 'value', name: '日产油' }, series: (detail?.curves ?? []).map((curve) => ({ name: `第${curve.round}轮`, type: 'line', showSymbol: false, data: curve.points.map((point) => [point.day, point.oil]) })) };

  return <div className="page-stack animate-in fade-in duration-300">
    <section className="app-card p-6">
      <h3 className="text-lg font-bold text-slate-900">措施选井注汽选井</h3>
      <p className="mt-1 text-sm text-slate-500">导入单位数据库导出的阶段产油和注汽日数据，重建候选井后生成每月最多 30 口井的可执行注汽计划。</p>
      <div className="mt-5 grid gap-4 md:grid-cols-2">
        {(['stage', 'daily'] as const).map((source) => { const stage = source === 'stage'; const status = sourceByType.get(source); return <div key={source} className="rounded border border-slate-200 p-4">
          <b>{stage ? '阶段产油' : '注汽日数据'}</b><p className="mt-1 text-xs text-slate-500">{status ? `${status.sourceFile} · ${status.rowCount} 行 · ${new Date(status.importedAt).toLocaleString()}` : '尚未导入'}</p>
          <label className="mt-3 inline-block cursor-pointer rounded bg-emerald-600 px-3 py-2 text-sm font-bold text-white"><input className="sr-only" type="file" accept=".xlsx,.xls" disabled={busySource !== null} onChange={(event) => void upload(source, event)} />{busySource === source ? '导入中…' : `导入${stage ? '阶段产油' : '注汽日数据'}`}</label>
        </div>; })}
      </div>
      {sources.some((source) => (source.skippedRowCount ?? 0) > 0 || (source.errorMessages?.length ?? 0) > 0) && <div className="mt-3 rounded border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">{sources.map((source) => <div key={`status-${source.sourceType}`}>{(source.skippedRowCount ?? 0) > 0 && <span>{`${source.sourceType}: \u8df3\u8fc7\u884c ${source.skippedRowCount}`}</span>}{source.errorMessages?.length ? <span className="ml-3 text-red-700">{`\u5bfc\u5165\u9519\u8bef?${source.errorMessages.join('?')}`}</span> : null}</div>)}</div>}
      <div className="mt-5 flex flex-wrap items-end gap-3"><button className="rounded border border-emerald-600 px-4 py-2 text-sm font-bold text-emerald-700 disabled:opacity-50" disabled={rebuilding || !bothSourcesReady} onClick={() => void rebuild()}>{rebuilding ? '重建中…' : '重建候选井'}</button><label className="text-sm font-semibold">目标月份<input className="ml-2 rounded border border-slate-300 px-2 py-2" type="month" value={month} onChange={(event) => setMonth(event.target.value)} /></label><button className="rounded bg-emerald-600 px-4 py-2 text-sm font-bold text-white disabled:opacity-50" disabled={generating || !month || !bothSourcesReady || !rebuildComplete} onClick={() => void generatePlan()}>{generating ? '生成中…' : '生成注汽计划'}</button></div>
    </section>
    {!bothSourcesReady && <div className="rounded border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">{'\u8bf7\u5148\u5bfc\u5165\u9636\u6bb5\u4ea7\u6cb9\u548c\u6ce8\u6c7d\u65e5\u6570\u636e\uff0c\u624d\u80fd\u91cd\u5efa\u5019\u9009\u4e95\u3002'}</div>}{bothSourcesReady && !rebuildComplete && <div className="rounded border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">{'\u4e24\u4efd\u6570\u636e\u5df2\u9f50\u5168\uff0c\u8bf7\u6210\u529f\u91cd\u5efa\u5019\u9009\u4e95\u540e\u518d\u751f\u6210\u6ce8\u6c7d\u8ba1\u5212\u3002'}</div>}
    {error && <div className="rounded border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}{message && <div className="rounded border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">{message}</div>}
    <section className="app-card overflow-hidden"><div className="app-card-header flex flex-wrap items-center justify-between gap-2"><div><h4 className="font-bold text-slate-800">候选井与月度注汽计划</h4><p className="mt-1 text-sm text-slate-500">油汽比优先排序；计划最多 30 口井。氮气和二氧化碳标记来自历史注汽日数据备注。</p></div>{plan && <a className="rounded border border-emerald-600 px-3 py-2 text-sm font-bold text-emerald-700" href={`/api/injection-selection/plans/${plan.id}.xlsx`}>导出 Excel</a>}</div>
      {!plan ? <div className="p-5 text-sm text-slate-500">{candidates.length ? `已重建 ${candidates.length} 口候选井，请选择目标月份生成注汽计划。` : '请先导入两份数据并重建候选井。'}</div> : <div className="overflow-x-auto"><table className="w-full min-w-[1180px] text-left text-sm"><thead className="bg-slate-50 text-xs text-slate-500"><tr><th className="px-3 py-3">{'\u8bc4\u5206\u4f9d\u636e'}</th>{['顺序','井号','评分','油汽比','阶段产油','建议注汽量','推荐锅炉','氮气','二氧化碳','人工决定','备注'].map((name) => <th key={name} className="px-3 py-3">{name}</th>)}</tr></thead><tbody className="divide-y divide-slate-100">{plan.items.map((item) => <tr key={item.id}><td className="px-3 py-3 text-xs text-slate-600">{`\u6cb9\u6c7d\u6bd4 ${item.scoreBreakdown?.oilSteamRatio?.score ?? '-'}?\u9636\u6bb5\u4ea7\u6cb9 ${item.scoreBreakdown?.stageOil?.score ?? '-'}?\u7a33\u5b9a\u6027 ${item.scoreBreakdown?.stability?.score ?? '-'}?\u65e5\u6570\u636e ${item.scoreBreakdown?.dailyCompleteness?.score ?? '-'}`}</td><td className="px-3 py-3">{item.rankNo}</td><td className="px-3 py-3 font-semibold">{item.wellNo}</td><td className="px-3 py-3">{item.score.toFixed(1)}</td><td className="px-3 py-3">{item.oilSteamRatio.toFixed(3)}</td><td className="px-3 py-3">{item.stageOil}</td><td className="px-3 py-3"><input aria-label={`${item.wellNo}建议注汽量`} className="w-24 rounded border px-2 py-1" type="number" defaultValue={item.suggestedSteam ?? ''} onBlur={(event) => void patchItem(item, { suggestedSteam: event.target.value === '' ? null : Number(event.target.value) })} /></td><td className="px-3 py-3"><input aria-label={`${item.wellNo}推荐锅炉`} className="w-28 rounded border px-2 py-1" defaultValue={item.recommendedBoiler ?? ''} onBlur={(event) => void patchItem(item, { recommendedBoiler: event.target.value || null })} /></td><td className="px-3 py-3">{item.nitrogen ? '是' : '否'}</td><td className="px-3 py-3">{item.carbonDioxide ? '是' : '否'}</td><td className="px-3 py-3"><select aria-label={`${item.wellNo}人工决定`} className="rounded border px-2 py-1" value={item.decision} onChange={(event) => void patchItem(item, { decision: event.target.value as PlanDecision })}><option value="included">纳入</option><option value="locked">锁定</option><option value="excluded">剔除</option></select></td><td className="px-3 py-3"><input aria-label={`${item.wellNo}备注`} className="rounded border px-2 py-1" defaultValue={item.manualNote ?? ''} onBlur={(event) => void patchItem(item, { manualNote: event.target.value || null })} />{savingId === item.id && <small className="ml-1 text-slate-400">保存中…</small>}</td></tr>)}</tbody></table></div>}
    </section>
    {(excluded.length > 0 || candidates.some((candidate) => candidate.qualityReasons.length > 0)) && <section className="app-card overflow-hidden"><div className="app-card-header"><h4 className="font-bold text-slate-800">{'\u6392\u9664\u4e95\u4e0e\u6570\u636e\u8d28\u91cf\u63d0\u793a'}</h4></div><div className="divide-y divide-slate-100 text-sm">{excluded.map((item) => <div key={`excluded-${item.wellNo}`} className="px-4 py-3"><b>{item.wellNo}</b><span className="ml-3 text-amber-700">{item.reason}</span></div>)}{candidates.filter((candidate) => candidate.qualityReasons.length > 0).map((candidate) => <div key={`quality-${candidate.wellNo}`} className="px-4 py-3"><b>{candidate.wellNo}</b><span className="ml-3 text-amber-700">{candidate.qualityReasons.join('\uff1b')}</span></div>)}</div></section>}
    <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(280px,0.8fr)_minmax(0,1.7fr)]"><section className="app-card overflow-hidden"><div className="app-card-header"><h4 className="font-bold text-slate-800">历史选井列表</h4></div><div className="max-h-[360px] overflow-y-auto">{legacyWells.map((well) => <button key={`${well.block}-${well.wellName}`} className="flex w-full justify-between border-b px-4 py-3 text-left hover:bg-slate-50" onClick={() => setSelectedLegacy(well)}><span>{well.wellName}<small className="ml-2 text-slate-400">{well.block}</small></span><b>{well.score.toFixed(1)}</b></button>)}{!legacyWells.length && <div className="p-4 text-sm text-slate-400">暂无历史曲线数据。</div>}</div></section><section className="space-y-6"><div className="app-card overflow-hidden"><div className="app-card-header"><h4 className="font-bold text-slate-800">历史近三轮日产油曲线</h4></div><ReactECharts option={chartOption} style={{ height: 300 }} /></div><div className="app-card overflow-hidden"><div className="app-card-header"><h4 className="font-bold text-slate-800">同类井</h4></div><div className="p-4 text-sm text-slate-600">{similar?.matches.length ? similar.matches.map((match) => <div key={`${match.block}-${match.wellName}`} className="border-b py-2">{match.wellName} · {match.block ?? '--'} · 相似度 {match.score.toFixed(1)} · 置信度 {(match.confidence * 100).toFixed(0)}%</div>) : '暂无可比较的同类井数据。'}</div></div></section></div>
  </div>;
}
