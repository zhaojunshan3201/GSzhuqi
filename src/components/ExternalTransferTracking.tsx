import { useEffect, useMemo, useRef, useState } from 'react';
import ReactECharts from 'echarts-for-react';
import * as XLSX from 'xlsx';
import { FileSpreadsheet, RefreshCw, Upload } from 'lucide-react';

import {
  parseExternalTransferWorkbook,
  summarizeExternalTransfer,
  summarizeExternalTransferByTenDayPeriod,
  type ExternalTransferDaily,
  type ExternalTransferRecord,
} from '../lib/externalTransferTracking';
import { getExternalTransferChartOption, type ExternalTransferChartSeries } from '../lib/externalTransferChart';

type Metric = Exclude<keyof ExternalTransferDaily, 'date'>;

type SeriesConfig = ExternalTransferChartSeries<Metric>;

export function ExternalTransferTracking() {
  const inputRef = useRef<HTMLInputElement>(null);
  const stationSelectorRef = useRef<HTMLDivElement>(null);
  const [records, setRecords] = useState<ExternalTransferRecord[]>([]);
  const [stations, setStations] = useState<string[]>([]);
  const [selectedStations, setSelectedStations] = useState<Set<string>>(new Set());
  const [isStationSelectorOpen, setIsStationSelectorOpen] = useState(false);
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [fileName, setFileName] = useState('');
  const [error, setError] = useState('');

  const applyUpload = (upload: { fileName: string; records: ExternalTransferRecord[] }) => {
    const dates = upload.records.map((record) => record.date).sort();
    const stationList = [...new Set(upload.records.map((record) => record.station))].sort((left, right) => left.localeCompare(right, 'zh-CN'));
    setRecords(upload.records);
    setStations(stationList);
    setSelectedStations(new Set(stationList));
    setStartDate(dates[0] ?? '');
    setEndDate(dates.at(-1) ?? '');
    setFileName(upload.fileName);
  };

  useEffect(() => {
    void fetch('/api/external-transfer/upload').then((response) => response.json()).then((result) => {
      if (result.success && result.data) applyUpload(result.data);
    }).catch(() => undefined);
  }, []);

  useEffect(() => {
    const handleOutsideClick = (event: MouseEvent) => {
      if (!stationSelectorRef.current?.contains(event.target as Node)) setIsStationSelectorOpen(false);
    };

    document.addEventListener('mousedown', handleOutsideClick);
    return () => document.removeEventListener('mousedown', handleOutsideClick);
  }, []);

  const daily = useMemo(
    () => startDate && endDate ? summarizeExternalTransferByTenDayPeriod(summarizeExternalTransfer(records, selectedStations, startDate, endDate)) : [],
    [records, selectedStations, startDate, endDate],
  );

  const handleUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;

    try {
      const workbook = XLSX.read(await file.arrayBuffer(), { type: 'array', cellDates: true });
      const parsed = parseExternalTransferWorkbook(workbook);
      const dates = parsed.records.map((record) => record.date).sort();
      if (!dates.length) throw new Error('Sheet1 中没有可用的日期和计量站数据');

      const response = await fetch('/api/external-transfer/upload', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ fileName: file.name, records: parsed.records }),
      });
      const result = await response.json();
      if (!response.ok || !result.success) throw new Error(result.message || '保存外输数据失败');
      applyUpload({ fileName: file.name, records: parsed.records });
      setError('');
    } catch (uploadError) {
      setError(uploadError instanceof Error ? uploadError.message : '文件读取失败，请重新上传');
    }
  };

  if (!records.length) {
    return (
      <section className="app-card p-8 text-center">
        <FileSpreadsheet className="mx-auto mb-4 h-10 w-10 text-blue-500" />
        <h2 className="text-lg font-semibold text-slate-800">导入外输分析数据</h2>
        <p className="mt-2 text-sm text-slate-500">上传 Excel 后，系统将读取 Sheet1 中的计量站连续日报数据。</p>
        <button type="button" className="primary-btn mt-5 inline-flex items-center gap-2" onClick={() => inputRef.current?.click()}>
          <Upload size={16} /> 上传 Excel
        </button>
        {error && <p className="mt-4 text-sm text-red-600">{error}</p>}
        <input ref={inputRef} type="file" accept=".xlsx" className="hidden" onChange={handleUpload} />
      </section>
    );
  }

  return (
    <section className="space-y-4">
      <div className="app-card flex flex-wrap items-end gap-4 p-4">
        <div ref={stationSelectorRef} className="relative min-w-[190px] flex-1">
          <label className="mb-1 block text-xs font-medium text-slate-500">计量站（可多选）</label>
          <button
            type="button"
            className="field-control h-10 w-full truncate text-left"
            aria-expanded={isStationSelectorOpen}
            onClick={() => setIsStationSelectorOpen((isOpen) => !isOpen)}
          >
            已选 {selectedStations.size} 个：{Array.from(selectedStations).join('、')}
          </button>
          {isStationSelectorOpen && (
            <div className="absolute z-10 mt-1 max-h-60 w-full overflow-auto rounded-md border border-slate-200 bg-white p-2 shadow-lg">
              {stations.map((station) => (
                <label key={station} className="flex cursor-pointer items-center gap-2 px-2 py-1 text-sm text-slate-700 hover:bg-slate-50">
                  <input
                    type="checkbox"
                    checked={selectedStations.has(station)}
                    onChange={() => setSelectedStations((current) => {
                      const next = new Set(current);
                      if (next.has(station)) next.delete(station);
                      else next.add(station);
                      return next;
                    })}
                  />
                  {station}
                </label>
              ))}
            </div>
          )}
        </div>
        <label className="min-w-[150px] text-xs font-medium text-slate-500">开始日期
          <input className="field-control mt-1 w-full" type="date" value={startDate} max={endDate} onChange={(event) => setStartDate(event.target.value)} />
        </label>
        <label className="min-w-[150px] text-xs font-medium text-slate-500">结束日期
          <input className="field-control mt-1 w-full" type="date" value={endDate} min={startDate} onChange={(event) => setEndDate(event.target.value)} />
        </label>
        <div className="flex gap-2">
          <button type="button" className="secondary-btn" onClick={() => setSelectedStations(new Set(stations))}>全选计量站</button>
          <button type="button" className="secondary-btn inline-flex items-center gap-1" onClick={() => inputRef.current?.click()}><RefreshCw size={15} />重新上传</button>
        </div>
        <p className="w-full text-xs text-slate-400">当前文件：{fileName} · 已加载 {records.length} 条记录</p>
        {error && <p className="w-full text-sm text-red-600">{error}</p>}
        <input ref={inputRef} type="file" accept=".xlsx" className="hidden" onChange={handleUpload} />
      </div>

      {!daily.length ? (
        <div className="app-card p-10 text-center text-sm text-slate-500">当前筛选条件下没有可展示的数据</div>
      ) : (
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
          <div className="app-card p-3"><ReactECharts option={getExternalTransferChartOption('井口液与外输', daily, [{ name: '日产液总量', metric: 'liquid' }, { name: '外输', metric: 'transfer' }])} style={{ height: 320 }} /></div>
          <div className="app-card p-3"><ReactECharts option={getExternalTransferChartOption('稀油用量与井口稀油', daily, [{ name: '日掺油总量', metric: 'diluent' }, { name: '稀油用量（方）', metric: 'thinOil' }])} style={{ height: 320 }} /></div>
          <div className="app-card p-3"><ReactECharts option={getExternalTransferChartOption('井口产油', daily, [{ name: '日产油总量', metric: 'oil' }, { name: '井数', metric: 'wellCount', type: 'bar', yAxisIndex: 1 }], true)} style={{ height: 320 }} /></div>
          <div className="app-card p-3"><ReactECharts option={getExternalTransferChartOption('含水', daily, [{ name: '综合含水', metric: 'waterCut' }])} style={{ height: 320 }} /></div>
          <div className="app-card p-3"><ReactECharts option={getExternalTransferChartOption('外输差值', daily, [{ name: '外输差', metric: 'transferDifference' }])} style={{ height: 320 }} /></div>
          <div className="app-card p-3"><ReactECharts option={getExternalTransferChartOption('排污/回流', daily, [{ name: '排污', metric: 'sewage' }, { name: '回流', metric: 'returnFlow', yAxisIndex: 1 }], true)} style={{ height: 320 }} /></div>
        </div>
      )}
    </section>
  );
}
