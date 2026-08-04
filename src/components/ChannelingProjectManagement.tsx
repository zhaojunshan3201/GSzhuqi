import { useEffect, useMemo, useState } from 'react';
import type { ChannelingGovernanceStatus, ChannelingProject, ChannelingRelation, ChannelingRelationInput, ChannelingType } from '../lib/channelingProjectStore';
import type { ChannelingRelationImport, ChannelingRelationImportRow } from '../lib/channelingRelationImport';

const statusLabels: Record<ChannelingGovernanceStatus, string> = { identified: '识别/导入', confirmed: '确认', risk_assessed: '风险分级', planned: '治理方案', governing: '执行跟踪', verifying: '效果验证', closed: '关闭', recurred: '复发回流' };
const relationLabels = { confirmed: '已确认', suspected: '疑似', released: '已解除' } as const;
const channelingTypeLabels: Record<ChannelingType, string> = { steam: '注汽窜', nitrogen: '注氮气窜' };
const today = () => new Date().toISOString().slice(0, 10);
const blankRelation = (): Omit<ChannelingRelationInput, 'projectId'> => ({ channelingType: 'steam', injectionWell: '', productionWell: '', reservoirLayer: '', impactLevel: 'medium', confidence: .5, status: 'confirmed', source: 'manual', evidence: '', effectiveStartDate: today(), effectiveEndDate: today(), owner: '' });
type Props = { role: string };

