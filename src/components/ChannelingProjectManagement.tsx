import { useEffect, useMemo, useRef, useState } from 'react';
import type { ChannelingGovernanceStatus, ChannelingProject, ChannelingRelation, ChannelingRelationInput, ChannelingType } from '../lib/channelingProjectStore';
import type { ChannelingRelationImport, ChannelingRelationImportRow } from '../lib/channelingRelationImport';
import { ChannelingTimeline } from './ChannelingTimeline.tsx';
import { ChannelingApiError, channelingRequest, type ProjectSummary } from '../lib/channelingTrackingApi.ts';
import { formatShanghaiBusinessDate } from '../lib/businessDate.ts';

const statusLabels: Record<ChannelingGovernanceStatus, string> = { identified: '识别/导入', confirmed: '确认', risk_assessed: '风险分级', planned: '治理方案', governing: '执行跟踪', verifying: '效果验证', closed: '关闭', recurred: '复发回流' };
const relationLabels = { confirmed: '已确认', suspected: '疑似', released: '已解除' } as const;
const channelingTypeLabels: Record<ChannelingType, string> = { steam: '注汽窜', nitrogen: '注氮气窜' };
const today = () => formatShanghaiBusinessDate(new Date());
export const defaultManualRelationDraft = (now = new Date()): Omit<ChannelingRelationInput, 'projectId'> => ({ channelingType: 'steam', injectionWell: '', productionWell: '', reservoirLayer: '', impactLevel: 'medium', confidence: .5, status: 'confirmed', source: 'manual', evidence: '', effectiveStartDate: formatShanghaiBusinessDate(now), effectiveEndDate: formatShanghaiBusinessDate(now), owner: '' });
const blankRelation = () => defaultManualRelationDraft();
type Props = { role: string; onOpenRelation?: (relationId: number) => void };
type MessageTone = 'info' | 'success' | 'warning' | 'error';
const messageClasses: Record<MessageTone, string> = { info: 'status-banner-info', success: 'status-banner-success border-emerald-200 bg-emerald-50 text-emerald-700', warning: 'status-banner-warning border-amber-200 bg-amber-50 text-amber-700', error: 'status-banner-error border-red-200 bg-red-50 text-red-700' };
type ProjectTab = 'overview' | 'relations' | 'timeline';
const projectTabs: [ProjectTab, string][] = [['overview', '项目概览'], ['relations', '关系清单'], ['timeline', '跟踪时间线']];
const isTrackingHistoryConflict = (error: unknown) => error instanceof ChannelingApiError && error.status === 409 && /tracking history/i.test(error.message);

const displayNumber = (value: unknown) => typeof value === 'number' && Number.isFinite(value) ? String(value) : '暂无数据';
const displayFixedTwo = (value: unknown) => typeof value === 'number' && Number.isFinite(value) ? value.toFixed(2) : '暂无数据';

