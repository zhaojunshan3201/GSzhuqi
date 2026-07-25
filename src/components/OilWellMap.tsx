import { useEffect, useRef, useState } from 'react';
import { ChevronDown, ChevronUp, MapPinned, Minus, Palette, Plus, RotateCcw, Trash2, Upload, X } from 'lucide-react';
import { buildInjectionStatusMapQuery, createLatestRequestGate, getDrawerFocusIndex, getStatusMapNavigation } from '../lib/injectionStatusMapNavigation';
import type { InjectionMapAlertType, InjectionMapLifecycleStatus, InjectionMapWell, InjectionStatusMapResponse } from '../lib/injectionStatusMap';
import { fitWellMapToWidth, getMarkerAnchorStyle, resolveInjectionLifecycleColor, resolveMarkerColor, type WellMapCategory, type WellMapCategoryWell, type WellMapMarker } from '../lib/oilWellMapMarkers';

const BLOCKS = [
  { name: '高3块', image: '/oil-well-map-assets/高3块.bmp' },
  { name: '高3624块', image: '/oil-well-map-assets/高3624.jpg' },
  { name: '高3618块', image: '/oil-well-map-assets/2026-高3618_L5.jpg' },
  { name: '高246块', image: '/oil-well-map-assets/高246块井位部署图(莲V顶).bmp' },
  { name: '高21块', image: '/oil-well-map-assets/高21.jpg' },
  { name: '高10块', image: '/oil-well-map-assets/高10块井位构造图.jpg' },
] as const;

const lifecycleLabels: Record<InjectionMapLifecycleStatus, string> = {
  pending: '待实施', injecting: '注汽中', soaking: '焖井中', pendingTransfer: '待转抽', producing: '生产响应', closed: '已关闭', needsData: '数据待补',
};
const alertLabels: Record<InjectionMapAlertType, string> = {
  needsData: '数据待补', notEvaluated: '未评价', lowEfficiency: '低效', soakingOverdue: '焖井超期', transferOverdue: '转抽超期',
};

type MapFilters = {
  lifecycleStatus: '' | InjectionMapLifecycleStatus;
  planMonth: string;
  alertType: '' | InjectionMapAlertType;
  overdue: boolean;
  keyword: string;
};
type OilWellMapProps = {
  isAdmin: boolean;
  onNavigate: (tab: 'injectionPlan' | 'measures' | 'measureAnalysis', filters: { projectId?: number; keyword?: string }) => void;
};

function display(value: unknown) {
  return value == null || value === '' ? '--' : String(value);
}

