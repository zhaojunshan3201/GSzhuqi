import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import ReactECharts from 'echarts-for-react';
import type { EChartsOption } from 'echarts';
import { ChannelingTimeline } from './ChannelingTimeline.tsx';
import { channelingRequest, type ChannelingRole, type ChannelingWellProfile, type RelationDetail, type TrackingEvent } from '../lib/channelingTrackingApi.ts';
import { formatShanghaiBusinessDate } from '../lib/businessDate.ts';

type RelationFact = {
  id: number; channelingType: string; injectionWell: string; productionWell: string; reservoirLayer?: string; impactLevel?: string;
  confidence?: number | null; status?: string; source?: string; evidence?: string; owner?: string; project?: { id: number; name: string; block: string };
};
type DetailTab = 'overview' | 'metrics' | 'evaluation' | 'timeline';
type EvaluationDraft = { beforeStart: string; splitDate: string; afterEnd: string; conclusion: string; evidence: string; owner: string };
export type ChannelingRelationDetailProps = { role: ChannelingRole; relationId: number; onOpenWell: (wellId: number) => void; onBack: () => void };

const statusLabels: Record<string, string> = { confirmed: '已确认', suspected: '疑似', released: '已解除' };
const sourceLabels: Record<string, string> = { manual: '手工录入', import: '导入', identified: '识别' };
const typeLabels: Record<string, string> = { steam: '注汽窜', nitrogen: '注氮气窜' };
const value = (item: unknown) => item === null || item === undefined || item === '' ? '暂无数据' : String(item);
const dateShift = (date: string, days: number) => { const parsed = new Date(`${date}T00:00:00Z`); parsed.setUTCDate(parsed.getUTCDate() + days); return parsed.toISOString().slice(0, 10); };
export function defaultRelationComparisonRange(now = new Date()): Pick<EvaluationDraft, 'beforeStart' | 'splitDate' | 'afterEnd'> {
  const afterEnd = formatShanghaiBusinessDate(now); return { beforeStart: dateShift(afterEnd, -30), splitDate: dateShift(afterEnd, -15), afterEnd };
}
const blankEvaluation = (): EvaluationDraft => ({ ...defaultRelationComparisonRange(), conclusion: '', evidence: '', owner: '' });

function buildRelationChart(detail: RelationDetail): EChartsOption {
  const dates = [...new Set([...detail.producerSeries.map((row) => row.date), ...detail.injector.injection!.stages.flatMap((stage) => [stage.startDate])])].sort();
  const production = new Map(detail.producerSeries.map((row) => [row.date, row]));
  const steam = new Map((detail.injector.injection?.stages || []).map((stage) => [stage.startDate, stage.steamVolume]));
  return { tooltip: { trigger: 'axis' }, legend: { data: ['注汽量', '日产油', '日产液', '含水'] }, xAxis: { type: 'category', data: dates }, yAxis: [{ type: 'value', name: '产量 / 注汽量' }, { type: 'value', name: '含水', axisLabel: { formatter: '{value}%' } }], series: [
    { name: '注汽量', type: 'bar', data: dates.map((date) => steam.get(date) ?? null) },
    { name: '日产油', type: 'line', connectNulls: true, data: dates.map((date) => production.get(date)?.oil ?? null) },
    { name: '日产液', type: 'line', connectNulls: true, data: dates.map((date) => production.get(date)?.liquid ?? null) },
    { name: '含水', type: 'line', yAxisIndex: 1, connectNulls: true, data: dates.map((date) => production.get(date)?.waterCut == null ? null : Number(production.get(date)!.waterCut) * 100) },
  ] };
}

