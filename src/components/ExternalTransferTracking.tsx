import { useMemo, useRef, useState } from 'react';
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
  const [records, setRecords] = useState<ExternalTransferRecord[]>([]);
  const [stations, setStations] = useState<string[]>([]);
  const [selectedStations, setSelectedStations] = useState<Set<string>>(new Set());
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [fileName, setFileName] = useState('');
  const [error, setError] = useState('');

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

      setRecords(parsed.records);
      setStations(parsed.stations);
      setSelectedStations(new Set(parsed.stations));
      setStartDate(dates[0]);
      setEndDate(dates.at(-1) ?? dates[0]);
      setFileName(file.name);
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
        <div className="min-w-[190px] flex-1">
          <label className="mb-1 block text-xs font-medium text-slate-500">计量站（可多选）</label>
          <select
            multiple
            value={Array.from(selectedStations)}
            className="field-control h-28 w-full"
            onChange={(event) => setSelectedStations(new Set(Array.from(event.target.selectedOptions, (option) => option.value)))}
          >
            {stations.map((station) => <option key={station} value={station}>{station}</option>)}
          </select>
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
