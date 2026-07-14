import { useEffect, useMemo, useRef, useState } from 'react';
import { MapPinned, Minus, Palette, Plus, RotateCcw, Trash2, Upload } from 'lucide-react';
import { fitWellMapToWidth, getMarkerAnchorStyle, getVisibleProductionMarkers, resolveMarkerColor, type WellMapCategory, type WellMapCategoryWell, type WellMapMarker } from '../lib/oilWellMapMarkers';

const BLOCKS = [
  { name: '高3块', image: '/oil-well-map-assets/高3块.bmp' },
  { name: '高3624块', image: '/oil-well-map-assets/高3624.jpg' },
  { name: '高3618块', image: '/oil-well-map-assets/2026-高3618_L5.jpg' },
  { name: '高246块', image: '/oil-well-map-assets/高246块井位部署图(莲V顶).bmp' },
  { name: '高21块', image: '/oil-well-map-assets/高21.jpg' },
  { name: '高10块', image: '/oil-well-map-assets/高10块井位构造图.jpg' },
] as const;

interface OilWellMapProps { isAdmin: boolean }

export function OilWellMap({ isAdmin }: OilWellMapProps) {
  const [selectedBlock, setSelectedBlock] = useState('高246块');
  const [producingWells, setProducingWells] = useState<string[]>([]);
  const [sourceDate, setSourceDate] = useState('');
  const [markers, setMarkers] = useState<WellMapMarker[]>([]);
  const [scale, setScale] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [dragStart, setDragStart] = useState<{ x: number; y: number } | null>(null);
  const [calibrationMode, setCalibrationMode] = useState(false);
  const [showMarkerSettings, setShowMarkerSettings] = useState(false);
  const [showLabels, setShowLabels] = useState(false);
  const [showDeleteButtons, setShowDeleteButtons] = useState(false);
  const [showCategoryManager, setShowCategoryManager] = useState(false);
  const [categories, setCategories] = useState<WellMapCategory[]>([]);
  const [categoryWells, setCategoryWells] = useState<WellMapCategoryWell[]>([]);
  const [selectedCategoryId, setSelectedCategoryId] = useState<number | null>(null);
  const [categoryDraft, setCategoryDraft] = useState({ name: '', color: '#7c3aed', priority: 10, remark: '' });
  const [uploadingDailyData, setUploadingDailyData] = useState(false);
  const [selectedWellNo, setSelectedWellNo] = useState('');
  const [message, setMessage] = useState('');
  const [mapSize, setMapSize] = useState<{ width: number; height: number } | null>(null);
  const mapRef = useRef<HTMLDivElement>(null);
  const mapViewportRef = useRef<HTMLDivElement>(null);
  const dailyDataInputRef = useRef<HTMLInputElement>(null);
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

  useEffect(() => {
    void fetch('/api/oil-well-map/production-wells').then((response) => response.json()).then((payload) => {
      if (payload.success) {
        setProducingWells(payload.data.wells);
        setSourceDate(payload.data.date);
      }
    }).catch(() => setMessage('生产井数据读取失败'));
  }, []);

  useEffect(() => { void loadCategories(); }, []);

  useEffect(() => {
    setScale(1); setOffset({ x: 0, y: 0 }); setSelectedWellNo(''); setMapSize(null);
    void loadMarkers(selectedBlock).catch(() => setMessage('井位标定读取失败'));
  }, [selectedBlock]);

  const visibleMarkers = useMemo(() => getVisibleProductionMarkers(selectedBlock, producingWells, markers), [markers, producingWells, selectedBlock]);
  const unmarkedWells = producingWells.filter((wellNo) => !markers.some((marker) => marker.wellNo === wellNo));
  const selectedCategoryWells = categoryWells.filter((relation) => relation.categoryId === selectedCategoryId).map((relation) => relation.wellNo);

  const saveMarker = async (event: React.MouseEvent<HTMLDivElement>) => {
    if (!calibrationMode || !selectedWellNo || !mapRef.current) return;
    const rect = mapRef.current.getBoundingClientRect();
    const xPercent = ((event.clientX - rect.left) / rect.width) * 100;
    const yPercent = ((event.clientY - rect.top) / rect.height) * 100;
    const response = await fetch(`/api/oil-well-map/markers/${encodeURIComponent(selectedWellNo)}`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ block: selectedBlock, xPercent, yPercent }),
    });
    if (!response.ok) { setMessage('井位标定保存失败'); return; }
    const payload = await response.json();
    setMarkers((current) => [...current.filter((marker) => marker.wellNo !== selectedWellNo), payload.data]);
    setSelectedWellNo(''); setMessage(`${selectedWellNo} 已标定`); await loadMarkers();
  };

  const removeMarker = async (wellNo: string) => {
    await fetch(`/api/oil-well-map/markers/${encodeURIComponent(wellNo)}`, { method: 'DELETE' });
    await loadMarkers();
  };

  const fitMap = (image: HTMLImageElement) => {
    const viewport = mapViewportRef.current;
    if (viewport) setMapSize(fitWellMapToWidth(image.naturalWidth, image.naturalHeight, viewport.clientWidth));
  };

  const uploadDailyData = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    setUploadingDailyData(true);
    try {
      const formData = new FormData();
      formData.append('file', file);
      const response = await fetch('/api/oil-well-map/daily-data', { method: 'POST', body: formData });
      const payload = await response.json();
      if (!response.ok || !payload.success) throw new Error(payload.message || '日数据上传失败');
      setProducingWells(payload.data.wells);
      setSourceDate(payload.data.date);
      setMessage(`日数据已更新：${payload.data.date}`);
    } catch (error: any) {
      setMessage(error?.message || '日数据上传失败');
    } finally {
      setUploadingDailyData(false);
    }
  };

  const saveCategory = async () => {
    const method = selectedCategoryId ? 'PUT' : 'POST';
    const url = selectedCategoryId ? `/api/oil-well-map/categories/${selectedCategoryId}` : '/api/oil-well-map/categories';
    const response = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(categoryDraft) });
    const payload = await response.json();
    if (!response.ok) { setMessage(payload.message || '分类保存失败'); return; }
    await loadCategories();
    if (!selectedCategoryId) setSelectedCategoryId(payload.data.id);
  };

  const saveCategoryWells = async (wells: string[]) => {
    if (!selectedCategoryId) return;
    await fetch(`/api/oil-well-map/categories/${selectedCategoryId}/wells`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ wells }) });
    await loadCategories();
  };

  return <div className="page-stack animate-in fade-in duration-300">
    <section className="app-card p-5">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div><h3 className="section-title"><MapPinned size={20} className="text-[#D32F2F]" />油井位图</h3><p className="mt-2 text-sm text-slate-500">{sourceDate ? `生产数据日期：${sourceDate}；SCSJ 大于 0 的井以红色显示` : '正在读取生产井数据'}</p></div>
        <div className="flex flex-wrap gap-2">{isAdmin && <><input ref={dailyDataInputRef} type="file" accept=".xlsx" className="hidden" onChange={uploadDailyData} /><button className="action-button action-outline" disabled={uploadingDailyData} onClick={() => dailyDataInputRef.current?.click()}><Upload size={16} />{uploadingDailyData ? '上传中...' : '上传日数据.xlsx'}</button><button className={`action-button ${calibrationMode ? 'action-primary' : 'action-outline'}`} onClick={() => setCalibrationMode((value) => !value)}> {calibrationMode ? '退出标定模式' : '井位标定模式'} </button><button className="action-button action-outline" onClick={() => setShowCategoryManager((value) => !value)}><Palette size={16} />分类管理</button></>}<button className="action-button action-outline" onClick={() => setShowMarkerSettings((value) => !value)}>显示设置</button></div>
      </div>
      <div className="mt-5 flex flex-wrap gap-2">{BLOCKS.map((block) => <button key={block.name} onClick={() => setSelectedBlock(block.name)} className={`rounded px-4 py-2 text-sm font-bold ${selectedBlock === block.name ? 'bg-[#D32F2F] text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}>{block.name}</button>)}</div>
      {showMarkerSettings && <div className="mt-4 flex flex-wrap items-center gap-5 rounded border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700"><label className="flex items-center gap-2"><input type="checkbox" checked={showLabels} onChange={(event) => setShowLabels(event.target.checked)} />显示井号标签</label>{isAdmin && calibrationMode && <label className="flex items-center gap-2"><input type="checkbox" checked={showDeleteButtons} onChange={(event) => setShowDeleteButtons(event.target.checked)} />显示删除按钮</label>}</div>}
      {showMarkerSettings && categories.length > 0 && <div className="mt-3 flex flex-wrap items-center gap-4 rounded border border-slate-200 bg-slate-50 p-3 text-sm">{categories.map((category) => <label key={category.id} className="flex items-center gap-2"><input type="checkbox" checked={category.visible} onChange={(event) => setCategories((current) => current.map((item) => item.id === category.id ? { ...item, visible: event.target.checked } : item))} /><span className="h-3 w-3 rounded-full" style={{ backgroundColor: category.color }} />{category.name}</label>)}</div>}
      {showCategoryManager && isAdmin && <div className="mt-4 grid gap-4 rounded border border-violet-200 bg-violet-50 p-4 lg:grid-cols-[260px_1fr]"><div className="space-y-2"><button className="action-button action-primary w-full" onClick={() => { setSelectedCategoryId(null); setCategoryDraft({ name: '', color: '#7c3aed', priority: 10, remark: '' }); }}>新建分类</button>{categories.map((category) => <button key={category.id} className={`flex w-full items-center gap-2 rounded px-3 py-2 text-left text-sm ${selectedCategoryId === category.id ? 'bg-violet-200' : 'bg-white'}`} onClick={() => { setSelectedCategoryId(category.id); setCategoryDraft(category); }}><span className="h-3 w-3 rounded-full" style={{ backgroundColor: category.color }} />{category.name}（优先级 {category.priority}）</button>)}</div><div className="space-y-3"><div className="grid gap-3 md:grid-cols-4"><input className="field-control" placeholder="分类名称" value={categoryDraft.name} onChange={(event) => setCategoryDraft({ ...categoryDraft, name: event.target.value })} /><input className="field-control p-1" type="color" value={categoryDraft.color} onChange={(event) => setCategoryDraft({ ...categoryDraft, color: event.target.value })} /><input className="field-control" type="number" placeholder="优先级" value={categoryDraft.priority} onChange={(event) => setCategoryDraft({ ...categoryDraft, priority: Number(event.target.value) })} /><button className="action-button action-primary" onClick={saveCategory}>保存分类</button></div><input className="field-control w-full" placeholder="备注" value={categoryDraft.remark} onChange={(event) => setCategoryDraft({ ...categoryDraft, remark: event.target.value })} />{selectedCategoryId && <div><p className="mb-2 text-sm font-bold">已标定井号</p><div className="grid max-h-48 grid-cols-2 gap-2 overflow-y-auto md:grid-cols-4">{markers.map((marker) => <label key={marker.wellNo} className="flex items-center gap-1 text-sm"><input type="checkbox" checked={selectedCategoryWells.includes(marker.wellNo)} onChange={(event) => saveCategoryWells(event.target.checked ? [...selectedCategoryWells, marker.wellNo] : selectedCategoryWells.filter((well) => well !== marker.wellNo))} />{marker.wellNo}</label>)}</div></div>}</div></div>}
      {calibrationMode && <div className="mt-4 flex flex-wrap items-center gap-3 rounded border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900"><span>选择生产井后，直接点击图上的实际位置完成标定：</span><select className="field-control" value={selectedWellNo} onChange={(event) => setSelectedWellNo(event.target.value)}><option value="">请选择生产井</option>{unmarkedWells.map((wellNo) => <option key={wellNo} value={wellNo}>{wellNo}</option>)}</select></div>}
      {message && <p className="status-banner status-banner-info mt-4">{message}</p>}
    </section>
    <section className="app-card overflow-hidden">
      <div className="flex items-center justify-between border-b border-slate-100 p-3"><span className="text-sm font-bold text-slate-700">{selectedBlock} · 生产井 {visibleMarkers.length} 口</span><div className="flex gap-2"><button className="action-button action-outline h-8 px-3" onClick={() => setScale((value) => Math.max(0.5, value - 0.2))}><Minus size={16} /></button><button className="action-button action-outline h-8 px-3" onClick={() => setScale((value) => Math.min(3, value + 0.2))}><Plus size={16} /></button><button className="action-button action-outline h-8 px-3" onClick={() => { setScale(1); setOffset({ x: 0, y: 0 }); }}><RotateCcw size={16} /></button></div></div>
      <div ref={mapViewportRef} className="relative min-h-[70vh] overflow-hidden bg-slate-100" style={{ height: mapSize?.height }} onMouseMove={(event) => dragStart && setOffset({ x: event.clientX - dragStart.x, y: event.clientY - dragStart.y })} onMouseUp={() => setDragStart(null)} onMouseLeave={() => setDragStart(null)}>
        <div ref={mapRef} className={`absolute left-1/2 top-1/2 select-none ${calibrationMode && selectedWellNo ? 'cursor-crosshair' : 'cursor-grab'}`} style={{ width: mapSize?.width, height: mapSize?.height, opacity: mapSize ? 1 : 0, transform: `translate(calc(-50% + ${offset.x}px), calc(-50% + ${offset.y}px)) scale(${scale})` }} onMouseDown={(event) => { if (!calibrationMode) setDragStart({ x: event.clientX - offset.x, y: event.clientY - offset.y }); }} onClick={saveMarker}>
          <img src={selected.image} alt={`${selectedBlock}井位图`} draggable={false} className="block h-full w-full" onLoad={(event) => fitMap(event.currentTarget)} />
          {visibleMarkers.map((marker) => { const color = resolveMarkerColor(marker.wellNo, categories, categoryWells); return <div key={marker.wellNo} className="absolute h-3 w-3" style={getMarkerAnchorStyle(marker.xPercent, marker.yPercent)} title={`${marker.wellNo}：生产中`}><span className="block h-3 w-3 rounded-full border-2 border-white shadow-lg" style={{ backgroundColor: color }} />{showLabels && <span className="absolute left-1/2 top-[calc(100%+4px)] -translate-x-1/2 whitespace-nowrap rounded px-1.5 py-0.5 text-[10px] font-bold text-white" style={{ backgroundColor: color }}>{marker.wellNo}</span>}{calibrationMode && showDeleteButtons && <button onClick={(event) => { event.stopPropagation(); void removeMarker(marker.wellNo); }} className={`absolute left-1/2 -translate-x-1/2 rounded bg-white p-1 text-red-600 shadow ${showLabels ? 'top-[calc(100%+26px)]' : 'top-[calc(100%+4px)]'}`}><Trash2 size={12} /></button>}</div>})}
        </div>
      </div>
    </section>
  </div>;
}
