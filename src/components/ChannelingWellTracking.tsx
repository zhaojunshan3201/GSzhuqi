import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { ChannelingTimeline } from './ChannelingTimeline.tsx';
import { channelingRequest, type ChannelingRole, type ChannelingWellProfile, type WellMetrics } from '../lib/channelingTrackingApi.ts';

type RelationSummary = {
  id: number; channelingType: string; injectionWell: string; productionWell: string; status: string;
  confidence: number | null; evidence: string; owner: string; effectiveStartDate: string | null; effectiveEndDate: string | null;
  project: { id: number; name: string; block: string };
};
type DetailTab = 'overview' | 'metrics' | 'relations' | 'timeline';
export type ChannelingWellTrackingProps = { role: ChannelingRole; selectedWellId?: number; onOpenRelation?: (id: number) => void; onBack?: () => void };

const errorText = (error: unknown, fallback: string) => error instanceof Error ? error.message : fallback;
const valueText = (value: unknown) => value === null || value === undefined || value === '' ? '暂无' : String(value);
const metricRange = () => {
  const endDate = new Date(); const startDate = new Date(endDate); startDate.setDate(startDate.getDate() - 29);
  return { start: startDate.toISOString().slice(0, 10), end: endDate.toISOString().slice(0, 10) };
};