export function ChannelingProjectManagement({ role }: Props) {
  const isAdmin = role === 'admin';
  const canOperate = isAdmin;
  const [projects, setProjects] = useState<ChannelingProject[]>([]);
  const [todos, setTodos] = useState<(ChannelingProject & { overdue: boolean })[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [message, setMessage] = useState('');
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
  const [validRowsExpanded, setValidRowsExpanded] = useState(false);
  const selected = projects.find((item) => item.id === selectedId);
  const visibleProjects = useMemo(() => projects.filter((item) => (!projectFilters.block || item.block.includes(projectFilters.block)) && (!projectFilters.status || item.status === projectFilters.status)), [projects, projectFilters]);
  const visibleRelations = useMemo(() => relations.filter((item) => (!relationFilters.channelingType || item.channelingType === relationFilters.channelingType) && (!relationFilters.status || item.status === relationFilters.status) && (!relationFilters.source || item.source === relationFilters.source)), [relations, relationFilters]);
  const visibleValidRows = preview?.valid ? (validRowsExpanded ? preview.valid : preview.valid.slice(0, 10)) : [];
  const token = localStorage.getItem('token');
  const headers = token ? { Authorization: `Bearer ${token}` } : {};

  const load = async () => {
    const [projectResponse, todoResponse] = await Promise.all([fetch('/api/channeling-projects'), fetch(`/api/channeling-projects/pending?date=${today()}`)]);
    const [projectPayload, todoPayload] = await Promise.all([projectResponse.json(), todoResponse.json()]);
    if (projectPayload.success) { setProjects(projectPayload.data); setSelectedId((id) => id ?? projectPayload.data[0]?.id ?? null); }
    if (todoPayload.success) setTodos(todoPayload.data);
  };
  useEffect(() => { void load().catch(() => setMessage('项目加载失败，请稍后重试。')); }, []);

  const loadRelations = async (projectId: number) => {
    const typeQuery = relationFilters.channelingType ? `?channelingType=${encodeURIComponent(relationFilters.channelingType)}` : '';
    const [relationPayload, importPayload] = await Promise.all([fetch(`/api/channeling-projects/${projectId}/relations${typeQuery}`).then((r) => r.json()), fetch(`/api/channeling-projects/${projectId}/relation-imports`).then((r) => r.json())]);
    if (relationPayload.success) setRelations(relationPayload.data);
    if (importPayload.success) setImports(importPayload.data);
  };
  useEffect(() => { if (selectedId) void loadRelations(selectedId).catch(() => setMessage('关系加载失败，请稍后重试。')); else { setRelations([]); setImports([]); } }, [selectedId, relationFilters.channelingType]);

  const request = async (url: string, init: RequestInit) => {
    const response = await fetch(url, { ...init, headers: { ...headers, ...(init.headers || {}) } });
    if (response.status === 401) {
      localStorage.removeItem('token');
      localStorage.removeItem('oil_system_user');
      window.dispatchEvent(new Event('auth-expired'));
      throw new Error('Authentication expired. Please sign in again.');
    }
    const payload = await response.json();
    if (!response.ok || !payload.success) throw new Error(payload.message || 'Operation failed');
    return payload.data;
  };

  const save = async (changes: Record<string, unknown>) => { if (!selected) return; try { await request(`/api/channeling-projects/${selected.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(changes) }); await load(); setMessage('治理台账已保存。'); } catch (error: any) { setMessage(error.message); } };
  const create = async (event: React.FormEvent) => { event.preventDefault(); try { const created = await request('/api/channeling-projects', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(newProject) }); setNewProject({ projectName: '', block: '', owner: '' }); await load(); setSelectedId(created.id); setPreviewProjectId((id) => id ?? created.id); } catch (error: any) { setMessage(error.message); } };
  const createRelation = async (event: React.FormEvent) => { event.preventDefault(); if (!selected) return; try { await request(`/api/channeling-projects/${selected.id}/relations`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(relationDraft) }); setRelationDraft(blankRelation()); await loadRelations(selected.id); } catch (error: any) { setMessage(error.message); } };
  const uploadRelations = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    if (!/\.xlsx?$/i.test(file.name)) { setMessage('请选择 .xlsx 或 .xls 格式的关系文件。'); return; }
    const body = new FormData();
    body.append('file', file);
    body.append('channelingType', channelingType);
    setUploading(true);
    setPreview(null);
    setValidRowsExpanded(false);
    setMessage('正在解析关系文件，请稍候…');
    try {
      const parsed = await request('/api/channeling-relation-imports/preview', { method: 'POST', body });
      setPreview(parsed);
      setPreviewProjectId(selectedId ?? projects[0]?.id ?? null);
      setMessage(`解析完成：${parsed.validCount} 条有效关系，请检查预览后选择项目确认。`);
    } catch (error: any) {
      setMessage(`解析失败：${error.message || '请检查文件格式和表头后重试。'}`);
    } finally {
      setUploading(false);
    }
  };
  const confirmPreview = async () => {
    if (!preview || !previewProjectId) return;
    try {
      await request(`/api/channeling-relation-imports/${preview.id}/confirm`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ projectId: previewProjectId }) });
      setSelectedId(previewProjectId);
      await load();
      await loadRelations(previewProjectId);
      setPreview(null);
      setValidRowsExpanded(false);
      setMessage('关系导入已确认并写入所选项目。');
    } catch (error: any) { setMessage(`确认失败：${error.message}`); }
  };
  const confirmImport = async (id: number) => { try { await request(`/api/channeling-relation-imports/${id}/confirm`, { method: 'POST' }); if (selected) await loadRelations(selected.id); } catch (error: any) { setMessage(error.message); } };
  const confirmSuspected = async (id: number) => { try { await request(`/api/channeling-relations/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status: 'confirmed' }) }); if (selected) await loadRelations(selected.id); } catch (error: any) { setMessage(error.message); } };
  const releaseRelation = async (id: number) => { try { await request(`/api/channeling-relations/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status: 'released' }) }); if (selected) await loadRelations(selected.id); } catch (error: any) { setMessage(error.message); } };
  const deleteProject = async () => { if (!selected || !window.confirm('删除后无法恢复，是否继续？')) return; try { await request(`/api/channeling-projects/${selected.id}`, { method: 'DELETE' }); setSelectedId(null); await load(); } catch (error: any) { setMessage(error.message); } };
  const deleteRelation = async (id: number) => { if (!window.confirm('删除关系后无法恢复，是否继续？')) return; try { await request(`/api/channeling-relations/${id}`, { method: 'DELETE' }); if (selected) await loadRelations(selected.id); } catch (error: any) { setMessage(error.message); } };

  const previewRelationRow = (row: ChannelingRelationImportRow, status: string) => <tr key={`${status}-${row.rowNumber}-${row.injectorWellNo}-${row.producerWellNo}`}><td className="px-2 py-2">{row.rowNumber}</td><td className="px-2 py-2">{status}</td><td className="px-2 py-2">{row.injectorWellNo}</td><td className="px-2 py-2">{row.producerWellNo}</td></tr>;

  return <div className="page-stack">
    <section className="app-card p-5"><h3 className="section-title">注窜项目台账（治理闭环）</h3><p className="mt-1 text-sm text-slate-500">游客只读，可查看完整项目、关系和筛选结果；管理员可维护、导入、确认、治理、关闭、解除和删除。</p>{message && <p className="status-banner status-banner-info mt-3">{message}</p>}
      {canOperate && <form className="mt-4 grid gap-2 md:grid-cols-4" onSubmit={create}><input className="field-control" required placeholder="项目名称" value={newProject.projectName} onChange={(e) => setNewProject({ ...newProject, projectName: e.target.value })}/><input className="field-control" required placeholder="区块" value={newProject.block} onChange={(e) => setNewProject({ ...newProject, block: e.target.value })}/><input className="field-control" required placeholder="责任人" value={newProject.owner} onChange={(e) => setNewProject({ ...newProject, owner: e.target.value })}/><button className="action-button action-primary">新增项目</button></form>}</section>

    <section className="app-card p-5"><div className="flex flex-wrap items-start justify-between gap-3"><div><h3 className="section-title">注窜关系识别</h3><p className="mt-1 text-sm text-slate-500">上传一个 Excel 文件进行分类预览，再确认写入现有项目。关系类型：注汽窜 / 注氮气窜。</p></div>{!isAdmin && <span className="rounded bg-slate-100 px-2 py-1 text-sm text-slate-600">游客只读</span>}</div>
      {isAdmin && <div className="mt-4 flex flex-wrap items-center gap-4"><fieldset className="flex gap-4"><legend className="sr-only">注窜类型</legend>{(['steam', 'nitrogen'] as ChannelingType[]).map((value) => <label key={value} className="flex items-center gap-2 text-sm"><input type="radio" name="channeling-type" value={value} checked={channelingType === value} disabled={uploading} onChange={() => setChannelingType(value)}/>{channelingTypeLabels[value]}</label>)}</fieldset><label className="text-sm">关系文件<input className="ml-2" type="file" accept=".xlsx,.xls" disabled={uploading} onChange={uploadRelations}/></label>{uploading && <span className="text-sm text-slate-500">正在解析上传文件…</span>}</div>}
      {preview && <div className="mt-4 rounded-lg border border-slate-200 p-4"><div className="flex flex-wrap items-center justify-between gap-3"><div><p className="font-bold">{preview.fileName} · {channelingTypeLabels[preview.channelingType]}</p><p className="mt-1 text-sm text-slate-500">请先检查异常行和有效关系，再选择目标项目确认。</p></div><div className="grid grid-cols-4 gap-2 text-center text-sm"><span className="rounded bg-emerald-50 px-3 py-2">有效关系<br/><b>{preview.validCount}</b></span><span className="rounded bg-amber-50 px-3 py-2">重复关系<br/><b>{preview.duplicateCount}</b></span><span className="rounded bg-orange-50 px-3 py-2">自身关系<br/><b>{preview.selfRelationCount}</b></span><span className="rounded bg-red-50 px-3 py-2">无效行<br/><b>{preview.invalidCount}</b></span></div></div>
        <div className="mt-4 max-h-72 overflow-auto"><table className="w-full min-w-[620px] text-left text-sm"><thead className="bg-slate-50 text-xs text-slate-500"><tr><th className="px-2 py-2">源行号</th><th className="px-2 py-2">状态</th><th className="px-2 py-2">注入井</th><th className="px-2 py-2">生产井 / 原因</th></tr></thead><tbody className="divide-y divide-slate-100">{(preview.duplicates || []).map((row) => previewRelationRow(row, '重复'))}{(preview.selfRelations || []).map((row) => previewRelationRow(row, '自身关系'))}{(preview.invalid || []).map((row) => <tr key={`invalid-${row.row}`}><td className="px-2 py-2">{row.row}</td><td className="px-2 py-2">无效</td><td className="px-2 py-2">--</td><td className="px-2 py-2">{row.reason}</td></tr>)}{visibleValidRows.map((row) => previewRelationRow(row, '有效'))}</tbody></table></div>
        {(preview.valid?.length || 0) > 10 && <button className="mt-3 text-sm text-blue-700" onClick={() => setValidRowsExpanded((value) => !value)}>{validRowsExpanded ? '收起有效关系列表' : `展开全部有效关系（${preview.validCount}）`}</button>}
        {isAdmin && <div className="mt-4 flex flex-wrap items-end gap-3"><label className="min-w-64 flex-1 text-sm">确认到项目<select className="field-control mt-1" value={previewProjectId ?? ''} onChange={(e) => setPreviewProjectId(e.target.value ? Number(e.target.value) : null)}><option value="">请选择项目</option>{projects.map((project) => <option key={project.id} value={project.id}>{project.projectName} · {project.block}</option>)}</select></label><button className="action-button action-primary" disabled={!previewProjectId || uploading} onClick={() => void confirmPreview()}>确认导入</button></div>}{isAdmin && !projects.length && <p className="mt-2 text-sm text-amber-700">没有项目可确认，请先通过上方表单新建项目；创建后可直接继续确认当前预览。</p>}</div>}
    </section>

    <section className="grid gap-4 lg:grid-cols-[320px_1fr]"><aside className="app-card p-4"><h4 className="font-bold">完整项目清单</h4><div className="mt-3 grid gap-2"><input className="field-control" placeholder="按区块筛选" value={projectFilters.block} onChange={(e) => setProjectFilters({ ...projectFilters, block: e.target.value })}/><select className="field-control" aria-label="项目状态筛选" value={projectFilters.status} onChange={(e) => setProjectFilters({ ...projectFilters, status: e.target.value })}><option value="">全部状态</option>{Object.entries(statusLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></div><div className="mt-3 space-y-2">{visibleProjects.map((item) => <button key={item.id} onClick={() => setSelectedId(item.id)} className={`w-full rounded border p-3 text-left text-sm ${item.id === selectedId ? 'border-red-300 bg-red-50' : 'border-slate-200'}`}><b>{item.projectName}</b><span className="mt-1 block text-slate-500">{item.block} · {statusLabels[item.status]} · {item.owner}</span></button>)}{!visibleProjects.length && <p className="text-sm text-slate-500">没有符合条件的项目{canOperate ? '，可在上方新建项目。' : '。'}</p>}</div><h4 className="mt-6 font-bold">治理待办</h4><div className="mt-2 space-y-2">{todos.map((item) => <button key={item.id} onClick={() => setSelectedId(item.id)} className="w-full text-left text-sm text-slate-600">{item.projectName}{item.overdue ? ' · 已超期' : ''}</button>)}{!todos.length && <p className="text-sm text-slate-500">暂无待办，但可通过上方清单查看全部台账。</p>}</div></aside>
      {selected ? <section className="app-card p-5"><div className="flex items-center justify-between"><div><h3 className="font-bold">{selected.projectName}</h3><p className="text-sm text-slate-500">{selected.block} · {selected.owner}</p></div><div className="flex gap-2"><span className="rounded bg-slate-100 px-2 py-1 text-sm">{statusLabels[selected.status]}</span>{isAdmin && <button className="action-button" onClick={() => void deleteProject()}>删除项目</button>}</div></div>
        {canOperate && <form key={selected.id} className="mt-4 grid gap-3 md:grid-cols-2" onSubmit={(e) => { e.preventDefault(); const data = new FormData(e.currentTarget); void save({ owner: data.get('owner'), governanceMeasure: data.get('governanceMeasure'), plannedDate: data.get('plannedDate') || null, riskLevel: data.get('riskLevel'), ...(isAdmin ? { status: data.get('status'), closureEvidence: data.get('closureEvidence') } : {}) }); }}><label>项目状态<select name="status" className="field-control" defaultValue={selected.status} disabled={!isAdmin}>{Object.entries(statusLabels).filter(([value]) => isAdmin || value !== 'closed').map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label><label>责任人<input name="owner" className="field-control" defaultValue={selected.owner}/></label><label className="md:col-span-2">治理措施<input name="governanceMeasure" className="field-control" defaultValue={selected.governanceMeasure}/></label><label>计划日期<input name="plannedDate" type="date" className="field-control" defaultValue={selected.plannedDate ?? ''}/></label><label>风险等级<select name="riskLevel" className="field-control" defaultValue={selected.riskLevel}><option value="high">高</option><option value="medium">中</option><option value="low">低</option></select></label>{isAdmin && <label className="md:col-span-2">关闭依据<input name="closureEvidence" className="field-control" defaultValue={selected.closureEvidence}/></label>}<button className="action-button action-primary md:col-span-2">保存治理信息</button></form>}
        <section className="mt-6 border-t pt-4"><h4 className="font-bold">关系清单</h4><div className="mt-3 grid gap-2 md:grid-cols-3"><select className="field-control" aria-label="注窜类型筛选" value={relationFilters.channelingType} onChange={(e) => setRelationFilters({ ...relationFilters, channelingType: e.target.value })}><option value="">全部注窜类型</option><option value="steam">注汽窜</option><option value="nitrogen">注氮气窜</option></select><select className="field-control" aria-label="关系状态筛选" value={relationFilters.status} onChange={(e) => setRelationFilters({ ...relationFilters, status: e.target.value })}><option value="">全部关系状态</option>{Object.entries(relationLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select><select className="field-control" aria-label="关系来源筛选" value={relationFilters.source} onChange={(e) => setRelationFilters({ ...relationFilters, source: e.target.value })}><option value="">全部来源</option><option value="manual">手工</option><option value="import">导入</option><option value="suspected">疑似识别</option></select></div>
          {canOperate && <form className="mt-3 grid gap-2 md:grid-cols-3" onSubmit={createRelation}><select className="field-control" aria-label="手工关系注窜类型" value={relationDraft.channelingType} onChange={(e) => setRelationDraft({ ...relationDraft, channelingType: e.target.value as ChannelingType })}><option value="steam">注汽窜</option><option value="nitrogen">注氮气窜</option></select><input className="field-control" required placeholder="注井" value={relationDraft.injectionWell} onChange={(e) => setRelationDraft({ ...relationDraft, injectionWell: e.target.value })}/><input className="field-control" required placeholder="采油井" value={relationDraft.productionWell} onChange={(e) => setRelationDraft({ ...relationDraft, productionWell: e.target.value })}/><input className="field-control" required placeholder="层系" value={relationDraft.reservoirLayer} onChange={(e) => setRelationDraft({ ...relationDraft, reservoirLayer: e.target.value })}/><input className="field-control" required placeholder="证据" value={relationDraft.evidence} onChange={(e) => setRelationDraft({ ...relationDraft, evidence: e.target.value })}/><input className="field-control" required placeholder="责任人" value={relationDraft.owner} onChange={(e) => setRelationDraft({ ...relationDraft, owner: e.target.value })}/><button className="action-button action-primary md:col-span-3">手工新增关系</button></form>}
          <div className="mt-3 space-y-2">{visibleRelations.map((row) => <div key={row.id} className="flex flex-wrap items-center gap-3 text-sm"><span className="rounded bg-slate-100 px-2 py-1">{channelingTypeLabels[row.channelingType]}</span><span>{row.injectionWell} → {row.productionWell} · {row.reservoirLayer} · {relationLabels[row.status]}</span>{canOperate && row.status === 'suspected' && <button onClick={() => void confirmSuspected(row.id)}>提交疑似确认</button>}{isAdmin && row.status !== 'released' && <button onClick={() => void releaseRelation(row.id)}>解除关系</button>}{isAdmin && <button onClick={() => void deleteRelation(row.id)}>删除关系</button>}</div>)}{!visibleRelations.length && <p className="text-sm text-slate-500">暂无符合条件的关系{canOperate ? '，可手工新增或通过上方识别卡导入 Excel 关系。' : '。'}</p>}</div><div className="mt-3 space-y-1">{imports.map((item) => <div key={item.id} className="flex flex-wrap gap-3 text-sm"><span>{item.fileName} · {channelingTypeLabels[item.channelingType]}：有效 {item.validCount}，重复 {item.duplicateCount}，自身 {item.selfRelationCount}，无效 {item.invalidCount}</span>{canOperate && item.status === 'preview' && <button onClick={() => void confirmImport(item.id)}>确认导入</button>}</div>)}</div></section></section> : <section className="app-card p-5 text-sm text-slate-500">暂无项目详情。{canOperate ? '请新建项目；关系文件仍可先在上方识别预览。' : '可使用左侧筛选查看完整台账。'}</section>}
    </section>
  </div>;
}
