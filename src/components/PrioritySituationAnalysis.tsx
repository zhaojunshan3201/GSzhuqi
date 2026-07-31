import { useMemo, useRef, useState } from 'react';
import ReactECharts from 'echarts-for-react';
import { AlertTriangle, FileUp, RefreshCw, TableProperties } from 'lucide-react';
import type { PriorityCategory, PriorityIssue } from '../lib/prioritySituationAnalysis.ts';

export type PrioritySituationData = {
  asOfDate: string;
  updatedAt?: string | null;
  summary: Record<PriorityCategory, number>;
  issues: PriorityIssue[];
  blockDeclines: Array<{
    block: string;
    targetMonth: string;
    declineRate: number | null;
    monthlyAverageOil: number | null;
    available: boolean;
    unavailableReason?: string;
  }>;
  soakingWells: Array<{
    wellNo: string;
    stopDate: string;
    soakingDays: number;
    status: string;
    plannedDate?: string | null;
  }>;
  restartSummary: Record<string, {
    year: number;
    category: string;
    wells: number;
    producingWells: number;
    averageOil?: number | null;
    missingWells: number;
  }>;
  sourceStatus: Record<string, {
    available: boolean;
    updatedAt?: string | null;
    fileName?: string | null;
    unavailableReason?: string;
  }>;
};

export interface PrioritySituationAnalysisProps {
  data: PrioritySituationData | null;
  loading: boolean;
  error: string;
  uploading: boolean;
  onRefresh: () => void;
  onUpload: (file: File) => void;
  onOpenIssue: (issue: PriorityIssue) => void;
}

const categories: Array<{ key: 'all' | PriorityCategory; label: string }> = [
  { key: 'all', label: '全部' },
  { key: 'pump', label: '检泵异常' },
  { key: 'waterCut', label: '含水偏差' },
  { key: 'blockDecline', label: '区块递减' },
  { key: 'soaking', label: '焖井' },
  { key: 'injectionPeriod', label: '注采同期变化' },
  { key: 'restartTracking', label: '复产井跟踪' },
];
const summaryCategories = categories.filter((item): item is { key: PriorityCategory; label: string } => item.key !== 'all');
const PAGE_SIZE = 10;

const categoryNames: Record<PriorityCategory, string> = {
  pump: '检泵异常',
  waterCut: '含水偏差',
  blockDecline: '区块递减',
  soaking: '焖井',
  injectionPeriod: '注采同期变化',
  restartTracking: '复产井跟踪',
};

const sourceNames: Record<string, string> = {
  production: '生产报产', waterLab: '含水化验', pump: '检泵跟踪', tracking: '措施跟踪',
  soaking: '焖井转抽', blockDecline: '区块产量', injectionPeriod: '注采同期', restartTracking: '复产跟踪',
};

const severityClass: Record<PriorityIssue['severity'], string> = {
  high: 'bg-red-100 text-red-700',
  medium: 'bg-orange-100 text-orange-700',
  low: 'bg-slate-100 text-slate-600',
};

const displayDateTime = (value?: string | null) => value ? new Date(value).toLocaleString('zh-CN', { hour12: false }) : '暂无更新时间';
const displayNumber = (value: number | null | undefined, unit = '') => value == null || !Number.isFinite(value) ? '--' : `${value.toLocaleString('zh-CN', { maximumFractionDigits: 1 })}${unit}`;