export function ChannelingRelationDetail({ role, relationId, onOpenWell, onBack }: ChannelingRelationDetailProps) {
  const [detail, setDetail] = useState<RelationDetail | null>(null);
  const [fact, setFact] = useState<RelationFact | null>(null);
  const [wellIds, setWellIds] = useState<{ injector?: number; producer?: number }>({});
  const [loading, setLoading] = useState(true); const [error, setError] = useState(''); const [tab, setTab] = useState<DetailTab>('overview');
  const [draft, setDraft] = useState<EvaluationDraft>(blankEvaluation); const [evaluationError, setEvaluationError] = useState('');
  const [submitting, setSubmitting] = useState(false); const [saved, setSaved] = useState<TrackingEvent | null>(null);
  const generation = useRef(0); const mutation = useRef(0); const submittingRef = useRef(false); const relationRef = useRef(relationId); relationRef.current = relationId;
  const loadController = useRef<AbortController | null>(null);

  const load = useCallback(async () => {
    const current = ++generation.current; loadController.current?.abort(); const controller = new AbortController(); loadController.current = controller; setLoading(true); setError(''); setDetail(null); setFact(null); setWellIds({});
    try {
      const range = defaultRelationComparisonRange(); const query = new URLSearchParams(range);
      const next = await channelingRequest<RelationDetail>(`/api/channeling-relations/${relationId}/detail?${query}`, { signal: controller.signal });
      if (generation.current !== current) return;
      if (!next) { setLoading(false); return; }
      setDetail(next); setDraft((existing) => ({ ...existing, ...next.range }));
      const lookup = async (wellNo: string) => {
        const profiles = await channelingRequest<ChannelingWellProfile[]>(`/api/channeling-wells?${new URLSearchParams({ query: wellNo })}`, { signal: controller.signal });
        return profiles.find((profile) => profile.normalizedWellNo === wellNo.trim().toUpperCase() || profile.wellNo.trim().toUpperCase() === wellNo.trim().toUpperCase());
      };
      try {
        const [injector, producer] = await Promise.all([lookup(next.injectionWell), lookup(next.productionWell)]);
        if (generation.current !== current) return;
        setWellIds({ injector: injector?.id, producer: producer?.id });
        if (injector) {
          const relations = await channelingRequest<RelationFact[]>(`/api/channeling-wells/${injector.id}/relations`, { signal: controller.signal });
          if (generation.current === current) setFact(relations.find((item) => item.id === relationId) || null);
        }
      } catch (lookupError) {
        if (controller.signal.aborted || generation.current !== current) return;
      }
    } catch (loadError) {
      if (!controller.signal.aborted && generation.current === current) setError(loadError instanceof Error ? loadError.message : '关系详情加载失败');
    } finally { if (generation.current === current) setLoading(false); }
  }, [relationId]);

  useEffect(() => {
    mutation.current++; submittingRef.current = false; setSubmitting(false); setSaved(null); setEvaluationError(''); setDraft(blankEvaluation()); setTab('overview');
    void load();
    return () => { generation.current++; mutation.current++; submittingRef.current = false; loadController.current?.abort(); };
  }, [load]);

  const submitEvaluation = async (event: FormEvent) => {
    event.preventDefault(); if (submittingRef.current) return;
    const controls = (event.currentTarget as HTMLFormElement).elements;
    const field = (name: string) => (controls.namedItem(name) as HTMLInputElement | HTMLTextAreaElement | null)?.value || '';
    const submitted: EvaluationDraft = { beforeStart: field('beforeStart'), splitDate: field('splitDate'), afterEnd: field('afterEnd'), conclusion: field('conclusion'), evidence: field('evidence'), owner: field('owner') };
    if (!(submitted.beforeStart < submitted.splitDate && submitted.splitDate < submitted.afterEnd)) { setEvaluationError('日期顺序必须为评价前开始日 < 分界日 < 评价后结束日。'); return; }
    const token = ++mutation.current; const activeRelation = relationId; submittingRef.current = true; setSubmitting(true); setEvaluationError('');
    try {
      const created = await channelingRequest<TrackingEvent>(`/api/channeling-relations/${relationId}/evaluations`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ occurredOn: submitted.afterEnd, conclusion: submitted.conclusion.trim(), evidence: submitted.evidence.trim(), owner: submitted.owner.trim(), range: { beforeStart: submitted.beforeStart, splitDate: submitted.splitDate, afterEnd: submitted.afterEnd } }) });
      if (mutation.current !== token || relationRef.current !== activeRelation) return;
      setSaved(created); setDraft((current) => ({ ...current, conclusion: '', evidence: '', owner: '' }));
    } catch (submitError) { if (mutation.current === token && relationRef.current === activeRelation) setEvaluationError(submitError instanceof Error ? submitError.message : '效果评价保存失败'); }
    finally { if (mutation.current === token && relationRef.current === activeRelation) { submittingRef.current = false; setSubmitting(false); } }
  };
  const chart = useMemo(() => detail?.injector.injection ? buildRelationChart(detail) : null, [detail]);
  const jsdom = typeof navigator !== 'undefined' && /jsdom/i.test(navigator.userAgent);

  if (loading) return <section className="app-card p-5"><p role="status">正在加载关系详情…</p></section>;
  if (error) return <section className="app-card p-5"><p role="alert">{error} <button type="button" onClick={() => void load()}>重试</button></p></section>;
  if (!detail) return <section className="app-card p-5"><p>暂无关系详情。</p><button type="button" onClick={onBack}>返回</button></section>;
  const snapshot = saved?.metricsSnapshot as RelationDetail | null;
  return <section aria-label="注窜关系详情" className="page-stack">
    <header className="app-card p-5"><button type="button" onClick={onBack} className="text-sm text-slate-600">← 返回</button><h2 className="mt-3 text-xl font-bold">{detail.injectionWell} → {detail.productionWell}</h2><div className="mt-3 flex flex-wrap gap-2"><button type="button" disabled={!wellIds.injector} onClick={() => wellIds.injector && onOpenWell(wellIds.injector)}>注入井：{detail.injectionWell}</button><button type="button" disabled={!wellIds.producer} onClick={() => wellIds.producer && onOpenWell(wellIds.producer)}>生产井：{detail.productionWell}</button></div>
      <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-3"><div><dt>关系状态</dt><dd>{statusLabels[fact?.status || ''] || value(fact?.status)}</dd></div><div><dt>关系类型</dt><dd>{typeLabels[fact?.channelingType || ''] || value(fact?.channelingType)}</dd></div><div><dt>来源</dt><dd>{sourceLabels[fact?.source || ''] || value(fact?.source)}</dd></div><div><dt>层系</dt><dd>{value(fact?.reservoirLayer)}</dd></div><div><dt>证据</dt><dd>{value(fact?.evidence)}</dd></div><div><dt>负责人</dt><dd>{value(fact?.owner)}</dd></div></dl>
    </header>
    <nav aria-label="关系详情模块" className="app-card flex flex-wrap gap-2 p-3">{([['overview', '关系概览'], ['metrics', '联动指标'], ['evaluation', '效果评价'], ['timeline', '跟踪记录']] as const).map(([key, label]) => <button type="button" key={key} aria-pressed={tab === key} onClick={() => setTab(key)} className="action-button">{label}</button>)}</nav>
    {tab === 'overview' && <section className="app-card p-5"><h3 className="font-bold">关系概览</h3><p className="mt-2">项目：{value(fact?.project?.name)} · 区块：{value(fact?.project?.block)} · 置信度：{value(fact?.confidence)}</p></section>}
    {tab === 'metrics' && <section className="app-card p-5"><h3 className="font-bold">注采联动指标</h3><p className="mt-1 text-sm text-slate-500">查询时间：{detail.generatedAt} · 指标区间：{detail.range.beforeStart} 至 {detail.range.afterEnd}</p>
      {!detail.injector.injection && <p>缺少注入数据。</p>}{!detail.producerSeries.length && <p>缺少生产数据。</p>}
      {chart && (jsdom ? <div aria-label="注采联动图表">注汽量 · 日产油 · 日产液 · 含水</div> : <ReactECharts option={chart} style={{ height: 360 }} />)}
      <div className="mt-4 grid gap-3 sm:grid-cols-4"><div>累计注汽量：{value(detail.injector.injection?.cumulativeSteam)}</div><div>日产油变化：{value(detail.comparison.oil.change)}</div><div>日产液变化：{value(detail.comparison.liquid.change)}</div><div>含水变化：{value(detail.comparison.waterCut.change)}</div></div>
      {!!detail.producerSeries.length && <table className="mt-4 w-full text-sm"><thead><tr><th>日期</th><th>注汽量</th><th>日产油</th><th>日产液</th><th>含水</th></tr></thead><tbody>{detail.producerSeries.map((row) => <tr key={row.date}><td>{row.date}</td><td>{detail.injector.injection?.stages.find((stage) => stage.startDate === row.date)?.steamVolume ?? '—'}</td><td>{value(row.oil)}</td><td>{value(row.liquid)}</td><td>{value(row.waterCut)}</td></tr>)}</tbody></table>}
    </section>}
    {tab === 'evaluation' && <section className="app-card p-5"><h3 className="font-bold">效果评价</h3>{role === 'admin' ? <form aria-label="新增效果评价" onSubmit={submitEvaluation} className="mt-4 grid gap-3 md:grid-cols-3">{(['beforeStart', 'splitDate', 'afterEnd'] as const).map((name) => <label key={name}>{name === 'beforeStart' ? '评价前开始日' : name === 'splitDate' ? '分界日' : '评价后结束日'}<input required type="date" name={name} value={draft[name]} onInput={(e) => { const next = e.currentTarget.value; setDraft((current) => ({ ...current, [name]: next })); }} className="field-control" /></label>)}<label className="md:col-span-3">评价结论<textarea required name="conclusion" value={draft.conclusion} onInput={(e) => { const next = e.currentTarget.value; setDraft((current) => ({ ...current, conclusion: next })); }} className="field-control" /></label><label>证据<input name="evidence" value={draft.evidence} onInput={(e) => { const next = e.currentTarget.value; setDraft((current) => ({ ...current, evidence: next })); }} className="field-control" /></label><label>负责人<input required name="owner" value={draft.owner} onInput={(e) => { const next = e.currentTarget.value; setDraft((current) => ({ ...current, owner: next })); }} className="field-control" /></label>{evaluationError && <p role="alert" className="text-red-700 md:col-span-3">{evaluationError}</p>}<button type="submit" disabled={submitting} className="action-button action-primary md:col-span-3">{submitting ? '保存中…' : '保存效果评价'}</button></form> : <p className="mt-3 text-sm text-slate-500">游客只读，可查看已形成的评价记录。</p>}
      {saved && <article className="mt-5 rounded border border-emerald-200 bg-emerald-50 p-4"><h4 className="font-bold">已保存评价快照</h4><p>{saved.content}</p><p>指标区间：{snapshot?.range.beforeStart || saved.occurredOn} 至 {snapshot?.range.afterEnd || saved.occurredOn}</p><p>日产油变化：{value(snapshot?.comparison.oil.change)} · 日产液变化：{value(snapshot?.comparison.liquid.change)} · 含水变化：{value(snapshot?.comparison.waterCut.change)}</p></article>}
    </section>}
    {tab === 'timeline' && <section className="app-card p-5"><ChannelingTimeline role={role} subject={{ subjectType: 'relation', subjectId: relationId }} /></section>}
  </section>;
}
