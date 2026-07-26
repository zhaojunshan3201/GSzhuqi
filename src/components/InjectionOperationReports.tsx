import { useEffect, useMemo, useState } from 'react';
import { Download, FileText, Filter } from 'lucide-react';

export type InjectionOperationReportKind = 'daily' | 'weekly' | 'retrospective';

export const reportKindLabels: Record<InjectionOperationReportKind, string> = {
  daily: '注汽运行日报',
  weekly: '注汽运行周报',
  retrospective: '注汽项目复盘',
};

type Report = {
  title: string;
  period: { start: string; end: string };
  sources: Array<{ name: string; recordCount: number; filters: string[]; latestDate: string | null }>;
  summary: Array<{ label: string; value: number | null; unit: string; source: string }>;
  details: Array<{ projectName: string; status: string; riskLevel: string | null; estimatedLoss: number | null; occupiedProduction: number | null; outcome: number | null; source: string }>;
  recommendations: Array<{ id: string; name: string; score: number | null; confidence: number; netBenefit: number | null; assumptions: string[] }>;
  missingData: string[];
};

export function buildOperationReportUrl(kind: InjectionOperationReportKind, date: string, block: string, download = false) {
  const params = new URLSearchParams({ type: kind, date });
  if (block.trim()) params.set('block', block.trim());
  return `/api/injection-operation-reports${download ? '.xlsx' : ''}?${params.toString()}`;
}

const today = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Shanghai' });
const display = (value: number | null, unit: string) => value == null ? '数据待补全' : `${value.toLocaleString('zh-CN', { maximumFractionDigits: 2 })}${unit ? ` ${unit}` : ''}`;

export function InjectionOperationReports() {
  const [kind, setKind] = useState<InjectionOperationReportKind>('daily');
  const [date, setDate] = useState(today);
  const [block, setBlock] = useState('');
  const [project, setProject] = useState('');
  const [report, setReport] = useState<Report | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError('');
    void fetch(buildOperationReportUrl(kind, date, block), { signal: controller.signal })
      .then(async (response) => {
        const payload = await response.json();
        if (!response.ok || !payload.success) throw new Error(payload.message || '运行报告加载失败');
        setReport(payload.data);
      })
      .catch((cause: Error) => { if (cause.name !== 'AbortError') setError(cause.message || '运行报告加载失败'); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [kind, date, block]);

  const projectOptions = useMemo(() => Array.from(new Set(report?.details.map((item) => item.projectName) ?? [])), [report]);
  const details = project ? (report?.details.filter((item) => item.projectName === project) ?? []) : (report?.details ?? []);

  return <div className="page-stack">
    <section className="app-card p-5">
      <div className="flex flex-col justify-between gap-4 lg:flex-row lg:items-start">
        <div><h3 className="text-lg font-bold text-slate-900">注汽运行报告</h3><p className="mt-1 text-sm text-slate-500">按日期、区块和项目查看运行日报、周报及项目复盘。</p></div>
        <a className="action-button action-outline inline-flex items-center justify-center gap-2" href={buildOperationReportUrl(kind, date, block, true)} download><Download size={16} />下载 Excel</a>
      </div>
      <div className="mt-5 flex flex-wrap gap-2 border-b border-slate-200">
        {(Object.keys(reportKindLabels) as InjectionOperationReportKind[]).map((item) => <button key={item} type="button" onClick={() => setKind(item)} className={`border-b-2 px-4 py-2 text-sm font-medium ${kind === item ? 'border-red-600 text-red-700' : 'border-transparent text-slate-500 hover:text-slate-800'}`}>{reportKindLabels[item]}</button>)}
      </div>
      <div className="mt-4 grid gap-3 md:grid-cols-3">
        <label className="text-sm font-medium text-slate-700">日期<input aria-label="日期" type="date" value={date} onChange={(event) => setDate(event.target.value)} className="mt-1 block w-full rounded-md border border-slate-300 px-3 py-2 text-sm" /></label>
        <label className="text-sm font-medium text-slate-700">区块<input aria-label="区块" value={block} onChange={(event) => setBlock(event.target.value)} placeholder="全部区块" className="mt-1 block w-full rounded-md border border-slate-300 px-3 py-2 text-sm" /></label>
        <label className="text-sm font-medium text-slate-700">项目<select aria-label="项目" value={project} onChange={(event) => setProject(event.target.value)} className="mt-1 block w-full rounded-md border border-slate-300 px-3 py-2 text-sm"><option value="">全部项目</option>{projectOptions.map((item) => <option key={item} value={item}>{item}</option>)}</select></label>
      </div>
    </section>

    {error && <div className="status-banner status-banner-error">{error}</div>}
    {loading && !report && <div className="app-card p-6 text-sm text-slate-500">报告数据加载中…</div>}
    {report && <>
      <section className="grid gap-3 md:grid-cols-3">{report.summary.map((item) => <div key={item.label} className="app-card p-4"><p className="text-sm text-slate-500">{item.label}</p><p className="mt-2 text-xl font-bold text-slate-900">{display(item.value, item.unit)}</p><p className="mt-1 text-xs text-slate-400">来源：{item.source}</p></div>)}</section>
      <section className="app-card p-5"><div className="flex items-center gap-2"><Filter size={17} className="text-slate-500" /><h3 className="font-bold text-slate-800">数据来源说明</h3></div><div className="mt-3 grid gap-3 md:grid-cols-3">{report.sources.map((source) => <div key={source.name} className="rounded-lg bg-slate-50 p-3 text-sm"><p className="font-semibold text-slate-800">{source.name}</p><p className="mt-1 text-slate-500">记录 {source.recordCount} 条 · 最新 {source.latestDate || '数据待补全'}</p><p className="mt-1 text-xs text-slate-400">{source.filters.join('；')}</p></div>)}</div></section>
      {report.missingData.length > 0 && <section className="app-card border-amber-200 bg-amber-50 p-4"><h3 className="font-bold text-amber-900">数据待补全</h3><ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-amber-800">{report.missingData.map((item) => <li key={item}>{item}</li>)}</ul></section>}
      <section className="app-card overflow-hidden"><div className="app-card-header"><h3 className="font-bold text-slate-800">项目明细</h3></div>{details.length ? <div className="overflow-x-auto"><table className="w-full min-w-[700px] text-left text-sm"><thead className="bg-slate-50 text-slate-500"><tr><th className="px-4 py-3">项目</th><th className="px-4 py-3">状态</th><th className="px-4 py-3">风险</th><th className="px-4 py-3">预计损失</th><th className="px-4 py-3">效果</th></tr></thead><tbody>{details.map((item) => <tr key={item.projectName} className="border-t border-slate-100"><td className="px-4 py-3 font-medium">{item.projectName}</td><td className="px-4 py-3">{item.status}</td><td className="px-4 py-3">{item.riskLevel || '数据待补全'}</td><td className="px-4 py-3">{display(item.estimatedLoss, 't/d')}</td><td className="px-4 py-3">{display(item.outcome, '')}</td></tr>)}</tbody></table></div> : <div className="flex flex-col items-center gap-2 px-5 py-12 text-slate-400"><FileText size={30} /><p>暂无符合筛选条件的项目数据，数据待补全。</p></div>}</section>
    </>}
  </div>;
}