export function OilWellMap({ isAdmin, onNavigate }: OilWellMapProps) {
  const [selectedBlock, setSelectedBlock] = useState<string>(BLOCKS[3].name);
  const [filters, setFilters] = useState<MapFilters>({ lifecycleStatus: '', planMonth: '', alertType: '', overdue: false, keyword: '' });
  const [mapData, setMapData] = useState<InjectionStatusMapResponse | null>(null);
  const [producingWells, setProducingWells] = useState<string[]>([]);
  const [mapError, setMapError] = useState('');
  const [loading, setLoading] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const [markers, setMarkers] = useState<WellMapMarker[]>([]);
  const [categories, setCategories] = useState<WellMapCategory[]>([]);
  const [categoryWells, setCategoryWells] = useState<WellMapCategoryWell[]>([]);
  const [selectedWell, setSelectedWell] = useState<InjectionMapWell | null>(null);
  const [showUnlocated, setShowUnlocated] = useState(false);
  const [showMarkerSettings, setShowMarkerSettings] = useState(false);
  const [showCategoryManager, setShowCategoryManager] = useState(false);
  const [showLabels, setShowLabels] = useState(false);
  const [showDeleteButtons, setShowDeleteButtons] = useState(false);
  const [calibrationMode, setCalibrationMode] = useState(false);
  const [selectedWellNo, setSelectedWellNo] = useState('');
  const [selectedCategoryId, setSelectedCategoryId] = useState<number | null>(null);
  const [categoryDraft, setCategoryDraft] = useState({ name: '', color: '#7c3aed', priority: 10, remark: '' });
  const [message, setMessage] = useState('');
  const [scale, setScale] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [dragStart, setDragStart] = useState<{ x: number; y: number } | null>(null);
  const [mapSize, setMapSize] = useState<{ width: number; height: number } | null>(null);
  const mapRef = useRef<HTMLDivElement>(null);
  const mapViewportRef = useRef<HTMLDivElement>(null);
  const dailyDataInputRef = useRef<HTMLInputElement>(null);
  const requestGateRef = useRef(createLatestRequestGate());
  const drawerRef = useRef<HTMLElement>(null);
  const drawerCloseRef = useRef<HTMLButtonElement>(null);
  const selectedWellTriggerRef = useRef<HTMLButtonElement>(null);
  const selected = BLOCKS.find((block) => block.name === selectedBlock) ?? BLOCKS[0];

  const loadMarkers = async (block = selectedBlock) => {
    const response = await fetch(`/api/oil-well-map/markers?block=${encodeURIComponent(block)}`);
    const payload = await response.json();
    if (payload.success) setMarkers(payload.data);
  };
  const loadCategories = async () => {
    const response = await fetch('/api/oil-well-map/categories');
    const payload = await response.json();
    if (payload.success) {
      setCategories(payload.data.categories.map((category: Omit<WellMapCategory, 'visible'>) => ({ ...category, visible: true })));
      setCategoryWells(payload.data.relations);
    }
  };

  useEffect(() => { void loadCategories().catch(() => setMessage('分类读取失败')); }, []);
  useEffect(() => {
    void fetch('/api/oil-well-map/production-wells').then((response) => response.json()).then((payload) => {
      if (payload.success) setProducingWells(payload.data.wells);
    }).catch(() => setMessage('生产井数据读取失败'));
  }, []);
  useEffect(() => {
    setScale(1); setOffset({ x: 0, y: 0 }); setSelectedWell(null); setSelectedWellNo(''); setMapSize(null);
    void loadMarkers(selectedBlock).catch(() => setMessage('井位标定读取失败'));
  }, [selectedBlock]);
  useEffect(() => {
    const controller = new AbortController();
    const requestId = requestGateRef.current.start();
    const query = buildInjectionStatusMapQuery({ block: selectedBlock, ...filters });
    setLoading(true); setMapError('');
    fetch(`/api/injection-status-map?${query}`, { signal: controller.signal })
      .then(async (response) => {
        const payload = await response.json();
        if (!requestGateRef.current.isCurrent(requestId, controller.signal)) return null;
        if (!response.ok || !payload.success) throw new Error(payload.message || '注采状态地图加载失败');
        return payload.data as InjectionStatusMapResponse;
      })
      .then((data) => {
        if (data && requestGateRef.current.isCurrent(requestId, controller.signal)) setMapData(data);
      })
      .catch((error: Error) => {
        if (requestGateRef.current.isCurrent(requestId, controller.signal) && error.name !== 'AbortError') setMapError(error.message || '注采状态地图加载失败');
      })
      .finally(() => { if (requestGateRef.current.isCurrent(requestId, controller.signal)) setLoading(false); });
    return () => controller.abort();
  }, [selectedBlock, filters, reloadKey]);

  const mapWells = mapData?.mapWells ?? [];
  const unlocatedWells = mapData?.unlocatedWells ?? [];
  const summary = mapData?.summary ?? { total: 0, injecting: 0, soaking: 0, pendingTransfer: 0, producing: 0, alerts: 0, unlocated: 0 };
  const selectedCategoryWells = categoryWells.filter((relation) => relation.categoryId === selectedCategoryId).map((relation) => relation.wellNo);
  const calibrationWells = unlocatedWells.filter((well) => well.block === selectedBlock);
  const calibrationMarkers = markers.filter((marker) => marker.block === selectedBlock && producingWells.includes(marker.wellNo));
  const planMonths = [...new Set([...mapWells, ...unlocatedWells].map((well) => well.planMonth).filter(Boolean))].sort().reverse();

  const closeDrawer = () => {
    setSelectedWell(null);
    requestAnimationFrame(() => selectedWellTriggerRef.current?.focus());
  };
  const trapDrawerFocus = (event: React.KeyboardEvent<HTMLElement>) => {
    if (event.key === 'Escape') { event.preventDefault(); closeDrawer(); return; }
    if (event.key !== 'Tab') return;
    const focusable = [...(drawerRef.current?.querySelectorAll<HTMLElement>('button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])') || [])];
    if (!focusable.length) return;
    event.preventDefault();
    const currentIndex = focusable.indexOf(document.activeElement as HTMLElement);
    const targetIndex = currentIndex < 0 ? (event.shiftKey ? focusable.length - 1 : 0) : getDrawerFocusIndex(focusable.length, currentIndex, event.shiftKey);
    focusable[targetIndex]?.focus();
  };
  useEffect(() => {
    if (!selectedWell) return;
    drawerCloseRef.current?.focus();
  }, [selectedWell]);

  const fitMap = (image: HTMLImageElement) => {
    const width = mapViewportRef.current?.clientWidth;
    if (width) setMapSize(fitWellMapToWidth(image.naturalWidth, image.naturalHeight, width));
  };
  const saveMarker = async (event: React.MouseEvent<HTMLDivElement>) => {
    if (!calibrationMode || !selectedWellNo || !mapRef.current) return;
    const rect = mapRef.current.getBoundingClientRect();
    const xPercent = ((event.clientX - rect.left) / rect.width) * 100;
    const yPercent = ((event.clientY - rect.top) / rect.height) * 100;
    const response = await fetch(`/api/oil-well-map/markers/${encodeURIComponent(selectedWellNo)}`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ block: selectedBlock, xPercent, yPercent }),
    });
    if (!response.ok) { setMessage('井位标定保存失败'); return; }
    setMessage(`${selectedWellNo} 已完成标定`); setSelectedWellNo(''); setReloadKey((key) => key + 1);
    await loadMarkers();
  };
  const removeMarker = async (wellNo: string) => {
    await fetch(`/api/oil-well-map/markers/${encodeURIComponent(wellNo)}`, { method: 'DELETE' });
    await loadMarkers(); setReloadKey((key) => key + 1);
  };
  const uploadDailyData = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]; event.target.value = '';
    if (!file) return;
    const formData = new FormData(); formData.append('file', file);
    const response = await fetch('/api/oil-well-map/daily-data', { method: 'POST', body: formData });
    const payload = await response.json();
    setMessage(response.ok && payload.success ? `日数据已更新：${payload.data.date}` : (payload.message || '日数据上传失败'));
  };
  const saveCategory = async () => {
    const response = await fetch(selectedCategoryId ? `/api/oil-well-map/categories/${selectedCategoryId}` : '/api/oil-well-map/categories', {
      method: selectedCategoryId ? 'PUT' : 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(categoryDraft),
    });
    const payload = await response.json();
    if (!response.ok) { setMessage(payload.message || '分类保存失败'); return; }
    await loadCategories(); if (!selectedCategoryId) setSelectedCategoryId(payload.data.id);
  };
  const saveCategoryWells = async (wells: string[]) => {
    if (!selectedCategoryId) return;
    await fetch(`/api/oil-well-map/categories/${selectedCategoryId}/wells`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ wells }) });
    await loadCategories();
  };
  const navigate = (action: 'project' | 'production' | 'evaluation') => {
    if (!selectedWell) return;
    const target = getStatusMapNavigation(action, selectedWell);
    if (target) onNavigate(target.tab, target.filters);
    else setMessage('该井尚无可查看的注汽项目');
  };
  const setFilter = <K extends keyof MapFilters>(key: K, value: MapFilters[K]) => setFilters((current) => ({ ...current, [key]: value }));

  return <div className="page-stack animate-in fade-in duration-300">
    <section className="app-card p-5">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div><h3 className="section-title"><MapPinned size={20} className="text-[#D32F2F]" />注采状态地图</h3><p className="mt-2 text-sm text-slate-500">状态颜色来自注汽项目与措施跟踪；分类仅作为独立关注标识。</p></div>
        <div className="flex flex-wrap gap-2">
          {isAdmin && <><input ref={dailyDataInputRef} type="file" accept=".xlsx" className="hidden" onChange={uploadDailyData} /><button className="action-button action-outline" onClick={() => dailyDataInputRef.current?.click()}><Upload size={16} />上传日数据</button><button className={`action-button ${calibrationMode ? 'action-primary' : 'action-outline'}`} onClick={() => setCalibrationMode((value) => !value)}>{calibrationMode ? '退出标定模式' : '井位标定模式'}</button><button className="action-button action-outline" onClick={() => setShowCategoryManager((value) => !value)}><Palette size={16} />分类管理</button></>}
          <button className="action-button action-outline" onClick={() => setShowMarkerSettings((value) => !value)}>显示设置</button>
        </div>
      </div>
      <div className="mt-5 grid gap-3 lg:grid-cols-6">{[
        ['地图内井数', summary.total, 'text-slate-900'], ['注汽中', summary.injecting, 'text-blue-700'], ['焖井中', summary.soaking, 'text-amber-700'], ['待转抽', summary.pendingTransfer, 'text-violet-700'], ['生产响应', summary.producing, 'text-emerald-700'], ['异常井', summary.alerts, 'text-red-700'], ['无坐标井', summary.unlocated, 'text-slate-600'],
      ].map(([label, value, color]) => <div key={String(label)} className="rounded border border-slate-200 bg-slate-50 px-3 py-2"><div className="text-xs text-slate-500">{label}</div><div className={`text-xl font-bold ${color}`}>{value}</div></div>)}</div>
      <div className="mt-5 flex flex-wrap gap-2">{BLOCKS.map((block) => <button key={block.name} onClick={() => setSelectedBlock(block.name)} className={`rounded px-4 py-2 text-sm font-bold ${selectedBlock === block.name ? 'bg-[#D32F2F] text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}>{block.name}</button>)}</div>
      <div className="mt-4 grid gap-3 rounded border border-slate-200 bg-slate-50 p-3 md:grid-cols-3 xl:grid-cols-6">
        <select className="field-control" value={filters.lifecycleStatus} onChange={(event) => setFilter('lifecycleStatus', event.target.value as MapFilters['lifecycleStatus'])}><option value="">全部生命周期</option>{Object.entries(lifecycleLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select>
        <select className="field-control" value={filters.planMonth} onChange={(event) => setFilter('planMonth', event.target.value)}><option value="">全部计划月份</option>{planMonths.map((month) => <option key={month} value={month!}>{month}</option>)}</select>
        <select className="field-control" value={filters.alertType} onChange={(event) => setFilter('alertType', event.target.value as MapFilters['alertType'])}><option value="">全部异常</option>{Object.entries(alertLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select>
        <label className="flex items-center gap-2 rounded border border-slate-200 bg-white px-3 text-sm"><input type="checkbox" checked={filters.overdue} onChange={(event) => setFilter('overdue', event.target.checked)} />仅超期</label>
        <input className="field-control xl:col-span-2" value={filters.keyword} placeholder="搜索井号" onChange={(event) => setFilter('keyword', event.target.value)} />
      </div>
      <div className="mt-3 flex flex-wrap gap-4 text-xs text-slate-600">{(['injecting', 'soaking', 'pendingTransfer', 'producing', 'needsData'] as InjectionMapLifecycleStatus[]).map((status) => <span key={status} className="flex items-center gap-1"><i className="h-3 w-3 rounded-full" style={{ backgroundColor: resolveInjectionLifecycleColor(status) }} />{lifecycleLabels[status]}</span>)}<span className="flex items-center gap-1"><i className="h-3 w-3 rounded-full bg-red-500" />异常</span></div>
      {showMarkerSettings && <div className="mt-4 flex flex-wrap items-center gap-5 rounded border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700"><label className="flex items-center gap-2"><input type="checkbox" checked={showLabels} onChange={(event) => setShowLabels(event.target.checked)} />显示井号标签</label>{isAdmin && calibrationMode && <label className="flex items-center gap-2"><input type="checkbox" checked={showDeleteButtons} onChange={(event) => setShowDeleteButtons(event.target.checked)} />显示删除按钮</label>}</div>}
      {showMarkerSettings && categories.length > 0 && <div className="mt-3 flex flex-wrap items-center gap-4 rounded border border-slate-200 bg-slate-50 p-3 text-sm">{categories.map((category) => <label key={category.id} className="flex items-center gap-2"><input type="checkbox" checked={category.visible} onChange={(event) => setCategories((current) => current.map((item) => item.id === category.id ? { ...item, visible: event.target.checked } : item))} /><span className="h-3 w-3 rounded-full" style={{ backgroundColor: category.color }} />{category.name}</label>)}</div>}
      {showCategoryManager && isAdmin && <div className="mt-4 grid gap-4 rounded border border-violet-200 bg-violet-50 p-4 lg:grid-cols-[260px_1fr]"><div className="space-y-2"><button className="action-button action-primary w-full" onClick={() => { setSelectedCategoryId(null); setCategoryDraft({ name: '', color: '#7c3aed', priority: 10, remark: '' }); }}>新建分类</button>{categories.map((category) => <button key={category.id} className={`flex w-full items-center gap-2 rounded px-3 py-2 text-left text-sm ${selectedCategoryId === category.id ? 'bg-violet-200' : 'bg-white'}`} onClick={() => { setSelectedCategoryId(category.id); setCategoryDraft({ name: category.name, color: category.color, priority: category.priority, remark: '' }); }}><span className="h-3 w-3 rounded-full" style={{ backgroundColor: category.color }} />{category.name}</button>)}</div><div className="space-y-3"><div className="grid gap-3 md:grid-cols-4"><input className="field-control" placeholder="分类名称" value={categoryDraft.name} onChange={(event) => setCategoryDraft({ ...categoryDraft, name: event.target.value })} /><input className="field-control p-1" type="color" value={categoryDraft.color} onChange={(event) => setCategoryDraft({ ...categoryDraft, color: event.target.value })} /><input className="field-control" type="number" value={categoryDraft.priority} onChange={(event) => setCategoryDraft({ ...categoryDraft, priority: Number(event.target.value) })} /><button className="action-button action-primary" onClick={saveCategory}>保存分类</button></div><input className="field-control w-full" placeholder="备注" value={categoryDraft.remark} onChange={(event) => setCategoryDraft({ ...categoryDraft, remark: event.target.value })} />{selectedCategoryId && <div><p className="mb-2 text-sm font-bold">已标定井号</p><div className="grid max-h-48 grid-cols-2 gap-2 overflow-y-auto md:grid-cols-4">{markers.map((marker) => <label key={marker.wellNo} className="flex items-center gap-1 text-sm"><input type="checkbox" checked={selectedCategoryWells.includes(marker.wellNo)} onChange={(event) => saveCategoryWells(event.target.checked ? [...selectedCategoryWells, marker.wellNo] : selectedCategoryWells.filter((well) => well !== marker.wellNo))} />{marker.wellNo}</label>)}</div></div>}</div></div>}
      {calibrationMode && <div className="mt-4 flex flex-wrap items-center gap-3 rounded border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900"><span>无坐标井不会自动生成坐标；选择井号后点击底图进行管理员标定。</span><select className="field-control" value={selectedWellNo} onChange={(event) => setSelectedWellNo(event.target.value)}><option value="">请选择无坐标井</option>{calibrationWells.map((well) => <option key={well.wellNo} value={well.wellNo}>{well.wellNo}</option>)}</select></div>}
      {message && <p className="status-banner status-banner-info mt-4">{message}</p>}
    </section>
    <section className="app-card overflow-hidden">
      <div className="flex items-center justify-between border-b border-slate-100 p-3"><span className="text-sm font-bold text-slate-700">{selectedBlock} · 地图内 {summary.total} 口井 {loading && '（更新中）'}</span><div className="flex gap-2"><button className="action-button action-outline h-8 px-3" onClick={() => setScale((value) => Math.max(0.5, value - 0.2))}><Minus size={16} /></button><button className="action-button action-outline h-8 px-3" onClick={() => setScale((value) => Math.min(3, value + 0.2))}><Plus size={16} /></button><button className="action-button action-outline h-8 px-3" onClick={() => { setScale(1); setOffset({ x: 0, y: 0 }); }}><RotateCcw size={16} /></button></div></div>
      {mapError && <div className="m-3 flex items-center justify-between rounded border border-red-200 bg-red-50 p-3 text-sm text-red-700"><span>{mapData ? `地图更新失败，保留最近成功数据：${mapError}` : mapError}</span><button className="action-button action-outline" onClick={() => setReloadKey((key) => key + 1)}>重试</button></div>}
      {!mapData && !loading && mapError ? null : <div ref={mapViewportRef} className="relative min-h-[70vh] overflow-hidden bg-slate-100" style={{ height: mapSize?.height }} onMouseMove={(event) => dragStart && setOffset({ x: event.clientX - dragStart.x, y: event.clientY - dragStart.y })} onMouseUp={() => setDragStart(null)} onMouseLeave={() => setDragStart(null)}>
        <div ref={mapRef} className={`absolute left-1/2 top-1/2 select-none ${calibrationMode && selectedWellNo ? 'cursor-crosshair' : 'cursor-grab'}`} style={{ width: mapSize?.width, height: mapSize?.height, opacity: mapSize ? 1 : 0, transform: `translate(calc(-50% + ${offset.x}px), calc(-50% + ${offset.y}px)) scale(${scale})` }} onMouseDown={(event) => { if (!calibrationMode) setDragStart({ x: event.clientX - offset.x, y: event.clientY - offset.y }); }} onClick={saveMarker}>
          <img src={selected.image} alt={`${selectedBlock}井位图`} draggable={false} className="block h-full w-full" onLoad={(event) => fitMap(event.currentTarget)} />
          {mapWells.map((well) => { const categoryColor = resolveMarkerColor(well.wellNo, categories, categoryWells); const statusColor = resolveInjectionLifecycleColor(well.lifecycleStatus); return <button type="button" key={well.wellNo} className="absolute h-5 w-5 rounded-full border-2 border-white shadow-lg" style={{ ...getMarkerAnchorStyle(well.xPercent!, well.yPercent!), backgroundColor: statusColor, boxShadow: categoryColor !== '#dc2626' ? `0 0 0 3px ${categoryColor}` : undefined }} title={`${well.wellNo} · ${lifecycleLabels[well.lifecycleStatus]}`} onMouseDown={(event) => event.stopPropagation()} onClick={(event) => { event.stopPropagation(); selectedWellTriggerRef.current = event.currentTarget; setSelectedWell(well); }}>{showLabels && <span className="absolute left-1/2 top-[calc(100%+4px)] -translate-x-1/2 whitespace-nowrap rounded px-1.5 py-0.5 text-[10px] font-bold text-white" style={{ backgroundColor: statusColor }}>{well.wellNo}</span>}</button>; })}
          {calibrationMode && showDeleteButtons && calibrationMarkers.map((marker) => <button type="button" key={`delete-${marker.wellNo}`} className="absolute rounded bg-white p-1 text-red-600 shadow" style={getMarkerAnchorStyle(marker.xPercent, marker.yPercent)} title={`删除 ${marker.wellNo} 标定`} onMouseDown={(event) => event.stopPropagation()} onClick={(event) => { event.stopPropagation(); void removeMarker(marker.wellNo); }}><Trash2 size={12} /></button>)}
        </div>
      </div>}
      <div className="border-t border-slate-100 p-3"><button className="flex items-center gap-2 text-sm font-bold text-slate-700" onClick={() => setShowUnlocated((value) => !value)}>无坐标井（{unlocatedWells.length}）{showUnlocated ? <ChevronUp size={16} /> : <ChevronDown size={16} />}</button>{showUnlocated && <div className="mt-3 rounded bg-slate-50 p-3 text-sm"><p className="mb-2 text-amber-800">无坐标井不会被绘制；管理员可使用上方标定模式补充位置。</p><div className="flex flex-wrap gap-2">{unlocatedWells.map((well) => <button key={well.wellNo} className="rounded border border-slate-200 bg-white px-2 py-1 hover:border-red-300" onClick={(event) => { selectedWellTriggerRef.current = event.currentTarget; setSelectedWell(well); }}>{well.wellNo}</button>)}</div></div>}</div>
    </section>
    {selectedWell && <div className="fixed inset-0 z-50 bg-slate-900/30" onClick={closeDrawer}><aside ref={drawerRef} role="dialog" aria-modal="true" aria-labelledby="selected-well-drawer-title" tabIndex={-1} className="absolute bottom-0 right-0 max-h-[85vh] w-full overflow-y-auto bg-white p-5 shadow-2xl md:bottom-auto md:top-0 md:h-full md:max-h-none md:w-[420px]" onKeyDown={trapDrawerFocus} onClick={(event) => event.stopPropagation()}><div className="flex items-start justify-between"><div><h3 id="selected-well-drawer-title" className="text-lg font-bold text-slate-900">{selectedWell.wellNo}</h3><p className="text-sm text-slate-500">{lifecycleLabels[selectedWell.lifecycleStatus]} · {selectedWell.statusSource === 'project' ? '项目数据' : '措施跟踪数据'}</p></div><button ref={drawerCloseRef} aria-label="关闭井详情" className="rounded p-1 hover:bg-slate-100" onClick={closeDrawer}><X size={20} /></button></div><div className="mt-5 grid grid-cols-2 gap-x-4 gap-y-3 text-sm">{[['区块', selectedWell.block], ['站点', selectedWell.station], ['负责人', selectedWell.owner], ['计划月份', selectedWell.planMonth], ['计划开始', selectedWell.plannedStartDate], ['计划结束', selectedWell.plannedEndDate], ['实际开始', selectedWell.actualStartDate], ['实际结束', selectedWell.actualEndDate], ['计划转抽', selectedWell.plannedTransferDate], ['超期天数', selectedWell.overdueDays], ['计划注汽', selectedWell.plannedSteam], ['实际注汽', selectedWell.actualSteam], ['当前日产油', selectedWell.currentOil], ['累计增油', selectedWell.cumulativeOilGain], ['油汽比', selectedWell.oilSteamRatio], ['效果评价', selectedWell.evaluation]].map(([label, value]) => <div key={String(label)}><div className="text-xs text-slate-500">{label}</div><div className="font-medium text-slate-800">{display(value)}</div></div>)}</div><div className="mt-5 rounded bg-rose-50 p-3 text-sm"><div className="font-bold text-rose-800">异常</div><div className="mt-1 text-rose-700">{selectedWell.alertTypes.length ? selectedWell.alertTypes.map((type) => alertLabels[type]).join('、') : '无'}</div></div><div className="mt-5 grid gap-2"><button className="action-button action-primary" disabled={selectedWell.projectId == null} onClick={() => navigate('project')}>查看注汽项目</button><button className="action-button action-outline" onClick={() => navigate('production')}>查看生产响应</button><button className="action-button action-outline" onClick={() => navigate('evaluation')}>查看效果评价</button></div></aside></div>}
  </div>;
}
