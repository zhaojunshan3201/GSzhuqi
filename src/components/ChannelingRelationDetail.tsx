import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import ReactECharts from 'echarts-for-react';
import type { EChartsOption } from 'echarts';
import { ChannelingTimeline } from './ChannelingTimeline.tsx';
import { channelingRequest, type ChannelingRole, type ChannelingWellProfile, type RelationDetail, type TrackingEvent } from '../lib/channelingTrackingApi.ts';
import { formatShanghaiBusinessDate } from '../lib/businessDate.ts';

type RelationFact = {
  id: number; channelingType: string; injectionWell: string; productionWell: string; reservoirLayer?: string; impactLevel?: string;
  confidence?: number | null; status?: string; source?: string; evidence?: string; effectiveStartDate?: string | null; effectiveEndDate?: string | null; owner?: string; project?: { id: number; name: string; block: string };
};
type DetailTab = 'overview' | 'metrics' | 'evaluation' | 'timeline';
const detailTabs: ReadonlyArray<readonly [DetailTab, string]> = [['overview', '关系概览'], ['metrics', '联动指标'], ['evaluation', '效果评价'], ['timeline', '跟踪记录']];
type EvaluationDraft = { beforeStart: string; splitDate: string; afterEnd: string; conclusion: string; evidence: string; owner: string };
export type ChannelingRelationDetailProps = { role: ChannelingRole; relationId: number; onOpenWell: (wellId: number) => void; onBack: () => void };

const statusLabels: Record<string, string> = { confirmed: '已确认', suspected: '疑似', released: '已解除' };
const sourceLabels: Record<string, string> = { manual: '手工录入', import: '导入', suspected: '疑似识别' };
const typeLabels: Record<string, string> = { steam: '注汽窜', nitrogen: '注氮气窜' };
const impactLabels: Record<string, string> = { high: '高', medium: '中', low: '低' };
const value = (item: unknown) => item === null || item === undefined || item === '' ? '暂无数据' : String(item);
const dateShift = (date: string, days: number) => { const parsed = new Date(`${date}T00:00:00Z`); parsed.setUTCDate(parsed.getUTCDate() + days); return parsed.toISOString().slice(0, 10); };
const isBusinessDate = (date: unknown): date is string => { if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return false; try { return dateShift(date, 0) === date; } catch { return false; } };
export function evaluationRangeAroundSplit(splitDate: string): Pick<EvaluationDraft, 'beforeStart' | 'splitDate' | 'afterEnd'> { return { beforeStart: dateShift(splitDate, -30), splitDate, afterEnd: dateShift(splitDate, 30) }; }
export function defaultRelationComparisonRange(now = new Date()): Pick<EvaluationDraft, 'beforeStart' | 'splitDate' | 'afterEnd'> { return evaluationRangeAroundSplit(formatShanghaiBusinessDate(now)); }
const blankEvaluation = (): EvaluationDraft => ({ ...defaultRelationComparisonRange(), conclusion: '', evidence: '', owner: '' });

export type EvaluationLineage = { root: TrackingEvent; current: TrackingEvent | null };
const correctionChildren = (events: TrackingEvent[]) => {
  const correctionsByParent = new Map<number, TrackingEvent[]>();
  for (const event of events) {
    if (event.eventType !== 'corrected' || !Number.isInteger(event.supersedesEventId) || Number(event.supersedesEventId) <= 0) continue;
    const children = correctionsByParent.get(Number(event.supersedesEventId)) || [];
    children.push(event);
    correctionsByParent.set(Number(event.supersedesEventId), children);
  }
  return correctionsByParent;
};
const currentCorrectedDescendant = (root: TrackingEvent, correctionsByParent: Map<number, TrackingEvent[]>): TrackingEvent | null => {
  let current: TrackingEvent | null = root.voidedAt ? null : root;
  let currentDepth = 0;
  const visited = new Set<number>([root.id]);
  const pending = (correctionsByParent.get(root.id) || []).map((event) => ({ event, depth: 1 }));
  while (pending.length) {
    const next = pending.pop()!;
    if (visited.has(next.event.id)) continue;
    visited.add(next.event.id);
    if (!next.event.voidedAt && (next.depth > currentDepth
      || (next.depth === currentDepth && (next.event.createdAt.localeCompare(current?.createdAt || '') > 0
        || (next.event.createdAt === current?.createdAt && next.event.id > (current?.id || 0)))))) {
      current = next.event;
      currentDepth = next.depth;
    }
    for (const child of correctionsByParent.get(next.event.id) || []) pending.push({ event: child, depth: next.depth + 1 });
  }
  return current;
};
export function buildEvaluationLineages(events: TrackingEvent[]): EvaluationLineage[] {
  const correctionsByParent = correctionChildren(events);
  return events.filter((event) => event.eventType === 'evaluated').map((root) => ({ root, current: currentCorrectedDescendant(root, correctionsByParent) }));
}
export function latestEffectiveTrackingDate(events: TrackingEvent[], eventType: TrackingEvent['eventType']): string | null {
  const correctionsByParent = correctionChildren(events);
  const current = events.filter((event) => event.eventType === eventType)
    .map((root) => currentCorrectedDescendant(root, correctionsByParent))
    .filter((event): event is TrackingEvent => Boolean(event) && isBusinessDate(event!.occurredOn))
    .sort((a, b) => b.occurredOn.localeCompare(a.occurredOn) || b.createdAt.localeCompare(a.createdAt) || b.id - a.id)[0];
  return current?.occurredOn || null;
}

