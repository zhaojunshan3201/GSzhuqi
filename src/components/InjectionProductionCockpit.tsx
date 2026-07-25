import { useEffect, useState, type ReactNode } from 'react';
import ReactECharts from 'echarts-for-react';
import type { InjectionProductionCockpit as Cockpit } from '../lib/injectionProductionCockpit';
import {
  buildAlertDistributionOption,
  buildBlockPerformanceOption,
  buildBlockStatusOption,
  buildStatusDistributionOption,
  hasChartValues,
} from '../lib/injectionProductionCockpitCharts';
import { getCockpitAlertDrilldown, getCockpitBlockDrilldown, type CockpitMeasureFilters } from '../lib/injectionProductionCockpitDrilldown';

const labels: Array<[keyof Cockpit['metrics'], string, string]> = [
  ['producingWells', '生产井', '口'], ['injectingWells', '正注井', '口'], ['soakingWells', '焖井', '口'],
  ['pendingTransferWells', '待转抽井', '口'], ['dailyOil', '日产油', 't'], ['cumulativeOilGain', '累计增油', 't'],
  ['oilSteamRatio', '油汽比', ''],
];

function ChartCard({ title, hasData, children, className = '' }: { title: string; hasData: boolean; children: ReactNode; className?: string }) {
  return <section className={`app-card p-4 ${className}`}>
    <h3 className="font-bold text-slate-800">{title}</h3>
    <div className="mt-2 h-72">{hasData ? children : <div className="flex h-full items-center justify-center text-sm text-slate-400">数据待补全</div>}</div>
  </section>;
}

export function InjectionProductionCockpit({ onNavigate }: {
  onNavigate: (tab: 'measures' | 'oilWellMap', filters?: CockpitMeasureFilters) => void;
}) {
  const [data, setData] = useState<Cockpit | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    void fetch('/api/injection-production/cockpit')
      .then((response) => response.json())
      .then((payload) => { if (!payload.success) throw new Error(payload.message); setData(payload.data); })
      .catch((cause) => setError(cause.message || '注采驾驶舱数据加载失败'));
  }, []);
  if (error) return <div className="status-banner status-banner-error">{error}</div>;
  if (!data) return <div className="app-card p-6 text-sm text-slate-500">驾驶舱数据加载中…</div>;

  const statusValues = Object.values(data.statusDistribution);
  const blockStatusValues = data.blockStatusSummary.flatMap(({ block: _block, ...counts }) => Object.values(counts));
  const performanceValues = data.blockPerformanceSummary.flatMap((row) => [row.dailyOil, row.cumulativeOilGain, row.oilSteamRatio]);
  const alertValues = data.alertDistribution.map((item) => item.count);
  const blockEvents = { click: (params: unknown) => { const filters = getCockpitBlockDrilldown(params); if (filters) onNavigate('measures', filters); } };

  return <div className="page-stack">
    <section className="app-card p-5"><h3 className="text-lg font-bold text-slate-900">注采驾驶舱</h3><div className="mt-3 grid gap-3 md:grid-cols-3">{data.dataFreshness.map((item) => <div key={item.source} className="rounded-lg border border-slate-200 p-3"><p className="font-semibold">{item.source}</p><p className="text-sm text-slate-500">{item.message}</p><p className="text-xs text-slate-400">{item.updatedAt || '暂无更新时间'}</p></div>)}</div></section>
    <section className="grid gap-3 md:grid-cols-4 xl:grid-cols-7">{labels.map(([key, label, unit]) => <div key={key} className="app-card p-4"><p className="text-sm text-slate-500">{label}</p><p className="mt-2 text-2xl font-bold">{data.metrics[key] ?? '数据待补全'}{data.metrics[key] != null && <span className="ml-1 text-sm font-normal">{unit}</span>}</p></div>)}</section>
    <section className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-7">
      <ChartCard title="生命周期状态" hasData={hasChartValues(statusValues)} className="xl:col-span-2">
        <ReactECharts option={buildStatusDistributionOption(data.statusDistribution)} style={{ height: '100%' }} />
      </ChartCard>
      <ChartCard title="区块生产效果" hasData={hasChartValues(performanceValues)} className="xl:col-span-3">
        <ReactECharts option={buildBlockPerformanceOption(data.blockPerformanceSummary)} style={{ height: '100%' }} onEvents={blockEvents} />
      </ChartCard>
      <ChartCard title="异常分布" hasData={hasChartValues(alertValues)} className="xl:col-span-2">
        <ReactECharts option={buildAlertDistributionOption(data.alertDistribution)} style={{ height: '100%' }} onEvents={{ click: (params: unknown) => { const filters = getCockpitAlertDrilldown(params, data.alerts); if (filters) onNavigate('measures', filters); } }} />
      </ChartCard>
      <ChartCard title="区块生命周期状态" hasData={hasChartValues(blockStatusValues)} className="md:col-span-2 xl:col-span-7">
        <ReactECharts option={buildBlockStatusOption(data.blockStatusSummary)} style={{ height: '100%' }} onEvents={blockEvents} />
      </ChartCard>
    </section>
    <section className="app-card p-5"><div className="flex items-center justify-between"><h3 className="font-bold">异常与待办</h3><button className="action-button action-outline" onClick={() => onNavigate('oilWellMap')}>查看注采状态地图</button></div><div className="mt-3 space-y-2">{data.alerts.length ? data.alerts.map((alert) => <button key={alert.id} className="flex w-full justify-between rounded-lg bg-slate-50 p-3 text-left text-sm" onClick={() => onNavigate(alert.target, { keyword: alert.wellNo })}><span>{alert.wellNo} · {alert.message}</span><span>{alert.block}</span></button>) : <p className="text-sm text-slate-500">暂无待办</p>}</div></section>
  </div>;
}
