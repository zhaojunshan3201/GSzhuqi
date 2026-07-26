import * as XLSX from 'xlsx';

export type InjectionOperationReportKind = 'daily' | 'weekly' | 'retrospective';

export type OperationReportProduction = {
  date: string;
  oil: number | null;
  liquid?: number | null;
  waterCut?: number | null;
  well?: string | null;
  block?: string | null;
};

export type OperationReportProject = {
  id: number | string;
  projectName: string;
  block?: string | null;
  status: string;
  estimatedLoss?: number | null;
  occupiedProduction?: number | null;
  riskLevel?: string | null;
  plannedDate?: string | null;
  actualDate?: string | null;
  beforeMetric?: number | null;
  afterMetric?: number | null;
};

export type OperationReportRecommendation = {
  id: string;
  name: string;
  score: number | null;
  confidence: number;
  netBenefit: number | null;
  assumptions: string[];
};

export type InjectionOperationReportInput = {
  kind: InjectionOperationReportKind;
  date: string;
  block?: string | null;
  production: OperationReportProduction[];
  channelingProjects: OperationReportProject[];
  recommendations: OperationReportRecommendation[];
};

export type InjectionOperationReport = {
  kind: InjectionOperationReportKind;
  title: string;
  period: { start: string; end: string };
  filter: { block: string | null };
  sources: Array<{ name: string; recordCount: number; filters: string[]; latestDate: string | null }>;
  summary: Array<{ label: string; value: number | null; unit: string; source: string }>;
  details: Array<{ projectName: string; status: string; riskLevel: string | null; estimatedLoss: number | null; occupiedProduction: number | null; outcome: number | null; source: string }>;
  trend: Array<{ date: string; oil: number | null; liquid: number | null; waterCut: number | null }>;
  recommendations: OperationReportRecommendation[];
  missingData: string[];
};

const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);
const dateOffset = (date: string, days: number) => {
  const value = new Date(`${date}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
};

export function buildInjectionOperationReport(input: InjectionOperationReportInput): InjectionOperationReport {
  const span = input.kind === 'daily' ? 0 : input.kind === 'weekly' ? 6 : 29;
  const start = dateOffset(input.date, -span);
  const production = input.production
    .filter((row) => row.date >= start && row.date <= input.date)
    .sort((a, b) => a.date.localeCompare(b.date));
  const latest = production.at(-1) ?? null;
  const periodOil = production.some((row) => finite(row.oil)) ? production.reduce((sum, row) => sum + (finite(row.oil) ? row.oil : 0), 0) : null;
  const missingData: string[] = [];
  if (!production.length) missingData.push('生产日报缺失，周期油量未计算');
  if (input.channelingProjects.some((project) => !finite(project.occupiedProduction))) missingData.push('部分项目占产损失待补全，未按 0 处理');
  if (input.kind === 'retrospective' && input.channelingProjects.some((project) => !finite(project.afterMetric))) missingData.push('部分项目效果验证指标待补全，复盘结论不下定论');
  if (!input.recommendations.length) missingData.push('推荐方案数据缺失，未生成替代方案');

  return {
    kind: input.kind,
    title: input.kind === 'daily' ? '注汽运行日报' : input.kind === 'weekly' ? '注汽运行周报' : '注汽项目复盘',
    period: { start, end: input.date },
    filter: { block: input.block?.trim() || null },
    sources: [
      { name: '生产日报', recordCount: production.length, filters: [`日期 ${start} 至 ${input.date}`, ...(input.block ? [`区块 ${input.block}`] : [])], latestDate: latest?.date ?? null },
      { name: '注窜治理项目', recordCount: input.channelingProjects.length, filters: input.block ? [`区块 ${input.block}`] : ['全部区块'], latestDate: input.channelingProjects.map((item) => item.actualDate ?? item.plannedDate).filter(Boolean).sort().at(-1) ?? null },
      { name: '注汽运行推荐', recordCount: input.recommendations.length, filters: input.block ? [`区块 ${input.block}`] : ['全部区块'], latestDate: input.date },
    ],
    summary: [
      { label: input.kind === 'daily' ? '当日油量' : '周期油量', value: input.kind === 'daily' ? (finite(latest?.oil) ? latest!.oil : null) : periodOil, unit: 't', source: '生产日报' },
      { label: '治理项目数', value: input.channelingProjects.length, unit: '项', source: '注窜治理项目' },
      { label: '预计注窜损失', value: input.channelingProjects.some((item) => finite(item.estimatedLoss)) ? input.channelingProjects.reduce((sum, item) => sum + (finite(item.estimatedLoss) ? item.estimatedLoss : 0), 0) : null, unit: 't/d', source: '注窜治理项目' },
    ],
    details: input.channelingProjects.map((project) => ({
      projectName: project.projectName, status: project.status, riskLevel: project.riskLevel ?? null,
      estimatedLoss: finite(project.estimatedLoss) ? project.estimatedLoss : null,
      occupiedProduction: finite(project.occupiedProduction) ? project.occupiedProduction : null,
      outcome: finite(project.beforeMetric) && finite(project.afterMetric) ? project.afterMetric - project.beforeMetric : null,
      source: '注窜治理项目',
    })),
    trend: production.map((row) => ({ date: row.date, oil: finite(row.oil) ? row.oil : null, liquid: finite(row.liquid) ? row.liquid : null, waterCut: finite(row.waterCut) ? row.waterCut : null })),
    recommendations: input.recommendations,
    missingData,
  };
}

export function buildInjectionOperationReportWorkbook(report: InjectionOperationReport): XLSX.WorkBook {
  const workbook = XLSX.utils.book_new();
  const summaryRows: Array<Array<string | number | null>> = [[report.title], ['报告周期', `${report.period.start} 至 ${report.period.end}`], ['筛选区块', report.filter.block ?? '全部']];
  summaryRows.push(...report.summary.map((item): Array<string | number | null> => [item.label, item.value, item.unit, item.source]));
  summaryRows.push(...report.missingData.map((item): Array<string | number | null> => ['待补全', item]));
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(summaryRows), '摘要');
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(report.details), '明细');
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(report.trend), '趋势');
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(report.recommendations), '推荐方案');
  return workbook;
}