const waterCutPercent = (raw: number | null | undefined) => raw == null || !Number.isFinite(raw) ? null : Math.abs(raw) <= 1 ? raw * 100 : raw;
export type AlignedRelationRow = { date: string; steamVolume: number | null; oil: number | null; liquid: number | null; waterCutPercent: number | null };
export function buildAlignedRelationRows(detail: RelationDetail): AlignedRelationRow[] {
  const steam = new Map<string, number | null>();
  for (const stage of detail.injector.injection?.stages || []) {
    const previous = steam.get(stage.startDate); steam.set(stage.startDate, stage.steamVolume == null ? previous ?? null : (previous ?? 0) + stage.steamVolume);
  }
  const production = new Map(detail.producerSeries.map((row) => [row.date, row]));
  return [...new Set([...steam.keys(), ...production.keys()])].sort().map((date) => ({ date, steamVolume: steam.get(date) ?? null, oil: production.get(date)?.oil ?? null, liquid: production.get(date)?.liquid ?? null, waterCutPercent: waterCutPercent(production.get(date)?.waterCut) }));
}
export function buildRelationChart(detail: RelationDetail): EChartsOption {
  const rows = buildAlignedRelationRows(detail);
  const points = (field: keyof Omit<AlignedRelationRow, 'date'>) => rows.map((row) => [row.date, row[field]]);
  return { tooltip: { trigger: 'axis' }, legend: { data: ['注汽量', '日产油', '日产液', '含水'] }, xAxis: { type: 'time' }, yAxis: [{ type: 'value', name: '产量 / 注汽量' }, { type: 'value', name: '含水(%)', min: 0, max: 100, axisLabel: { formatter: '{value}%' } }], series: [
    { name: '注汽量', type: 'bar', data: points('steamVolume') },
    { name: '日产油', type: 'line', connectNulls: false, data: points('oil') },
    { name: '日产液', type: 'line', connectNulls: false, data: points('liquid') },
    { name: '含水', type: 'line', yAxisIndex: 1, connectNulls: false, data: points('waterCutPercent') },
  ] };
}

const isRecord = (raw: unknown): raw is Record<string, unknown> => Boolean(raw) && typeof raw === 'object' && !Array.isArray(raw);
function relationSnapshot(raw: unknown): RelationDetail | null {
  if (!isRecord(raw)) return null;
  const candidate = raw as Partial<RelationDetail>;
  if (!isRecord(candidate.range) || typeof candidate.range.beforeStart !== 'string' || typeof candidate.range.splitDate !== 'string' || typeof candidate.range.afterEnd !== 'string') return null;
  return candidate as RelationDetail;
}
const snapshotMetric = (snapshot: RelationDetail, name: 'oil' | 'liquid' | 'waterCut') => {
  const comparison = isRecord(snapshot.comparison) ? snapshot.comparison : null; const metric = comparison?.[name]; return isRecord(metric) ? metric as unknown as RelationDetail['comparison']['oil'] : undefined;
};
const snapshotIsPartial = (snapshot: RelationDetail) => !isRecord(snapshot.injector) || !Array.isArray(snapshot.producerSeries) || !isRecord(snapshot.comparison)
  || (['oil', 'liquid', 'waterCut'] as const).some((name) => !snapshotMetric(snapshot, name));
