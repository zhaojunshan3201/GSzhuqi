import { ChangeEvent, useEffect, useMemo, useRef, useState } from 'react';
import ReactECharts from 'echarts-for-react';
import { formatSelectionImportError, formatSelectionScoreBreakdown, selectionSourceLabel } from '../lib/injectionSelectionFormatting';
import { requestJson } from '../lib/requestJson';

type SourceStatus = { sourceType: 'stage' | 'daily'; sourceFile: string; importedAt: string; rowCount: number; skippedRowCount?: number; errorMessages?: string[] };
type ScorePart = { score: number; value: number | null; maxScore: number };
type Candidate = { wellNo: string; score: number; oilSteamRatio: number; stageOil: number; qualityReasons: string[]; scoreBreakdown: { oilSteamRatio: ScorePart; stageOil: ScorePart; stability: ScorePart; dailyCompleteness: ScorePart } };
type ExcludedCandidate = { wellNo: string; reason: string };
type PlanDecision = 'included' | 'locked' | 'excluded';
type PlanItem = { id: number; rankNo: number; wellNo: string; score: number; suggestedSteam: number | null; recommendedBoiler: string | null; nitrogen: boolean; carbonDioxide: boolean; oilSteamRatio: number; stageOil: number; decision: PlanDecision; manualNote: string | null; scoreBreakdown: Candidate['scoreBreakdown'] };
type Plan = { id: number; month: string; maxWells: number; generatedAt: string; items: PlanItem[] };
type PlanMode = 'next-month' | 'year-end';
type EligibilityEvidence = { eligible: boolean; reason: string; oilValue: number | null; oilSource: 'actual' | 'predicted' | null; minimumEligibleDate: string | null };
type YearEndPlanItem = { wellNo: string; score: number; evidence: EligibilityEvidence; source?: Candidate };
type YearEndMonthPlan = { month: string; planDate: string; items: YearEndPlanItem[]; excluded: YearEndPlanItem[] };
type NextMonthGeneration = { mode: 'next-month'; plan: Plan; evidence: Array<{ wellNo: string; score: number } & EligibilityEvidence>; excluded: Array<{ wellNo: string; score: number } & EligibilityEvidence> };
type YearEndGeneration = { mode: 'year-end'; months: YearEndMonthPlan[] };
type LegacyWell = { wellName: string; block: string; station: string | null; score: number };
type LegacyDetail = { curves: Array<{ round: number; points: Array<{ day: number; oil: number }> }> };
type Similar = { matches: Array<{ wellName: string; block: string | null; score: number; confidence: number }> };