export function ChannelingWellTracking({ role, selectedWellId, onOpenRelation, onBack }: ChannelingWellTrackingProps) {
  const [query, setQuery] = useState('');
  const [profiles, setProfiles] = useState<ChannelingWellProfile[]>([]);
  const [listLoading, setListLoading] = useState(true);
  const [listError, setListError] = useState('');
  const [selectedId, setSelectedId] = useState<number | undefined>(selectedWellId);
  const [detail, setDetail] = useState<ChannelingWellProfile | null>(null);
  const [metrics, setMetrics] = useState<WellMetrics | null>(null);
  const [relations, setRelations] = useState<RelationSummary[]>([]);
  const [detailLoading, setDetailLoading] = useState(false);
  const [metricsLoading, setMetricsLoading] = useState(false);
  const [relationsLoading, setRelationsLoading] = useState(false);
  const [detailError, setDetailError] = useState('');
  const [metricsError, setMetricsError] = useState('');
  const [relationsError, setRelationsError] = useState('');
  const [tab, setTab] = useState<DetailTab>('overview');
  const [createDraft, setCreateDraft] = useState({ wellNo: '', block: '', owner: '' });
  const [createError, setCreateError] = useState('');
  const [creating, setCreating] = useState(false);
  const creatingRef = useRef(false);
  const createMutationToken = useRef(0);
  const mounted = useRef(true);
  const mutationSelection = useRef<number | undefined>(selectedWellId);
  const listGeneration = useRef(0);
  const detailGeneration = useRef(0);

  useEffect(() => { setSelectedId(selectedWellId); }, [selectedWellId]);
  useEffect(() => {
    if (mutationSelection.current === selectedId) return;
    mutationSelection.current = selectedId;
    createMutationToken.current++;
    creatingRef.current = false;
    setCreating(false);
  }, [selectedId]);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      createMutationToken.current++;
      creatingRef.current = false;
    };
  }, []);

  const loadProfiles = useCallback(async (search: string) => {
    const generation = ++listGeneration.current; setListLoading(true); setListError('');
    try {
      const data = await channelingRequest<ChannelingWellProfile[]>(`/api/channeling-wells?${new URLSearchParams({ query: search.trim() })}`);
      if (listGeneration.current === generation) setProfiles(data);
    } catch (error) {
      if (listGeneration.current === generation) { setProfiles([]); setListError(errorText(error, '单井档案加载失败')); }
    } finally { if (listGeneration.current === generation) setListLoading(false); }
  }, []);

  useEffect(() => { void loadProfiles(''); return () => { listGeneration.current++; }; }, [loadProfiles]);

  const loadDetailPart = useCallback(async (kind: 'detail' | 'metrics' | 'relations', id: number, generation: number, signal?: AbortSignal) => {
    const range = metricRange();
    if (kind === 'detail') { setDetailLoading(true); setDetailError(''); }
    if (kind === 'metrics') { setMetricsLoading(true); setMetricsError(''); }
    if (kind === 'relations') { setRelationsLoading(true); setRelationsError(''); }
    try {
      if (kind === 'detail') {
        const data = await channelingRequest<ChannelingWellProfile>(`/api/channeling-wells/${id}`, { signal });
        if (detailGeneration.current === generation) setDetail(data);
      } else if (kind === 'metrics') {
        const data = await channelingRequest<WellMetrics>(`/api/channeling-wells/${id}/metrics?${new URLSearchParams(range)}`, { signal });
        if (detailGeneration.current === generation) setMetrics(data);
      } else {
        const data = await channelingRequest<RelationSummary[]>(`/api/channeling-wells/${id}/relations`, { signal });
        if (detailGeneration.current === generation) setRelations(data);
      }
    } catch (error) {
      if (detailGeneration.current !== generation || signal?.aborted) return;
      if (kind === 'detail') { setDetail(null); setDetailError(errorText(error, '单井详情加载失败')); }
      if (kind === 'metrics') { setMetrics(null); setMetricsError(errorText(error, '生产指标加载失败')); }
      if (kind === 'relations') { setRelations([]); setRelationsError(errorText(error, '关系加载失败')); }
    } finally {
      if (detailGeneration.current !== generation) return;
      if (kind === 'detail') setDetailLoading(false);
      if (kind === 'metrics') setMetricsLoading(false);
      if (kind === 'relations') setRelationsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!selectedId) { setDetail(null); setMetrics(null); setRelations([]); return; }
    const generation = ++detailGeneration.current; const controller = new AbortController(); setTab('overview');
    setDetail(null); setMetrics(null); setRelations([]);
    void loadDetailPart('detail', selectedId, generation, controller.signal);
    void loadDetailPart('metrics', selectedId, generation, controller.signal);
    void loadDetailPart('relations', selectedId, generation, controller.signal);
    return () => { controller.abort(); detailGeneration.current++; };
  }, [loadDetailPart, selectedId]);

  const search = (event: FormEvent) => { event.preventDefault(); void loadProfiles(query); };
  const createProfile = async (event: FormEvent) => {
    event.preventDefault(); if (creatingRef.current) return;
    const mutationToken = ++createMutationToken.current;
    creatingRef.current = true; setCreating(true); setCreateError('');
    try {
      const created = await channelingRequest<ChannelingWellProfile>('/api/channeling-wells', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(createDraft) });
      if (!mounted.current || createMutationToken.current !== mutationToken) return;
      setProfiles((current) => [created, ...current.filter((item) => item.id !== created.id)]);
      setSelectedId(created.id); setCreateDraft({ wellNo: '', block: '', owner: '' });
    } catch (error) {
      if (mounted.current && createMutationToken.current === mutationToken) setCreateError(errorText(error, '单井档案保存失败'));
    } finally {
      if (mounted.current && createMutationToken.current === mutationToken) { creatingRef.current = false; setCreating(false); }
    }
  };

  const retryPart = (kind: 'detail' | 'metrics' | 'relations') => {
    if (!selectedId) return; const generation = detailGeneration.current; void loadDetailPart(kind, selectedId, generation);
  };

  const roles = detail?.roles ?? metrics?.roles ?? [];
  const latestStage = metrics?.injection?.stages?.at(-1);
  const production = metrics?.production;
  const hasInjectionData = Boolean(metrics?.injection && (metrics.injection.stages.length > 0 || metrics.injection.cumulativeSteam !== null));
  const hasProductionData = Boolean(production && (production.latest?.date || production.rows?.length));
  return <section aria-label="单井跟踪台账" className="grid gap-5 lg:grid-cols-[300px_1fr]">
    <aside className="space-y-4 rounded-xl border border-slate-200 bg-white p-4">
      <div className="flex items-center justify-between"><h2 className="font-semibold text-slate-900">单井跟踪台账</h2>{onBack && <button type="button" onClick={onBack} className="text-sm text-emerald-700">返回</button>}</div>
      <form aria-label="搜索单井" onSubmit={search} className="flex gap-2"><input name="query" value={query} onInput={(e) => { const value = e.currentTarget.value; setQuery(value); }} placeholder="井号" className="min-w-0 flex-1 rounded border p-2"/><button type="submit" className="rounded bg-slate-700 px-3 text-white">搜索</button></form>
      {role === 'admin' && <form aria-label="新建或复用单井档案" onSubmit={createProfile} className="space-y-2 rounded bg-slate-50 p-3">
        <h3 className="text-sm font-semibold">新建/复用档案</h3>
        <input name="wellNo" required value={createDraft.wellNo} onInput={(e) => { const wellNo = e.currentTarget.value; setCreateDraft((value) => ({ ...value, wellNo })); }} placeholder="井号" className="w-full rounded border p-2"/>
        <input name="block" value={createDraft.block} onInput={(e) => { const block = e.currentTarget.value; setCreateDraft((value) => ({ ...value, block })); }} placeholder="区块" className="w-full rounded border p-2"/>
        <input name="owner" value={createDraft.owner} onInput={(e) => { const owner = e.currentTarget.value; setCreateDraft((value) => ({ ...value, owner })); }} placeholder="负责人" className="w-full rounded border p-2"/>
        {createError && <p role="alert" className="text-sm text-red-700">{createError}</p>}
        <button type="submit" disabled={creating} className="w-full rounded bg-emerald-600 p-2 text-white disabled:opacity-50">{creating ? '保存中…' : '保存档案'}</button>
      </form>}
      {listLoading && <p role="status">正在加载单井档案…</p>}
      {!listLoading && listError && <p role="alert">{listError} <button type="button" onClick={() => void loadProfiles(query)}>重试</button></p>}
      {!listLoading && !listError && profiles.length === 0 && <p className="text-sm text-slate-500">暂无单井档案</p>}
      <div className="space-y-2">{profiles.map((item) => <button data-well-id={item.id} key={item.id} type="button" onClick={() => setSelectedId(item.id)} className={`w-full rounded border p-3 text-left ${selectedId === item.id ? 'border-emerald-500 bg-emerald-50' : 'border-slate-200'}`}><strong>{item.wellNo}</strong><span className="block text-xs text-slate-500">{item.block || '未提供区块'} · {item.owner || '未提供负责人'}</span></button>)}</div>
    </aside>
    <main className="min-w-0 rounded-xl border border-slate-200 bg-white p-5">
      {!selectedId && <p className="py-16 text-center text-slate-500">请选择一口井查看跟踪详情</p>}
      {selectedId && <>
        <div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="text-xl font-semibold">{detail?.wellNo || `单井 #${selectedId}`}</h2><p className="text-sm text-slate-500">{roles.length ? roles.map((item) => item === 'injector' ? '注汽井' : '采油井').join(' / ') : '暂未识别井角色'}</p></div></div>
        <nav aria-label="单井详情标签" className="my-4 flex flex-wrap gap-2">{([['overview', '概览'], ['metrics', '生产指标'], ['relations', '关联关系'], ['timeline', '跟踪记录']] as const).map(([key, label]) => <button key={key} type="button" onClick={() => setTab(key)} className={`rounded px-3 py-2 ${tab === key ? 'bg-emerald-600 text-white' : 'bg-slate-100'}`}>{label}</button>)}</nav>
        {tab === 'overview' && <div className="space-y-4">{detailLoading && <p role="status">正在加载单井详情…</p>}{detailError && <p role="alert">{detailError} <button type="button" onClick={() => retryPart('detail')}>重试详情</button></p>}{detail && <dl className="grid gap-3 sm:grid-cols-2"><div><dt>井号</dt><dd>{detail.wellNo}</dd></div><div><dt>区块</dt><dd>{valueText(detail.block)}</dd></div><div><dt>负责人</dt><dd>{valueText(detail.owner)}</dd></div><div><dt>关联关系数</dt><dd>{valueText(detail.relationCount)}</dd></div></dl>}{metrics && <section aria-label="最新指标摘要" className="rounded border bg-slate-50 p-4"><h3 className="font-semibold">最新指标摘要</h3>{roles.includes('injector') && <p>{hasInjectionData ? `累计注汽量 ${valueText(metrics.injection?.cumulativeSteam)} · 最新周期 ${valueText(latestStage?.cycleNo)}` : '未找到注汽数据'}</p>}{roles.includes('producer') && <p>{hasProductionData ? `最新日产油 ${valueText(production?.latest?.oil)} · 最新日产液 ${valueText(production?.latest?.liquid)} · 最新含水 ${valueText(production?.latest?.waterCut)}` : '未找到生产数据'}</p>}</section>}</div>}
        {tab === 'metrics' && <div className="space-y-4">{metricsLoading && <p role="status">正在加载生产指标…</p>}{metricsError && <p role="alert">{metricsError} <button type="button" onClick={() => retryPart('metrics')}>重试指标</button></p>}{metrics && <>
          <p className="text-xs text-slate-500">查询时间 {metrics.queriedAt} · {metrics.range.start} 至 {metrics.range.end}</p>
          {roles.includes('injector') && <section aria-label="注汽指标" className="rounded border p-4"><h3 className="font-semibold">注汽指标</h3>{hasInjectionData ? <><p>周期数 {valueText(metrics.injection?.cycleCount)} · 最新周期 {valueText(latestStage?.cycleNo)} · 累计注汽量 {valueText(metrics.injection?.cumulativeSteam)}</p><p>开始日期 {valueText(latestStage?.startDate)} · 结束日期 {valueText(latestStage?.endDate)}</p><p>蒸汽量 {valueText(latestStage?.steamVolume)} · 温度 {valueText(latestStage?.temperature)} · 压力 {valueText(latestStage?.pressure)} · 干度 {valueText(latestStage?.dryness)} · 生产时数 {valueText(latestStage?.productionHours)}</p></> : <p>未找到注汽数据</p>}</section>}
          {roles.includes('producer') && <section aria-label="采油井指标" className="rounded border p-4"><h3 className="font-semibold">采油井指标</h3>{hasProductionData ? <><p>最新日产油 {valueText(production?.latest?.oil)} · 最新日产液 {valueText(production?.latest?.liquid)} · 最新含水 {valueText(production?.latest?.waterCut)}</p><p>7日均值 {valueText(production?.last7Days?.oil.average)}（油） / {valueText(production?.last7Days?.liquid.average)}（液） / {valueText(production?.last7Days?.waterCut.average)}（含水）</p><p>30日均值 {valueText(production?.last30Days?.oil.average)}（油） / {valueText(production?.last30Days?.liquid.average)}（液） / {valueText(production?.last30Days?.waterCut.average)}（含水）</p></> : <p>未找到生产数据</p>}</section>}
          {!roles.length && <p>暂无可展示的角色指标</p>}
        </>}</div>}
        {tab === 'relations' && <div>{relationsLoading && <p role="status">正在加载关联关系…</p>}{relationsError && <p role="alert">{relationsError} <button type="button" onClick={() => retryPart('relations')}>重试关系</button></p>}{!relationsLoading && !relationsError && relations.length === 0 && <p>暂无关联关系</p>}<div className="space-y-3">{relations.map((item) => <article key={item.id} className="rounded border p-4"><h3>{item.injectionWell} → {item.productionWell}</h3><p>{item.channelingType} · {item.status} · {item.project.name}</p><p>证据：{valueText(item.evidence)} · 置信度：{valueText(item.confidence)} · 负责人：{valueText(item.owner)}</p>{onOpenRelation && <button type="button" onClick={() => onOpenRelation(item.id)} className="mt-2 text-emerald-700 underline">查看关系详情</button>}</article>)}</div></div>}
        {tab === 'timeline' && (
          <ChannelingTimeline role={role} subject={{ subjectType: 'well', subjectId: selectedId }}/>
        )}
      </>}
    </main>
  </section>;
}