export function PrioritySituationAnalysis({ data, loading, error, uploading, onRefresh, onUpload, onOpenIssue }: PrioritySituationAnalysisProps) {
  const [filter, setFilter] = useState<'all' | PriorityCategory>('all');
  const [page, setPage] = useState(1);
  const fileInput = useRef<HTMLInputElement>(null);
  const issues = useMemo(() => data?.issues.filter((issue) => filter === 'all' || issue.category === filter) ?? [], [data, filter]);
  const totalPages = Math.max(1, Math.ceil(issues.length / PAGE_SIZE));
  const currentPage = Math.min(page, totalPages);
  const pagedIssues = useMemo(() => issues.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE), [currentPage, issues]);
  const selectFilter = (nextFilter: 'all' | PriorityCategory) => {
    setFilter(nextFilter);
    setPage(1);
  };
  const unavailableSources = useMemo(() => Object.entries(data?.sourceStatus ?? {}).filter(([, status]) => !status.available), [data]);
  const tracking = data?.sourceStatus.tracking;
  const chartOption = useMemo(() => {
    const rows = (data?.blockDeclines ?? []).filter((item) => item.declineRate != null).slice(0, 10).reverse();
    return {
      grid: { left: 78, right: 28, top: 18, bottom: 22 },
      tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' } },
      xAxis: { type: 'value', axisLabel: { formatter: '{value}%' } },
      yAxis: { type: 'category', data: rows.map((item) => item.block), axisTick: { show: false } },
      series: [{ type: 'bar', data: rows.map((item) => ({ value: item.declineRate, itemStyle: { color: Number(item.declineRate) > 0 ? '#dc2626' : '#16a34a' } })), barMaxWidth: 24 }],
    };
  }, [data]);

  return <div className="page-stack priority-situation-page">
    <section className="app-card p-5">
      <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
        <div>
          <p className="text-sm font-semibold text-red-700">重点情况分析与建议</p>
          <h2 className="mt-1 text-xl font-bold text-slate-900">统一异常处置工作台</h2>
          <p className="mt-2 text-sm text-slate-500">数据截至：{data?.asOfDate || '待加载'} · 更新于：{displayDateTime(data?.updatedAt)}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <input ref={fileInput} type="file" accept=".xls,.xlsx" className="hidden" onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) onUpload(file);
            event.currentTarget.value = '';
          }} />
          <button type="button" className="action-button action-outline inline-flex items-center gap-2" disabled={uploading} onClick={() => fileInput.current?.click()}><FileUp size={16} />{uploading ? '正在上传…' : '上传跟踪表'}</button>
          <button type="button" className="action-button action-primary inline-flex items-center gap-2" disabled={loading} onClick={onRefresh}><RefreshCw size={16} className={loading ? 'animate-spin' : ''} />刷新</button>
        </div>
      </div>
      <div className="mt-4 rounded-lg bg-slate-50 px-4 py-3 text-sm text-slate-600">
        <span className="font-semibold text-slate-800">共享跟踪文件：</span>{tracking?.fileName || '尚未上传'} · {displayDateTime(tracking?.updatedAt)}
      </div>
      <div className="mt-4 flex items-center gap-3" aria-label="异常类型筛选">
        <span className="text-sm font-medium text-slate-600">类别筛选</span>
        <button type="button" aria-pressed={filter === 'all'} onClick={() => selectFilter('all')} className={`rounded-full px-3 py-1.5 text-sm font-medium transition ${filter === 'all' ? 'bg-red-600 text-white shadow-sm' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}>全部</button>
      </div>
      <div data-testid="priority-summary-grid" className="mt-3 grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        {summaryCategories.map((item) => {
          const active = filter === item.key;
          return <button
            key={item.key}
            type="button"
            data-category={item.key}
            aria-pressed={active}
            onClick={() => selectFilter(item.key)}
            className={`rounded-xl border px-4 py-3 text-left transition ${active ? 'border-red-500 bg-red-50 shadow-sm ring-1 ring-red-200' : 'border-slate-200 bg-white hover:border-slate-300 hover:shadow-sm'}`}
          >
            <span className={`block text-sm font-medium ${active ? 'text-red-700' : 'text-slate-600'}`}>{item.label}</span>
            <strong className={`mt-1 block text-2xl leading-none ${active ? 'text-red-700' : 'text-slate-900'}`}>{data?.summary[item.key] || 0}</strong>
          </button>;
        })}
      </div>
    </section>

    {error && <div className="status-banner status-banner-error">{error}</div>}
    {loading && !data && <section className="app-card p-8 text-center text-sm text-slate-500">正在加载重点异常数据…</section>}
    {!loading && !data && !error && <section className="app-card p-8 text-center text-sm text-slate-500">暂无分析数据，请刷新后重试。</section>}

    {data && <>
      {unavailableSources.length > 0 && <section className="app-card border border-amber-200 bg-amber-50 p-4">
        <div className="flex items-center gap-2 font-semibold text-amber-900"><AlertTriangle size={17} />数据源待补全</div>
        <p className="mt-1 text-sm text-amber-800">{unavailableSources.map(([key, status]) => `${sourceNames[key] || key}：${status.unavailableReason || '暂无可用数据'}`).join('；')}</p>
      </section>}

      <section className="app-card overflow-hidden">
        <div className="app-card-header flex items-center justify-between gap-3"><div><h3 className="font-bold text-slate-800">重点异常处置清单</h3><p className="mt-1 text-xs text-slate-500">按风险等级、偏差绝对值和数据日期排序，共 {issues.length} 项</p></div><TableProperties size={19} className="text-slate-400" /></div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[1120px] text-left text-sm">
            <thead className="bg-slate-50 text-slate-500"><tr><th className="px-4 py-3">风险</th><th className="px-4 py-3">类别</th><th className="px-4 py-3">井号/区块</th><th className="px-4 py-3">对比口径</th><th className="px-4 py-3">偏差</th><th className="px-4 py-3">当前状态</th><th className="px-4 py-3">处置建议</th><th className="px-4 py-3">数据日期</th><th className="px-4 py-3">操作</th></tr></thead>
            <tbody>{issues.length ? pagedIssues.map((issue) => {
              const isImproving = issue.status === '同期变好';
              const isNegative = !isImproving && (issue.severity === 'high' || issue.severity === 'medium' || Number(issue.deviation) < 0);
              return <tr key={issue.id} className="border-t border-slate-100 align-top"><td className="px-4 py-3"><span className={`rounded-full px-2 py-1 text-xs font-semibold ${severityClass[issue.severity]}`}>{issue.severity === 'high' ? '高风险' : issue.severity === 'medium' ? '中风险' : '关注'}</span></td><td className="px-4 py-3 font-medium text-slate-700">{categoryNames[issue.category]}</td><td className="px-4 py-3">{issue.wellNo || issue.block || '--'}</td><td className="px-4 py-3 text-slate-600">{issue.comparison}</td><td className={`px-4 py-3 font-semibold ${isImproving ? 'text-emerald-600' : isNegative ? 'text-red-600' : 'text-slate-700'}`}>{issue.deviationText}</td><td className={`px-4 py-3 font-medium ${isImproving ? 'text-emerald-600' : isNegative ? 'text-orange-600' : 'text-slate-700'}`}>{issue.status}</td><td className="px-4 py-3 text-slate-600">{issue.suggestion}</td><td className="px-4 py-3 text-slate-500">{issue.dataDate || '--'}</td><td className="px-4 py-3"><button type="button" className="text-sm font-medium text-red-700 hover:text-red-900" onClick={() => onOpenIssue(issue)}>查看详情</button></td></tr>;
            }) : <tr><td colSpan={9} className="px-4 py-12 text-center text-slate-500">当前筛选条件下暂无异常记录。请确认相关数据源是否已导入。</td></tr>}</tbody>
          </table>
        </div>
        {issues.length > 0 && <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 px-4 py-3 text-sm text-slate-500">
          <span>共 {issues.length} 项</span>
          <div className="flex items-center gap-2">
            <button type="button" aria-label="上一页" disabled={currentPage === 1} onClick={() => setPage((value) => Math.max(1, value - 1))} className="rounded-md border border-slate-200 px-3 py-1.5 font-medium text-slate-600 disabled:cursor-not-allowed disabled:opacity-40">上一页</button>
            <span>第 {currentPage} 页，共 {totalPages} 页</span>
            <button type="button" aria-label="下一页" disabled={currentPage === totalPages} onClick={() => setPage((value) => Math.min(totalPages, value + 1))} className="rounded-md border border-slate-200 px-3 py-1.5 font-medium text-slate-600 disabled:cursor-not-allowed disabled:opacity-40">下一页</button>
          </div>
        </div>}
      </section>

      <section className="grid gap-4 xl:grid-cols-2">
        <div className="app-card p-5"><div className="flex items-baseline justify-between"><div><h3 className="font-bold text-slate-800">上月递减率</h3><p className="mt-1 text-sm text-slate-500">区块生产动态生成器递减率口径</p></div><span className="text-xs text-slate-400">横向对比</span></div>{data.blockDeclines.some((item) => item.available) ? <ReactECharts option={chartOption} style={{ height: 300, width: '100%' }} /> : <div className="flex h-[300px] items-center justify-center text-sm text-slate-500">区块产量数据待补全，暂无法生成递减率。</div>}</div>
        <div className="app-card overflow-hidden"><div className="app-card-header"><h3 className="font-bold text-slate-800">当前焖井</h3><p className="mt-1 text-xs text-slate-500">未转抽或未结束的焖井记录</p></div><div className="overflow-x-auto"><table className="w-full min-w-[560px] text-left text-sm"><thead className="bg-slate-50 text-slate-500"><tr><th className="px-4 py-3">井号</th><th className="px-4 py-3">停井日期</th><th className="px-4 py-3">焖井天数</th><th className="px-4 py-3">计划日期</th><th className="px-4 py-3">状态</th></tr></thead><tbody>{data.soakingWells.length ? data.soakingWells.map((well) => <tr key={`${well.wellNo}:${well.stopDate}`} className="border-t border-slate-100"><td className="px-4 py-3 font-medium">{well.wellNo}</td><td className="px-4 py-3">{well.stopDate}</td><td className="px-4 py-3 text-orange-600">{displayNumber(well.soakingDays, ' 天')}</td><td className="px-4 py-3">{well.plannedDate || '--'}</td><td className="px-4 py-3">{well.status}</td></tr>) : <tr><td colSpan={5} className="px-4 py-12 text-center text-slate-500">暂无当前焖井数据。</td></tr>}</tbody></table></div></div>
      </section>
    </>}
  </div>;
}