const snapshotMetricValue = (raw: number | null | undefined, percent = false) => {
  const normalized = percent ? waterCutPercent(raw) : raw; return normalized == null ? '缺失' : `${Number(normalized.toFixed(3))}${percent ? '%' : ''}`;
};
function EvaluationSnapshot({ lineage, role, busy, recomputing, onRecompute }: { lineage: EvaluationLineage; role: ChannelingRole; busy: boolean; recomputing: boolean; onRecompute: () => void }) {
  const { root, current } = lineage;
  const displayed = current || root;
  const snapshot = relationSnapshot(root.metricsSnapshot);
  if (!snapshot) return <article data-evaluation-event className="rounded border border-amber-200 p-4"><h4 className="font-bold">{displayed.content}</h4><p className="text-sm text-slate-500">{displayed.occurredOn} · 负责人：{displayed.owner} · 证据：{displayed.evidence || '未提供'}</p><p>该评价没有可读取的指标快照。</p></article>;
  const missing = [...(!snapshot.injector?.injection ? ['注汽数据'] : []), ...(!snapshot.producerSeries?.length ? ['生产数据'] : [])];
  for (const [label, name] of [['日产油', 'oil'], ['日产液', 'liquid'], ['含水', 'waterCut']] as const) {
    const metric = snapshotMetric(snapshot, name);
    if (metric?.beforeAverage == null) missing.push(`${label}评价前均值`);
    if (metric?.afterAverage == null) missing.push(`${label}评价后均值`);
    if (metric?.change == null) missing.push(`${label}变化量`);
    if (metric?.beforeValidDays == null) missing.push(`${label}评价前有效天数`);
    if (metric?.afterValidDays == null) missing.push(`${label}评价后有效天数`);
  }
  return <article data-evaluation-event className="rounded border border-slate-200 p-4"><div className="flex flex-wrap items-start justify-between gap-2"><div><h4 className="font-bold">{displayed.content}</h4><p className="text-sm text-slate-500">{displayed.occurredOn} · 负责人：{displayed.owner} · 证据：{displayed.evidence || '未提供'}</p>{displayed.id !== root.id && <p className="text-sm text-amber-700">当前展示更正后的评价内容，指标快照与评价范围保留自原评价。</p>}{!current && <p className="text-sm text-slate-500">该评价已作废，暂无有效更正记录。</p>}</div>{role === 'admin' && current && <button type="button" disabled={busy} onClick={onRecompute}>{recomputing ? '重新计算中…' : '按最新数据重新计算'}</button>}</div>
    <p className="mt-2 text-sm">快照查询时间：{value(snapshot.generatedAt)} · 范围：{snapshot.range.beforeStart} / {snapshot.range.splitDate} / {snapshot.range.afterEnd}</p>{snapshotIsPartial(snapshot) && <p className="text-sm text-amber-700">该历史快照为旧版或不完整格式，部分字段不可用。</p>}<p className="text-sm">数据来源：{snapshot.injector?.injection ? '注汽阶段数据' : '注汽数据缺失'}、{snapshot.producerSeries?.length ? '生产日报' : '生产数据缺失'}</p>
    <div className="mt-3 overflow-auto"><table className="w-full text-sm"><thead><tr><th>指标</th><th>评价前</th><th>评价后</th><th>变化量</th><th>有效天数（前/后）</th></tr></thead><tbody>{([['日产油', 'oil', false], ['日产液', 'liquid', false], ['含水', 'waterCut', true]] as const).map(([label, name, percent]) => { const metric = snapshotMetric(snapshot, name); return <tr key={name}><td>{label}</td><td>{snapshotMetricValue(metric?.beforeAverage, percent)}</td><td>{snapshotMetricValue(metric?.afterAverage, percent)}</td><td>{snapshotMetricValue(metric?.change, percent)}</td><td>{metric?.beforeValidDays ?? '缺失'} / {metric?.afterValidDays ?? '缺失'}</td></tr>; })}</tbody></table></div>
    <p className="mt-2 text-sm">缺失字段：{missing.length ? missing.join('、') : '无'}</p>
  </article>;
}