type SelectedWellReference = { wellNo: string; cycles: Array<{ cycleNo: number; stopInjectionDate: string; metrics: { stageOil: number; oilSteamRatio: number; steamVolume: number }; points: Array<{ day: number; oil: number | null }>; missingReason: string | null }>; similarWells: Array<{ wellNo: string; similarity: number; score: number; oilSteamRatio: number; stageOil: number }>; missingReasons: string[] };
const selectedReferenceText = { title: '\u5df2\u9009\u4e95\u6548\u679c\u53c2\u8003', x: '\u505c\u6ce8\u6c7d\u540e\u5929\u6570', y: '\u65e5\u4ea7\u6cb9', noSimilar: '\u5f53\u524d\u5019\u9009\u4e95\u4e2d\u6ca1\u6709\u53ef\u6bd4\u8f83\u7684\u540c\u7c7b\u4e95\u3002', selected: '\u5df2\u9009\u4e95', loading: '\u6b63\u5728\u52a0\u8f7d', round: '\u8f6e\u6b21', date: '\u505c\u6ce8\u6c7d\u65e5\u671f', stageOil: '\u9636\u6bb5\u4ea7\u6cb9', ratio: '\u6cb9\u6c7d\u6bd4', steam: '\u5468\u671f\u6ce8\u6c7d\u91cf', similar: '\u540c\u7c7b\u4e95', well: '\u4e95\u53f7', similarity: '\u76f8\u4f3c\u5ea6', score: '\u8bc4\u5206' };
export function SelectedWellReferencePanel({ planItems, selectedWellNo, reference, onWellChange }: { planItems: PlanItem[]; selectedWellNo: string; reference: SelectedWellReference | null; onWellChange?: (wellNo: string) => void }) {
  const items = planItems.filter((item) => item.decision === 'included' || item.decision === 'locked');
  const option = { xAxis: { type: 'value', name: selectedReferenceText.x, min: 10, max: 310 }, yAxis: { type: 'value', name: selectedReferenceText.y }, series: (reference?.cycles ?? []).map((cycle) => ({ name: `\u7b2c${cycle.cycleNo}\u8f6e\uff08${cycle.stopInjectionDate}\uff09`, type: 'line', showSymbol: false, data: cycle.points.map((point) => [point.day, point.oil]) })) };
  return <section className="app-card overflow-hidden"><div className="app-card-header"><h4 className="font-bold text-slate-800">{selectedReferenceText.title}</h4><label>{selectedReferenceText.selected} <select value={selectedWellNo} onChange={(event) => onWellChange?.(event.target.value)}>{items.map((item) => <option key={item.id} value={item.wellNo}>{item.wellNo}</option>)}</select></label></div>{!reference ? <div className="p-4">{selectedReferenceText.loading}</div> : <div className="p-4 space-y-4">{reference.missingReasons.map((reason) => <div key={reason} className="text-amber-800">{reason}</div>)}{reference.cycles.length > 0 && <><>{typeof window === 'undefined' ? <div>{selectedReferenceText.x} {selectedReferenceText.y}</div> : <ReactECharts option={option} style={{ height: 300 }} />}</><table className="w-full table-fixed text-center text-sm [&_th]:px-3 [&_th]:py-2 [&_td]:px-3 [&_td]:py-2"><thead><tr><th>{selectedReferenceText.round}</th><th>{selectedReferenceText.date}</th><th>{selectedReferenceText.stageOil}</th><th>{selectedReferenceText.ratio}</th><th>{selectedReferenceText.steam}</th></tr></thead><tbody>{reference.cycles.map((cycle) => <tr key={cycle.cycleNo}><td>{cycle.cycleNo}</td><td>{cycle.stopInjectionDate}</td><td>{cycle.metrics.stageOil}</td><td>{cycle.metrics.oilSteamRatio}</td><td>{cycle.metrics.steamVolume}</td></tr>)}</tbody></table></>}<h5>{selectedReferenceText.similar}</h5>{reference.similarWells.length ? <table className="w-full table-fixed text-center text-sm [&_th]:px-3 [&_th]:py-2 [&_td]:px-3 [&_td]:py-2"><thead><tr><th>{selectedReferenceText.well}</th><th>{selectedReferenceText.similarity}</th><th>{selectedReferenceText.score}</th><th>{selectedReferenceText.ratio}</th><th>{selectedReferenceText.stageOil}</th></tr></thead><tbody>{reference.similarWells.map((well) => <tr key={well.wellNo}><td>{well.wellNo}</td><td>{well.similarity.toFixed(1)}</td><td>{well.score.toFixed(1)}</td><td>{well.oilSteamRatio.toFixed(3)}</td><td>{well.stageOil}</td></tr>)}</tbody></table> : <p>{selectedReferenceText.noSimilar}</p>}</div>}</section>;
}

export function SelectionImportStatusLine({ source }: { source: SourceStatus }) {
  return <div>
    {(source.skippedRowCount ?? 0) > 0 && <span>{`${selectionSourceLabel(source.sourceType)}：跳过 ${source.skippedRowCount} 行`}</span>}
    {source.errorMessages?.length ? <span className="ml-3 text-red-700">{`导入错误：${source.errorMessages.map(formatSelectionImportError).join('；')}`}</span> : null}
  </div>;
}

export function SelectionScoringExplanation() {
  return <p className="mt-1 text-sm text-slate-500">油汽比优先排序;计划最多 30 口井。氮气和二氧化碳标记来自历史注汽日数据备注。评分依据：油汽比 60 分、阶段产油 20 分、稳定性 10 分、日数据完整性 10 分；总分为四项之和，满分 100 分。</p>;
}

