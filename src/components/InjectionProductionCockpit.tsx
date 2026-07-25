import { useEffect, useState } from 'react';

type Cockpit = {
  dataFreshness: Array<{ source: string; status: string; updatedAt: string | null; message: string }>;
  metrics: Record<string, number | null>;
  statusDistribution: Record<string, number>;
  alerts: Array<{ id: string; type: string; wellNo: string; block: string; message: string; target: 'measures' | 'oilWellMap' }>;
};

const labels: Array<[keyof Cockpit['metrics'], string, string]> = [
  ['producingWells', '生产井', '口'], ['injectingWells', '正注井', '口'], ['soakingWells', '焖井', '口'], ['pendingTransferWells', '待转抽', '口'], ['dailyOil', '日产油', 't'], ['cumulativeOilGain', '累计增油', 't'], ['oilSteamRatio', '油汽比', ''],
];

export function InjectionProductionCockpit({ onNavigate }: { onNavigate: (tab: 'measures' | 'oilWellMap', wellNo?: string) => void }) {
  const [data, setData] = useState<Cockpit | null>(null);
  const [error, setError] = useState('');
  useEffect(() => { void fetch('/api/injection-production/cockpit').then((r) => r.json()).then((payload) => { if (!payload.success) throw new Error(payload.message); setData(payload.data); }).catch((cause) => setError(cause.message || '注采驾驶舱数据加载失败')); }, []);
  if (error) return <div className="status-banner status-banner-error">{error}</div>;
  if (!data) return <div className="app-card p-6 text-sm text-slate-500">驾驶舱数据加载中…</div>;
  return <div className="page-stack">
    <section className="app-card p-5"><h3 className="text-lg font-bold text-slate-900">注采驾驶舱</h3><div className="mt-3 grid gap-3 md:grid-cols-3">{data.dataFreshness.map((item) => <div key={item.source} className="rounded-lg border border-slate-200 p-3"><p className="font-semibold">{item.source}</p><p className="text-sm text-slate-500">{item.message}</p><p className="text-xs text-slate-400">{item.updatedAt || '暂无更新时间'}</p></div>)}</div></section>
    <section className="grid gap-3 md:grid-cols-4 xl:grid-cols-7">{labels.map(([key, label, unit]) => <div key={key} className="app-card p-4"><p className="text-sm text-slate-500">{label}</p><p className="mt-2 text-2xl font-bold">{data.metrics[key] ?? '数据待补全'}{data.metrics[key] != null && <span className="ml-1 text-sm font-normal">{unit}</span>}</p></div>)}</section>
    <section className="app-card p-5"><div className="flex items-center justify-between"><h3 className="font-bold">异常与待办</h3><button className="action-button action-outline" onClick={() => onNavigate('oilWellMap')}>查看注采状态地图</button></div><div className="mt-3 space-y-2">{data.alerts.length ? data.alerts.map((alert) => <button key={alert.id} className="flex w-full justify-between rounded-lg bg-slate-50 p-3 text-left text-sm" onClick={() => onNavigate(alert.target, alert.wellNo)}><span>{alert.wellNo} · {alert.message}</span><span>{alert.block}</span></button>) : <p className="text-sm text-slate-500">暂无待办</p>}</div></section>
  </div>;
}