export function ChannelingRelationDetail({ role, relationId, onOpenWell, onBack }: ChannelingRelationDetailProps) {
  const [detail, setDetail] = useState<RelationDetail | null>(null);
  const [fact, setFact] = useState<RelationFact | null>(null);
  const [wellIds, setWellIds] = useState<{ injector?: number; producer?: number }>({});
  const [factsLoading, setFactsLoading] = useState(false); const [factsError, setFactsError] = useState(''); const [factsResolved, setFactsResolved] = useState(false);
  const [loading, setLoading] = useState(true); const [error, setError] = useState(''); const [tab, setTab] = useState<DetailTab>('overview');
  const [draft, setDraft] = useState<EvaluationDraft>(blankEvaluation); const [evaluationError, setEvaluationError] = useState('');
  const [evaluationBusy, setEvaluationBusy] = useState(false); const [evaluationBusyTarget, setEvaluationBusyTarget] = useState<'new' | number | null>(null); const [saved, setSaved] = useState<TrackingEvent | null>(null);
  const [evaluations, setEvaluations] = useState<TrackingEvent[]>([]); const [evaluationsLoading, setEvaluationsLoading] = useState(false); const [evaluationsError, setEvaluationsError] = useState('');
  const [eventsSettled, setEventsSettled] = useState(false); const [latestExecutedOn, setLatestExecutedOn] = useState<string | null>(null); const [recomputeError, setRecomputeError] = useState('');
  const primaryGeneration = useRef(0); const factsGeneration = useRef(0); const evaluationsGeneration = useRef(0); const writeToken = useRef(0); const evaluationBusyRef = useRef(false); const draftDirty = useRef(false); const relationRef = useRef(relationId); relationRef.current = relationId;
  const loadController = useRef<AbortController | null>(null);
  const factsController = useRef<AbortController | null>(null); const evaluationsController = useRef<AbortController | null>(null);
  const tabRefs = useRef(new Map<DetailTab, HTMLButtonElement>());
  const selectTabByKeyboard = (event: ReactKeyboardEvent<HTMLButtonElement>, current: DetailTab) => {
    const currentIndex = detailTabs.findIndex(([key]) => key === current);
    let nextIndex: number | null = null;
    if (event.key === 'ArrowRight' || event.key === 'ArrowDown') nextIndex = (currentIndex + 1) % detailTabs.length;
    else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') nextIndex = (currentIndex - 1 + detailTabs.length) % detailTabs.length;
    else if (event.key === 'Home') nextIndex = 0;
    else if (event.key === 'End') nextIndex = detailTabs.length - 1;
    if (nextIndex === null) return;
    event.preventDefault();
    const next = detailTabs[nextIndex][0];
    setTab(next);
    tabRefs.current.get(next)?.focus();
  };

  const loadFacts = useCallback(async (next: RelationDetail) => {
    const requestGeneration = ++factsGeneration.current; const activeRelation = relationId;
    factsController.current?.abort(); const controller = new AbortController(); factsController.current = controller; setFactsLoading(true); setFactsError(''); setFactsResolved(false); setFact(null); setWellIds({});
    try {
      const lookup = async (wellNo: string) => {
        const profiles = await channelingRequest<ChannelingWellProfile[]>(`/api/channeling-wells?${new URLSearchParams({ query: wellNo })}`, { signal: controller.signal });
        return profiles.find((profile) => profile.normalizedWellNo === wellNo.trim().toUpperCase() || profile.wellNo.trim().toUpperCase() === wellNo.trim().toUpperCase());
      };
      const [injector, producer] = await Promise.all([lookup(next.injectionWell), lookup(next.productionWell)]);
      if (controller.signal.aborted || factsGeneration.current !== requestGeneration || relationRef.current !== activeRelation) return;
      setWellIds({ injector: injector?.id, producer: producer?.id });
      const profile = injector || producer;
      if (profile) {
        const relations = await channelingRequest<RelationFact[]>(`/api/channeling-wells/${profile.id}/relations`, { signal: controller.signal });
        if (controller.signal.aborted || factsGeneration.current !== requestGeneration || relationRef.current !== activeRelation) return;
        setFact(relations.find((item) => item.id === relationId) || null);
      }
      setFactsResolved(true);
    } catch (lookupError) {
      if (!controller.signal.aborted && factsGeneration.current === requestGeneration && relationRef.current === activeRelation) setFactsError(lookupError instanceof Error ? lookupError.message : '关系基础信息加载失败');
    } finally { if (!controller.signal.aborted && factsGeneration.current === requestGeneration && relationRef.current === activeRelation) setFactsLoading(false); }
  }, [relationId]);

  const loadEvaluations = useCallback(async () => {
    const requestGeneration = ++evaluationsGeneration.current; const activeRelation = relationId;
    evaluationsController.current?.abort(); const controller = new AbortController(); evaluationsController.current = controller; setEvaluationsLoading(true); setEvaluationsError('');
    try {
      const query = new URLSearchParams({ subjectType: 'relation', subjectId: String(relationId) });
      const events = await channelingRequest<TrackingEvent[]>(`/api/channeling-tracking-events?${query}`, { signal: controller.signal });
      if (!controller.signal.aborted && evaluationsGeneration.current === requestGeneration && relationRef.current === activeRelation) {
        setEvaluations(events);
        setLatestExecutedOn(latestEffectiveTrackingDate(events, 'executed'));
      }
    } catch (eventsError) { if (!controller.signal.aborted && evaluationsGeneration.current === requestGeneration && relationRef.current === activeRelation) { setEvaluations([]); setLatestExecutedOn(null); setEvaluationsError(eventsError instanceof Error ? eventsError.message : '历史评价加载失败'); } }
    finally { if (!controller.signal.aborted && evaluationsGeneration.current === requestGeneration && relationRef.current === activeRelation) { setEvaluationsLoading(false); setEventsSettled(true); } }
  }, [relationId]);

  const load = useCallback(async () => {
    const current = ++primaryGeneration.current; const activeRelation = relationId; loadController.current?.abort(); const controller = new AbortController(); loadController.current = controller; setLoading(true); setError(''); setDetail(null);
    try {
      const range = defaultRelationComparisonRange(); const query = new URLSearchParams(range);
      const next = await channelingRequest<RelationDetail>(`/api/channeling-relations/${relationId}/detail?${query}`, { signal: controller.signal });
      if (primaryGeneration.current !== current || relationRef.current !== activeRelation) return;
      if (!next) { setLoading(false); return; }
      setDetail(next); void loadFacts(next);
    } catch (loadError) {
      if (!controller.signal.aborted && primaryGeneration.current === current && relationRef.current === activeRelation) setError(loadError instanceof Error ? loadError.message : '关系详情加载失败');
    } finally { if (primaryGeneration.current === current && relationRef.current === activeRelation) setLoading(false); }
  }, [loadFacts, relationId]);

  useEffect(() => {
    writeToken.current++; evaluationBusyRef.current = false; draftDirty.current = false; setEvaluationBusy(false); setEvaluationBusyTarget(null); setSaved(null); setEvaluationError(''); setRecomputeError(''); setDraft(blankEvaluation()); setTab('overview'); setFact(null); setWellIds({}); setFactsError(''); setFactsResolved(false); setEvaluations([]); setEventsSettled(false); setLatestExecutedOn(null);
    void load(); void loadEvaluations();
    return () => { primaryGeneration.current++; factsGeneration.current++; evaluationsGeneration.current++; writeToken.current++; evaluationBusyRef.current = false; loadController.current?.abort(); factsController.current?.abort(); evaluationsController.current?.abort(); };
  }, [load, loadEvaluations]);

  useEffect(() => {
    if (draftDirty.current || !eventsSettled || (!factsResolved && !factsError)) return;
    const effective = fact?.effectiveStartDate; const validEffective = isBusinessDate(effective);
    const split = latestExecutedOn || (validEffective ? effective : formatShanghaiBusinessDate(new Date())); setDraft((current) => ({ ...current, ...evaluationRangeAroundSplit(split) }));
  }, [eventsSettled, fact?.effectiveStartDate, factsError, factsResolved, latestExecutedOn]);

  const submitEvaluation = async (event: FormEvent) => {
    event.preventDefault(); if (evaluationBusyRef.current) return;
    const controls = (event.currentTarget as HTMLFormElement).elements;
    const field = (name: string) => (controls.namedItem(name) as HTMLInputElement | HTMLTextAreaElement | null)?.value || '';
    const submitted: EvaluationDraft = { beforeStart: field('beforeStart'), splitDate: field('splitDate'), afterEnd: field('afterEnd'), conclusion: field('conclusion'), evidence: field('evidence'), owner: field('owner') };
    if (!(submitted.beforeStart < submitted.splitDate && submitted.splitDate < submitted.afterEnd)) { setEvaluationError('日期顺序必须为评价前开始日 < 分界日 < 评价后结束日。'); return; }
    const token = ++writeToken.current; const activeRelation = relationId; evaluationBusyRef.current = true; setEvaluationBusy(true); setEvaluationBusyTarget('new'); setEvaluationError('');
    try {
      const created = await channelingRequest<TrackingEvent>(`/api/channeling-relations/${relationId}/evaluations`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ occurredOn: submitted.afterEnd, conclusion: submitted.conclusion.trim(), evidence: submitted.evidence.trim(), owner: submitted.owner.trim(), range: { beforeStart: submitted.beforeStart, splitDate: submitted.splitDate, afterEnd: submitted.afterEnd } }) });
      if (writeToken.current !== token || relationRef.current !== activeRelation) return;
      setSaved(created); draftDirty.current = false; setDraft((current) => ({ ...current, conclusion: '', evidence: '', owner: '' })); await loadEvaluations();
    } catch (submitError) { if (writeToken.current === token && relationRef.current === activeRelation) setEvaluationError(submitError instanceof Error ? submitError.message : '效果评价保存失败'); }
    finally { if (writeToken.current === token && relationRef.current === activeRelation) { evaluationBusyRef.current = false; setEvaluationBusy(false); setEvaluationBusyTarget(null); } }
  };
  const recomputeEvaluation = async ({ root, current }: EvaluationLineage) => {
    if (evaluationBusyRef.current) return;
    const snapshot = relationSnapshot(root.metricsSnapshot); if (!snapshot || !current) { setRecomputeError('该历史评价缺少可重新计算的日期范围。'); return; }
    const token = ++writeToken.current; const activeRelation = relationId; evaluationBusyRef.current = true; setEvaluationBusy(true); setEvaluationBusyTarget(root.id); setRecomputeError('');
    try {
      await channelingRequest<TrackingEvent>(`/api/channeling-relations/${relationId}/evaluations`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ occurredOn: snapshot.range.afterEnd, conclusion: current.content, evidence: current.evidence, owner: current.owner, range: snapshot.range }) });
      if (writeToken.current !== token || relationRef.current !== activeRelation) return;
      await loadEvaluations();
    } catch (recomputeFailure) { if (writeToken.current === token && relationRef.current === activeRelation) setRecomputeError(recomputeFailure instanceof Error ? recomputeFailure.message : '重新计算失败'); }
    finally { if (writeToken.current === token && relationRef.current === activeRelation) { evaluationBusyRef.current = false; setEvaluationBusy(false); setEvaluationBusyTarget(null); } }
  };
  const chart = useMemo(() => detail?.injector.injection ? buildRelationChart(detail) : null, [detail]);
  const alignedRows = useMemo(() => detail ? buildAlignedRelationRows(detail) : [], [detail]);
  const evaluationLineages = useMemo(() => buildEvaluationLineages(evaluations), [evaluations]);
  const jsdom = typeof navigator !== 'undefined' && /jsdom/i.test(navigator.userAgent);

  if (loading) return <section className="app-card p-5"><p role="status">正在加载关系详情…</p></section>;
  if (error) return <section className="app-card p-5"><p role="alert">{error} <button type="button" onClick={() => void load()}>重试</button></p></section>;
  if (!detail) return <section className="app-card p-5"><p>暂无关系详情。</p><button type="button" onClick={onBack}>返回</button></section>;
  const snapshot = relationSnapshot(saved?.metricsSnapshot);
  const savedOil = snapshot ? snapshotMetric(snapshot, 'oil') : undefined; const savedLiquid = snapshot ? snapshotMetric(snapshot, 'liquid') : undefined; const savedWaterCut = snapshot ? snapshotMetric(snapshot, 'waterCut') : undefined;
  return <section aria-label="注窜关系详情" className="page-stack">
    <header className="app-card p-5"><button type="button" onClick={onBack} className="text-sm text-slate-600">← 返回</button><h2 className="mt-3 text-xl font-bold">{detail.injectionWell} → {detail.productionWell}</h2><div className="mt-3 flex flex-wrap gap-2"><button type="button" disabled={!wellIds.injector} onClick={() => wellIds.injector && onOpenWell(wellIds.injector)}>注入井：{detail.injectionWell}</button><button type="button" disabled={!wellIds.producer} onClick={() => wellIds.producer && onOpenWell(wellIds.producer)}>生产井：{detail.productionWell}</button></div>
      {factsLoading && <p role="status" className="mt-3 text-sm">正在加载关系基础信息和井档案…</p>}
      {factsError && <p role="alert" className="mt-3 text-sm text-red-700">{factsError} <button type="button" onClick={() => void loadFacts(detail)}>重试基础信息</button></p>}
      {factsResolved && !fact && <p className="mt-3 text-sm text-amber-700">未找到关系基础信息。{!wellIds.injector && ' 未找到注入井档案。'}{!wellIds.producer && ' 未找到生产井档案。'}</p>}
      {factsResolved && fact && <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-3"><div><dt>关系状态</dt><dd>{statusLabels[fact.status || ''] || value(fact.status)}</dd></div><div><dt>关系类型</dt><dd>{typeLabels[fact.channelingType || ''] || value(fact.channelingType)}</dd></div><div><dt>来源</dt><dd>{sourceLabels[fact.source || ''] || value(fact.source)}</dd></div><div><dt>层系</dt><dd>{value(fact.reservoirLayer)}</dd></div><div><dt>影响程度</dt><dd>{impactLabels[fact.impactLevel || ''] || value(fact.impactLevel)}</dd></div><div><dt>证据</dt><dd>{value(fact.evidence)}</dd></div><div><dt>负责人</dt><dd>{value(fact.owner)}</dd></div><div><dt>生效开始日</dt><dd>{value(fact.effectiveStartDate)}</dd></div><div><dt>生效结束日</dt><dd>{value(fact.effectiveEndDate)}</dd></div></dl>}
    </header>
    <nav role="tablist" aria-label="关系详情模块" className="app-card flex flex-wrap gap-2 p-3">{detailTabs.map(([key, label]) => <button type="button" role="tab" id={`relation-detail-tab-${relationId}-${key}`} aria-controls={`relation-detail-panel-${relationId}-${key}`} aria-selected={tab === key} tabIndex={tab === key ? 0 : -1} ref={(node) => { if (node) tabRefs.current.set(key, node); else tabRefs.current.delete(key); }} key={key} onKeyDown={(event) => selectTabByKeyboard(event, key)} onClick={() => setTab(key)} className="action-button">{label}</button>)}</nav>
    {tab === 'overview' && <section role="tabpanel" id={`relation-detail-panel-${relationId}-overview`} aria-labelledby={`relation-detail-tab-${relationId}-overview`} className="app-card p-5"><h3 className="font-bold">关系概览</h3><p className="mt-2">项目：{value(fact?.project?.name)} · 区块：{value(fact?.project?.block)} · 置信度：{value(fact?.confidence)}</p></section>}
    {tab === 'metrics' && <section role="tabpanel" id={`relation-detail-panel-${relationId}-metrics`} aria-labelledby={`relation-detail-tab-${relationId}-metrics`} className="app-card p-5"><h3 className="font-bold">注采联动指标</h3><p className="mt-1 text-sm text-slate-500">查询时间：{detail.generatedAt} · 指标区间：{detail.range.beforeStart} 至 {detail.range.afterEnd}</p>
      {!detail.injector.injection && <p>缺少注入数据。</p>}{!detail.producerSeries.length && <p>缺少生产数据。</p>}
      {chart && (jsdom ? <div aria-label="注采联动图表">注汽量 · 日产油 · 日产液 · 含水</div> : <ReactECharts option={chart} style={{ height: 360 }} />)}
      <div className="mt-4 grid gap-3 sm:grid-cols-4"><div>累计注汽量：{value(detail.injector.injection?.cumulativeSteam)}</div><div>日产油变化：{value(detail.comparison.oil.change)}</div><div>日产液变化：{value(detail.comparison.liquid.change)}</div><div>含水变化：{snapshotMetricValue(detail.comparison.waterCut.change, true)}</div></div>
      {!!alignedRows.length && <table className="mt-4 w-full text-sm"><thead><tr><th>日期</th><th>注汽量</th><th>日产油</th><th>日产液</th><th>含水</th></tr></thead><tbody>{alignedRows.map((row) => <tr key={row.date} data-aligned-date={row.date}><td>{row.date}</td><td>{row.steamVolume ?? '—'}</td><td>{row.oil ?? '—'}</td><td>{row.liquid ?? '—'}</td><td>{row.waterCutPercent == null ? '—' : `${Number(row.waterCutPercent.toFixed(3))}%`}</td></tr>)}</tbody></table>}
    </section>}
    {tab === 'evaluation' && <section role="tabpanel" id={`relation-detail-panel-${relationId}-evaluation`} aria-labelledby={`relation-detail-tab-${relationId}-evaluation`} className="app-card p-5"><h3 className="font-bold">效果评价</h3>{role === 'admin' ? <form aria-label="新增效果评价" onSubmit={submitEvaluation} className="mt-4 grid gap-3 md:grid-cols-3">{(['beforeStart', 'splitDate', 'afterEnd'] as const).map((name) => <label key={name}>{name === 'beforeStart' ? '评价前开始日' : name === 'splitDate' ? '分界日' : '评价后结束日'}<input required disabled={evaluationBusy} type="date" name={name} value={draft[name]} onInput={(e) => { if (evaluationBusyRef.current) return; draftDirty.current = true; const next = e.currentTarget.value; setDraft((current) => ({ ...current, [name]: next })); }} className="field-control" /></label>)}<label className="md:col-span-3">评价结论<textarea required disabled={evaluationBusy} name="conclusion" value={draft.conclusion} onInput={(e) => { if (evaluationBusyRef.current) return; draftDirty.current = true; const next = e.currentTarget.value; setDraft((current) => ({ ...current, conclusion: next })); }} className="field-control" /></label><label>证据<input name="evidence" disabled={evaluationBusy} value={draft.evidence} onInput={(e) => { if (evaluationBusyRef.current) return; draftDirty.current = true; const next = e.currentTarget.value; setDraft((current) => ({ ...current, evidence: next })); }} className="field-control" /></label><label>负责人<input required disabled={evaluationBusy} name="owner" value={draft.owner} onInput={(e) => { if (evaluationBusyRef.current) return; draftDirty.current = true; const next = e.currentTarget.value; setDraft((current) => ({ ...current, owner: next })); }} className="field-control" /></label>{evaluationError && <p role="alert" className="text-red-700 md:col-span-3">{evaluationError}</p>}<button type="submit" disabled={evaluationBusy} className="action-button action-primary md:col-span-3">{evaluationBusyTarget === 'new' ? '保存中…' : '保存效果评价'}</button></form> : <p className="mt-3 text-sm text-slate-500">游客只读，可查看已形成的评价记录。</p>}
      {saved && <article className="mt-5 rounded border border-emerald-200 bg-emerald-50 p-4"><h4 className="font-bold">已保存评价快照</h4><p>{saved.content}</p><p>指标区间：{snapshot?.range.beforeStart || saved.occurredOn} 至 {snapshot?.range.afterEnd || saved.occurredOn}</p><p>日产油变化：{value(savedOil?.change)} · 日产液变化：{value(savedLiquid?.change)} · 含水变化：{snapshotMetricValue(savedWaterCut?.change, true)}</p></article>}
      <div className="mt-5 space-y-3"><h4 className="font-bold">历史评价快照</h4>{evaluationsLoading && <p role="status">正在加载历史评价…</p>}{evaluationsError && <p role="alert">{evaluationsError} <button type="button" onClick={() => void loadEvaluations()}>重试历史评价</button></p>}{!evaluationsLoading && !evaluationsError && evaluationLineages.length === 0 && <p>暂无历史评价。</p>}{recomputeError && <p role="alert" className="text-red-700">{recomputeError}</p>}{evaluationLineages.map((lineage) => <EvaluationSnapshot key={lineage.root.id} lineage={lineage} role={role} busy={evaluationBusy} recomputing={evaluationBusyTarget === lineage.root.id} onRecompute={() => void recomputeEvaluation(lineage)} />)}</div>
    </section>}
    {tab === 'timeline' && <section role="tabpanel" id={`relation-detail-panel-${relationId}-timeline`} aria-labelledby={`relation-detail-tab-${relationId}-timeline`} className="app-card p-5"><ChannelingTimeline role={role} subject={{ subjectType: 'relation', subjectId: relationId }} /></section>}
  </section>;
}