export function SelectionScoreBreakdownText({ scoreBreakdown }: { scoreBreakdown: Candidate['scoreBreakdown'] }) {
  return <span>{formatSelectionScoreBreakdown(scoreBreakdown)}</span>;
}

export function MeasureWellSelection() {
  const [sources, setSources] = useState<SourceStatus[]>([]);
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [excluded, setExcluded] = useState<ExcludedCandidate[]>([]);
  const [rebuildComplete, setRebuildComplete] = useState(false);
  const [plan, setPlan] = useState<Plan | null>(null);
  const [annualPlans, setAnnualPlans] = useState<YearEndMonthPlan[]>([]);
  const [nextMonthEvidence, setNextMonthEvidence] = useState<NextMonthGeneration['evidence']>([]);
  const [busySource, setBusySource] = useState<'stage' | 'daily' | null>(null);
  const [rebuilding, setRebuilding] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [savingId, setSavingId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [selectedReferenceWell, setSelectedReferenceWell] = useState('');
  const [selectedWellReference, setSelectedWellReference] = useState<SelectedWellReference | null>(null);
  const referenceRequestSequence = useRef(0);
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

  const selectablePlanItems = useMemo(() => plan?.items.filter((item) => item.decision === 'included' || item.decision === 'locked') ?? [], [plan]);
  const evidenceByWell = useMemo(() => new Map(nextMonthEvidence.map((evidence) => [evidence.wellNo, evidence])), [nextMonthEvidence]);
  useEffect(() => { if (!selectablePlanItems.some((item) => item.wellNo === selectedReferenceWell)) setSelectedReferenceWell(selectablePlanItems[0]?.wellNo ?? ''); }, [selectablePlanItems, selectedReferenceWell]);
  useEffect(() => {
    const requestSequence = ++referenceRequestSequence.current;
    setSelectedWellReference(null);
    if (!plan || !selectedReferenceWell) return;
    const controller = new AbortController();
    const params = new URLSearchParams({ wellNo: selectedReferenceWell });
    void requestJson<SelectedWellReference>(`/api/injection-selection/plans/${plan.id}/reference?${params}`, { signal: controller.signal }).then((reference) => {
      if (referenceRequestSequence.current === requestSequence) setSelectedWellReference(reference);
    }).catch((cause) => {
      if (controller.signal.aborted || referenceRequestSequence.current !== requestSequence) return;
      setSelectedWellReference(null); showError(cause);
    });
    return () => controller.abort();
  }, [plan?.id, selectedReferenceWell]);

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
      setCandidates([]); setExcluded([]); setPlan(null); setAnnualPlans([]); setNextMonthEvidence([]); setRebuildComplete(false);
      setMessage(`${source === 'stage' ? '阶段产油' : '注汽日数据'}已导入 ${result.rows.length} 行${result.skippedRows.length ? `,跳过 ${result.skippedRows.length} 行` : ''}。`);
    } catch (cause) { showError(cause); } finally { setBusySource(null); }
  }
  async function rebuild() {
    setRebuilding(true); setError(null);
    try {
      const result = await requestJson<{ candidates: Candidate[]; excluded: ExcludedCandidate[] }>('/api/injection-selection/rebuild', { method: 'POST' });
      setCandidates(result.candidates); setExcluded(result.excluded); setRebuildComplete(true); setMessage(`已重建 ${result.candidates.length} 口候选井。`);
    } catch (cause) { showError(cause); } finally { setRebuilding(false); }
  }
  async function generatePlan(mode: PlanMode) {
    if (!bothSourcesReady || !rebuildComplete) { setError('请先导入两份数据并成功重建候选井。'); return; }
    setGenerating(true); setError(null); setMessage(null);
    try {
      const created = await requestJson<NextMonthGeneration | YearEndGeneration>('/api/injection-selection/plans/generate', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ mode }) });
      if (created.mode === 'next-month') {
        setPlan(created.plan); setAnnualPlans([]); setNextMonthEvidence(created.evidence); setExcluded(created.excluded.map(({ wellNo, reason }) => ({ wellNo, reason })));
        setMessage(`已生成 ${created.plan.month} 注汽计划(${created.plan.items.length}/${created.plan.maxWells} 口)。`);
      } else {
        setPlan(null); setAnnualPlans(created.months); setNextMonthEvidence([]);
        const count = created.months.reduce((total, item) => total + item.items.length, 0);
        setMessage(`已生成至年末计划建议，共 ${count} 口。`);
      }
    } catch (cause) { showError(cause); } finally { setGenerating(false); }
  }
  function exportYearEndPlans() {
    const rows = [['计划月份', '计划日', '井号', '评分', '底产', '底产来源', '最小可注汽日期', '资格说明']];
    for (const monthPlan of annualPlans) for (const item of monthPlan.items) rows.push([monthPlan.month, monthPlan.planDate, item.wellNo, String(item.score), item.evidence.oilValue === null ? '' : String(item.evidence.oilValue), item.evidence.oilSource === 'predicted' ? '预测底产' : '最新实际底产', item.evidence.minimumEligibleDate ?? '', item.evidence.reason]);
    const csv = `\uFEFF${rows.map((row) => row.map((value) => `"${String(value).replaceAll('"', '""')}"`).join(',')).join('\r\n')}`;
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    const anchor = document.createElement('a'); anchor.href = url; anchor.download = '至年末注汽计划.csv'; anchor.click(); URL.revokeObjectURL(url);
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
      <p className="mt-1 text-sm text-slate-500">导入单位数据库导出的阶段产油和注汽日数据,重建候选井后生成每月最多 30 口井的可执行注汽计划。</p>
      <div className="mt-5 grid gap-4 md:grid-cols-2">
        {(['stage', 'daily'] as const).map((source) => { const stage = source === 'stage'; const status = sourceByType.get(source); return <div key={source} className="rounded border border-slate-200 p-4">
          <b>{stage ? '阶段产油' : '注汽日数据'}</b><p className="mt-1 text-xs text-slate-500">{status ? `${status.sourceFile} · ${status.rowCount} 行 · ${new Date(status.importedAt).toLocaleString()}` : '尚未导入'}</p>
          <label className="mt-3 inline-block cursor-pointer rounded bg-emerald-600 px-3 py-2 text-sm font-bold text-white"><input className="sr-only" type="file" accept=".xlsx,.xls" disabled={busySource !== null} onChange={(event) => void upload(source, event)} />{busySource === source ? '导入中…' : `导入${stage ? '阶段产油' : '注汽日数据'}`}</label>
        </div>; })}
      </div>
      {sources.some((source) => (source.skippedRowCount ?? 0) > 0 || (source.errorMessages?.length ?? 0) > 0) && <div className="mt-3 rounded border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">{sources.map((source) => <SelectionImportStatusLine key={`status-${source.sourceType}`} source={source} />)}</div>}
      <div className="mt-5 flex flex-wrap items-end gap-3"><button className="rounded border border-emerald-600 px-4 py-2 text-sm font-bold text-emerald-700 disabled:opacity-50" disabled={rebuilding || !bothSourcesReady} onClick={() => void rebuild()}>{rebuilding ? '重建中…' : '重建候选井'}</button><button className="rounded bg-emerald-600 px-4 py-2 text-sm font-bold text-white disabled:opacity-50" disabled={generating || !bothSourcesReady || !rebuildComplete} onClick={() => void generatePlan('next-month')}>{generating ? '生成中…' : '生成下个月计划'}</button><button className="rounded border border-emerald-600 px-4 py-2 text-sm font-bold text-emerald-700 disabled:opacity-50" disabled={generating || !bothSourcesReady || !rebuildComplete} onClick={() => void generatePlan('year-end')}>{generating ? '生成中…' : '生成至年末计划'}</button></div>
    </section>
    {!bothSourcesReady && <div className="rounded border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">{'\u8bf7\u5148\u5bfc\u5165\u9636\u6bb5\u4ea7\u6cb9\u548c\u6ce8\u6c7d\u65e5\u6570\u636e\uff0c\u624d\u80fd\u91cd\u5efa\u5019\u9009\u4e95\u3002'}</div>}{bothSourcesReady && !rebuildComplete && <div className="rounded border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">{'\u4e24\u4efd\u6570\u636e\u5df2\u9f50\u5168\uff0c\u8bf7\u6210\u529f\u91cd\u5efa\u5019\u9009\u4e95\u540e\u518d\u751f\u6210\u6ce8\u6c7d\u8ba1\u5212\u3002'}</div>}
    {error && <div className="rounded border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}{message && <div className="rounded border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">{message}</div>}
    {plan && selectablePlanItems.length > 0 && <SelectedWellReferencePanel planItems={plan.items} selectedWellNo={selectedReferenceWell} reference={selectedWellReference} onWellChange={setSelectedReferenceWell} />}
    {annualPlans.length > 0 && <section className="app-card overflow-hidden"><div className="app-card-header flex items-center justify-between gap-2"><div><h4 className="font-bold text-slate-800">至年末注汽计划建议</h4><p className="mt-1 text-sm text-slate-500">按每月 1 日计算；底产为基于同期周期的预测值。</p></div><button className="rounded border border-emerald-600 px-3 py-2 text-sm font-bold text-emerald-700" onClick={exportYearEndPlans}>导出至年末计划</button></div><div className="divide-y divide-slate-100">{annualPlans.map((monthPlan) => <div key={monthPlan.month} className="p-4"><h5 className="mb-3 font-bold text-slate-800">{monthPlan.month}（计划日 {monthPlan.planDate}）</h5>{monthPlan.items.length ? <div className="overflow-x-auto"><table className="w-full min-w-[920px] text-left text-sm"><thead className="bg-slate-50 text-xs text-slate-500"><tr><th className="px-3 py-2">井号</th><th className="px-3 py-2">评分</th><th className="px-3 py-2">预测底产</th><th className="px-3 py-2">底产来源</th><th className="px-3 py-2">最小可注汽日期</th><th className="px-3 py-2">资格说明</th></tr></thead><tbody>{monthPlan.items.map((item) => <tr key={item.wellNo} className="border-t border-slate-100"><td className="px-3 py-2 font-semibold">{item.wellNo}</td><td className="px-3 py-2">{item.score.toFixed(1)}</td><td className="px-3 py-2">{item.evidence.oilValue === null ? '缺失' : item.evidence.oilValue}</td><td className="px-3 py-2">预测底产</td><td className="px-3 py-2">{item.evidence.minimumEligibleDate ?? '无历史间隔限制'}</td><td className="px-3 py-2">{item.evidence.reason}</td></tr>)}</tbody></table></div> : <p className="text-sm text-amber-700">当月没有符合条件的候选井。</p>}{monthPlan.excluded.length > 0 && <p className="mt-2 text-xs text-slate-500">已排除 {monthPlan.excluded.length} 口：{monthPlan.excluded.slice(0, 3).map((item) => `${item.wellNo}（${item.evidence.reason}）`).join('；')}{monthPlan.excluded.length > 3 ? '…' : ''}</p>}</div>)}</div></section>}

    <section className="app-card overflow-hidden"><div className="app-card-header flex flex-wrap items-center justify-between gap-2"><div><h4 className="font-bold text-slate-800">候选井与月度注汽计划</h4><SelectionScoringExplanation /></div>{plan && <a className="rounded border border-emerald-600 px-3 py-2 text-sm font-bold text-emerald-700" href={`/api/injection-selection/plans/${plan.id}.xlsx`}>导出 Excel</a>}</div>
      {!plan ? <div className="p-5 text-sm text-slate-500">{candidates.length ? `已重建 ${candidates.length} 口候选井,请选择目标月份生成注汽计划。` : '请先导入两份数据并重建候选井。'}</div> : <div className="overflow-x-auto"><table className="w-full min-w-[1180px] text-left text-sm"><thead className="bg-slate-50 text-xs text-slate-500"><tr><th className="px-3 py-3">{'评分依据'}</th>{['顺序','井号','评分','油汽比','阶段产油'].map((name) => <th key={name} className="px-3 py-3">{name}</th>)}<th className="px-3 py-3">最新实际底产</th><th className="px-3 py-3">底产来源</th><th className="px-3 py-3">最小可注汽日期</th><th className="px-3 py-3">资格说明</th>{['建议注汽量','推荐锅炉','氮气','二氧化碳','人工决定','备注'].map((name) => <th key={name} className="px-3 py-3">{name}</th>)}</tr></thead><tbody className="divide-y divide-slate-100">{plan.items.map((item) => <tr key={item.id}><td className="px-3 py-3 text-xs text-slate-600"><SelectionScoreBreakdownText scoreBreakdown={item.scoreBreakdown} /></td><td className="px-3 py-3">{item.rankNo}</td><td className="px-3 py-3 font-semibold">{item.wellNo}</td><td className="px-3 py-3">{item.score.toFixed(1)}</td><td className="px-3 py-3">{item.oilSteamRatio.toFixed(3)}</td><td className="px-3 py-3">{item.stageOil}</td><td className="px-3 py-3">{evidenceByWell.get(item.wellNo)?.oilValue ?? '未提供'}</td><td className="px-3 py-3">{evidenceByWell.get(item.wellNo)?.oilSource === 'actual' ? '最新实际底产' : '未提供'}</td><td className="px-3 py-3">{evidenceByWell.get(item.wellNo)?.minimumEligibleDate ?? '无历史间隔限制'}</td><td className="px-3 py-3">{evidenceByWell.get(item.wellNo)?.reason ?? '未提供'}</td><td className="px-3 py-3"><input aria-label={`${item.wellNo}建议注汽量`} className="w-24 rounded border px-2 py-1" type="number" defaultValue={item.suggestedSteam ?? ''} onBlur={(event) => void patchItem(item, { suggestedSteam: event.target.value === '' ? null : Number(event.target.value) })} /></td><td className="px-3 py-3"><input aria-label={`${item.wellNo}推荐锅炉`} className="w-28 rounded border px-2 py-1" defaultValue={item.recommendedBoiler ?? ''} onBlur={(event) => void patchItem(item, { recommendedBoiler: event.target.value || null })} /></td><td className="px-3 py-3">{item.nitrogen ? '是' : '否'}</td><td className="px-3 py-3">{item.carbonDioxide ? '是' : '否'}</td><td className="px-3 py-3"><select aria-label={`${item.wellNo}人工决定`} className="rounded border px-2 py-1" value={item.decision} onChange={(event) => void patchItem(item, { decision: event.target.value as PlanDecision })}><option value="included">纳入</option><option value="locked">锁定</option><option value="excluded">剔除</option></select></td><td className="px-3 py-3"><input aria-label={`${item.wellNo}备注`} className="rounded border px-2 py-1" defaultValue={item.manualNote ?? ''} onBlur={(event) => void patchItem(item, { manualNote: event.target.value || null })} />{savingId === item.id && <small className="ml-1 text-slate-400">保存中…</small>}</td></tr>)}</tbody></table></div>}
    </section>
    {(excluded.length > 0 || candidates.some((candidate) => candidate.qualityReasons.length > 0)) && <section className="app-card overflow-hidden"><div className="app-card-header"><h4 className="font-bold text-slate-800">{'\u6392\u9664\u4e95\u4e0e\u6570\u636e\u8d28\u91cf\u63d0\u793a'}</h4></div><div className="divide-y divide-slate-100 text-sm">{excluded.map((item) => <div key={`excluded-${item.wellNo}`} className="px-4 py-3"><b>{item.wellNo}</b><span className="ml-3 text-amber-700">{item.reason}</span></div>)}{candidates.filter((candidate) => candidate.qualityReasons.length > 0).map((candidate) => <div key={`quality-${candidate.wellNo}`} className="px-4 py-3"><b>{candidate.wellNo}</b><span className="ml-3 text-amber-700">{candidate.qualityReasons.join('\uff1b')}</span></div>)}</div></section>}

  </div>;
}
