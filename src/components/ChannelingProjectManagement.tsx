import { useEffect, useRef, useState } from 'react';
import type { ChannelingProject, ChannelingRelation, ChannelingRelationInput } from '../lib/channelingProjectStore';
import type { ChannelingRelationImport } from '../lib/channelingRelationImport';

const today = () => new Date().toISOString().slice(0, 10);
const blankRelation = (): Omit<ChannelingRelationInput, 'projectId'> => ({ injectionWell: '', productionWell: '', reservoirLayer: '', impactLevel: 'medium', confidence: 0.5, status: 'confirmed', source: 'manual', evidence: '', effectiveStartDate: today(), effectiveEndDate: today(), owner: '' });
const statusLabel = { confirmed: '已确认', suspected: '疑似', released: '已解除' } as const;

type Props = { canEdit: boolean };
export function ChannelingProjectManagement({ canEdit }: Props) {
  const [projects, setProjects] = useState<ChannelingProject[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [relations, setRelations] = useState<ChannelingRelation[]>([]);
  const [imports, setImports] = useState<ChannelingRelationImport[]>([]);
  const [projectDraft, setProjectDraft] = useState({ projectName: '', block: '', owner: '' });
  const [relationDraft, setRelationDraft] = useState(blankRelation());
  const [message, setMessage] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);
  const selected = projects.find((item) => item.id === selectedId) ?? null;
  const loadProjects = async () => {
    const payload = await (await fetch('/api/channeling-projects')).json();
    if (payload.success) { setProjects(payload.data); setSelectedId((current) => current ?? payload.data[0]?.id ?? null); }
  };
  const loadDetail = async (id: number) => {
    const [relationsResponse, importsResponse] = await Promise.all([fetch(`/api/channeling-projects/${id}/relations`), fetch(`/api/channeling-projects/${id}/relation-imports`)]);
    const [relationPayload, importPayload] = await Promise.all([relationsResponse.json(), importsResponse.json()]);
    if (relationPayload.success) setRelations(relationPayload.data);
    if (importPayload.success) setImports(importPayload.data);
  };
  useEffect(() => { void loadProjects().catch(() => setMessage('项目加载失败')); }, []);
  useEffect(() => { if (selectedId) void loadDetail(selectedId).catch(() => setMessage('关系加载失败')); else { setRelations([]); setImports([]); } }, [selectedId]);
  const request = async (url: string, init: RequestInit) => {
    const response = await fetch(url, init); const payload = await response.json();
    if (!response.ok || !payload.success) throw new Error(payload.message || '操作失败');
    return payload.data;
  };
  const createProject = async (event: React.FormEvent) => {
    event.preventDefault();
    try { const created = await request('/api/channeling-projects', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(projectDraft) }); setProjectDraft({ projectName: '', block: '', owner: '' }); await loadProjects(); setSelectedId(created.id); setMessage('项目已新增'); } catch (error: any) { setMessage(error.message); }
  };
  const createRelation = async (event: React.FormEvent) => {
    event.preventDefault(); if (!selected) return;
    try { await request(`/api/channeling-projects/${selected.id}/relations`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(relationDraft) }); setRelationDraft(blankRelation()); await loadDetail(selected.id); setMessage('关系已保存'); } catch (error: any) { setMessage(error.message); }
  };
  const upload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]; event.target.value = ''; if (!file || !selected) return;
    const body = new FormData(); body.append('file', file);
    try { const preview = await request(`/api/channeling-projects/${selected.id}/relation-imports/preview`, { method: 'POST', body }); await loadDetail(selected.id); setMessage(`已生成导入预览：有效 ${preview.validCount} 行，无效 ${preview.invalidCount} 行`); } catch (error: any) { setMessage(error.message); }
  };
  const confirmImport = async (id: number) => { try { await request(`/api/channeling-relation-imports/${id}/confirm`, { method: 'POST' }); if (selected) await loadDetail(selected.id); setMessage('导入已确认'); } catch (error: any) { setMessage(error.message); } };
  const confirmSuspected = async (relation: ChannelingRelation) => { try { await request(`/api/channeling-relations/${relation.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status: 'confirmed' }) }); if (selected) await loadDetail(selected.id); setMessage('疑似关系已确认'); } catch (error: any) { setMessage(error.message); } };
  return <div className="page-stack">
    <section className="app-card p-5"><div className="flex flex-wrap items-start justify-between gap-3"><div><h3 className="section-title">注窜项目台账</h3><p className="mt-1 text-sm text-slate-500">管理注井—采油井窜流关系，并在地图中按状态显示。</p></div><span className={`rounded px-2 py-1 text-xs font-bold ${canEdit ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-600'}`}>{canEdit ? '编辑权限' : '只读权限'}</span></div>{message && <p className="status-banner status-banner-info mt-3">{message}</p>}
      {canEdit && <form className="mt-4 grid gap-2 md:grid-cols-4" onSubmit={createProject}><input className="field-control" required placeholder="项目名称" value={projectDraft.projectName} onChange={(e) => setProjectDraft({ ...projectDraft, projectName: e.target.value })}/><input className="field-control" required placeholder="区块" value={projectDraft.block} onChange={(e) => setProjectDraft({ ...projectDraft, block: e.target.value })}/><input className="field-control" required placeholder="负责人" value={projectDraft.owner} onChange={(e) => setProjectDraft({ ...projectDraft, owner: e.target.value })}/><button className="action-button action-primary">新增项目</button></form>}</section>
    <section className="grid gap-4 lg:grid-cols-[280px_1fr]"><aside className="app-card p-3"><h4 className="mb-2 font-bold">项目列表</h4>{projects.map((project) => <button key={project.id} onClick={() => setSelectedId(project.id)} className={`mb-2 w-full rounded border p-3 text-left text-sm ${project.id === selectedId ? 'border-red-300 bg-red-50' : 'border-slate-200'}`}><b>{project.projectName}</b><span className="mt-1 block text-slate-500">{project.block} · {project.owner}</span></button>)}{!projects.length && <p className="text-sm text-slate-500">暂无项目</p>}</aside>
      <div className="space-y-4">{selected && <><section className="app-card p-5"><div className="flex flex-wrap items-center justify-between gap-3"><div><h3 className="font-bold">{selected.projectName}</h3><p className="text-sm text-slate-500">{selected.block} · {selected.owner}</p></div>{canEdit && <><input ref={fileRef} type="file" accept=".xlsx,.xls" className="hidden" onChange={upload}/><button className="action-button action-outline" onClick={() => fileRef.current?.click()}>导入关系 Excel</button></>}</div>
        {canEdit && <form className="mt-4 grid gap-2 md:grid-cols-3" onSubmit={createRelation}><input className="field-control" required placeholder="注井" value={relationDraft.injectionWell} onChange={(e) => setRelationDraft({ ...relationDraft, injectionWell: e.target.value })}/><input className="field-control" required placeholder="采油井" value={relationDraft.productionWell} onChange={(e) => setRelationDraft({ ...relationDraft, productionWell: e.target.value })}/><select className="field-control" value={relationDraft.impactLevel} onChange={(e) => setRelationDraft({ ...relationDraft, impactLevel: e.target.value as any })}><option value="high">高影响</option><option value="medium">中影响</option><option value="low">低影响</option></select><input className="field-control" required placeholder="层系" value={relationDraft.reservoirLayer} onChange={(e) => setRelationDraft({ ...relationDraft, reservoirLayer: e.target.value })}/><input className="field-control" required placeholder="证据" value={relationDraft.evidence} onChange={(e) => setRelationDraft({ ...relationDraft, evidence: e.target.value })}/><input className="field-control" required placeholder="负责人" value={relationDraft.owner} onChange={(e) => setRelationDraft({ ...relationDraft, owner: e.target.value })}/><input className="field-control" type="date" value={relationDraft.effectiveStartDate} onChange={(e) => setRelationDraft({ ...relationDraft, effectiveStartDate: e.target.value })}/><input className="field-control" type="date" value={relationDraft.effectiveEndDate} onChange={(e) => setRelationDraft({ ...relationDraft, effectiveEndDate: e.target.value })}/><button className="action-button action-primary">手工新增关系</button></form>}</section>
        <section className="app-card overflow-hidden"><div className="app-card-header"><h3 className="font-bold">关系清单（{relations.length}）</h3></div><div className="overflow-x-auto"><table className="w-full min-w-[760px] text-left text-sm"><thead className="bg-slate-50 text-xs text-slate-500"><tr>{['注井','采油井','层系','影响','置信度','状态','证据','操作'].map((x) => <th className="px-3 py-2" key={x}>{x}</th>)}</tr></thead><tbody>{relations.map((row) => <tr className="border-t" key={row.id}><td className="px-3 py-2">{row.injectionWell}</td><td className="px-3 py-2">{row.productionWell}</td><td className="px-3 py-2">{row.reservoirLayer}</td><td className="px-3 py-2">{row.impactLevel}</td><td className="px-3 py-2">{Math.round(row.confidence * 100)}%</td><td className="px-3 py-2"><span className="rounded bg-slate-100 px-2 py-1">{statusLabel[row.status]}</span></td><td className="px-3 py-2">{row.evidence}</td><td className="px-3 py-2">{canEdit && row.status === 'suspected' && <button className="text-violet-700" onClick={() => void confirmSuspected(row)}>确认疑似</button>}</td></tr>)}{!relations.length && <tr><td className="px-3 py-4 text-slate-500" colSpan={8}>暂无关系</td></tr>}</tbody></table></div></section>
        <section className="app-card p-5"><h3 className="font-bold">导入批次</h3><div className="mt-3 space-y-2">{imports.map((item) => <div key={item.id} className="flex flex-wrap items-center justify-between gap-2 rounded border border-slate-200 p-3 text-sm"><span>{item.fileName}：有效 {item.validCount}，无效 {item.invalidCount}</span><span>{item.status === 'preview' ? '待确认' : '已确认'}</span>{canEdit && item.status === 'preview' && <button className="action-button action-primary h-8" onClick={() => void confirmImport(item.id)}>确认导入</button>}</div>)}{!imports.length && <p className="text-sm text-slate-500">暂无导入批次</p>}</div></section></>}</div></section>
  </div>;
}
