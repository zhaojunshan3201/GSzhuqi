import { useEffect, useMemo, useRef, useState } from 'react';
import { MapPinned, Minus, Plus, RotateCcw, Trash2 } from 'lucide-react';
import { fitWellMapToWidth, getMarkerAnchorStyle, getVisibleProductionMarkers, type WellMapMarker } from '../lib/oilWellMapMarkers';

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
  const [selectedWellNo, setSelectedWellNo] = useState('');
  const [message, setMessage] = useState('');
  const [mapSize, setMapSize] = useState<{ width: number; height: number } | null>(null);
  const mapRef = useRef<HTMLDivElement>(null);
  const mapViewportRef = useRef<HTMLDivElement>(null);
  const selected = BLOCKS.find((block) => block.name === selectedBlock) ?? BLOCKS[0];

  const loadMarkers = async (block = selectedBlock) => {
    const response = await fetch(`/api/oil-well-map/markers?block=${encodeURIComponent(block)}`);
    const payload = await response.json();
    if (payload.success) setMarkers(payload.data);
  };

  useEffect(() => {
    void fetch('/api/oil-well-map/production-wells').then((response) => response.json()).then((payload) => {
      if (payload.success) {
        setProducingWells(payload.data.wells);
        setSourceDate(payload.data.date);
      }
    }).catch(() => setMessage('生产井数据读取失败'));
  }, []);

  useEffect(() => {
    setScale(1); setOffset({ x: 0, y: 0 }); setSelectedWellNo(''); setMapSize(null);
    void loadMarkers(selectedBlock).catch(() => setMessage('井位标定读取失败'));
  }, [selectedBlock]);

  const visibleMarkers = useMemo(() => getVisibleProductionMarkers(selectedBlock, producingWells, markers), [markers, producingWells, selectedBlock]);
  const unmarkedWells = producingWells.filter((wellNo) => !markers.some((marker) => marker.wellNo === wellNo));

  const saveMarker = async (event: React.MouseEvent<HTMLDivElement>) => {
    if (!calibrationMode || !selectedWellNo || !mapRef.current) return;
    const rect = mapRef.current.getBoundingClientRect();
    const xPercent = ((event.clientX - rect.left) / rect.width) * 100;
    const yPercent = ((event.clientY - rect.top) / rect.height) * 100;
    const response = await fetch(`/api/oil-well-map/markers/${encodeURIComponent(selectedWellNo)}`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ block: selectedBlock, xPercent, yPercent }),
    });
    if (!response.ok) { setMessage('井位标定保存失败'); return; }
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

  return <div className="page-stack animate-in fade-in duration-300">
    <section className="app-card p-5">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div><h3 className="section-title"><MapPinned size={20} className="text-[#D32F2F]" />油井位图</h3><p className="mt-2 text-sm text-slate-500">{sourceDate ? `生产数据日期：${sourceDate}；SCSJ 大于 0 的井以红色显示` : '正在读取生产井数据'}</p></div>
        {isAdmin && <button className={`action-button ${calibrationMode ? 'action-primary' : 'action-outline'}`} onClick={() => setCalibrationMode((value) => !value)}> {calibrationMode ? '退出标定模式' : '井位标定模式'} </button>}
      </div>
      <div className="mt-5 flex flex-wrap gap-2">{BLOCKS.map((block) => <button key={block.name} onClick={() => setSelectedBlock(block.name)} className={`rounded px-4 py-2 text-sm font-bold ${selectedBlock === block.name ? 'bg-[#D32F2F] text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}>{block.name}</button>)}</div>
      {calibrationMode && <div className="mt-4 flex flex-wrap items-center gap-3 rounded border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900"><span>选择生产井后，直接点击图上的实际位置完成标定：</span><select className="field-control" value={selectedWellNo} onChange={(event) => setSelectedWellNo(event.target.value)}><option value="">请选择生产井</option>{unmarkedWells.map((wellNo) => <option key={wellNo} value={wellNo}>{wellNo}</option>)}</select></div>}
      {message && <p className="status-banner status-banner-info mt-4">{message}</p>}
    </section>
    <section className="app-card overflow-hidden">
      <div className="flex items-center justify-between border-b border-slate-100 p-3"><span className="text-sm font-bold text-slate-700">{selectedBlock} · 生产井 {visibleMarkers.length} 口</span><div className="flex gap-2"><button className="action-button action-outline h-8 px-3" onClick={() => setScale((value) => Math.max(0.5, value - 0.2))}><Minus size={16} /></button><button className="action-button action-outline h-8 px-3" onClick={() => setScale((value) => Math.min(3, value + 0.2))}><Plus size={16} /></button><button className="action-button action-outline h-8 px-3" onClick={() => { setScale(1); setOffset({ x: 0, y: 0 }); }}><RotateCcw size={16} /></button></div></div>
      <div ref={mapViewportRef} className="relative min-h-[70vh] overflow-hidden bg-slate-100" style={{ height: mapSize?.height }} onMouseMove={(event) => dragStart && setOffset({ x: event.clientX - dragStart.x, y: event.clientY - dragStart.y })} onMouseUp={() => setDragStart(null)} onMouseLeave={() => setDragStart(null)}>
        <div ref={mapRef} className={`absolute left-1/2 top-1/2 select-none ${calibrationMode && selectedWellNo ? 'cursor-crosshair' : 'cursor-grab'}`} style={{ width: mapSize?.width, height: mapSize?.height, opacity: mapSize ? 1 : 0, transform: `translate(calc(-50% + ${offset.x}px), calc(-50% + ${offset.y}px)) scale(${scale})` }} onMouseDown={(event) => { if (!calibrationMode) setDragStart({ x: event.clientX - offset.x, y: event.clientY - offset.y }); }} onClick={saveMarker}>
          <img src={selected.image} alt={`${selectedBlock}井位图`} draggable={false} className="block h-full w-full" onLoad={(event) => fitMap(event.currentTarget)} />
          {visibleMarkers.map((marker) => <div key={marker.wellNo} className="absolute h-3 w-3" style={getMarkerAnchorStyle(marker.xPercent, marker.yPercent)} title={`${marker.wellNo}：生产中`}><span className="block h-3 w-3 rounded-full border-2 border-white bg-red-600 shadow-lg" /><span className="absolute left-1/2 top-[calc(100%+4px)] -translate-x-1/2 whitespace-nowrap rounded bg-red-700/90 px-1.5 py-0.5 text-[10px] font-bold text-white">{marker.wellNo}</span>{calibrationMode && <button onClick={(event) => { event.stopPropagation(); void removeMarker(marker.wellNo); }} className="absolute left-1/2 top-[calc(100%+26px)] -translate-x-1/2 rounded bg-white p-1 text-red-600 shadow"><Trash2 size={12} /></button>}</div>)}
        </div>
      </div>
    </section>
  </div>;
}