function ProjectSummaryPanel({ projectId, isAdmin }: { projectId: number; isAdmin: boolean }) {
  const [draftRange, setDraftRange] = useState({ start: '', end: '' });
  const [appliedRange, setAppliedRange] = useState({ start: '', end: '' });
  const [summary, setSummary] = useState<ProjectSummary | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [validationError, setValidationError] = useState('');
  const [retryKey, setRetryKey] = useState(0);
  const [requestVersion, setRequestVersion] = useState(0);
  const explicitRange = useRef(false);
  const dirtyDraft = useRef({ start: false, end: false });
  const activeController = useRef<AbortController | null>(null);
  const [evaluationDraft, setEvaluationDraft] = useState({ conclusion: '', evidence: '', owner: '' });
  const [evaluationError, setEvaluationError] = useState('');
  const [evaluationSuccess, setEvaluationSuccess] = useState('');
  const [evaluationSubmitting, setEvaluationSubmitting] = useState(false);
  const evaluationSubmittingRef = useRef(false);
  const evaluationMutationToken = useRef(0);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; evaluationMutationToken.current++; evaluationSubmittingRef.current = false; };
  }, []);
  useEffect(() => {
    if (!evaluationSubmittingRef.current) return;
    evaluationMutationToken.current++;
    evaluationSubmittingRef.current = false;
    setEvaluationSubmitting(false);
  }, [appliedRange.start, appliedRange.end]);

  useEffect(() => {
    setSummary(null);
    setError('');
    const controller = new AbortController();
    activeController.current = controller;
    setLoading(true);
    const url = explicitRange.current ? `/api/channeling-projects/${projectId}/summary?${new URLSearchParams(appliedRange)}` : `/api/channeling-projects/${projectId}/summary`;
    void channelingRequest<ProjectSummary>(url, { signal: controller.signal })
      .then((data) => { if (!controller.signal.aborted) { setSummary(data); if (!explicitRange.current) { setDraftRange((current) => ({ start: dirtyDraft.current.start ? current.start : data.range.start, end: dirtyDraft.current.end ? current.end : data.range.end })); setAppliedRange(data.range); } } })
      .catch((reason) => { if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : '项目汇总加载失败'); })
      .finally(() => { if (!controller.signal.aborted) { setLoading(false); if (activeController.current === controller) activeController.current = null; } });
    return () => { controller.abort(); if (activeController.current === controller) activeController.current = null; };
  }, [projectId, requestVersion, retryKey]);

  const applyRange = () => {
    if (evaluationSubmittingRef.current) return;
    const message = !draftRange.start || !draftRange.end ? '请选择完整日期范围' : draftRange.start > draftRange.end ? '开始日期不能晚于结束日期' : '';
    if (message) {
      activeController.current?.abort();
      activeController.current = null;
      setLoading(false);
      setValidationError(message);
      return;
    }
    activeController.current?.abort();
    setValidationError('');
    explicitRange.current = true;
    setAppliedRange({ ...draftRange });
    setRequestVersion((version) => version + 1);
  };

  const submitEvaluation = async (event: React.FormEvent) => {
    event.preventDefault();
    if (evaluationSubmittingRef.current || !summary) return;
    if (!evaluationDraft.conclusion.trim() || !evaluationDraft.owner.trim()) { setEvaluationError('请填写评价结论和负责人'); setEvaluationSuccess(''); return; }
    const range = summary.range ?? appliedRange;
    const mutationToken = ++evaluationMutationToken.current;
    evaluationSubmittingRef.current = true; setEvaluationSubmitting(true); setEvaluationError(''); setEvaluationSuccess('');
    try {
      await channelingRequest(`/api/channeling-projects/${projectId}/evaluations`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ occurredOn: range.end, conclusion: evaluationDraft.conclusion.trim(), evidence: evaluationDraft.evidence.trim(), owner: evaluationDraft.owner.trim(), range }),
      });
      if (!mounted.current || evaluationMutationToken.current !== mutationToken) return;
      setEvaluationDraft({ conclusion: '', evidence: '', owner: '' });
      setEvaluationSuccess('项目评价已保存');
      setRequestVersion((version) => version + 1);
    } catch (reason) {
      if (mounted.current && evaluationMutationToken.current === mutationToken) setEvaluationError(reason instanceof Error ? reason.message : '项目评价保存失败');
    } finally {
      if (mounted.current && evaluationMutationToken.current === mutationToken) { evaluationSubmittingRef.current = false; setEvaluationSubmitting(false); }
    }
  };

  const cards: [string, unknown, boolean?][] = summary ? [
    ['关系数量', summary.relationCount], ['有效关系数量', summary.activeRelationCount], ['已解除关系数量', summary.releasedRelationCount],
    ['注入井数量', summary.injectorCount], ['生产井数量', summary.producerCount], ['去重井数', summary.uniqueWellCount],
    ['累计注汽量', summary.cumulativeSteam], ['期初日产油合计', summary.initialTotalOil, true], ['最新日产油合计', summary.latestTotalOil, true], ['日产油合计变化', summary.totalOilChange, true], ['已评价次数', summary.evaluatedCount],
  ] : [];
  return <section id="project-panel-overview" role="tabpanel" aria-labelledby="project-tab-overview" className="mt-4">
    <div className="grid items-end gap-2 sm:grid-cols-[1fr_1fr_auto]"><label>汇总开始日期<input aria-label="汇总开始日期" disabled={evaluationSubmitting} className="field-control" type="date" value={draftRange.start} onInput={(event) => { if (evaluationSubmittingRef.current) return; const value = event.currentTarget.value; dirtyDraft.current.start = true; setDraftRange((current) => ({ ...current, start: value })); setValidationError(''); }}/></label><label>汇总结束日期<input aria-label="汇总结束日期" disabled={evaluationSubmitting} className="field-control" type="date" value={draftRange.end} onInput={(event) => { if (evaluationSubmittingRef.current) return; const value = event.currentTarget.value; dirtyDraft.current.end = true; setDraftRange((current) => ({ ...current, end: value })); setValidationError(''); }}/></label><button type="button" disabled={evaluationSubmitting} className="action-button" onClick={applyRange}>应用统计范围</button></div>
    {validationError && <p role="alert" className="mt-2 text-sm text-red-700">{validationError}</p>}
    {loading && <p className="mt-3 text-sm text-slate-500">正在加载项目汇总…</p>}
    {error && <div className="mt-3 rounded border border-red-200 bg-red-50 p-3 text-sm text-red-700"><p>{error}</p><button type="button" className="mt-2" onClick={() => setRetryKey((value) => value + 1)}>重试</button></div>}
    {!loading && !error && summary && <><div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">{cards.map(([label, value, fixedTwo]) => <div key={label} className="rounded border border-slate-200 p-3"><span className="text-sm text-slate-500">{label}</span><b className="mt-1 block">{fixedTwo ? displayFixedTwo(value) : displayNumber(value)}</b></div>)}</div><div className="mt-3 rounded border border-slate-200 p-3 text-sm"><span className="text-slate-500">最新评价结论</span><p className="mt-1">{typeof summary.latestEvaluationConclusion === 'string' && summary.latestEvaluationConclusion.trim() ? summary.latestEvaluationConclusion : '暂无数据'}</p></div><p className="mt-3 text-sm text-slate-500">统计范围：{summary.range?.start || summary.start || appliedRange.start} 至 {summary.range?.end || summary.end || appliedRange.end} · 最新可用数据日期：{summary.latestAvailableDate || '暂无数据'} · 查询时间：{summary.generatedAt || '暂无数据'}</p></>}
    {isAdmin && summary && <form aria-label="人工项目评价" onSubmit={submitEvaluation} className="mt-4 grid gap-3 rounded border border-slate-200 bg-slate-50 p-4 md:grid-cols-2"><div className="md:col-span-2"><h4 className="font-semibold">人工项目评价</h4><p className="text-sm text-slate-500">评价范围：{summary.range.start} 至 {summary.range.end}</p></div><label className="md:col-span-2">评价结论<textarea name="conclusion" required disabled={evaluationSubmitting} className="field-control" value={evaluationDraft.conclusion} onInput={(event) => { if (evaluationSubmittingRef.current) return; const conclusion = event.currentTarget.value; setEvaluationDraft((current) => ({ ...current, conclusion })); setEvaluationError(''); setEvaluationSuccess(''); }}/></label><label>评价证据<input name="evidence" disabled={evaluationSubmitting} className="field-control" value={evaluationDraft.evidence} onInput={(event) => { if (evaluationSubmittingRef.current) return; const evidence = event.currentTarget.value; setEvaluationDraft((current) => ({ ...current, evidence })); setEvaluationError(''); setEvaluationSuccess(''); }}/></label><label>负责人<input name="owner" required disabled={evaluationSubmitting} className="field-control" value={evaluationDraft.owner} onInput={(event) => { if (evaluationSubmittingRef.current) return; const owner = event.currentTarget.value; setEvaluationDraft((current) => ({ ...current, owner })); setEvaluationError(''); setEvaluationSuccess(''); }}/></label>{evaluationError && <p role="alert" className="text-sm text-red-700 md:col-span-2">{evaluationError}</p>}<button type="submit" disabled={evaluationSubmitting} className="action-button action-primary md:col-span-2">{evaluationSubmitting ? '评价保存中…' : '保存人工评价'}</button></form>}
    {evaluationSuccess && <p role="status" className="mt-3 text-sm text-emerald-700">{evaluationSuccess}</p>}
    {!loading && !error && !summary && !validationError && <p className="mt-3 text-sm text-slate-500">暂无汇总数据</p>}
  </section>;
}

export function ChannelingProjectManagement({ role, onOpenRelation = () => {} }: Props) {
  const isAdmin = role === 'admin';
  const canOperate = isAdmin;
  const [projects, setProjects] = useState<ChannelingProject[]>([]);
  const [todos, setTodos] = useState<(ChannelingProject & { overdue: boolean })[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [message, setMessageState] = useState<{ text: string; tone: MessageTone } | null>(null);
  const [relations, setRelations] = useState<ChannelingRelation[]>([]);
  const [imports, setImports] = useState<ChannelingRelationImport[]>([]);
  const [relationDraft, setRelationDraft] = useState(blankRelation());
  const [newProject, setNewProject] = useState({ projectName: '', block: '', owner: '' });
  const [projectFilters, setProjectFilters] = useState({ block: '', status: '' });
  const [relationFilters, setRelationFilters] = useState({ channelingType: '', status: '', source: '' });
  const [channelingType, setChannelingType] = useState<ChannelingType>('steam');
  const [preview, setPreview] = useState<ChannelingRelationImport | null>(null);
  const [previewProjectId, setPreviewProjectId] = useState<number | null>(null);
  const [uploading, setUploading] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [relationCreating, setRelationCreating] = useState(false);
  const [projectCreating, setProjectCreating] = useState(false);
  const [projectTab, setProjectTab] = useState<ProjectTab>('overview');
  const [validRowsExpanded, setValidRowsExpanded] = useState(false);
  const [protectedProjectIds, setProtectedProjectIds] = useState<Set<number>>(() => new Set());
  const [protectedRelationKeys, setProtectedRelationKeys] = useState<Set<string>>(() => new Set());
  const confirmingImportIdRef = useRef<number | null>(null);
  const projectCreateMutationToken = useRef(0);
  const projectCreateDraftVersion = useRef(0);
  const activeProjectCreateRef = useRef<number | null>(null);
  const projectLoadRequestRef = useRef<AbortController | null>(null);
  const projectLoadGenerationRef = useRef(0);
  const mountedRef = useRef(false);
  const relationRequestRef = useRef<AbortController | null>(null);
  const relationProjectIdRef = useRef<number | null>(null);
  const viewSelectionRef = useRef({ selectedId, channelingType: relationFilters.channelingType, status: relationFilters.status, source: relationFilters.source });
  viewSelectionRef.current = { selectedId, channelingType: relationFilters.channelingType, status: relationFilters.status, source: relationFilters.source };
  const isCurrentView = (view: { selectedId: number | null; channelingType: string; status: string; source: string }) => viewSelectionRef.current.selectedId === view.selectedId && viewSelectionRef.current.channelingType === view.channelingType && viewSelectionRef.current.status === view.status && viewSelectionRef.current.source === view.source;
  const relationCreateTokenRef = useRef(0);
  const activeRelationCreateRef = useRef<{ token: number; view: typeof viewSelectionRef.current } | null>(null);
  const selected = projects.find((item) => item.id === selectedId);
  const visibleProjects = useMemo(() => projects.filter((item) => (!projectFilters.block || item.block.includes(projectFilters.block)) && (!projectFilters.status || item.status === projectFilters.status)), [projects, projectFilters]);
  const visibleRelations = useMemo(() => relations.filter((item) => (!relationFilters.channelingType || item.channelingType === relationFilters.channelingType) && (!relationFilters.status || item.status === relationFilters.status) && (!relationFilters.source || item.source === relationFilters.source)), [relations, relationFilters]);
  const visibleValidRows = preview?.valid ? (validRowsExpanded ? preview.valid : preview.valid.slice(0, 10)) : [];
  const setMessage = (text: string, tone: MessageTone = 'error') => setMessageState({ text, tone });
  const invalidateProjectCreate = () => {
    if (activeProjectCreateRef.current === null) return;
    activeProjectCreateRef.current = null;
    projectCreateMutationToken.current++;
    setProjectCreating(false);
  };
  const invalidateRelationCreate = () => {
    if (!activeRelationCreateRef.current) return;
    activeRelationCreateRef.current = null;
    relationCreateTokenRef.current++;
    setRelationCreating(false);
  };
  const selectProject = (id: number | null) => { invalidateProjectCreate(); invalidateRelationCreate(); setMessageState(null); setProjectTab('overview'); setSelectedId(id); };
  const selectProjectTab = (tab: ProjectTab, focus = false) => {
    setProjectTab(tab);
    if (focus) document.getElementById(`project-tab-${tab}`)?.focus();
  };
  const navigateProjectTabs = (event: React.KeyboardEvent<HTMLButtonElement>, current: ProjectTab) => {
    const index = projectTabs.findIndex(([tab]) => tab === current);
    let next: ProjectTab | null = null;
    if (event.key === 'ArrowRight') next = projectTabs[(index + 1) % projectTabs.length][0];
    if (event.key === 'ArrowLeft') next = projectTabs[(index - 1 + projectTabs.length) % projectTabs.length][0];
    if (event.key === 'Home') next = projectTabs[0][0];
    if (event.key === 'End') next = projectTabs[projectTabs.length - 1][0];
    if (next) { event.preventDefault(); selectProjectTab(next, true); }
  };

  const load = async () => {
    projectLoadRequestRef.current?.abort();
    const controller = new AbortController();
    const generation = ++projectLoadGenerationRef.current;
    projectLoadRequestRef.current = controller;
    try {
      const [projectResponse, todoResponse] = await Promise.all([fetch('/api/channeling-projects', { signal: controller.signal }), fetch(`/api/channeling-projects/pending?date=${today()}`, { signal: controller.signal })]);
      const [projectPayload, todoPayload] = await Promise.all([projectResponse.json(), todoResponse.json()]);
      if (controller.signal.aborted || !mountedRef.current || projectLoadGenerationRef.current !== generation) return false;
      if (!projectPayload.success) throw new Error(projectPayload.message || '项目加载失败');
      if (!todoPayload.success) throw new Error(todoPayload.message || '待办加载失败');
      setProjects(projectPayload.data);
      const loadedProjectIds = new Set<number>(projectPayload.data.map((item: ChannelingProject) => item.id));
      setProtectedProjectIds((current) => new Set([...current].filter((id) => loadedProjectIds.has(id))));
      setProtectedRelationKeys((current) => new Set([...current].filter((key) => loadedProjectIds.has(Number(key.split(':', 1)[0])))));
      setSelectedId((id) => id ?? projectPayload.data[0]?.id ?? null);
      setTodos(todoPayload.data);
      return true;
    } catch (error) {
      if (controller.signal.aborted || !mountedRef.current || projectLoadGenerationRef.current !== generation) return false;
      throw error;
    }
  };
  useEffect(() => {
    mountedRef.current = true;
    void load().catch(() => { if (mountedRef.current) setMessage('项目加载失败，请稍后重试。'); });
    return () => {
      mountedRef.current = false;
      projectLoadGenerationRef.current++;
      projectLoadRequestRef.current?.abort();
    };
  }, []);

  const loadRelations = async (projectId: number) => {
    relationRequestRef.current?.abort();
    const controller = new AbortController();
    relationRequestRef.current = controller;
    if (relationProjectIdRef.current !== projectId) {
      relationProjectIdRef.current = projectId;
      setImports([]);
    }
    setRelations([]);
    const typeQuery = relationFilters.channelingType ? `?channelingType=${encodeURIComponent(relationFilters.channelingType)}` : '';
    try {
      const [relationPayload, importPayload] = await Promise.all([fetch(`/api/channeling-projects/${projectId}/relations${typeQuery}`, { signal: controller.signal }).then((r) => r.json()), fetch(`/api/channeling-projects/${projectId}/relation-imports`, { signal: controller.signal }).then((r) => r.json())]);
      if (controller.signal.aborted || relationRequestRef.current !== controller) return;
      if (!relationPayload.success) throw new Error(relationPayload.message || '关系加载失败');
      if (!importPayload.success) throw new Error(importPayload.message || '导入历史加载失败');
      setRelations(relationPayload.data);
      setImports(importPayload.data);
    } catch (error) {
      if (controller.signal.aborted || relationRequestRef.current !== controller) return;
      throw error;
    }
  };
  useEffect(() => { if (selectedId) void loadRelations(selectedId).catch(() => setMessage('关系加载失败，请稍后重试。')); else { relationRequestRef.current?.abort(); relationProjectIdRef.current = null; setRelations([]); setImports([]); } }, [selectedId, relationFilters.channelingType]);
  useEffect(() => { setProjectTab('overview'); }, [selectedId]);
  useEffect(() => () => relationRequestRef.current?.abort(), []);
  useEffect(() => () => { activeProjectCreateRef.current = null; projectCreateMutationToken.current++; }, []);
  useEffect(() => () => { activeRelationCreateRef.current = null; relationCreateTokenRef.current++; }, []);
  useEffect(() => {
    if (!preview) return;
    setPreviewProjectId((current) => {
      if (current !== null && projects.some((project) => project.id === current)) return current;
      if (selectedId !== null && projects.some((project) => project.id === selectedId)) return selectedId;
      return projects[0]?.id ?? null;
    });
  }, [preview, projects, selectedId]);

  const request = <T = any,>(url: string, init: RequestInit) => channelingRequest<T>(url, init);

  const save = async (changes: Record<string, unknown>) => {
    if (!selected) return;
    const projectId = selected.id;
    try {
      await request(`/api/channeling-projects/${projectId}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(changes) });
      if (viewSelectionRef.current.selectedId !== projectId) return;
      await load();
      if (viewSelectionRef.current.selectedId === projectId) setMessage('治理台账已保存。', 'success');
    } catch (error: any) { if (viewSelectionRef.current.selectedId === projectId) setMessage(error.message); }
  };
  const create = async (event: React.FormEvent) => {
    event.preventDefault(); if (activeProjectCreateRef.current !== null) return;
    const view = { ...viewSelectionRef.current };
    const draftVersion = projectCreateDraftVersion.current;
    const mutationToken = ++projectCreateMutationToken.current;
    const draft = { ...newProject };
    activeProjectCreateRef.current = mutationToken;
    setProjectCreating(true);
    const remainsCurrent = () => mountedRef.current && activeProjectCreateRef.current === mutationToken && projectCreateMutationToken.current === mutationToken && projectCreateDraftVersion.current === draftVersion && isCurrentView(view);
    try {
      const created = await request<ChannelingProject>('/api/channeling-projects', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(draft) });
      if (!remainsCurrent()) return;
      await load();
      if (!remainsCurrent()) return;
      setNewProject({ projectName: '', block: '', owner: '' });
      selectProject(created.id);
      setPreviewProjectId((id) => id ?? created.id);
    } catch (error: any) { if (remainsCurrent()) setMessage(error.message); }
    finally {
      if (activeProjectCreateRef.current === mutationToken) {
        activeProjectCreateRef.current = null;
        setProjectCreating(false);
      }
    }
  };
  const createRelation = async (event: React.FormEvent) => {
    event.preventDefault(); if (!selected || activeRelationCreateRef.current) return;
    const projectId = selected.id;
    const view = { ...viewSelectionRef.current };
    const draft = { ...relationDraft };
    const token = ++relationCreateTokenRef.current;
    activeRelationCreateRef.current = { token, view };
    setRelationCreating(true);
    const isActive = () => activeRelationCreateRef.current?.token === token && isCurrentView(view);
    try {
      await request(`/api/channeling-projects/${projectId}/relations`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(draft) });
      if (!isActive()) return;
      setRelationDraft(blankRelation());
      await loadRelations(projectId);
    } catch (error: any) { if (isActive()) setMessage(error.message); }
    finally {
      if (activeRelationCreateRef.current?.token === token) {
        activeRelationCreateRef.current = null;
        setRelationCreating(false);
      }
    }
  };
  const uploadRelations = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file || confirmingImportIdRef.current !== null) return;
    if (!/\.xlsx?$/i.test(file.name)) { setMessage('请选择 .xlsx 或 .xls 格式的关系文件。'); return; }
    const body = new FormData();
    body.append('file', file);
    body.append('channelingType', channelingType);
    setUploading(true);
    setPreview(null);
    setValidRowsExpanded(false);
    setMessage('正在解析关系文件，请稍候…', 'info');
    try {
      const parsed = await request('/api/channeling-relation-imports/preview', { method: 'POST', body });
      setPreview(parsed);
      setPreviewProjectId(selectedId ?? projects[0]?.id ?? null);
      setMessage(`解析完成：${parsed.validCount} 条有效关系，请检查预览后选择项目确认。`, 'success');
    } catch (error: any) {
      setMessage(`解析失败：${error.message || '请检查文件格式和表头后重试。'}`);
    } finally {
      setUploading(false);
    }
  };
  const confirmPreview = async () => {
    if (!preview || !previewProjectId || confirmingImportIdRef.current !== null || !projects.some((project) => project.id === previewProjectId)) return;
    const batchId = preview.id;
    const projectId = previewProjectId;
    const viewSelection = viewSelectionRef.current;
    confirmingImportIdRef.current = batchId;
    setConfirming(true);
    try {
      await request(`/api/channeling-relation-imports/${batchId}/confirm`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ projectId }) });
    } catch (error: any) {
      if (isCurrentView(viewSelection)) setMessage(`确认失败：${error.message}`);
      confirmingImportIdRef.current = null;
      setConfirming(false);
      return;
    }
    const viewIsUnchanged = () => isCurrentView(viewSelection);
    if (!viewIsUnchanged()) { if (confirmingImportIdRef.current === batchId) confirmingImportIdRef.current = null; setConfirming(false); return; }
    setPreview((current) => current?.id === batchId ? null : current);
    setValidRowsExpanded(false);
    selectProject(projectId);
    setMessage('关系导入已确认并写入所选项目。', 'success');
    try {
      await load();
      if (viewIsUnchanged()) await loadRelations(projectId);
    } catch {
      if (viewIsUnchanged()) setMessage('关系已确认，但刷新失败，请稍后手动刷新项目数据。', 'warning');
    } finally {
      if (confirmingImportIdRef.current === batchId) confirmingImportIdRef.current = null;
      setConfirming(false);
    }
  };
  const confirmImport = async (id: number) => {
    if (confirmingImportIdRef.current !== null) return;
    confirmingImportIdRef.current = id;
    const viewSelection = viewSelectionRef.current;
    setConfirming(true);
    try {
      await request(`/api/channeling-relation-imports/${id}/confirm`, { method: 'POST' });
    } catch (error: any) {
      if (isCurrentView(viewSelection)) setMessage(`确认失败：${error.message}`);
      confirmingImportIdRef.current = null;
      setConfirming(false);
      return;
    }
    if (!isCurrentView(viewSelection)) { if (confirmingImportIdRef.current === id) confirmingImportIdRef.current = null; setConfirming(false); return; }
    setImports((current) => current.map((item) => item.id === id ? { ...item, status: 'confirmed' } : item));
    setPreview((current) => current?.id === id ? null : current);
    setMessage('关系导入已确认。', 'success');
    try {
      if (selected && isCurrentView(viewSelection)) await loadRelations(selected.id);
    } catch {
      setMessage('关系已确认，但刷新失败，请稍后手动刷新项目数据。', 'warning');
    } finally {
      if (confirmingImportIdRef.current === id) confirmingImportIdRef.current = null;
      setConfirming(false);
    }
  };
  const mutateRelationStatus = async (id: number, status: 'confirmed' | 'released') => {
    if (!selected) return;
    const projectId = selected.id;
    const view = { ...viewSelectionRef.current };
    try {
      await request(`/api/channeling-relations/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status }) });
      if (isCurrentView(view)) await loadRelations(projectId);
    } catch (error: any) { if (isCurrentView(view)) setMessage(error.message); }
  };
  const confirmSuspected = (id: number) => mutateRelationStatus(id, 'confirmed');
  const releaseRelation = (id: number) => mutateRelationStatus(id, 'released');
  const deleteProject = async () => {
    if (!selected || selected.canDelete === false || protectedProjectIds.has(selected.id) || !window.confirm('删除后无法恢复，是否继续？')) return;
    const projectId = selected.id;
    try {
      await request(`/api/channeling-projects/${projectId}`, { method: 'DELETE' });
      if (viewSelectionRef.current.selectedId !== projectId) return;
      setProtectedProjectIds((current) => { const next = new Set(current); next.delete(projectId); return next; });
      selectProject(null); await load();
    } catch (error: unknown) {
      if (viewSelectionRef.current.selectedId !== projectId) return;
      if (isTrackingHistoryConflict(error)) {
        setProtectedProjectIds((current) => new Set(current).add(projectId));
        setMessage('项目已有关系或跟踪历史，应保留历史记录。', 'warning');
      } else setMessage(error instanceof Error ? error.message : '删除项目失败');
    }
  };
  const deleteRelation = async (id: number) => {
    if (!selected) return;
    const relation = relations.find((item) => item.id === id);
    if (relation?.canDelete === false) return;
    const projectId = selected.id; const key = `${projectId}:${id}`;
    const view = { ...viewSelectionRef.current };
    if (protectedRelationKeys.has(key) || !window.confirm('删除关系后无法恢复，是否继续？')) return;
    try {
      await request(`/api/channeling-relations/${id}`, { method: 'DELETE' });
      if (!isCurrentView(view)) return;
      setProtectedRelationKeys((current) => { const next = new Set(current); next.delete(key); return next; });
      if (viewSelectionRef.current.selectedId === projectId) await loadRelations(projectId);
    } catch (error: unknown) {
      if (!isCurrentView(view)) return;
      if (isTrackingHistoryConflict(error)) {
        setProtectedRelationKeys((current) => new Set(current).add(key));
        setMessage('关系已有跟踪历史，请解除关系并保留历史。', 'warning');
      } else setMessage(error instanceof Error ? error.message : '删除关系失败');
    }
  };

  const previewRelationRow = (row: ChannelingRelationImportRow, status: string, index: number) => <tr key={`${status}-${row.rowNumber}-${row.injectorWellNo}-${row.producerWellNo}-${index}`}><td className="px-2 py-2">{row.rowNumber}</td><td className="px-2 py-2">{status}</td><td className="px-2 py-2">{channelingTypeLabels[row.channelingType]}</td><td className="px-2 py-2">{row.injectorWellNo}</td><td className="px-2 py-2">{row.producerWellNo}</td></tr>;

  return <div className="page-stack">
    <section className="app-card p-5"><h3 className="section-title">注窜项目台账（治理闭环）</h3><p className="mt-1 text-sm text-slate-500">游客只读，可查看完整项目、关系和筛选结果；管理员可维护、导入、确认、治理、关闭、解除和删除。</p>{message && <p aria-live="polite" className={`status-banner mt-3 ${messageClasses[message.tone]}`}>{message.text}</p>}
      {canOperate && <form className="mt-4 grid gap-2 md:grid-cols-4" onSubmit={create}><input aria-label="新建项目名称" className="field-control" required placeholder="项目名称" value={newProject.projectName} disabled={projectCreating} onInput={(e) => { if (activeProjectCreateRef.current !== null) return; projectCreateDraftVersion.current++; setNewProject({ ...newProject, projectName: e.currentTarget.value }); }}/><input aria-label="新建项目区块" className="field-control" required placeholder="区块" value={newProject.block} disabled={projectCreating} onInput={(e) => { if (activeProjectCreateRef.current !== null) return; projectCreateDraftVersion.current++; setNewProject({ ...newProject, block: e.currentTarget.value }); }}/><input aria-label="新建项目负责人" className="field-control" required placeholder="责任人" value={newProject.owner} disabled={projectCreating} onInput={(e) => { if (activeProjectCreateRef.current !== null) return; projectCreateDraftVersion.current++; setNewProject({ ...newProject, owner: e.currentTarget.value }); }}/><button aria-label="新增项目" className="action-button action-primary" disabled={projectCreating}>{projectCreating ? '正在新增…' : '新增项目'}</button></form>}</section>

    <section className="app-card p-5"><div className="flex flex-wrap items-start justify-between gap-3"><div><h3 className="section-title">注窜关系识别</h3><p className="mt-1 text-sm text-slate-500">上传一个 Excel 文件进行分类预览，再确认写入现有项目。关系类型：注汽窜 / 注氮气窜。</p></div>{!isAdmin && <span className="rounded bg-slate-100 px-2 py-1 text-sm text-slate-600">游客只读</span>}</div>
      {isAdmin && <div className="mt-4 flex flex-wrap items-center gap-4"><fieldset className="flex gap-4"><legend className="sr-only">注窜类型</legend>{(['steam', 'nitrogen'] as ChannelingType[]).map((value) => <label key={value} className="flex items-center gap-2 text-sm"><input type="radio" name="channeling-type" value={value} checked={channelingType === value} disabled={uploading || confirming} onChange={() => setChannelingType(value)}/>{channelingTypeLabels[value]}</label>)}</fieldset><label className="text-sm">关系文件<input className="ml-2" type="file" accept=".xlsx,.xls" disabled={uploading || confirming} onChange={uploadRelations}/></label>{uploading && <span className="text-sm text-slate-500">正在解析上传文件…</span>}</div>}
      {preview && <div className="mt-4 rounded-lg border border-slate-200 p-4"><div className="flex flex-wrap items-center justify-between gap-3"><div><p className="font-bold">{preview.fileName} · {channelingTypeLabels[preview.channelingType]}</p><p className="mt-1 text-sm text-slate-500">请先检查异常行和有效关系，再选择目标项目确认。</p></div><div className="grid grid-cols-4 gap-2 text-center text-sm"><span className="rounded bg-emerald-50 px-3 py-2">有效关系<br/><b>{preview.validCount}</b></span><span className="rounded bg-amber-50 px-3 py-2">重复关系<br/><b>{preview.duplicateCount}</b></span><span className="rounded bg-orange-50 px-3 py-2">自身关系<br/><b>{preview.selfRelationCount}</b></span><span className="rounded bg-red-50 px-3 py-2">无效行<br/><b>{preview.invalidCount}</b></span></div></div>
        <div className="mt-4 max-h-72 overflow-auto"><table className="w-full min-w-[620px] text-left text-sm"><thead className="bg-slate-50 text-xs text-slate-500"><tr><th className="px-2 py-2">源行号</th><th className="px-2 py-2">状态</th><th className="px-2 py-2">类型</th><th className="px-2 py-2">注入井</th><th className="px-2 py-2">生产井 / 原因</th></tr></thead><tbody className="divide-y divide-slate-100">{(preview.duplicates || []).map((row, index) => previewRelationRow(row, '重复', index))}{(preview.selfRelations || []).map((row, index) => previewRelationRow(row, '自身关系', index))}{(preview.invalid || []).map((row, index) => <tr key={`invalid-${row.row}-${index}`}><td className="px-2 py-2">{row.row}</td><td className="px-2 py-2">无效</td><td className="px-2 py-2">--</td><td className="px-2 py-2">--</td><td className="px-2 py-2">{row.reason}</td></tr>)}{visibleValidRows.map((row, index) => previewRelationRow(row, '有效', index))}</tbody></table></div>
        {(preview.valid?.length || 0) > 10 && <button className="mt-3 text-sm text-blue-700" onClick={() => setValidRowsExpanded((value) => !value)}>{validRowsExpanded ? '收起有效关系列表' : `展开全部有效关系（${preview.validCount}）`}</button>}
        {isAdmin && <div className="mt-4 flex flex-wrap items-end gap-3"><label className="min-w-64 flex-1 text-sm">确认到项目<select className="field-control mt-1" value={previewProjectId ?? ''} disabled={confirming} onChange={(e) => setPreviewProjectId(e.target.value ? Number(e.target.value) : null)}><option value="">请选择项目</option>{projects.map((project) => <option key={project.id} value={project.id}>{project.projectName} · {project.block}</option>)}</select></label><button className="action-button action-primary" disabled={!previewProjectId || !projects.some((project) => project.id === previewProjectId) || uploading || confirming} onClick={() => void confirmPreview()}>{confirming ? '正在确认…' : '确认导入'}</button></div>}{isAdmin && !projects.length && <p className="mt-2 text-sm text-amber-700">没有项目可确认，请先通过上方表单新建项目；创建后可直接继续确认当前预览。</p>}</div>}
    </section>

    <section className="grid gap-4 lg:grid-cols-[320px_1fr]"><aside className="app-card p-4"><h4 className="font-bold">完整项目清单</h4><div className="mt-3 grid gap-2"><input className="field-control" placeholder="按区块筛选" value={projectFilters.block} onChange={(e) => setProjectFilters({ ...projectFilters, block: e.target.value })}/><select className="field-control" aria-label="项目状态筛选" value={projectFilters.status} onChange={(e) => setProjectFilters({ ...projectFilters, status: e.target.value })}><option value="">全部状态</option>{Object.entries(statusLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></div><div className="mt-3 space-y-2">{visibleProjects.map((item) => <button key={item.id} onClick={() => selectProject(item.id)} className={`w-full rounded border p-3 text-left text-sm ${item.id === selectedId ? 'border-red-300 bg-red-50' : 'border-slate-200'}`}><b>{item.projectName}</b><span className="mt-1 block text-slate-500">{item.block} · {statusLabels[item.status]} · {item.owner}</span></button>)}{!visibleProjects.length && <p className="text-sm text-slate-500">没有符合条件的项目{canOperate ? '，可在上方新建项目。' : '。'}</p>}</div><h4 className="mt-6 font-bold">治理待办</h4><div className="mt-2 space-y-2">{todos.map((item) => <button key={item.id} onClick={() => selectProject(item.id)} className="w-full text-left text-sm text-slate-600">{item.projectName}{item.overdue ? ' · 已超期' : ''}</button>)}{!todos.length && <p className="text-sm text-slate-500">暂无待办，但可通过上方清单查看全部台账。</p>}</div></aside>
      {selected ? <section className="app-card p-5"><div className="flex items-center justify-between"><div><h3 className="font-bold">{selected.projectName}</h3><p className="text-sm text-slate-500">{selected.block} · {selected.owner}</p></div><div className="flex gap-2"><span className="rounded bg-slate-100 px-2 py-1 text-sm">{statusLabels[selected.status]}</span>{isAdmin && <button className="action-button" disabled={selected.canDelete === false || protectedProjectIds.has(selected.id)} onClick={() => void deleteProject()}>删除项目</button>}</div></div>
        {(selected.canDelete === false || protectedProjectIds.has(selected.id)) && <p className="mt-2 text-sm text-amber-700">{typeof selected.relationCount === 'number' && selected.relationCount > 0 ? `项目存在 ${selected.relationCount} 条关系，请保留项目历史。` : '项目已有跟踪历史，应保留历史记录。'}</p>}
        {canOperate && <form key={selected.id} className="mt-4 grid gap-3 md:grid-cols-2" onSubmit={(e) => { e.preventDefault(); const data = new FormData(e.currentTarget); void save({ owner: data.get('owner'), governanceMeasure: data.get('governanceMeasure'), plannedDate: data.get('plannedDate') || null, riskLevel: data.get('riskLevel'), ...(isAdmin ? { status: data.get('status'), closureEvidence: data.get('closureEvidence') } : {}) }); }}><label>项目状态<select name="status" className="field-control" defaultValue={selected.status} disabled={!isAdmin}>{Object.entries(statusLabels).filter(([value]) => isAdmin || value !== 'closed').map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label><label>责任人<input name="owner" className="field-control" defaultValue={selected.owner}/></label><label className="md:col-span-2">治理措施<input name="governanceMeasure" className="field-control" defaultValue={selected.governanceMeasure}/></label><label>计划日期<input name="plannedDate" type="date" className="field-control" defaultValue={selected.plannedDate ?? ''}/></label><label>风险等级<select name="riskLevel" className="field-control" defaultValue={selected.riskLevel}><option value="high">高</option><option value="medium">中</option><option value="low">低</option></select></label>{isAdmin && <label className="md:col-span-2">关闭依据<input name="closureEvidence" className="field-control" defaultValue={selected.closureEvidence}/></label>}<button className="action-button action-primary md:col-span-2">保存治理信息</button></form>}
        <div role="tablist" aria-label="项目详情模块" className="mt-6 flex gap-2 border-t pt-4">{projectTabs.map(([value, label]) => <button key={value} id={`project-tab-${value}`} aria-controls={`project-panel-${value}`} type="button" role="tab" aria-selected={projectTab === value} tabIndex={projectTab === value ? 0 : -1} className={`action-button ${projectTab === value ? 'action-primary' : ''}`} onClick={() => selectProjectTab(value)} onKeyDown={(event) => navigateProjectTabs(event, value)}>{label}</button>)}</div>
        {projectTab === 'overview' && <ProjectSummaryPanel key={`summary-${selected.id}`} projectId={selected.id} isAdmin={isAdmin}/>}
        {projectTab === 'relations' && <section id="project-panel-relations" role="tabpanel" aria-labelledby="project-tab-relations" className="mt-4"><h4 className="sr-only">关系清单</h4><div className="mt-3 grid gap-2 md:grid-cols-3"><select className="field-control" aria-label="注窜类型筛选" value={relationFilters.channelingType} onChange={(e) => { invalidateProjectCreate(); invalidateRelationCreate(); setRelationFilters({ ...relationFilters, channelingType: e.target.value }); }}><option value="">全部注窜类型</option><option value="steam">注汽窜</option><option value="nitrogen">注氮气窜</option></select><select className="field-control" aria-label="关系状态筛选" value={relationFilters.status} onChange={(e) => { invalidateProjectCreate(); invalidateRelationCreate(); setRelationFilters({ ...relationFilters, status: e.target.value }); }}><option value="">全部关系状态</option>{Object.entries(relationLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select><select className="field-control" aria-label="关系来源筛选" value={relationFilters.source} onChange={(e) => { invalidateProjectCreate(); invalidateRelationCreate(); setRelationFilters({ ...relationFilters, source: e.target.value }); }}><option value="">全部来源</option><option value="manual">手工</option><option value="import">导入</option><option value="suspected">疑似识别</option></select></div>
          {canOperate && <form className="mt-3 grid gap-2 md:grid-cols-3" onSubmit={createRelation}><select className="field-control" aria-label="手工关系注窜类型" value={relationDraft.channelingType} disabled={relationCreating} onChange={(e) => { if (!activeRelationCreateRef.current) setRelationDraft({ ...relationDraft, channelingType: e.target.value as ChannelingType }); }}><option value="steam">注汽窜</option><option value="nitrogen">注氮气窜</option></select><input aria-label="手工关系注井" className="field-control" required placeholder="注井" value={relationDraft.injectionWell} disabled={relationCreating} onChange={(e) => { if (!activeRelationCreateRef.current) setRelationDraft({ ...relationDraft, injectionWell: e.target.value }); }}/><input aria-label="手工关系采油井" className="field-control" required placeholder="采油井" value={relationDraft.productionWell} disabled={relationCreating} onChange={(e) => { if (!activeRelationCreateRef.current) setRelationDraft({ ...relationDraft, productionWell: e.target.value }); }}/><input aria-label="手工关系层系" className="field-control" required placeholder="层系" value={relationDraft.reservoirLayer} disabled={relationCreating} onChange={(e) => { if (!activeRelationCreateRef.current) setRelationDraft({ ...relationDraft, reservoirLayer: e.target.value }); }}/><input aria-label="手工关系证据" className="field-control" required placeholder="证据" value={relationDraft.evidence} disabled={relationCreating} onChange={(e) => { if (!activeRelationCreateRef.current) setRelationDraft({ ...relationDraft, evidence: e.target.value }); }}/><input aria-label="手工关系负责人" className="field-control" required placeholder="责任人" value={relationDraft.owner} disabled={relationCreating} onChange={(e) => { if (!activeRelationCreateRef.current) setRelationDraft({ ...relationDraft, owner: e.target.value }); }}/><button aria-label="手工新增关系" className="action-button action-primary md:col-span-3" disabled={relationCreating}>{relationCreating ? '正在新增…' : '手工新增关系'}</button></form>}
          <div className="mt-3 space-y-2">{visibleRelations.map((row) => { const protectedKey = `${selected.id}:${row.id}`; const historyProtected = row.canDelete === false || protectedRelationKeys.has(protectedKey); return <div key={row.id} className="flex flex-wrap items-center gap-3 text-sm"><span className="rounded bg-slate-100 px-2 py-1">{channelingTypeLabels[row.channelingType]}</span><span>{row.injectionWell} → {row.productionWell} · {row.reservoirLayer} · {relationLabels[row.status]}</span><button type="button" onClick={() => onOpenRelation(row.id)}>查看详情/跟踪记录</button>{canOperate && row.status === 'suspected' && <button onClick={() => void confirmSuspected(row.id)}>提交疑似确认</button>}{isAdmin && row.status !== 'released' && <button onClick={() => void releaseRelation(row.id)}>解除关系</button>}{isAdmin && <button disabled={historyProtected} onClick={() => void deleteRelation(row.id)}>删除关系</button>}{historyProtected && <span className="text-amber-700">已有跟踪历史，请解除关系并保留历史。</span>}</div>; })}{!visibleRelations.length && <p className="text-sm text-slate-500">暂无符合条件的关系{canOperate ? '，可手工新增或通过上方识别卡导入 Excel 关系。' : '。'}</p>}</div><div className="mt-3 space-y-1">{imports.map((item) => <div key={item.id} className="flex flex-wrap gap-3 text-sm"><span>{item.fileName} · {channelingTypeLabels[item.channelingType]}：有效 {item.validCount}，重复 {item.duplicateCount}，自身 {item.selfRelationCount}，无效 {item.invalidCount}</span>{canOperate && item.status === 'preview' && <button disabled={confirming} onClick={() => void confirmImport(item.id)}>{confirmingImportIdRef.current === item.id ? '正在确认…' : '确认导入'}</button>}</div>)}</div></section>}
        {projectTab === 'timeline' && <div id="project-panel-timeline" role="tabpanel" aria-labelledby="project-tab-timeline" className="mt-4"><ChannelingTimeline role={isAdmin ? 'admin' : 'guest'} subject={{ subjectType: 'project', subjectId: selected.id }}/></div>}
      </section> : <section className="app-card p-5 text-sm text-slate-500">暂无项目详情。{canOperate ? '请新建项目；关系文件仍可先在上方识别预览。' : '可使用左侧筛选查看完整台账。'}</section>}
    </section>
  </div>;
}
