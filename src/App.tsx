import React, { useState, useEffect } from 'react';
import ReactECharts from 'echarts-for-react';
import { 
  LayoutDashboard, 
  Activity, 
  Database, 
  AlertTriangle, 
  TrendingUp,
  Search,
  Menu,
  ChevronRight,
  Droplets,
  Flame,
  Waves,
  Filter,
  FileSpreadsheet,
  User,
  Users,
  ClipboardList,
  MessageSquare,
  Eye,
  Download,
  Calendar,
  Clock,
  ShieldCheck,
  FileText,
  Bell,
  LogIn,
  Thermometer,
  Target,
  MapPinned
} from 'lucide-react';
import { cn } from './lib/utils';
import * as XLSX from 'xlsx';
import { getWellTemperatureChartOption } from './wellTemperatureChart';
import { MeasureWellSelection } from './components/MeasureWellSelection';
import { OilWellMap } from './components/OilWellMap';
import { ExternalTransferTracking } from './components/ExternalTransferTracking';
import { InjectionProductionCockpit } from './components/InjectionProductionCockpit';
import { InjectionProjectManagement } from './components/InjectionProjectManagement';
import { filterMeasuresByCockpitAlerts, type CockpitMeasureFilters } from './lib/injectionProductionCockpitDrilldown';
import type { InjectionProductionCockpit as InjectionProductionCockpitData } from './lib/injectionProductionCockpit';
import { getSidebarGroupKey, runtimeLogNavigationItem, sidebarNavigationGroups } from './lib/sidebarNavigation';
import type { SidebarGroupKey, SidebarIcon, SidebarTab } from './lib/sidebarNavigation';
import type { LucideIcon } from 'lucide-react';
import { AxonLandingPage } from './components/AxonLandingPage';
import { DatacoreLandingPage } from './components/DatacoreLandingPage';

// --- Types ---
interface Well {
  jh: string;
  block: string;
  station: string;
}

interface ChartData {
  dates: string[];
  liquid: number[];
  oil: number[];
  diluent: number[];
  water_cut: number[];
  gas: number[];
}

interface PieData {
  name: string;
  value: number;
}

interface AnalysisData {
  water_cut_pie: PieData[];
  top_water_cut_wells: { jh: string; water_cut: number; oil: number; liquid: number }[];
  decline_warnings: { jh: string; decline_rate: string; reason: string; suggestion: string }[];
  summary: { total_wells: number; abnormal_wells: number; potential_gain: string };
}

interface UserInfo {
  name: string;
  role: string;
  username?: string;
}

interface WellTemperatureTestSummary {
  id: number;
  wellNo: string;
  testDate: string;
  perforationTopDepth: number | null;
  perforationBottomDepth: number | null;
  pointCount: number;
  sourceFile: string;
  createdAt: string;
  updatedAt: string;
}

interface WellTemperatureTestDetail extends WellTemperatureTestSummary {
  points: Array<{ depth: number; temperature: number | null; pressure: number | null }>;
}

interface SyncStatus {
  syncing: boolean;
  lastSuccessfulSyncAt: string | null;
  lastLocalDataDate: string | null;
  lastSyncStatus: string;
  lastError: string | null;
  hasData: boolean;
}

export const getRuntimeSyncStatus = (syncStatus: SyncStatus | null, syncing: boolean) => {
  if (!syncStatus) return { label: '状态未知', className: 'text-amber-600' };
  if (syncStatus.syncing || syncing) return { label: '同步中', className: 'text-blue-600' };
  if (syncStatus.lastSyncStatus === 'error') return { label: '同步失败', className: 'text-red-600' };
  if (syncStatus.lastSyncStatus === 'success') return { label: '同步正常', className: 'text-emerald-600' };
  return { label: '状态未知', className: 'text-amber-600' };
};

interface DashboardBootstrapData {
  overallData: ChartData;
  analysisData: AnalysisData;
  blocks: string[];
  chartBlocks: string[];
  stations: string[];
  syncStatus: SyncStatus;
  cacheWarm?: boolean;
  cacheSource?: 'sqlite' | 'rebuilt' | null;
  generatedAt?: string | null;
  sourceDate?: string | null;
}

interface DashboardCacheInfo {
  cacheWarm: boolean;
  cacheSource: 'sqlite' | 'rebuilt' | null;
  generatedAt: string | null;
  sourceDate: string | null;
}

interface OccupancyUploadState {
  fileName: string;
  sheetName: string;
  rows: Record<string, unknown>[];
  columns: string[];
  error: string;
}

interface PumpAnalysisUploadState {
  fileName: string;
  sheetName: string;
  rows: Record<string, unknown>[];
  columns: string[];
  error: string;
  sheets?: Record<string, { sheetName: string; rows: Record<string, unknown>[]; columns: string[] }>;
}

interface OccupancySummary {
  count: number;
  fileName: string;
  sheetName: string;
  createdAt: string;
  types: { type: string; count: number; affectedOil: number }[];
  preview: Record<string, unknown>[];
  columns?: string[];
}

interface OccupancyTypeAnalysisData {
  intervalDays: number;
  labels: string[];
  series: { name: string; data: number[] }[];
}

interface OccupancyBlockAnalysisData {
  intervalDays: number;
  blocks: Array<{
    block: string;
    labels: string[];
    series: { name: string; data: number[] }[];
    total: number[];
    count: number;
    affectedOil: number;
  }>;
}

interface PumpProductionOilAnalysisGroupData {
  key: string;
  title: string;
  labels: string[];
  oil: number[];
  previousOil: number[];
  matchedRows: number;
  matchedWells: number;
  source: string;
  wellDetails?: Array<{
    jh: string;
    block: string;
    type: string;
    status: string;
    openDate: string;
    previousOpenDate: string;
    currentRecentOil: number | null;
    previousRecentOil: number | null;
    recoverableOil: number | null;
    reason?: string;
    interval?: number | null;
    preOil?: number | null;
    potentialOil?: number | null;
    remark?: string;
  }>;
}

interface PumpProductionOilAnalysisData {
  groups: PumpProductionOilAnalysisGroupData[];
}

const buildPumpPendingSummaryRows = (rows: PumpProductionOilAnalysisGroupData['wellDetails'] = []) => {
  const map = new Map<string, { block: string; count: number; current: number; previous: number; recoverable: number }>();
  rows.forEach((row) => {
const block = row.block || '未知区块';
    const item = map.get(block) || { block, count: 0, current: 0, previous: 0, recoverable: 0 };
    item.count += 1;
    item.current += Number(row.currentRecentOil || 0);
    item.previous += Number(row.previousRecentOil || 0);
    item.recoverable += Number(row.recoverableOil || 0);
    map.set(block, item);
  });
  return Array.from(map.values()).sort((a, b) => b.recoverable - a.recoverable);
};

type ChartDataSource = 'memory' | 'summary' | 'local_production' | 'oracle' | null;

interface DateRange {
  start: string;
  end: string;
}

interface CompareMetrics {
  liquid: number;
  oil: number;
  diluent: number;
  water_cut: number;
  gas: number;
}

interface CompareTypeStat {
  label: string;
  wellCount: number;
  liquidDiff: number;
  oilDiff: number;
}

interface CompareResultRow {
  jh: string;
  station: string;
  block: string;
  avgA: CompareMetrics;
  avgB: CompareMetrics;
  diff: CompareMetrics;
  note: string;
}

interface CompareSummary {
  totalWellDiff: number;
  totalLiquidDiff: number;
  totalOilDiff: number;
  openWellCount: number;
  closedWellCount: number;
  incrementWellCount: number;
  decrementWellCount: number;
  openWellTypes: CompareTypeStat[];
  closedWellTypes: CompareTypeStat[];
  incrementTypes: CompareTypeStat[];
  decrementTypes: CompareTypeStat[];
}

interface LargeChangeRow {
  jh: string;
  station: string;
  block: string;
  liquidDiff: number;
  oilDiff: number;
  diluentDiff: number;
  waterDiff: number;
  note: string;
}

interface LargeChangeData {
  rows: LargeChangeRow[];
  count: number;
  totalLiquidDiff: number;
  totalOilDiff: number;
  totalDiluentDiff: number;
}

interface CompareResponseData {
  rows: CompareResultRow[];
  summary: CompareSummary | null;
  largeChange: LargeChangeData | null;
  hasRangeAData?: boolean;
  hasRangeBData?: boolean;
}

type MeasureDetailValue = string | number;

type MeasureDetailSection = Record<string, MeasureDetailValue>;

interface MeasureDetailPayload {
  currentRound: MeasureDetailSection;
  previousRound: MeasureDetailSection;
  rawExtras: MeasureDetailSection;
  rawStatus?: string;
  rawEvaluation?: string;
}

interface MeasureRow {
  id: number;
  seq_no: string;
  jh: string;
  block: string;
  current_status: string;
  current_round_transfer_time: string;
  current_round_measure_type: string;
  production_days: number | null;
  current_liquid: number | null;
  current_oil: number | null;
  current_diluent: number | null;
  current_water_cut: number | null;
  cumulative_oil: number | null;
  cumulative_oil_gain: number | null;
  evaluation: string;
  evaluation_by_cumulative_oil?: string;
  evaluation_by_cumulative_oil_gain?: string;
  previous_period_cumulative_oil?: number | null;
  previous_period_oil_gain?: number | null;
  detail_json?: string;
  detail?: MeasureDetailPayload;
  measure_date?: string;
  station?: string;
  measure_type?: string;
  measure_name?: string;
  status?: string;
  owner?: string;
  result_text?: string;
  oil_gain?: number;
  liquid_gain?: number;
  remark?: string;
  source_batch?: string;
  created_at?: string;
  updated_at?: string;
}

interface MeasureFiltersMeta {
  blocks: string[];
  stations: string[];
  statuses: string[];
  years: string[];
}

interface MeasuresResponseData {
  rows: MeasureRow[];
  filters: MeasureFiltersMeta;
}

type MeasureMetricMode = 'cumulative_oil' | 'cumulative_oil_gain';

const TEN_DAY_DELTA_PALETTES = [
  { current: '#0f766e', previous: '#f97316' },
  { current: '#2563eb', previous: '#dc2626' },
  { current: '#7c3aed', previous: '#16a34a' },
  { current: '#0891b2', previous: '#f59e0b' }
];

interface MeasureImportMeta {
  sheetName?: string;
  totalRows?: number;
  validRows?: number;
  skippedCount?: number;
  unknownHeaders?: string[];
  dataYear?: string;
  yearMismatch?: boolean;
  expectedYear?: string;
}

type MeasureImportDialogKind = 'preview' | 'success' | 'error';

interface MeasureImportDialogState {
  open: boolean;
  kind: MeasureImportDialogKind;
  title: string;
  message: string;
  file: File | null;
  meta: MeasureImportMeta | null;
}

interface MeasureDetailChartState {
  currentData: ChartData | null;
  previousData: ChartData | null;
  currentRange: DateRange | null;
  previousRange: DateRange | null;
  loading: boolean;
  error: string;
  warning: string;
}

interface MeasureClassAnalysisState {
  evaluation: string | null;
  currentData: ChartData | null;
  previousData: ChartData | null;
  loading: boolean;
  error: string;
  wellCount: number;
}

interface AverageOilPeriodData {
  labels: string[];
  current: Array<number | null>;
  previous: Array<number | null>;
}

interface MeasureMonthlyCohortChart {
  month: string;
  wellCount: number;
  tenDayData: AverageOilPeriodData;
}

interface MeasureMonthlyCohortState {
  rows: MeasureMonthlyCohortChart[];
  loading: boolean;
  error: string;
}

interface MeasureBlockChart {
  block: string;
  wellCount: number;
  tenDayData: AverageOilPeriodData;
}

interface MeasureBlockChartState {
  rows: MeasureBlockChart[];
  loading: boolean;
  error: string;
}

interface MeasureTypeChart {
  measureType: string;
  wellCount: number;
  tenDayData: AverageOilPeriodData;
}

interface MeasureTypeChartState {
  rows: MeasureTypeChart[];
  loading: boolean;
  error: string;
}

type MeasureCustomTimeGrain = 'day' | 'tenDay' | 'month';

interface MeasureCustomFilters {
  block: string;
  measureType: string;
  timeGrain: MeasureCustomTimeGrain;
  transferStart: string;
}

interface MeasureCustomAnalysisState {
  currentData: ChartData | null;
  previousData: ChartData | null;
  loading: boolean;
  error: string;
  wellCount: number;
}

interface MeasureFormState {
  measure_date: string;
  jh: string;
  block: string;
  station: string;
  measure_type: string;
  measure_name: string;
  status: string;
  owner: string;
  result_text: string;
  liquid_gain: number;
  remark: string;
}

const DEFAULT_MEASURE_STATUS_OPTIONS = ['生产', '焖井', '正注', '转注'];

const buildDefaultMeasureForm = (): MeasureFormState => ({
  measure_date: new Date().toISOString().split('T')[0],
  jh: '',
  block: '',
  station: '',
  measure_type: '',
  measure_name: '',
  status: '生产',
  owner: '',
  result_text: '',
  liquid_gain: 0,
  remark: ''
});

const buildEmptyMeasureDetail = (): MeasureDetailPayload => ({
  currentRound: {},
  previousRound: {},
  rawExtras: {}
});

const buildMeasureImportSummaryLines = (meta: MeasureImportMeta | null, fileName?: string, message?: string) => [
  message || '',
  fileName ? `文件名: ${fileName}` : '',
  meta?.sheetName ? `工作表:表:${meta.sheetName}` : '',
  typeof meta?.totalRows === 'number' ? `原始记录: ${meta.totalRows} 行` : '',
  typeof meta?.validRows === 'number' ? `已导入记录: ${meta.validRows} 行` : '',
  meta?.skippedCount ? `跳过无效记录: ${meta.skippedCount} 行` : '',
  meta ? (Array.isArray(meta.unknownHeaders) && meta.unknownHeaders.length > 0 ? `未识别列：${meta.unknownHeaders.join('、')}` : '所有列已识别，或已兼容处理') : '',
].filter(Boolean);

interface MeasureDetailCompareRow {
  label: string;
  currentKey?: string;
  currentValue?: MeasureDetailValue;
  previousKey?: string;
  previousValue?: MeasureDetailValue;
}

const MEASURE_DETAIL_COMPARE_PREFIX_PATTERN = /^(本轮|当前转抽|当前|本次|上轮同期|上轮转抽|上轮措施|上一轮|上轮)/;

const formatMeasureSlashDate = (year: number, month: number, day: number) => `${String(year).padStart(4, '0')}/${String(month).padStart(2, '0')}/${String(day).padStart(2, '0')}`;

const formatMeasureExcelSerialDate = (value: number) => {
  if (!Number.isFinite(value)) {
    return '';
  }

  const wholeDays = Math.floor(value);
  const fractionalDay = value - wholeDays;
  const adjustedDays = wholeDays >= 60 ? wholeDays - 1 : wholeDays;
  const excelEpochUtc = Date.UTC(1899, 11, 31);
  const date = new Date(excelEpochUtc + adjustedDays * 24 * 60 * 60 * 1000 + Math.round(fractionalDay * 24 * 60 * 60 * 1000));
  if (Number.isNaN(date.getTime())) {
    return '';
  }

  return formatMeasureSlashDate(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate());
};

const isReadableDateKey = (key: string) => /(日期|时间|开井|停产|降产|开井日期|停产\/降产日期|rq|date|time)/i.test(key);

const isMeasureDetailDateKey = (key: string) => isReadableDateKey(key) || /日期/.test(key) || /(转注|转抽|开注|停注|开井|停井|开抽|停抽|措施|实施).*(时间)/.test(key);

const formatMeasureDetailDateValue = (value: unknown) => {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return formatMeasureExcelSerialDate(value);
  }

  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return formatMeasureSlashDate(value.getFullYear(), value.getMonth() + 1, value.getDate());
  }

  const text = String(value ?? '').trim();
  if (!text) {
    return '';
  }

  if (/^-?\d+(\.\d+)?$/.test(text)) {
    return formatMeasureExcelSerialDate(Number(text));
  }

  const normalized = text.replace(/[年月.]/g, '/').replace(/[日号]/g, '').replace('T', ' ').trim();
 const datePart = normalized.split(/\s+/)[0];
 const match = datePart.match(/^(\d{4})\/(\d{1,2})\/(\d{1,2})$/);
 if (!match) {
    // Try M/D/YY format (e.g., "9/10/24" -> Sep 10, 2024)
    const matchMDY = datePart.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2})$/);
    if (matchMDY) {
      const [, m, d, shortYear] = matchMDY;
      const fullYear = Number(shortYear) < 50 ? 2000 + Number(shortYear) : 1900 + Number(shortYear);
      return formatMeasureSlashDate(fullYear, Number(m), Number(d));
    }
    // Try M/D/YYYY format (e.g., "9/10/2024")
    const matchMDYYYY = datePart.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    if (matchMDYYYY) {
      const [, m, d, y] = matchMDYYYY;
      return formatMeasureSlashDate(Number(y), Number(m), Number(d));
    }
    return text;
 }

  const [, year, month, day] = match;
  return formatMeasureSlashDate(Number(year), Number(month), Number(day));
};

const normalizeMeasureDetailCompareLabel = (key: string) => {
  const normalized = key.trim().replace(MEASURE_DETAIL_COMPARE_PREFIX_PATTERN, '');
  return normalized || key.trim();
};

const parseMeasureDetailNumber = (key: string, value: unknown) => {
  if (isMeasureDetailDateKey(key)) {
    return null;
  }

  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }

  const text = String(value ?? '').replace(/,/g, '').trim();
  if (!/^-?\d+(\.\d+)?$/.test(text)) {
    return null;
  }

  return Number(text);
};

const formatMeasureDetailNumber = (value: number) => value.toLocaleString('zh-CN', {
  minimumFractionDigits: 1,
  maximumFractionDigits: 1
});

const formatMeasureDetailValue = (key: string, value: unknown) => {
  const text = String(value ?? '').trim();
  if (!text) {
    return '--';
  }

  if (isMeasureDetailDateKey(key)) {
    return formatMeasureDetailDateValue(value) || '--';
  }

  const numeric = parseMeasureDetailNumber(key, value);
  if (numeric !== null) {
    return formatMeasureDetailNumber(numeric);
  }

  return text;
};

const formatOccupancyPreviewValue = (column: string, value: unknown) => {
  const text = String(value ?? '').trim();
  if (!text) {
    return '';
  }

  if (isReadableDateKey(column)) {
    return formatMeasureDetailDateValue(value);
  }

  return text;
};

const OCCUPANCY_COLUMN_LABELS: Record<string, string> = {
  report_date: '日期',
  occupancy_type: '占产类型',
  jh: '井号',
  block: '区块',
  stop_or_decline_date: '停产/降产日期',
  open_date: '开井日期',
  normal_liquid: '正常产液量',
  normal_oil: '正常产油量',
  normal_diluent: '正常掺油',
  normal_water_cut: '正常含水',
  current_liquid: '前液量',
  current_oil: '前油量',
  current_diluent: '前掺油量',
  current_water_cut: '前含水',
  affected_liquid: '影响产液量',
  affected_oil: '影响产油量',
  affected_diluent: '影响掺油',
  affected_water_cut: '正常含水',
  remark: '备注'
};

const HIDDEN_OCCUPANCY_PREVIEW_COLUMNS = new Set(['id', 'raw_json', 'source_file', 'sheet_name', 'created_at']);

const normalizeOccupancyPreviewRows = (rows: Record<string, unknown>[]) => rows.map((row) => {
  const rawJson = row.raw_json;
  if (typeof rawJson === 'string' && rawJson.trim()) {
    try {
      const parsed = JSON.parse(rawJson);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
    } catch {
      // 旧数据可能没有原始行，继续走 Excel 字段中文映射
    }
  }

  return Object.fromEntries(
    Object.entries(row)
      .filter(([key]) => !HIDDEN_OCCUPANCY_PREVIEW_COLUMNS.has(key))
      .map(([key, value]) => [OCCUPANCY_COLUMN_LABELS[key] || key, value])
  );
});

const getOccupancyPreviewColumns = (rows: Record<string, unknown>[], fallbackColumns: string[] = []) => {
  const normalizedFallback = fallbackColumns
    .filter((column) => !HIDDEN_OCCUPANCY_PREVIEW_COLUMNS.has(column))
    .map((column) => OCCUPANCY_COLUMN_LABELS[column] || column);
  const columns = rows.reduce((set, row) => {
    Object.keys(row || {}).forEach((key) => {
      if (!HIDDEN_OCCUPANCY_PREVIEW_COLUMNS.has(key)) {
        set.add(OCCUPANCY_COLUMN_LABELS[key] || key);
      }
    });
    return set;
  }, new Set<string>(normalizedFallback));
  return Array.from(columns);
};

const decodeMojibakeText = (value: unknown) => {
  const raw = String(value ?? '').trim();
  if (!raw) return raw;

  const countCjk = (text: string) => (text.match(/[\u3400-\u9fff]/g) || []).length;
  const countMojibake = (text: string) => (text.match(/[ÃÂÄÅÆÇÈÉÊËÌÍÎÏÐÑÒÓÔÕÖØÙÚÛÜÝÞßàáâãäåæçèéêëìíîïðñòóôõöøùúûüýþÿ�]/g) || []).length;

  try {
    const bytes = Uint8Array.from(Array.from(raw).map((char) => char.charCodeAt(0) & 0xff));
    const decoded = new TextDecoder('utf-8', { fatal: false }).decode(bytes).trim();
    if (decoded && !decoded.includes('� ') && countCjk(decoded) > countCjk(raw)) {
      return decoded;
    }
    if (decoded && countMojibake(raw) > 0 && countMojibake(decoded) < countMojibake(raw)) {
      return decoded;
    }
  } catch {
    return raw;
  }

  return raw;
};


// ---- Normalize?? special values (rules mirrored from backend gs-waterlab.js) ----
const normalizeWaterLabValue = (value: string): string | null => {
  const raw = String(value ?? "").trim();
  if (!raw) return null;
  const emptyKeywords = ["?", "??", "???", "???", "??", "???", "????", "?"];
  if (emptyKeywords.includes(raw)) return null;
  if (raw === "?") return "100";
  if (raw.includes("/")) {
    const parts = raw.split("/");
    const numbers: number[] = [];
    for (const part of parts) {
      const cleaned = part.trim().replace(/\+$/, "");
      if (emptyKeywords.includes(cleaned) || cleaned === "?" || cleaned === "??") continue;
      if (cleaned === "?") { numbers.push(100); continue; }
      const num = parseFloat(cleaned);
      if (!isNaN(num) && isFinite(num)) numbers.push(num);
    }
    if (numbers.length === 0) return null;
    const avg = numbers.reduce((a, b) => a + b, 0) / numbers.length;
    return String(Math.round(avg * 10) / 10);
  }
  let cleaned = raw.replace(/\+$/, "");
  const num = parseFloat(cleaned);
  if (!isNaN(num) && isFinite(num)) return String(num);
  cleaned = raw.replace(/[,%]/g, "");
  const num2 = parseFloat(cleaned);
  if (!isNaN(num2) && isFinite(num2)) return String(num2);
  return raw; // preserve unknown values
};

const parseExcelWorksheetWithDetectedHeader = (worksheet: XLSX.WorkSheet) => {
  const table = XLSX.utils.sheet_to_json<unknown[]>(worksheet, { header: 1, defval: '', raw: true });
  const merges = ((worksheet['!merges'] || []) as XLSX.Range[]);
  merges.forEach((merge) => {
    const topLeft = table[merge.s.r]?.[merge.s.c];
    if (topLeft === undefined || topLeft === null || String(topLeft).trim() === '') return;
    for (let rowIndex = merge.s.r; rowIndex <= merge.e.r; rowIndex += 1) {
      table[rowIndex] = table[rowIndex] || [];
      for (let colIndex = merge.s.c; colIndex <= merge.e.c; colIndex += 1) {
        if (table[rowIndex][colIndex] === undefined || table[rowIndex][colIndex] === null || String(table[rowIndex][colIndex]).trim() === '') {
          table[rowIndex][colIndex] = topLeft;
        }
      }
    }
  });
  const normalizedRows = table.map((row) => row.map((cell) => { const nv = normalizeWaterLabValue(String(cell ?? '')); return nv !== null ? nv : ''; }));
const headerKeywords = ['井号', '井名', '区块', '日期', '开井', '检泵', '泵深', '产液', '产油', '含水', '备注'];

  let headerIndex = 0;
  let bestScore = -1;
  normalizedRows.slice(0, 20).forEach((row, index) => {
    const nonEmpty = row.filter(Boolean);
    if (nonEmpty.length < 2) return;
    const keywordScore = nonEmpty.reduce((score, cell) => (
      score + (headerKeywords.some((keyword) => cell.includes(keyword)) ? 4 : 0)
    ), 0);
    const emptyPenalty = nonEmpty.some((cell) => /^__EMPTY/i.test(cell)) ? 20 : 0;
    const titlePenalty = nonEmpty.length === 1 ? 30 : 0;
    const score = keywordScore + Math.min(nonEmpty.length, 12) - emptyPenalty - titlePenalty;
    if (score > bestScore) {
      bestScore = score;
      headerIndex = index;
    }
  });

  const headerRow = normalizedRows[headerIndex] || [];
  const subHeaderRow = normalizedRows[headerIndex + 1] || [];
const groupHeaderPattern = /(检泵前|预检泵潜力|^\d{4}[\/-]\d{1,2}[\/-]\d{1,2}$|^\d{4}[\/-]\d{1,2}$)/;
  const leafHeaderPattern = /^(液|油|掺油|含水|日液|日油|日产液|日产油)$/;
  const seen = new Map<string, number>();
  const columns = headerRow.map((cell, index) => {
    const subCell = subHeaderRow[index] || '';
    const hasGroupHeader = groupHeaderPattern.test(cell);
    const hasLeafHeader = leafHeaderPattern.test(subCell);
    const base = hasGroupHeader && hasLeafHeader
      ? `${cell}_${subCell}`
      : (cell && !/^__EMPTY/i.test(cell) ? cell : (subCell || `列${index + 1}`));
    const count = seen.get(base) || 0;
    seen.set(base, count + 1);
    return count === 0 ? base : `${base}_${count + 1}`;
  });

  const dataStartIndex = subHeaderRow.some((cell) => leafHeaderPattern.test(cell)) ? headerIndex + 2 : headerIndex + 1;
  const rows = table.slice(dataStartIndex)
    .filter((row) => row.some((cell) => String(cell ?? '').trim()))
    .map((row) => columns.reduce<Record<string, unknown>>((record, column, index) => {
      record[column] = row[index] ?? '';
      return record;
    }, {}));

  columns.forEach((column) => {
    if (/^(状态  |区块|类型)$/i.test(column) || ['状态  ', '区块', '类型'].includes(column)) {
      let lastValue = '';
      rows.forEach((row) => {
        const current = String(row[column] ?? '').trim();
        if (current) {
          lastValue = current;
        } else if (lastValue) {
          row[column] = lastValue;
        }
      });
    }
  });

  const visibleColumns = columns.filter((column, index) => (
    !/^列\d+$/.test(column) || rows.some((row) => String(row[column] ?? '').trim()) || headerRow[index]
  ));

  return {
    headerIndex,
    columns: visibleColumns,
    rows: rows.map((row) => visibleColumns.reduce<Record<string, unknown>>((record, column) => {
      record[column] = row[column];
      return record;
    }, {}))
  };
};

const normalizeTableKey = (value: string) => value.replace(/\s+/g, '').replace(/[()（）/\\:_\-、,，.。;；：]/g, '').toLowerCase();

const findTableColumn = (columns: string[], aliases: string[]) => {
  const normalizedAliases = aliases.map(normalizeTableKey);
  return columns.find((column) => {
    const key = normalizeTableKey(column);
    return normalizedAliases.some((alias) => key === alias || key.includes(alias));
  }) || '';
};

const findPumpDeepDateColumn = (columns: string[], kind: 'handover' | 'operation') => {
  const exactAliases = kind === 'handover'
    ? ['交井日期']
    : ['作业日期'];
  const normalizedExactAliases = exactAliases.map(normalizeTableKey);
  const forbidden = ['上次', '上轮', '上期', '上回', '作业区', '上次作业区', '上轮作业区'].map(normalizeTableKey);

  return columns.find((column) => {
    const key = normalizeTableKey(column);
    if (forbidden.some((item) => key.includes(item))) return false;
    if (normalizedExactAliases.some((alias) => key === alias)) return true;

    return false;
  }) || '';
};

const findPumpCurrentOilColumn = (columns: string[]) => {
  const explicit = findTableColumn(columns, ['日产油量', '日产油', '前日产油', '当前日产油量']);
  if (explicit) return explicit;

  const datedOilColumns = columns
    .map((column) => ({ column, match: column.match(/(\d{4})[\/-](\d{1,2})(?:[\/-](\d{1,2}))?.*油/) }))
    .filter((item): item is { column: string; match: RegExpMatchArray } => Boolean(item.match))
    .map((item) => {
      const year = Number(item.match[1]);
      const month = Number(item.match[2]);
      const day = Number(item.match[3] || 1);
      return { column: item.column, time: new Date(year, month - 1, day).getTime() };
    })
    .sort((a, b) => b.time - a.time);

  return datedOilColumns[0]?.column || findTableColumn(columns, ['日产油']);
};

const parseTableDateValue = (value: unknown) => {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return formatMeasureDetailDateValue(value).replace(/\//g, '-');
  }

  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    const year = value.getFullYear();
    const month = String(value.getMonth() + 1).padStart(2, '0');
    const day = String(value.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  const text = String(value ?? '').trim();
  if (!text) return '';
  if (/^-?\d+(\.\d+)?$/.test(text)) {
    return formatMeasureDetailDateValue(Number(text)).replace(/\//g, '-');
  }

  const normalized = text.replace(/[年月.]/g, '-').replace(/[日号]/g, '').replace(/\//g, '-').trim();
  const match = normalized.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (!match) return '';
  return `${match[1]}-${match[2].padStart(2, '0')}-${match[3].padStart(2, '0')}`;
};

const parseTableNumberValue = (value: unknown) => {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  const text = String(value ?? '').replace(/,/g, '').trim();
  const match = text.match(/-?\d+(\.\d+)?/);
  return match ? Number(match[0]) : null;
};

const buildPumpOldWellRecoveredOilSeries = (rows: Record<string, unknown>[], columns: string[]) => {
  const statusColumn = findTableColumn(columns, ['状态  ', '当前状态  ', '泵状态  ']);
  const typeColumn = findTableColumn(columns, ['类型', '井类型', '类别']);
  const openDateColumn = findTableColumn(columns, ['本次检泵开日期', '本次检泵开井日期', '检泵开日期', '开井日期']);
  const previousOpenDateColumn = findTableColumn(columns, ['上次检泵开日期', '上次检泵开井日期', '上轮检泵开日期', '上轮开井日期']);
  const wellColumn = findTableColumn(columns, ['井号', '井名', '井 ']);
  const blockColumn = findTableColumn(columns, ['区块', '分区', '所属区块']);
  const reasonColumn = findTableColumn(columns, ['泵深原因', '原因']);
  const intervalColumn = findTableColumn(columns, ['作业间隔', '检泵间隔', '间隔']);
  const preOilColumn = findTableColumn(columns, ['检泵前日产油', '检泵前产油', '检泵前日产油']);
  const potentialOilColumn = findTableColumn(columns, ['预检泵潜力产油', '预检泵潜力产油', '油潜力产油']);
  const remarkColumn = findTableColumn(columns, ['备注', '说明']);

  const missing = [
    !statusColumn ? '状态  ' : '',
    !typeColumn ? '类型' : '',
    !openDateColumn ? '本次检泵开日期' : '',
    !previousOpenDateColumn ? '上次检泵开日期' : '',
    !wellColumn ? '井号' : ''
  ].filter(Boolean);

  if (missing.length > 0) {
    return {
      wells: [],
      matchedWells: 0,
      matchedRows: 0,
      missing,
      columns: { statusColumn, typeColumn, openDateColumn, previousOpenDateColumn, wellColumn }
    };
  }

  const groupConfigs = [
    {
      key: 'recoveredOld',
      title: '已检泵（已恢复）老井',
      matches: (status: string, type: string) => status.includes('已检泵') && status.includes('已恢复') && type === '老井',
    },
    {
      key: 'recoveredMeasure',
      title: '已检泵（已恢复）措施井',
      matches: (status: string, type: string) => status.includes('已检泵') && status.includes('已恢复') && type === '措施井',
    },
    {
      key: 'pendingRecovery',
      title: '已检泵（待恢复）',
      matches: (status: string) => status.includes('已检泵') && status.includes('待恢复'),
    },
    {
      key: 'activePendingPump',
      title: '未检泵/待检泵',
      matches: (status: string) => status.includes('待检泵') || status.includes('未检泵') || status.includes('正/待检泵'),
    }
  ];
  const groupMaps = new Map(groupConfigs.map((group) => [group.key, new Map<string, {
    openDate: string;
    previousOpenDate: string;
    status: string;
    type: string;
    block: string;
    reason: string;
    interval: number | null;
    preOil: number | null;
    potentialOil: number | null;
    remark: string;
  }>]));
  const matchedRowsByGroup = new Map(groupConfigs.map((group) => [group.key, 0]));

  rows.forEach((row) => {
    const status = String(row[statusColumn] ?? '').replace(/\s+/g, '');
    const type = String(row[typeColumn] ?? '').replace(/\s+/g, '');
    const matchedGroups = groupConfigs.filter((group) => group.matches(status, type));
    if (matchedGroups.length === 0) return;

    const openDate = parseTableDateValue(row[openDateColumn]);
    const previousOpenDate = parseTableDateValue(row[previousOpenDateColumn]);
    const jh = String(row[wellColumn] ?? '').trim();
    if (!jh) return;

    matchedGroups.forEach((group) => {
      if (group.key !== 'activePendingPump' && (!openDate || !previousOpenDate)) return;
      const groupMap = groupMaps.get(group.key)!;
      matchedRowsByGroup.set(group.key, (matchedRowsByGroup.get(group.key) || 0) + 1);
      const previous = groupMap.get(jh);
      if (!previous || (openDate && (!previous.openDate || openDate < previous.openDate))) {
        groupMap.set(jh, {
          openDate,
          previousOpenDate,
          status: String(row[statusColumn] ?? '').trim(),
          type: String(row[typeColumn] ?? '').trim(),
          block: blockColumn ? String(row[blockColumn] ?? '').trim() : '',
          reason: reasonColumn ? String(row[reasonColumn] ?? '').trim() : '',
          interval: intervalColumn ? parseTableNumberValue(row[intervalColumn]) : null,
          preOil: preOilColumn ? parseTableNumberValue(row[preOilColumn]) : null,
          potentialOil: potentialOilColumn ? parseTableNumberValue(row[potentialOilColumn]) : null,
          remark: remarkColumn ? String(row[remarkColumn] ?? '').trim() : ''
        });
      }
    });
  });

  const groups = groupConfigs.map((group) => {
    const groupMap = groupMaps.get(group.key)!;
    return {
      key: group.key,
      title: group.title,
      wells: Array.from(groupMap.entries()).map(([jh, dates]) => ({ jh, ...dates })),
      matchedWells: groupMap.size,
      matchedRows: matchedRowsByGroup.get(group.key) || 0
    };
  });

  return {
    wells: groups[0]?.wells || [],
    groups,
    matchedWells: groups.reduce((sum, group) => sum + group.matchedWells, 0),
    matchedRows: groups.reduce((sum, group) => sum + group.matchedRows, 0),
    missing: [],
    columns: { statusColumn, typeColumn, openDateColumn, previousOpenDateColumn, wellColumn }
  };
};

const getPumpYearSheet = (
  upload: PumpAnalysisUploadState,
  year: string
): { sheetName: string; rows: Record<string, unknown>[]; columns: string[] } => {
  const sheets = upload.sheets || {};
  const matchedKey = Object.keys(sheets).find((key) => key.includes(year));
  if (matchedKey) return sheets[matchedKey];

  if (upload.sheetName.includes(year)) {
    return { sheetName: upload.sheetName, rows: upload.rows, columns: upload.columns };
  }

  return { sheetName: '', rows: [], columns: [] };
};

const getPumpDeepColumns = (columns: string[]) => ({
  date: findTableColumn(columns, ['日期', '检泵日期', '本次检泵日期', '本次检泵开日期', '开井日期']),
  handoverDate: findPumpDeepDateColumn(columns, 'handover'),
  operationDate: findPumpDeepDateColumn(columns, 'operation'),
  interval: findTableColumn(columns, ['间隔天数', '作业间隔', '检泵间隔', '间隔']),
  designReason: findTableColumn(columns, ['设计检泵原因', '设计原因']),
  surveyReason: findTableColumn(columns, ['勘察原因', '勘查原因', '现场勘察原因']),
  actualReason: findTableColumn(columns, ['实际检泵原因', '实际泵原因', '检泵实际原因', '实际原因']),
  detailReason: findTableColumn(columns, ['具体原因', '原因明细', '详细原因']),
  block: findTableColumn(columns, ['区块', '分区', '所属区块']),
  type: findTableColumn(columns, ['类型', '类别', '井别']),
  well: findTableColumn(columns, ['井号', '井名', '井 '])
});

const normalizePumpReasonText = (value: unknown) => String(value ?? '').replace(/\s+/g, '').trim() || '未知原因';

const normalizePumpDeepBlockName = (value: unknown) => {
  const text = String(value ?? '').replace(/\s+/g, '').trim();
  if (!text) return '未知区块';
  const normalized = text.replace(/（ /g, '(').replace(/） /g, ')');

  // 高3624(北)/高3624（南）→ 高3624
  if (/^高3624/.test(normalized)) return '高3624';
  // 高21/高21南 → 高21
  if (/^高21/.test(normalized)) return '高21';
  // 高372108 → 高3
  if (/^高372108/.test(normalized)) return '高3';

  if (/^北 ?3624北 ?\((北|北 )\)$/i.test(normalized)) return '北 3624';
  if (/^北 ?3624北 ?$/i.test(normalized)) return '北 3624';
  return text;
};

const getPumpDeepRowMonth = (row: Record<string, unknown>, dateColumn: string) => {
  const date = dateColumn ? parseTableDateValue(row[dateColumn]) : '';
  const match = date.match(/^\d{4}-(\d{2})-/);
  return match ? match[1] : '';
};

const getPumpDeepRowDate = (row: Record<string, unknown>, columns: ReturnType<typeof getPumpDeepColumns>) => {
  const handoverDate = columns.handoverDate ? parseTableDateValue(row[columns.handoverDate]) : '';
  const operationDate = columns.operationDate ? parseTableDateValue(row[columns.operationDate]) : '';
  return [handoverDate, operationDate].filter(Boolean).sort().pop() || '';
};

const getPumpSamePeriodRows = (
  rows: Record<string, unknown>[],
  columns: ReturnType<typeof getPumpDeepColumns>,
  cutoffMonthDay: string
) => {
  if (!cutoffMonthDay) return rows;
  return rows.filter((row) => {
    const date = getPumpDeepRowDate(row, columns);
    if (!date) return false;
    return date.slice(5, 10) <= cutoffMonthDay;
  });
};

const buildCountMap = (rows: Record<string, unknown>[], column: string) => {
  const map = new Map<string, number>();
  if (!column) return map;
  rows.forEach((row) => {
    const key = normalizePumpReasonText(row[column]);
    map.set(key, (map.get(key) || 0) + 1);
  });
  return map;
};

const getTopCountRows = (map2025: Map<string, number>, map2026: Map<string, number>, limit = 12) => {
  const keys = Array.from(new Set([...map2025.keys(), ...map2026.keys()]));
  return keys
    .map((name) => ({
      name,
      count2025: map2025.get(name) || 0,
      count2026: map2026.get(name) || 0,
      diff: (map2026.get(name) || 0) - (map2025.get(name) || 0)
    }))
    .sort((a, b) => (b.count2026 + b.count2025) - (a.count2026 + a.count2025))
    .slice(0, limit);
};

const buildPumpReasonPairRows = (rows: Record<string, unknown>[], designColumn: string, actualColumn: string, limit = 12) => {
  const map = new Map<string, { design: string; actual: string; count: number }>();
  if (!designColumn || !actualColumn) return [];
  rows.forEach((row) => {
    const design = normalizePumpReasonText(row[designColumn]);
    const actual = normalizePumpReasonText(row[actualColumn]);
    const key = `${design} -> ${actual}`;
    const item = map.get(key) || { design, actual, count: 0 };
    item.count += 1;
    map.set(key, item);
  });
  return Array.from(map.values()).sort((a, b) => b.count - a.count).slice(0, limit);
};

const buildPumpReasonConformity = (rows: Record<string, unknown>[], designColumn: string, actualColumn: string) => {
  if (!designColumn || !actualColumn) {
    return { total: 0, matched: 0, unmatched: 0, rate: 0 };
  }

  const compared = rows.map((row) => {
    const design = normalizePumpReasonText(row[designColumn]);
    const actual = normalizePumpReasonText(row[actualColumn]);
    return { design, actual, matched: design !== '未知原因' && actual !== '未知原因' && design === actual };
  });
  const matched = compared.filter((row) => row.matched).length;
  return {
    total: compared.length,
    matched,
    unmatched: compared.length - matched,
    rate: compared.length ? matched / compared.length : 0
  };
};

const buildPumpDeepAnalysisData = (upload: PumpAnalysisUploadState) => {
  const sheet2025 = getPumpYearSheet(upload, '2025');
  const sheet2026 = getPumpYearSheet(upload, '2026');
  const columns2025 = getPumpDeepColumns(sheet2025.columns);
  const columns2026 = getPumpDeepColumns(sheet2026.columns);
  const monthLabels = Array.from({ length: 12 }, (_, index) => `${index + 1}月`);
  const latest2026Date = sheet2026.rows
    .map((row) => getPumpDeepRowDate(row, columns2026))
    .filter(Boolean)
    .sort()
    .pop() || '';
  const samePeriodCutoffMonthDay = latest2026Date.slice(5, 10);
  const samePeriodRows2025 = getPumpSamePeriodRows(sheet2025.rows, columns2025, samePeriodCutoffMonthDay);
  const samePeriodRows2026 = getPumpSamePeriodRows(sheet2026.rows, columns2026, samePeriodCutoffMonthDay);

  const buildMonthlyRows = () => monthLabels.map((label, index) => {
    const month = String(index + 1).padStart(2, '0');
    const monthDateColumn2025 = columns2025.handoverDate || columns2025.operationDate;
    const monthDateColumn2026 = columns2026.handoverDate || columns2026.operationDate;
    const rows2025 = sheet2025.rows.filter((row) => getPumpDeepRowMonth(row, monthDateColumn2025) === month);
    const rows2026 = samePeriodRows2026.filter((row) => getPumpDeepRowMonth(row, monthDateColumn2026) === month);
    const avg = (rows: Record<string, unknown>[], column: string) => {
      if (!column) return null;
      const values = rows.map((row) => parseTableNumberValue(row[column])).filter((value): value is number => value !== null);
      return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
    };
    return {
      month: label,
      count2025: rows2025.length,
      count2026: rows2026.length,
      avgInterval2025: avg(rows2025, columns2025.interval),
      avgInterval2026: avg(rows2026, columns2026.interval)
    };
  });

  const reasonConfigs = [
    { key: 'designReason', title: '设计检泵原因' },
    { key: 'surveyReason', title: '勘察原因' },
    { key: 'actualReason', title: '实际检泵原因' },
    { key: 'detailReason', title: '具体原因' }
  ] as const;

  const reasonTables = reasonConfigs.map((config) => {
    const column2025 = columns2025[config.key];
    const column2026 = columns2026[config.key];
    return {
      title: config.title,
      column2025,
      column2026,
      rows: getTopCountRows(buildCountMap(samePeriodRows2025, column2025), buildCountMap(samePeriodRows2026, column2026))
    };
  });

  const conformity2025 = buildPumpReasonConformity(samePeriodRows2025, columns2025.designReason, columns2025.actualReason);
  const conformity2026 = buildPumpReasonConformity(samePeriodRows2026, columns2026.designReason, columns2026.actualReason);
  const relation2025 = buildPumpReasonPairRows(samePeriodRows2025, columns2025.designReason, columns2025.actualReason);
  const relation2026 = buildPumpReasonPairRows(samePeriodRows2026, columns2026.designReason, columns2026.actualReason);

  const blockMap = new Map<string, {
    block: string;
    count2025: number;
    count2026: number;
    types2025: Map<string, number>;
    types2026: Map<string, number>;
  }>();
  const appendBlockRows = (rows: Record<string, unknown>[], columns: ReturnType<typeof getPumpDeepColumns>, year: '2025' | '2026') => {
    rows.forEach((row) => {
      const block = columns.block ? normalizePumpDeepBlockName(row[columns.block]) : '未知区块';
      const type = columns.type ? normalizePumpReasonText(row[columns.type]) : '未知原因';
      const item = blockMap.get(block) || { block, count2025: 0, count2026: 0, types2025: new Map<string, number>(), types2026: new Map<string, number>() };
      if (year === '2025') {
        item.count2025 += 1;
        item.types2025.set(type, (item.types2025.get(type) || 0) + 1);
      } else {
        item.count2026 += 1;
        item.types2026.set(type, (item.types2026.get(type) || 0) + 1);
      }
      blockMap.set(block, item);
    });
  };
  appendBlockRows(samePeriodRows2025, columns2025, '2025');
  appendBlockRows(samePeriodRows2026, columns2026, '2026');

  const blockRows = Array.from(blockMap.values())
    .map((item) => ({
      block: item.block,
      count2025: item.count2025,
      count2026: item.count2026,
      diff: item.count2026 - item.count2025,
      types2025: Array.from(item.types2025.entries()).sort((a, b) => b[1] - a[1]).map(([name, count]) => `${name}${count}`).join('、') || '--',
      types2026: Array.from(item.types2026.entries()).sort((a, b) => b[1] - a[1]).map(([name, count]) => `${name}${count}`).join('、') || '--',
    }))
    .sort((a, b) => (b.count2026 + b.count2025) - (a.count2026 + a.count2025));

  return {
    sheet2025,
    sheet2026,
    samePeriodRows2025,
    samePeriodRows2026,
    columns2025,
    columns2026,
    monthRows: buildMonthlyRows(),
    reasonTables,
    conformity2025,
    conformity2026,
    relation2025,
    relation2026,
    latest2026Date,
    blockRows
  };
};

const getPumpMonthlyComparisonChartOption = (monthRows: ReturnType<typeof buildPumpDeepAnalysisData>['monthRows']) => ({
  color: ['#64748b', '#2563eb', '#f59e0b', '#ef4444'],
  tooltip: {
    trigger: 'axis',
    axisPointer: { type: 'shadow' },
    formatter: (params: any[]) => {
      const title = params[0]?.axisValue || '';
      return [
        title,
        ...params.map((item) => `${item.marker}${item.seriesName}: ${formatChartNumber(item.value, 0)}${item.seriesType === 'line' ? ' 日均' : ' 日均'}`)
      ].join('<br/>');
    }
  },
  legend: { top: 8, data: ['2025年泵数年', '2026年泵数年', '2025平均间隔', '2026平均间隔'] },
  grid: { top: 72, left: 56, right: 56, bottom: 48 },
  xAxis: { type: 'category', data: monthRows.map((row) => row.month), axisTick: { alignWithLabel: true } },
  yAxis: [
    { type: 'value', name: '检泵数据', minInterval: 1, splitLine: { lineStyle: { type: 'dashed', color: '#e2e8f0' } } },
    { type: 'value', name: '平均间隔(天)', splitLine: { show: false } }
  ],
  series: [
    { name: '2025年泵数年', type: 'bar', data: monthRows.map((row) => row.count2025), barMaxWidth: 28, label: { show: true, position: 'top', formatter: (params: any) => formatChartNumber(params.value, 0) } },
    { name: '2026年泵数年', type: 'bar', data: monthRows.map((row) => row.count2026), barMaxWidth: 28, label: { show: true, position: 'top', formatter: (params: any) => formatChartNumber(params.value, 0) } },
    { name: '2025平均间隔', type: 'line', yAxisIndex: 1, smooth: true, data: monthRows.map((row) => row.avgInterval2025), label: { show: true, formatter: (params: any) => params.value == null ? '' : formatChartNumber(params.value, 0) } },
    { name: '2026平均间隔', type: 'line', yAxisIndex: 1, smooth: true, data: monthRows.map((row) => row.avgInterval2026), label: { show: true, formatter: (params: any) => params.value == null ? '' : formatChartNumber(params.value, 0) } }
  ]
});

const getPumpBlockComparisonChartOption = (blockRows: ReturnType<typeof buildPumpDeepAnalysisData>['blockRows']) => {
  const rows = blockRows.slice(0, 12);
  const formatBlockAxisLabel = (value: string) => value.length > 6 ? `${value.slice(0, 6)}...` : value;
  return {
    color: ['#64748b', '#2563eb'],
    tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' } },
    legend: { top: 8, data: ['2025年泵数年', '2026年泵数年'] },
    grid: { top: 62, left: 52, right: 24, bottom: 64 },
    xAxis: {
      type: 'category',
      data: rows.map((row) => row.block),
      axisLabel: { interval: 0, rotate: 0, formatter: formatBlockAxisLabel }
    },
    yAxis: { type: 'value', minInterval: 1, name: '检泵数据', splitLine: { lineStyle: { type: 'dashed', color: '#e2e8f0' } } },
    series: [
      { name: '2025年泵数年', type: 'bar', data: rows.map((row) => row.count2025), barMaxWidth: 30, label: { show: true, position: 'top', formatter: (params: any) => formatChartNumber(params.value, 0) } },
      { name: '2026年泵数年', type: 'bar', data: rows.map((row) => row.count2026), barMaxWidth: 30, label: { show: true, position: 'top', formatter: (params: any) => formatChartNumber(params.value, 0) } }
    ]
  };
};

const getPumpReasonComparisonChartOption = (title: string, rows: ReturnType<typeof getTopCountRows>) => {
  const chartRows = rows.slice(0, 10).reverse();
  const formatReasonAxisLabel = (value: string) => value.length > 10 ? `${value.slice(0, 10)}...` : value;
  return {
    color: ['#64748b', '#2563eb'],
    tooltip: {
      trigger: 'axis',
      axisPointer: { type: 'shadow' },
      formatter: (params: any[]) => {
        const name = params[0]?.axisValue || '';
        return [
          name,
          ...params.map((item) => `${item.marker}${item.seriesName}: ${formatChartNumber(item.value, 0)} 小计`)
        ].join('<br/>');
      }
    },
    legend: { top: 8, data: ['2025', '2026'] },
    grid: { top: 50, left: 104, right: 34, bottom: 24 },
    xAxis: {
      type: 'value',
      minInterval: 1,
      name: '次数',
      splitLine: { lineStyle: { type: 'dashed', color: '#e2e8f0' } }
    },
    yAxis: {
      type: 'category',
      data: chartRows.map((row) => row.name),
      axisLabel: { formatter: formatReasonAxisLabel }
    },
    series: [
      {
        name: '2025',
        type: 'bar',
        data: chartRows.map((row) => row.count2025),
        barMaxWidth: 18,
        label: { show: true, position: 'right', formatter: (params: any) => formatChartNumber(params.value, 0) }
      },
      {
        name: '2026',
        type: 'bar',
        data: chartRows.map((row) => row.count2026),
        barMaxWidth: 18,
        label: { show: true, position: 'right', formatter: (params: any) => formatChartNumber(params.value, 0) }
      }
    ]
  };
};

const buildMeasureDetailCompareRows = (detail: MeasureDetailPayload | undefined): MeasureDetailCompareRow[] => {
  const rowMap = new Map<string, MeasureDetailCompareRow>();
  const order: string[] = [];

  const appendEntries = (entries: Array<[string, MeasureDetailValue]>, side: 'current' | 'previous') => {
    entries.forEach(([key, value]) => {
      const label = normalizeMeasureDetailCompareLabel(key);
      if (!rowMap.has(label)) {
        rowMap.set(label, { label });
        order.push(label);
      }

      const row = rowMap.get(label)!;
      if (side === 'current') {
        row.currentKey = row.currentKey || key;
        row.currentValue = value;
      } else {
        row.previousKey = row.previousKey || key;
        row.previousValue = value;
      }
    });
  };

  appendEntries(Object.entries(detail?.currentRound || {}), 'current');
  appendEntries(Object.entries(detail?.previousRound || {}), 'previous');

  return order.map((label) => rowMap.get(label)!);
};

const getMeasureDetailDiff = (row: MeasureDetailCompareRow) => {
  const currentNumber = row.currentKey ? parseMeasureDetailNumber(row.currentKey, row.currentValue) : null;
  const previousNumber = row.previousKey ? parseMeasureDetailNumber(row.previousKey, row.previousValue) : null;
  if (currentNumber === null || previousNumber === null) {
    return null;
  }

  const diff = currentNumber - previousNumber;
  if (Math.abs(diff) < 0.05) {
    return { text: '持平', className: 'text-gray-500' };
  }

  return diff > 0
    ? { text: `增加 ${formatMeasureDetailNumber(Math.abs(diff))}`, className: 'text-red-600' }
    : { text: `减少 ${formatMeasureDetailNumber(Math.abs(diff))}`, className: 'text-emerald-600' };
};

const shiftDateByYears = (dateString: string, yearOffset: number) => {
  const [year, month, day] = dateString.split('-').map(Number);
  const shifted = new Date(year + yearOffset, month - 1, day);
  if (shifted.getMonth() !== month - 1) {
    shifted.setDate(0);
  }
  return `${shifted.getFullYear()}-${String(shifted.getMonth() + 1).padStart(2, '0')}-${String(shifted.getDate()).padStart(2, '0')}`;
};

const shiftDateByDays = (dateString: string, dayOffset: number) => {
  const [year, month, day] = dateString.split('-').map(Number);
  const shifted = new Date(year, month - 1, day);
  shifted.setDate(shifted.getDate() + dayOffset);
  return `${shifted.getFullYear()}-${String(shifted.getMonth() + 1).padStart(2, '0')}-${String(shifted.getDate()).padStart(2, '0')}`;
};

const getInclusiveDateRangeDayCount = (startDate: string, endDate: string) => {
  const [startYear, startMonth, startDay] = startDate.split('-').map(Number);
  const [endYear, endMonth, endDay] = endDate.split('-').map(Number);
  const start = Date.UTC(startYear, startMonth - 1, startDay);
  const end = Date.UTC(endYear, endMonth - 1, endDay);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return 0;
  return Math.floor((end - start) / 86400000) + 1;
};

const normalizeMeasureDetailIsoDate = (value: unknown) => {
  const formatted = formatMeasureDetailDateValue(value).replace(/\//g, '-');
  return /^\d{4}-\d{2}-\d{2}$/.test(formatted) ? formatted : '';
};

const getPreviousMeasureStartDate = (detail: MeasureDetailPayload | undefined) => {
  const exactKeys = ['上轮转抽时间', '上轮转抽日期', '上轮同期转抽时间', '上轮同期转抽日期'];

  // 1) Primary: search in structured previousRound
  const previousEntries = Object.entries(detail?.previousRound || {});
  for (const [rawKey, value] of previousEntries) {
    const key = rawKey.replace(/\s+/g, '');
    if (exactKeys.includes(key)) {
      return normalizeMeasureDetailIsoDate(value) || '';
    }
  }

  // 2) Fallback: search in rawExtras (may contain migrated Excel keys)
  const extrasEntries = Object.entries(detail?.rawExtras || {});
  for (const [rawKey, value] of extrasEntries) {
    const key = rawKey.replace(/\s+/g, '');
    if (exactKeys.includes(key)) {
      return normalizeMeasureDetailIsoDate(value) || '';
    }
  }

  // 3) Last resort: search top-level detail fields (Excel imports put keys at root)
  const rootEntries = Object.entries(detail || {});
  for (const [rawKey, value] of rootEntries) {
    if (rawKey === 'currentRound' || rawKey === 'previousRound' || rawKey === 'rawExtras' || rawKey === 'rawStatus' || rawKey === 'rawEvaluation') continue;
    const key = rawKey.replace(/\s+/g, '');
    if (exactKeys.includes(key)) {
      return normalizeMeasureDetailIsoDate(value) || '';
    }
  }

  return '';
};

const buildDateSequence = (startDate: string, dayCount: number) =>
  Array.from({ length: dayCount }, (_, index) => shiftDateByDays(startDate, index));

const alignChartDataToRange = (
  data: ChartData | null,
  range: DateRange,
  dayCount: number,
  displayDates?: string[]
): ChartData => {
  const actualDates = buildDateSequence(range.start, dayCount);
  const dates = displayDates ?? actualDates;
  const indexByDate = new Map((data?.dates || []).map((date, index) => [date, index]));
  const pickSeries = (series: number[] | undefined) =>
    actualDates.map((date) => {
      const sourceIndex = indexByDate.get(date);
      return sourceIndex === undefined ? 0 : Number(series?.[sourceIndex] ?? 0);
    });

  return {
    dates,
    liquid: pickSeries(data?.liquid),
    oil: pickSeries(data?.oil),
    diluent: pickSeries(data?.diluent),
    water_cut: pickSeries(data?.water_cut),
    gas: pickSeries(data?.gas)
  };
};

const alignChartDataByOffsetToDisplayDates = (
  data: ChartData | null,
  sourceStartDate: string,
  targetStartDate: string,
  dayCount: number,
  displayDates: string[]
): ChartData => {
  const aligned = buildEmptyAggregateChartData(displayDates);
  const sourceIndexByDate = new Map((data?.dates || []).map((date, index) => [date, index]));
  const targetIndexByDate = new Map(displayDates.map((date, index) => [date, index]));

  for (let offset = 0; offset < dayCount; offset += 1) {
    const sourceDate = shiftDateByDays(sourceStartDate, offset);
    const targetDate = shiftDateByDays(targetStartDate, offset);
    const sourceIndex = sourceIndexByDate.get(sourceDate);
    const targetIndex = targetIndexByDate.get(targetDate);
    if (sourceIndex === undefined || targetIndex === undefined) continue;

    aligned.liquid[targetIndex] = Number(data?.liquid?.[sourceIndex] ?? 0);
    aligned.oil[targetIndex] = Number(data?.oil?.[sourceIndex] ?? 0);
    aligned.diluent[targetIndex] = Number(data?.diluent?.[sourceIndex] ?? 0);
    aligned.water_cut[targetIndex] = Number(data?.water_cut?.[sourceIndex] ?? 0);
    aligned.gas[targetIndex] = Number(data?.gas?.[sourceIndex] ?? 0);
  }

  return aligned;
};

const buildEmptyAggregateChartData = (dates: string[]): ChartData => ({
  dates,
  liquid: Array(dates.length).fill(0),
  oil: Array(dates.length).fill(0),
  diluent: Array(dates.length).fill(0),
  water_cut: Array(dates.length).fill(0),
  gas: Array(dates.length).fill(0)
});

const appendAggregateChartData = (target: ChartData, source: ChartData | null) => {
  if (!source) return;
  for (let index = 0; index < target.dates.length; index += 1) {
    target.liquid[index] += Number(source.liquid[index] || 0);
    target.oil[index] += Number(source.oil[index] || 0);
    target.diluent[index] += Number(source.diluent[index] || 0);
    target.gas[index] += Number(source.gas[index] || 0);
  }
};

const fillAggregateWaterCut = (target: ChartData) => {
  target.water_cut = target.dates.map((_, index) => {
    const liquid = Number(target.liquid[index] || 0);
    const oil = Number(target.oil[index] || 0);
    const diluent = Number(target.diluent[index] || 0);
    const water = Math.max(0, liquid - oil - diluent);

    if (liquid <= 0) return 0;
    if (diluent > 0) {
      return Number(Math.max(0, 100 - (100 * (oil + diluent)) / liquid).toFixed(1));
    }
    return Number(((100 * water) / (oil + water + 0.0001)).toFixed(1));
  });
};

const filterChartDataByRange = (data: ChartData | null, range: DateRange): ChartData | null => {
  if (!data) return null;

  const startTime = new Date(`${range.start}T00:00:00`).getTime();
  const endTime = new Date(`${range.end}T23:59:59`).getTime();
  const indexes = data.dates.reduce((acc: number[], date, index) => {
    const currentTime = new Date(`${date}T00:00:00`).getTime();
    if (currentTime >= startTime && currentTime <= endTime) {
      acc.push(index);
    }
    return acc;
  }, []);

  return {
    dates: indexes.map(index => data.dates[index]),
    liquid: indexes.map(index => data.liquid[index]),
    oil: indexes.map(index => data.oil[index]),
    diluent: indexes.map(index => data.diluent[index]),
    water_cut: indexes.map(index => data.water_cut[index]),
    gas: indexes.map(index => data.gas[index])
  };
};

const padSeries = (values: Array<number | null> | undefined, length: number) => Array.from({ length }, (_, index) => values?.[index] ?? null);

const formatChartNumber = (value: unknown, digits = 1) => {
  const numberValue = Number(value);
  if (!Number.isFinite(numberValue)) return '--';
  return Number(numberValue.toFixed(digits)).toLocaleString('zh-CN', {
    minimumFractionDigits: 0,
    maximumFractionDigits: digits
  });
};

const getAdaptiveAxisBounds = (seriesList: Array<Array<number | null> | undefined>, isPercent: boolean) => {
  const values = seriesList
    .flatMap(series => series || [])
    .filter((value): value is number => typeof value === 'number' && Number.isFinite(value));
  if (values.length === 0) return {};

  const minValue = Math.min(...values);
  const maxValue = Math.max(...values);
  const span = Math.max(maxValue - minValue, Math.abs(maxValue) * 0.06, 1);
  const padding = span * 0.25;
  const min = Math.floor(minValue - padding);
  const max = Math.ceil(maxValue + padding);

  return {
    min: isPercent ? Math.max(0, min) : min,
    max: isPercent ? Math.min(100, Math.max(max, min + 1)) : Math.max(max, min + 1)
  };
};

const getTenDayPeriodLabel = (date: string) => {
  const [year, month, dayText] = date.split('-');
  const day = Number(dayText);
  const tenDay = day <= 10 ? '上旬' : day <= 20 ? '中旬' : '下旬';
  return `${year}-${month}${tenDay}`;
};

const normalizeMeasureBlockName = (block: string | undefined | null) => {
  const value = (block || '').trim();
  if (!value) return '未分区';
  const compact = value.replace(/\s+/g, '').replace(/（/g, '(').replace(/）/g, ')');
  if (/^(高)?3624/.test(compact)) {
    return '高3624';
  }
  return value;
};

const normalizeMeasureTypeName = (row: Pick<MeasureRow, 'current_round_measure_type' | 'measure_type' | 'detail'>) => {
  const detailType = row.detail?.currentRound?.['本轮措施类型'];
  const value = String(row.current_round_measure_type || row.measure_type || detailType || '').trim();
  return value || '未知措施类型';
};

const buildAverageOilPeriodData = (
  currentData: ChartData | null,
  previousData: ChartData | null,
  period: 'month' | 'tenDay'
): AverageOilPeriodData => {
  if (!currentData) return { labels: [], current: [], previous: [] };

  const groups = new Map<string, { currentSum: number; previousSum: number; days: number }>();
  currentData.dates.forEach((date, index) => {
    const label = period === 'month' ? date.slice(0, 7) : getTenDayPeriodLabel(date);
    const group = groups.get(label) || { currentSum: 0, previousSum: 0, days: 0 };
    group.currentSum += Number(currentData.oil[index] ?? 0);
    group.previousSum += Number(previousData?.oil?.[index] ?? 0);
    group.days += 1;
    groups.set(label, group);
  });

  const labels = Array.from(groups.keys());
  return {
    labels,
    current: labels.map(label => {
      const group = groups.get(label);
      return group && group.days > 0 ? Number((group.currentSum / group.days).toFixed(1)) : null;
    }),
    previous: labels.map(label => {
      const group = groups.get(label);
      return group && group.days > 0 ? Number((group.previousSum / group.days).toFixed(1)) : null;
    })
  };
};

const buildPeriodDeltaData = (periodData: AverageOilPeriodData): AverageOilPeriodData => {
  const diffSeries = (values: Array<number | null>) => values.map((value, index) => {
    if (typeof value !== 'number') return null;
    if (index === 0) return Number(value.toFixed(1));
    const previous = values[index - 1];
    if (typeof previous !== 'number') return null;
    return Number((value - previous).toFixed(1));
  });

  return {
    labels: periodData.labels,
    current: diffSeries(periodData.current),
    previous: diffSeries(periodData.previous)
  };
};

const aggregateChartDataByTimeGrain = (data: ChartData | null, grain: MeasureCustomTimeGrain): ChartData | null => {
  if (!data || grain === 'day') return data;

  const groups = new Map<string, {
    liquid: number;
    oil: number;
    diluent: number;
    gas: number;
    days: number;
  }>();

  data.dates.forEach((date, index) => {
    const label = grain === 'month' ? date.slice(0, 7) : getTenDayPeriodLabel(date);
    const group = groups.get(label) || { liquid: 0, oil: 0, diluent: 0, gas: 0, days: 0 };
    group.liquid += Number(data.liquid[index] ?? 0);
    group.oil += Number(data.oil[index] ?? 0);
    group.diluent += Number(data.diluent[index] ?? 0);
    group.gas += Number(data.gas[index] ?? 0);
    group.days += 1;
    groups.set(label, group);
  });

  const labels = Array.from(groups.keys());
  const average = (label: string, key: 'liquid' | 'oil' | 'diluent' | 'gas') => {
    const group = groups.get(label);
    return group && group.days > 0 ? Number((group[key] / group.days).toFixed(1)) : 0;
  };

  // Recalculate含水 from period totals, not by averaging
  const calcWaterCut = (label: string) => {
    const group = groups.get(label);
    if (!group || group.liquid <= 0) return 0;
    const water = Math.max(0, group.liquid - group.oil - group.diluent);
    if (group.diluent > 0) {
      return Number(Math.max(0, 100 - (100 * (group.oil + group.diluent)) / group.liquid).toFixed(1));
    }
    return Number(((100 * water) / (group.oil + water + 0.0001)).toFixed(1));
  };

  return {
    dates: labels,
    liquid: labels.map(label => average(label, 'liquid')),
    oil: labels.map(label => average(label, 'oil')),
    diluent: labels.map(label => average(label, 'diluent')),
    water_cut: labels.map(label => calcWaterCut(label)),
    gas: labels.map(label => average(label, 'gas'))
  };
};;

const aggregateOilByDayInterval = (data: ChartData | null, intervalDays: number) => {
  if (!data || data.dates.length === 0) return { labels: [], oil: [] as Array<number | null> };

  const interval = Math.min(Math.max(Math.round(intervalDays) || 10, 1), 100);
  const labels: string[] = [];
  const oil: Array<number | null> = [];

  for (let startIndex = 0; startIndex < data.dates.length; startIndex += interval) {
    const endIndex = Math.min(startIndex + interval, data.dates.length);
    const values = data.oil
      .slice(startIndex, endIndex)
      .filter((value): value is number => typeof value === 'number' && Number.isFinite(value));
    const startDate = data.dates[startIndex];
    const endDate = data.dates[endIndex - 1];
    labels.push(interval === 1 || startDate === endDate ? startDate : `${startDate}~${endDate}`);
    oil.push(values.length > 0 ? Number((values.reduce((sum, value) => sum + value, 0) / values.length).toFixed(1)) : null);
  }

  return { labels, oil };
};

const calculateDiluentRatioSeries = (
  diluent: Array<number | null> | undefined,
  oil: Array<number | null> | undefined
) => Array.from({ length: Math.max(diluent?.length ?? 0, oil?.length ?? 0) }, (_, index) => {
  const diluentValue = diluent?.[index];
  const oilValue = oil?.[index];

  if (typeof diluentValue !== 'number' || typeof oilValue !== 'number' || oilValue === 0) {
    return null;
  }

  return Number((diluentValue / oilValue).toFixed(4));
});

// --- Components ---

const Login = ({ onLogin, globalError, overlay = false, onCancel }: { onLogin: (user: any) => void; globalError?: string; overlay?: boolean; onCancel?: () => void }) => {
  const [isRegister, setIsRegister] = useState(false);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    setSuccess('');
    
    const endpoint = isRegister ? '/api/register' : '/api/login';
    const body = isRegister ? { username, password, name } : { username, password };

    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({ success: false, message: '服务响应异常' }));

      if (!res.ok && !data.message) {
        data.message = '服务请求失败';
      }

      if (data.success) {
        if (isRegister) {
          setSuccess('导入成功！已更新数据');
          setIsRegister(false);
          setPassword('');
        } else {
          onLogin(data.user);
        }
      } else {
        setError(data.message || '操作失败');
      }
    } catch (err) {
      setError('导入失败，请检查文件格式');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className={overlay ? 'absolute inset-0 z-40 flex items-center justify-center bg-slate-950/25 p-4 backdrop-blur-md' : 'relative flex min-h-screen items-center justify-center overflow-hidden bg-[#1a2634]'}>
      {/* Background decoration */}
      {!overlay && <div className="absolute top-0 left-0 w-full h-full opacity-10 pointer-events-none">
        <div className="absolute top-[-10%] left-[-10%] w-[40%] h-[40%] bg-blue-500 rounded-full blur-[120px]"></div>
        <div className="absolute bottom-[-10%] right-[-10%] w-[40%] h-[40%] bg-red-500 rounded-full blur-[120px]"></div>
      </div>}

      <div className="relative z-10 w-full max-w-md rounded-2xl border border-white/30 bg-slate-900/35 p-8 shadow-2xl shadow-slate-950/30 ring-1 ring-white/10 backdrop-blur-2xl">
        {onCancel && <button type="button" onClick={onCancel} className="absolute right-4 top-3 text-2xl text-white/70 transition hover:text-white" aria-label="关闭登录框">×</button>}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 bg-blue-600 rounded-2xl mb-4 shadow-lg shadow-blue-500/30">
            <Droplets className="text-white w-8 h-8" />
          </div>
          <h1 className="text-2xl font-bold text-white mb-2">油井采油作业管理系统</h1>
          <p className="text-blue-200/60 text-sm">{isRegister ? '已有账号？立即登录' : '还没有账号？立即注册'}</p>
        </div>

        {globalError && !error && !success && (
          <div className="mb-6 bg-red-500/20 border border-red-500/40 text-red-100 text-sm px-4 py-3 rounded-xl">
            {globalError}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-5">
          {isRegister && (
            <div>
              <label className="block text-sm font-medium text-blue-100 mb-2">姓名</label>
              <div className="relative">
                <FileText className="absolute left-3 top-1/2 -translate-y-1/2 text-blue-300/50 w-5 h-5" />
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="w-full bg-white/5 border border-white/10 rounded-xl py-3 pl-11 pr-4 text-white placeholder-blue-300/30 focus:outline-none focus:ring-2 focus:ring-blue-500/50 transition-all"
                  placeholder="请输入用户名"
                  required
                />
              </div>
            </div>
          )}

          <div>
            <label className="block text-sm font-medium text-blue-100 mb-2">用户名</label>
            <div className="relative">
              <User className="absolute left-3 top-1/2 -translate-y-1/2 text-blue-300/50 w-5 h-5" />
              <input
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                className="w-full bg-white/5 border border-white/10 rounded-xl py-3 pl-11 pr-4 text-white placeholder-blue-300/30 focus:outline-none focus:ring-2 focus:ring-blue-500/50 transition-all"
                placeholder="请输入用户名"
                required
              />
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-blue-100 mb-2">密码</label>
            <div className="relative">
              <ShieldCheck className="absolute left-3 top-1/2 -translate-y-1/2 text-blue-300/50 w-5 h-5" />
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full bg-white/5 border border-white/10 rounded-xl py-3 pl-11 pr-4 text-white placeholder-blue-300/30 focus:outline-none focus:ring-2 focus:ring-blue-500/50 transition-all"
                placeholder="请输入密码"
                required
              />
            </div>
          </div>

          {error && (
            <div className="bg-red-500/20 border border-red-500/50 text-red-200 text-sm p-3 rounded-lg flex items-center gap-2">
              <AlertTriangle className="w-4 h-4" />
              {error}
            </div>
          )}

          {success && (
            <div className="bg-green-500/20 border border-green-500/50 text-green-200 text-sm p-3 rounded-lg flex items-center gap-2">
              <ShieldCheck className="w-4 h-4" />
              {success}
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full bg-blue-600 hover:bg-blue-700 text-white font-bold py-3 rounded-xl shadow-lg shadow-blue-600/30 transition-all active:scale-[0.98] disabled:opacity-50 disabled:pointer-events-none flex items-center justify-center gap-2"
          >
            {loading ? (
              <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin"></div>
            ) : (
              <>
                {isRegister ? <FileText className="w-5 h-5" /> : <LogIn className="w-5 h-5" />}
                {isRegister ? '注册' : '登录'}
              </>
            )}
          </button>
        </form>

        <div className="mt-6 text-center">
          <button 
            onClick={() => {
              setIsRegister(!isRegister);
              setError('');
              setSuccess('');
            }}
            className="text-blue-300 hover:text-white text-sm transition-colors"
          >
            {isRegister ? '已有账号？去登录' : '没有账号？去注册'}
          </button>
        </div>

        <div className="mt-8 pt-6 border-t border-white/10 text-center">
          <p className="text-xs text-blue-200/40">
            . 2026 油井采油作业管理系统
          </p>
      </div>
    </div>
    </div>
  );
};

const sidebarIconMap: Record<SidebarIcon, LucideIcon> = {
  LayoutDashboard,
  MapPinned,
  Thermometer,
  Database,
  Activity,
  TrendingUp,
  ClipboardList,
  FileSpreadsheet,
  AlertTriangle,
  Droplets,
  Filter,
  Target,
  MessageSquare,
};

const SidebarItem = ({ icon: Icon, label, active, onClick }: { icon: LucideIcon, label: string, active?: boolean, onClick: () => void }) => (
  <button
    type="button"
    onClick={onClick}
    className={cn(
      "group mx-3 mb-1 flex w-[calc(100%-1.5rem)] cursor-pointer items-center gap-3 rounded-md border-0 border-l-4 bg-transparent px-4 py-3 text-left text-sm transition-all duration-200",
      active
        ? "border-l-emerald-400 bg-emerald-400/10 text-white font-bold shadow-sm"
        : "border-l-transparent text-slate-300 hover:bg-white/7 hover:text-white"
    )}
  >
    <Icon size={18} className={cn(active ? "text-emerald-300" : "text-slate-400 group-hover:text-white")} />
    <span>{label}</span>
  </button>
);

const formatDiffText = (value: number, suffix = '') => (value > 0 ? `+${value}${suffix}` : `${value}${suffix}`);

const buildSparseAverageMarkPoints = (
  dates: string[],
  series: Array<number | null> | undefined,
  color: string,
  position: 'top' | 'bottom',
  interval = 5
) => {
  if (!series || interval <= 1) return undefined;

  const points = series
    .map((value, index) => {
      if (value == null || !Number.isFinite(Number(value))) return null;
      const shouldShow = index === 0 || index === dates.length - 1 || (index + 1) % interval === 0;
      if (!shouldShow) return null;
      const windowValues = series
        .slice(Math.max(0, index - interval + 1), index + 1)
        .filter((item): item is number => item != null && Number.isFinite(Number(item)));
      if (windowValues.length === 0) return null;
      const avg = windowValues.reduce((sum, item) => sum + Number(item), 0) / windowValues.length;
      return {
        coord: [dates[index], value],
        value: formatChartNumber(avg, 0)
      };
    })
    .filter(Boolean);

  if (points.length === 0) return undefined;

  return {
    symbol: 'circle',
    symbolSize: 1,
    silent: true,
    data: points,
    label: {
      show: true,
      position,
      distance: 8,
      formatter: (params: any) => params.value,
      color,
      fontSize: 11,
      fontWeight: 600,
      backgroundColor: 'rgba(255,255,255,0.72)',
      borderRadius: 3,
      padding: [1, 3]
    },
    itemStyle: {
      color: 'transparent',
      borderColor: 'transparent'
    }
  };
};

const buildChangeSeries = (series: Array<number | null> | undefined) => {
  if (!series) return [];

  return series.map((value, index) => {
    if (value == null || !Number.isFinite(Number(value))) return null;
    if (index === 0) return Number(value);

    const previous = series[index - 1];
    if (previous == null || !Number.isFinite(Number(previous))) return null;
    return Number((Number(value) - Number(previous)).toFixed(2));
  });
};

const buildChangeSeriesWithZeroBaseline = (series: Array<number | null> | undefined) => {
  if (!series) return [];

  return series.map((value, index) => {
    if (value == null || !Number.isFinite(Number(value))) return null;
    if (index === 0) return 0;

    const previous = series[index - 1];
    if (previous == null || !Number.isFinite(Number(previous))) return null;
    return Number((Number(value) - Number(previous)).toFixed(2));
  });
};

const CompareTypeTable = ({ title, rows }: { title: string; rows: CompareTypeStat[] }) => (
  <div className="app-card overflow-hidden">
    <div className="app-card-header font-bold text-slate-800">{title}</div>
    <div className="overflow-x-auto">
      <table className="measure-table w-full text-left text-sm">
        <thead>
          <tr>
            <th>分类</th>
            <th className="text-center">井数</th>
            <th className="text-center">日产液差</th>
            <th className="text-center">日产油差</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.label}>
              <td className="font-medium text-slate-800">{row.label}</td>
              <td className="text-center">{row.wellCount}</td>
              <td className="text-center">{formatDiffText(row.liquidDiff)}</td>
              <td className="text-center">{formatDiffText(row.oilDiff)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  </div>
);

const StatCard = ({ title, value, unit, icon: Icon, color }: { title: string, value: string | number, unit: string, icon: any, color: string }) => (
  <div className="app-card flex items-center gap-4 p-5 transition-transform hover:-translate-y-0.5">
    <div className={cn("rounded-full bg-opacity-10 p-3 ring-1 ring-inset ring-slate-900/5", color)}>
      <Icon className={cn("w-6 h-6", color.replace('bg-', 'text-'))} />
    </div>
    <div>
      <p className="text-sm text-slate-500 font-medium">{title}</p>
      <div className="flex items-baseline gap-1">
        <span className="text-2xl font-bold text-slate-950">{value}</span>
        <span className="text-xs text-slate-400">{unit}</span>
      </div>
    </div>
  </div>
);

const DashboardStatCardSkeleton = () => (
  <div className="app-card flex animate-pulse items-center gap-4 p-5">
    <div className="w-12 h-12 rounded-full bg-slate-200"></div>
    <div className="flex-1 space-y-3">
      <div className="h-4 w-24 bg-slate-200 rounded"></div>
      <div className="h-7 w-28 bg-slate-300 rounded"></div>
    </div>
  </div>
);

const DashboardChartSkeleton = ({ title }: { title: string }) => (
  <div className="analysis-section animate-pulse">
    <div className="flex items-center gap-2 mb-6">
      <div className="w-5 h-5 rounded bg-red-100"></div>
      <div className="h-5 w-40 bg-gray-200 rounded"></div>
    </div>
    <div className="grid grid-cols-1 xl:grid-cols-2 gap-4 text-sm mb-6">
      <div className="rounded-lg border border-gray-200 p-4 bg-gray-50/70 space-y-3">
        <div className="h-4 w-20 bg-gray-200 rounded"></div>
        <div className="flex gap-3">
          <div className="h-9 flex-1 bg-gray-200 rounded"></div>
          <div className="h-9 flex-1 bg-gray-200 rounded"></div>
        </div>
      </div>
      <div className="rounded-lg border border-gray-200 p-4 bg-blue-50/40 space-y-3">
        <div className="h-4 w-24 bg-gray-200 rounded"></div>
        <div className="flex gap-3">
          <div className="h-9 flex-1 bg-gray-200 rounded"></div>
          <div className="h-9 flex-1 bg-gray-200 rounded"></div>
        </div>
      </div>
    </div>
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      {Array.from({ length: 6 }).map((_, index) => (
        <div key={`${title}-${index}`} className="chart-card">
          <div className="h-full w-full rounded bg-gray-100"></div>
        </div>
      ))}
    </div>
  </div>
);

export default function App() {
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [showLanding, setShowLanding] = useState(() => window.location.pathname === '/axon');
  const [showDatacoreLanding, setShowDatacoreLanding] = useState(() => window.location.pathname !== '/axon');
  const [showDatacoreLogin, setShowDatacoreLogin] = useState(false);
  const [showAccessLogin, setShowAccessLogin] = useState(false);
  const [user, setUser] = useState<UserInfo | null>(null);
  const [activeTab, setActiveTab] = useState<SidebarTab>('dashboard');
  const [expandedSidebarGroup, setExpandedSidebarGroup] = useState<SidebarGroupKey | null>(getSidebarGroupKey('dashboard') ?? 'overview');
  const [dailyCompare, setDailyCompare] = useState<any>(null);

  useEffect(() => {
    const activeGroup = getSidebarGroupKey(activeTab);
    if (activeGroup) setExpandedSidebarGroup(activeGroup);
  }, [activeTab]);

  // Data States
  const [overallData, setOverallData] = useState<ChartData | null>(null);
  const [blocks, setBlocks] = useState<string[]>([]);
  const [chartBlocks, setChartBlocks] = useState<string[]>([]);
  const [stations, setStations] = useState<string[]>([]);
  const [wells, setWells] = useState<Well[]>([]);

  // Filter States
  const [selectedChartBlocks, setSelectedChartBlocks] = useState<string[]>([]);
  const [selectedWellBlock, setSelectedWellBlock] = useState<string>('');
  const [selectedStation, setSelectedStation] = useState<string>('');
  const [wellSearch, setWellSearch] = useState<string>('');
  
  // Chart Data States
  const [blockChartData, setBlockChartData] = useState<ChartData | null>(null);
  const [blockChartSource, setBlockChartSource] = useState<ChartDataSource>(null);
  const [selectedWell, setSelectedWell] = useState<string>('');
  const [wellChartData, setWellChartData] = useState<ChartData | null>(null);
  const [wellChartSource, setWellChartSource] = useState<ChartDataSource>(null);
  const [wellRange, setWellRange] = useState({
    start: '2025-01-01',
    end: new Date().toISOString().split('T')[0]
  });
  
  const [analysisData, setAnalysisData] = useState<AnalysisData | null>(null);
  const [loading, setLoading] = useState(false);
  const [overallRange, setOverallRange] = useState<DateRange>({
    start: '2026-01-01',
    end: new Date().toISOString().split('T')[0]
  });
  const [overallCompareRange, setOverallCompareRange] = useState<DateRange>({
    start: shiftDateByYears('2026-01-01', -1),
    end: shiftDateByYears(new Date().toISOString().split('T')[0], -1)
  });

  // Comparison States
  const [compareRanges, setCompareRanges] = useState({
    rangeA: { start: '2025-01-01', end: '2025-01-15' },
    rangeB: { start: '2025-03-01', end: '2025-03-15' }
  });
  const [selectedStations, setSelectedStations] = useState<string[]>([]);
  const [compareResults, setCompareResults] = useState<CompareResultRow[]>([]);
  const [compareSummary, setCompareSummary] = useState<CompareSummary | null>(null);
  const [largeChangeData, setLargeChangeData] = useState<LargeChangeData | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [syncStatus, setSyncStatus] = useState<SyncStatus | null>(null);
  const [dashboardBootstrapLoading, setDashboardBootstrapLoading] = useState(false);
  const [dashboardBootstrapLoaded, setDashboardBootstrapLoaded] = useState(false);
  const [dashboardBootstrapNeedsRefresh, setDashboardBootstrapNeedsRefresh] = useState(false);
  const [cacheInfo, setCacheInfo] = useState<DashboardCacheInfo>({
    cacheWarm: false,
    cacheSource: null,
    generatedAt: null,
    sourceDate: null
  });
  const [wellsLoaded, setWellsLoaded] = useState(false);
  const [wellsLoading, setWellsLoading] = useState(false);
  const wellsLoadingRef = React.useRef(false);
  const blockDefaultAutoLoadedRef = React.useRef(false);
  const measureImportInputRef = React.useRef<HTMLInputElement | null>(null);
  const wellTemperatureImportInputRef = React.useRef<HTMLInputElement | null>(null);
  const [wellTemperatureTests, setWellTemperatureTests] = useState<WellTemperatureTestSummary[]>([]);
  const [selectedWellTemperatureId, setSelectedWellTemperatureId] = useState<number | null>(null);
  const [selectedWellTemperatureTest, setSelectedWellTemperatureTest] = useState<WellTemperatureTestDetail | null>(null);
  const [wellTemperatureLoading, setWellTemperatureLoading] = useState(false);
  const [wellTemperatureImporting, setWellTemperatureImporting] = useState(false);
  const [wellTemperatureError, setWellTemperatureError] = useState('');
  const [wellTemperatureWellFilter, setWellTemperatureWellFilter] = useState('');

  const [measures, setMeasures] = useState<MeasureRow[]>([]);
  const [measureFilterMeta, setMeasureFilterMeta] = useState<MeasureFiltersMeta>({ blocks: [], stations: [], statuses: [] });
  const [measuresLoading, setMeasuresLoading] = useState(false);
  const [measuresSaving, setMeasuresSaving] = useState(false);
  const [measureImporting, setMeasureImporting] = useState(false);
  const [measureImportYear, setMeasureImportYear] = useState(new Date().getFullYear().toString());
  const [measureImportDialog, setMeasureImportDialog] = useState<MeasureImportDialogState>({
    open: false,
    kind: 'preview',
    title: '',
    message: '',
    file: null,
    meta: null
  });
  const [showMeasureForm, setShowMeasureForm] = useState(false);
  const [showMeasureDetail, setShowMeasureDetail] = useState(false);
  const [selectedMeasureDetail, setSelectedMeasureDetail] = useState<MeasureRow | null>(null);
  const [measureDetailCharts, setMeasureDetailCharts] = useState<MeasureDetailChartState>({
    currentData: null,
    previousData: null,
    currentRange: null,
    previousRange: null,
    loading: false,
    error: '',
    warning: ''
  });
  const [measureClassAnalysis, setMeasureClassAnalysis] = useState<MeasureClassAnalysisState>({
    evaluation: null,
    currentData: null,
    previousData: null,
    loading: false,
    error: '',
    wellCount: 0
  });
  const [measureAnalysisCharts, setMeasureAnalysisCharts] = useState<MeasureDetailChartState>({
    currentData: null,
    previousData: null,
    currentRange: null,
    previousRange: null,
    loading: false,
    error: '',
    warning: ''
  });
  const [occupancyUpload, setOccupancyUpload] = useState<OccupancyUploadState>({
    fileName: '',
    sheetName: '',
    rows: [],
    columns: [],
    error: ''
  });
  const [occupancyExpanded, setOccupancyExpanded] = useState<Record<string, boolean>>({
    upload: true,
    typeAnalysis: true,
    blockAnalysis: false
  });
  const [occupancySummary, setOccupancySummary] = useState<OccupancySummary | null>(null);
  const [occupancyUploading, setOccupancyUploading] = useState(false);
  const [occupancyIntervalDays, setOccupancyIntervalDays] = useState(5);
  const [occupancyBlockIntervalDays, setOccupancyBlockIntervalDays] = useState(5);
  const [occupancyTypeAnalysis, setOccupancyTypeAnalysis] = useState<{
    loading: boolean;
    error: string;
    data: OccupancyTypeAnalysisData | null;
  }>({ loading: false, error: '', data: null });
  const [occupancyBlockAnalysis, setOccupancyBlockAnalysis] = useState<{
    loading: boolean;
    error: string;
    data: OccupancyBlockAnalysisData | null;
  }>({ loading: false, error: '', data: null });
  const [pumpAnalysisExpanded, setPumpAnalysisExpanded] = useState<Record<string, boolean>>({
    upload: true,
    analysis: true
  });
  const [pumpAnalysisUpload, setPumpAnalysisUpload] = useState<PumpAnalysisUploadState>({
    fileName: '',
    sheetName: '',
    rows: [],
    columns: [],
    error: ''
  });
  const [pumpAnalysisUploading, setPumpAnalysisUploading] = useState(false);
  const [pumpDeepAnalysisExpanded, setPumpDeepAnalysisExpanded] = useState<Record<string, boolean>>({
    upload: true,
    analysis: true
  });
  const [pumpDeepAnalysisUpload, setPumpDeepAnalysisUpload] = useState<PumpAnalysisUploadState>({
    fileName: '',
    sheetName: '',
    rows: [],
    columns: [],
    error: ''
  });
  const [pumpDeepAnalysisUploading, setPumpDeepAnalysisUploading] = useState(false);
  const [waterLabExpanded, setWaterLabExpanded] = useState<Record<string, boolean>>({
    upload: true,
    analysis: true
  });
  const [waterLabUpload, setWaterLabUpload] = useState<PumpAnalysisUploadState>({
    fileName: '',
    sheetName: '',
    rows: [],
    columns: [],
    error: ''
  });
  const [waterLabUploading, setWaterLabUploading] = useState(false);
  // Water Lab Analysis state
  const [waterLabWellList, setWaterLabWellList] = useState<Array<{ jh: string; block: string; station: string; area: string }>>([]);
  const [waterLabBlockList, setWaterLabBlockList] = useState<Array<{ block: string; well_count: number; record_days: number }>>([]);
  const [waterLabSelectedWell, setWaterLabSelectedWell] = useState('');
  const [waterLabSelectedBlock, setWaterLabSelectedBlock] = useState('');
  const [waterLabSelectedStation, setWaterLabSelectedStation] = useState('');
  const [waterLabWellTrend, setWaterLabWellTrend] = useState<{ dates: string[]; lab_water_cut: (number | null)[]; prod_water_cut: (number | null)[]; block: string; station: string } | null>(null);
  const [waterLabBlockTrend, setWaterLabBlockTrend] = useState<{ dates: string[]; avg_water_cut: number[]; well_count: number[] } | null>(null);
  const [waterLabStationTrend, setWaterLabStationTrend] = useState<{ dates: string[]; avg_water_cut: number[]; well_count: number[] } | null>(null);
  const [waterLabAnomalies, setWaterLabAnomalies] = useState<{
    anomalies: Array<{ jh: string; block: string; station: string; current_water_cut: number; previous_water_cut: number; rise: number; record_date: string }>;
    currentMonth: string; previousMonth: string; threshold: number;
  } | null>(null);
  const [waterLabAnomalyThreshold, setWaterLabAnomalyThreshold] = useState(20);
  const [waterLabLoading, setWaterLabLoading] = useState(false);
  const [waterLabCompareResult, setWaterLabCompareResult] = useState<{
    deviations: Array<{ jh: string; block: string; station: string; lab_count: number; lab_avg: number; prod_avg: number; deviation: number }>;
    startDate: string; endDate: string; threshold: number; days: number;
  } | null>(null);
  const [waterLabCompareThreshold, setWaterLabCompareThreshold] = useState(30);
  const [keyWellTracking, setKeyWellTracking] = useState<{
    highWaterWells: Array<{ jh: string; block: string; station: string; latest_lab_wc: number | null; latest_lab_date: string | null; latest_prod_wc: number | null; latest_prod_date: string | null; days_since_last_lab: number | null; no_lab_alert: boolean }>;
    measureWcAlerts: Array<{ jh: string; block: string; production_days: number; current_transfer_time: string; current_avg_wc: number; previous_avg_wc: number; diff: number }>;
    labMaxDate: string;
  } | null>(null);
  const [keyWellFilters, setKeyWellFilters] = useState({ highWc: 80, labGap: 3, wcDiff: 20 });
  const [keyWellTrackingLoading, setKeyWellTrackingLoading] = useState(false);
  const [forecastLoading, setForecastLoading] = useState(false);
  const [forecastError, setForecastError] = useState('');
  const [forecastData, setForecastData] = useState<Record<string, { label: string; wells: Array<{ jh: string; block: string; predictedStart: string; previousStart: string }>; aggregate: { dates: string[]; oil: number[]; tenDayOil: number[] }; wellCount: number; minPredictedStart: string }> | null>(null);

  const [inventoryUploading, setInventoryUploading] = useState(false);
  const [inventoryError, setInventoryError] = useState('');
  const [inventoryPrediction, setInventoryPrediction] = useState<{ dates: string[]; actual: (number | null)[]; predicted: (number | null)[] } | null>(null);
  const [pumpProductionOilAnalysis, setPumpProductionOilAnalysis] = useState<{
    loading: boolean;
    error: string;
    data: PumpProductionOilAnalysisData | null;
  }>({ loading: false, error: '', data: null });
  const [measureMonthlyCohorts, setMeasureMonthlyCohorts] = useState<MeasureMonthlyCohortState>({
    rows: [],
    loading: false,
    error: ''
  });
  const [measureBlockCharts, setMeasureBlockCharts] = useState<MeasureBlockChartState>({
    rows: [],
    loading: false,
    error: ''
  });
  const [measureTypeCharts, setMeasureTypeCharts] = useState<MeasureTypeChartState>({
    rows: [],
    loading: false,
    error: ''
  });
  const [measureCustomFilters, setMeasureCustomFilters] = useState<MeasureCustomFilters>({
    block: '',
    measureType: '',
    timeGrain: 'day',
    transferStart: '2026-01-01'
  });
  const [measureCustomAnalysis, setMeasureCustomAnalysis] = useState<MeasureCustomAnalysisState>({
    currentData: null,
    previousData: null,
    loading: false,
    error: '',
    wellCount: 0
  });
  const [dashboardExpanded, setDashboardExpanded] = useState<Record<string, boolean>>({
    trend: true,
    composition: true
  });
  const [dashboardCompositionInterval, setDashboardCompositionInterval] = useState(10);
  const [measureAnalysisExpanded, setMeasureAnalysisExpanded] = useState<Record<string, boolean>>({});
  const [tenDayDeltaPaletteIndex, setTenDayDeltaPaletteIndex] = useState(0);
  const [editingMeasureId, setEditingMeasureId] = useState<number | null>(null);
  const [measureForm, setMeasureForm] = useState<MeasureFormState>(buildDefaultMeasureForm());
  const [measureQuery, setMeasureQuery] = useState({
    start: '',
    end: '',
    block: '',
    station: '',
    status: '',
    keyword: '',
    year: ''
  });
  const [measureAvailableYears, setMeasureAvailableYears] = useState<string[]>([]);
  const [measureCockpitAlertFilter, setMeasureCockpitAlertFilter] = useState<{ type: CockpitMeasureFilters['alertType']; alerts: InjectionProductionCockpitData['alerts'] } | null>(null);
  const [measureMetricMode, setMeasureMetricMode] = useState<MeasureMetricMode>('cumulative_oil');
  const [measureEvaluationSorted, setMeasureEvaluationSorted] = useState(true);

  const [globalError, setGlobalError] = useState('');


  // Check for existing session
  useEffect(() => {
    const savedUser = localStorage.getItem('oil_system_user');
    if (!savedUser) return;

    try {
      const parsedUser = JSON.parse(savedUser);
      if (parsedUser?.name && parsedUser?.role) {
        setUser(parsedUser);
        setIsLoggedIn(true);
      } else {
        localStorage.removeItem('oil_system_user');
      }
    } catch {
      localStorage.removeItem('oil_system_user');
    }
  }, []);

  const handleLogin = (userData: UserInfo) => {
    setGlobalError('');
    setUser(userData);
    setIsLoggedIn(true);
    localStorage.setItem('oil_system_user', JSON.stringify(userData));
  };

  const handleEnterFromLanding = () => {
    setShowLanding(false);
    setShowDatacoreLanding(false);
    setUser({ name: '访客', role: 'guest', username: 'guest' });
    setIsLoggedIn(true);
    localStorage.removeItem('oil_system_user');
  };

  const handleNavigateFromDatacoreLanding = (tab: SidebarTab) => {
    setShowLanding(false);
    setShowDatacoreLanding(false);
    setActiveTab(tab);
    setUser({ name: '访客', role: 'guest', username: 'guest' });
    setIsLoggedIn(true);
    localStorage.removeItem('oil_system_user');
  };

  const handleDatacoreLogin = (userData: UserInfo) => {
    setShowDatacoreLogin(false);
    setShowDatacoreLanding(false);
    setShowLanding(false);
    handleLogin(userData);
  };

  const handleAccessLogin = (userData: UserInfo) => {
    setShowAccessLogin(false);
    handleLogin(userData);
  };

  const isGuest = user?.role === 'guest';
  const requestAccessLogin = () => setShowAccessLogin(true);
  const blockGuestMutation = (event: React.MouseEvent<HTMLDivElement>) => {
    if (!isGuest) return;
    const action = (event.target as Element).closest('button,[role="button"]');
    if (action && /(新增|编辑|删除|导入|上传|保存|提交|更新|确认覆盖)/.test(action.textContent || '')) {
      event.preventDefault();
      event.stopPropagation();
      requestAccessLogin();
    }
  };

  const handleLogout = () => {
    setGlobalError('');
    setShowAccessLogin(false);
    setShowLanding(false);
    setShowDatacoreLanding(true);
    window.history.pushState({}, '', '/datacore');
    setIsLoggedIn(false);
    setUser(null);
    setWells([]);
    setWellsLoaded(false);
    wellsLoadingRef.current = false;
    setWellsLoading(false);
    setDashboardBootstrapLoading(false);
    setDashboardBootstrapLoaded(false);
    setDashboardBootstrapNeedsRefresh(false);
    setCacheInfo({ cacheWarm: false, cacheSource: null, generatedAt: null, sourceDate: null });
    setSelectedChartBlocks([]);
    setBlockChartData(null);
    setBlockChartSource(null);
    blockDefaultAutoLoadedRef.current = false;
    localStorage.removeItem('oil_system_user');
  };

  const showDataError = (message = '数据获取失败') => {
    setGlobalError(message || '数据获取失败');
  };

  const fetchJson = async (url: string, options?: RequestInit) => {
    const apiUrl = url;
    const token = localStorage.getItem('token');
    const headers: Record<string, string> = { ...(options?.headers as Record<string, string> || {}) };
    if (token) headers['Authorization'] = `Bearer ${token}`;
    const res = await fetch(apiUrl, { ...options, headers });
    const result = await res.json().catch(() => ({ success: false, message: '服务响应异常' }));

    if (!res.ok) {
      return { success: false, message: result.message || '数据获取失败' };
    }

    return result;
  };

  const loadWellTemperatureTests = async (wellNo = wellTemperatureWellFilter) => {
    setWellTemperatureLoading(true);
    setWellTemperatureError('');
    try {
      const query = wellNo.trim() ? `?wellNo=${encodeURIComponent(wellNo.trim())}` : '';
      const result = await fetchJson(`/api/well-temperature-tests${query}`);
      if (!result.success) throw new Error(result.message || '井温记录加载失败');
      setWellTemperatureTests(result.data);
      return result.data as WellTemperatureTestSummary[];
    } catch (error: any) {
      setWellTemperatureError(error?.message || '井温记录加载失败');
    } finally {
      setWellTemperatureLoading(false);
    }
  };

  const loadWellTemperatureTestDetail = async (id: number) => {
    setSelectedWellTemperatureId(id);
    setWellTemperatureLoading(true);
    setWellTemperatureError('');
    try {
      const result = await fetchJson(`/api/well-temperature-tests/${id}`);
      if (!result.success) throw new Error(result.message || '井温详情加载失败');
      setSelectedWellTemperatureTest(result.data);
    } catch (error: any) {
      setSelectedWellTemperatureTest(null);
      setWellTemperatureError(error?.message || '井温详情加载失败');
    } finally {
      setWellTemperatureLoading(false);
    }
  };

  const importWellTemperatureTest = async (file: File) => {
    setWellTemperatureImporting(true);
    setWellTemperatureError('');
    try {
      const formData = new FormData();
      formData.append('file', file);
      const result = await fetchJson('/api/well-temperature-tests/import', { method: 'POST', body: formData });
      if (!result.success) throw new Error(result.message || '井温文件导入失败');
      await loadWellTemperatureTests();
      await loadWellTemperatureTestDetail(result.data.id);
    } catch (error: any) {
      setWellTemperatureError(error?.message || '井温文件导入失败');
    } finally {
      setWellTemperatureImporting(false);
      if (wellTemperatureImportInputRef.current) wellTemperatureImportInputRef.current.value = '';
    }
  };

  const deleteWellTemperatureTest = async (id: number) => {
    setWellTemperatureLoading(true);
    setWellTemperatureError('');
    try {
      const result = await fetchJson(`/api/well-temperature-tests/${id}`, { method: 'DELETE' });
      if (!result.success) throw new Error(result.message || '井温记录删除失败');
      if (selectedWellTemperatureId === id) {
        setSelectedWellTemperatureId(null);
        setSelectedWellTemperatureTest(null);
      }
      await loadWellTemperatureTests();
    } catch (error: any) {
      setWellTemperatureError(error?.message || '井温记录删除失败');
    } finally {
      setWellTemperatureLoading(false);
    }
  };

  const loadSyncStatus = async (silent = false) => {
    try {
      const result = await fetchJson('/api/sync/status');
      if (result.success) {
        setSyncStatus(result.data);
      } else if (!silent) {
        showDataError(result.message);
      }
    } catch {
      if (!silent) {
        showDataError();
      }
    }
  };

  const resetMeasureForm = () => {
    setEditingMeasureId(null);
    setMeasureForm(buildDefaultMeasureForm());
  };

  const openCreateMeasureForm = () => {
    resetMeasureForm();
    setShowMeasureForm(true);
  };

  const openEditMeasureForm = (row: MeasureRow) => {
    setEditingMeasureId(row.id);
    setMeasureForm({
      measure_date: row.measure_date || row.current_round_transfer_time || new Date().toISOString().split('T')[0],
      jh: row.jh || '',
      block: row.block || '',
      station: row.station || '',
      measure_type: row.current_round_measure_type || row.measure_type || '',
      measure_name: row.measure_name || '',
      status: row.current_status || row.status || '生产',
      owner: row.owner || '',
      result_text: row.result_text || '',
      liquid_gain: Number(row.current_liquid ?? row.liquid_gain ?? 0),
      remark: row.remark || ''
    });
    setShowMeasureForm(true);
  };

  const loadMeasureDetailCharts = async (row: MeasureRow) => {
    const currentStart = normalizeMeasureDetailIsoDate(row.current_round_transfer_time);
    const dayCount = Math.max(1, Math.round(Number(row.production_days || 1)));
    const currentEnd = currentStart ? shiftDateByDays(currentStart, dayCount - 1) : '';
    const previousStart = getPreviousMeasureStartDate(row.detail);
    const previousEnd = previousStart ? shiftDateByDays(previousStart, dayCount - 1) : '';

    setMeasureDetailCharts({
      currentData: null,
      previousData: null,
      currentRange: currentStart ? { start: currentStart, end: currentEnd } : null,
      previousRange: previousStart ? { start: previousStart, end: previousEnd } : null,
      loading: true,
      error: '',
      warning: !previousStart ? '该井缺少“上轮转抽时间”，上轮同期曲线暂不可用' : ''
    });

    if (!row.jh || !currentStart) {
      setMeasureDetailCharts(prev => ({
        ...prev,
        loading: false,
        error: '未找到本轮转抽时间，无法生成曲线',
        warning: ''
      }));
      return;
    }

    try {
      const [currentResult, previousResult] = await Promise.all([
        fetchJson(`/api/chart/well?jh=${encodeURIComponent(row.jh)}&start=${currentStart}&end=${currentEnd}`),
        previousStart
          ? fetchJson(`/api/chart/well?jh=${encodeURIComponent(row.jh)}&start=${previousStart}&end=${previousEnd}`)
          : Promise.resolve({ success: true, data: null })
      ]);

      if (!currentResult.success || !previousResult.success) {
        throw new Error(currentResult.message || previousResult.message || '曲线数据获取失败');
      }

      const currentRange = { start: currentStart, end: currentEnd };
      const previousRange = previousStart ? { start: previousStart, end: previousEnd } : null;
      const currentData = alignChartDataToRange(currentResult.data ?? null, currentRange, dayCount);
      const previousData = previousRange
        ? alignChartDataToRange(previousResult.data ?? null, previousRange, dayCount, currentData.dates)
        : null;

      setMeasureDetailCharts({
        currentData,
        previousData,
        currentRange: { start: currentStart, end: currentEnd },
        previousRange,
        loading: false,
        error: '',
        warning: previousStart ? '' : '未找到上轮转抽时间，上轮同期曲线暂不可用'
      });
    } catch (err: any) {
      setMeasureDetailCharts(prev => ({
        ...prev,
        loading: false,
        error: err?.message || '数据获取失败',
        warning: ''
      }));
    }
  };

  const openMeasureDetail = (row: MeasureRow) => {
    setSelectedMeasureDetail(row);
    setShowMeasureDetail(true);
    setShowMeasureForm(false);
    setMeasureClassAnalysis(prev => ({ ...prev, evaluation: null }));
    void loadMeasureDetailCharts(row);
  };

  const buildMeasuresQueryString = () => {
    const params = new URLSearchParams();
    Object.entries(measureQuery).forEach(([key, value]) => {
      if (value) {
        params.set(key, value);
      }
    });
    return params.toString();
  };

  const loadMeasures = async (silent = false) => {
    setMeasuresLoading(true);
    try {
      const query = buildMeasuresQueryString();
      const result = await fetchJson(`/api/measures${query ? `?${query}` : ''}`);
      if (result.success) {
        const data = (result.data || {}) as Partial<MeasuresResponseData>;
        const rows = Array.isArray(data.rows)
          ? data.rows.map((row) => ({
              ...row,
              detail: (() => {
                if (row.detail && typeof row.detail === 'object') return row.detail;
                if (typeof row.detail_json === 'string' && row.detail_json.trim()) {
                  try {
                    return JSON.parse(row.detail_json) as MeasureDetailPayload;
                  } catch {
                    return buildEmptyMeasureDetail();
                  }
                }
                return buildEmptyMeasureDetail();
              })()
            }))
          : [];
        setMeasures(rows);
        setMeasureFilterMeta({
          blocks: Array.isArray(data.filters?.blocks) ? data.filters.blocks : [],
          stations: Array.isArray(data.filters?.stations) ? data.filters.stations : [],
          statuses: Array.isArray(data.filters?.statuses) ? data.filters.statuses : []
        });
        setMeasureAvailableYears(Array.isArray(data.filters?.years) ? data.filters.years : []);
      } else if (!silent) {
        setMeasures([]);
        showDataError(result.message);
      }
    } catch {
      if (!silent) {
        showDataError();
      }
    } finally {
      setMeasuresLoading(false);
    }
  };

  const submitMeasureForm = async () => {
    if (!measureForm.measure_date || !measureForm.jh.trim()) {
      alert('请先填写本轮转抽时间');
      return;
    }

    setMeasuresSaving(true);
    try {
      const payload = {
        ...measureForm,
        oil_gain: 0,
        liquid_gain: Number(measureForm.liquid_gain) || 0
      };
      const result = await fetchJson(editingMeasureId ? `/api/measures/${editingMeasureId}` : '/api/measures', {
        method: editingMeasureId ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      if (!result.success) {
        alert(result.message || '保存失败');
        return;
      }

      setShowMeasureForm(false);
      resetMeasureForm();
      await loadMeasures(true);
      alert(editingMeasureId ? '更新成功' : '新增成功');
    } catch {
      alert('保存失败');
    } finally {
      setMeasuresSaving(false);
    }
  };

  const deleteMeasureRow = async (id: number) => {
    if (!window.confirm('确认删除这条措施记录吗？')) {
      return;
    }

    try {
      const result = await fetchJson(`/api/measures/${id}`, { method: 'DELETE' });
      if (!result.success) {
        alert(result.message || '删除失败');
        return;
      }
      await loadMeasures(true);
      alert('删除成功');
    } catch {
      alert('删除失败');
    }
  };

  const closeMeasureImportDialog = () => {
    setMeasureImportDialog({
      open: false,
      kind: 'preview',
      title: '',
      message: '',
      file: null,
      meta: null
    });
  };

  const confirmMeasureExcelImport = async () => {
    const file = measureImportDialog.file;
    if (!file) {
      closeMeasureImportDialog();
      return;
    }

    setMeasureImporting(true);
    try {
      const formData = new FormData();
      formData.append('file', file);

      const yearParam = measureImportYear ? `?year=${encodeURIComponent(measureImportYear)}` : '';
      const result = await fetchJson(`/api/measures/import${yearParam}`, {
        method: 'POST',
        body: formData
      });

      const meta = (result.meta as MeasureImportMeta | null) ?? measureImportDialog.meta;
      if (!result.success) {
        setMeasureImportDialog({
          open: true,
          kind: 'error',
          title: '导入失败',
          message: result.message || '导入失败',
          file,
          meta
        });
        return;
      }

      await loadMeasures(true);
      setMeasureImportDialog({
        open: true,
        kind: 'success',
        title: '导入完成',
        message: result.message || '覆盖导入成功',
        file: null,
        meta
      });
    } catch {
      setMeasureImportDialog({
        open: true,
        kind: 'error',
        title: '导入失败',
        message: 'Excel 导入失败',
        file,
        meta: measureImportDialog.meta
      });
    } finally {
      if (measureImportInputRef.current) {
        measureImportInputRef.current.value = '';
      }
      setMeasureImporting(false);
    }
  };

  const handleMeasureExcelImport = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    const fileName = file.name.toLowerCase();
    if (!['.xlsx', '.xls', '.csv'].some((ext) => fileName.endsWith(ext))) {
      setMeasureImportDialog({
        open: true,
        kind: 'error',
        title: '文件格式不支持',
        message: '仅支持导入 .xlsx、.xls 或 .csv 文件',
        file: null,
        meta: null
      });
      event.target.value = '';
      return;
    }

    setMeasureImporting(true);
    try {
      const previewFormData = new FormData();
      previewFormData.append('file', file);

      const previewYearParam = measureImportYear ? `?year=${encodeURIComponent(measureImportYear)}` : '';
      const previewResult = await fetchJson(`/api/measures/import/preview${previewYearParam}`, {
        method: 'POST',
        body: previewFormData
      });

      const previewMeta = (previewResult.meta as MeasureImportMeta | null) ?? null;
      if (!previewResult.success) {
        setMeasureImportDialog({
          open: true,
          kind: 'error',
          title: '预览失败',
          message: previewResult.message || '预览失败',
          file: null,
          meta: previewMeta
        });
        return;
      }

      setMeasureImportDialog({
        open: true,
        kind: 'preview',
        title: '导入预览结果',
        message: previewResult.message || '预览完成',
        file,
        meta: previewMeta
      });
    } catch {
      setMeasureImportDialog({
        open: true,
        kind: 'error',
        title: '预览失败',
        message: 'Excel 预览失败',
        file: null,
        meta: null
      });
    } finally {
      event.target.value = '';
      setMeasureImporting(false);
    }
  };

  const loadOccupancySummary = async () => {
    try {
      const result = await fetchJson('/api/occupancy/summary');
      if (result.success) {
        const summary = result.data as OccupancySummary;
        setOccupancySummary(summary);
        const previewRows = normalizeOccupancyPreviewRows(Array.isArray(summary.preview) ? summary.preview : []);
        const previewColumns = getOccupancyPreviewColumns(
          previewRows,
          Array.isArray(summary.columns) ? summary.columns : []
        );
        if (summary.count > 0 && previewRows.length > 0 && previewColumns.length > 0) {
          setOccupancyUpload({
            fileName: summary.fileName || '',
            sheetName: summary.sheetName || '',
            rows: previewRows,
            columns: previewColumns,
            error: ''
          });
        }
      }
    } catch {
      // Summary is optional until the first file is imported.
    }
  };

  const loadOccupancyTypeAnalysis = async (intervalDays = occupancyIntervalDays) => {
    setOccupancyTypeAnalysis(prev => ({ ...prev, loading: true, error: '' }));
    try {
      const result = await fetchJson(`/api/occupancy/type-analysis?intervalDays=${intervalDays}`);
      if (!result.success) {
        setOccupancyTypeAnalysis({ loading: false, error: result.message || '占产类型分析失败', data: null });
        return;
      }
      setOccupancyTypeAnalysis({ loading: false, error: '', data: result.data as OccupancyTypeAnalysisData });
    } catch (err: any) {
      setOccupancyTypeAnalysis({ loading: false, error: err?.message || '占产类型分析失败', data: null });
    }
  };

  const loadOccupancyBlockAnalysis = async (intervalDays = occupancyBlockIntervalDays) => {
    setOccupancyBlockAnalysis(prev => ({ ...prev, loading: true, error: '' }));
    try {
      const result = await fetchJson(`/api/occupancy/block-analysis?intervalDays=${intervalDays}`);
      if (!result.success) {
        setOccupancyBlockAnalysis({ loading: false, error: result.message || '区块占产分析失败', data: null });
        return;
      }
      setOccupancyBlockAnalysis({ loading: false, error: '', data: result.data as OccupancyBlockAnalysisData });
    } catch (err: any) {
      setOccupancyBlockAnalysis({ loading: false, error: err?.message || '区块占产分析失败', data: null });
    }
  };

  const handleOccupancyExcelUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    const fileName = file.name.toLowerCase();
    if (!['.xlsx', '.xls', '.csv'].some((ext) => fileName.endsWith(ext))) {
      setOccupancyUpload({
        fileName: file.name,
        sheetName: '',
        rows: [],
        columns: [],
        error: '仅支持上传 .xlsx、.xls 或 .csv 文件'
      });
      event.target.value = '';
      return;
    }

    setOccupancyUploading(true);
    try {
      const buffer = await file.arrayBuffer();
      const workbook = XLSX.read(buffer, { type: 'array' });
      const sheetName = workbook.SheetNames.find((name) => name.includes('2026')) || workbook.SheetNames[0] || '';
      const worksheet = sheetName ? workbook.Sheets[sheetName] : null;

      if (!worksheet) {
        setOccupancyUpload({
          fileName: file.name,
          sheetName: '',
          rows: [],
          columns: [],
          error: '未找到可读取的工作表'
        });
        event.target.value = '';
        return;
      }

      const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(worksheet, { defval: '' });
      const columns = Array.from(
        rows.reduce((set, row) => {
          Object.keys(row).forEach((key) => set.add(key));
          return set;
        }, new Set<string>())
      );

      setOccupancyUpload({
        fileName: file.name,
        sheetName,
        rows,
        columns,
        error: rows.length === 0 ? '文件已读取，但工作表中没有数据' : ''
      });

      const formData = new FormData();
      formData.append('file', file);
      const importResult = await fetchJson('/api/occupancy/import', {
        method: 'POST',
        body: formData
      });
      if (!importResult.success) {
        setOccupancyUpload(prev => ({ ...prev, error: importResult.message || '占产数据导入数据库失败' }));
        return;
      }
      const summary = (importResult.data as { summary?: OccupancySummary })?.summary;
      if (summary) {
        setOccupancySummary(summary);
      } else {
        await loadOccupancySummary();
      }
      await loadOccupancyTypeAnalysis(occupancyIntervalDays);
      await loadOccupancyBlockAnalysis(occupancyBlockIntervalDays);
    } catch (err: any) {
      setOccupancyUpload({
        fileName: file.name,
        sheetName: '',
        rows: [],
        columns: [],
        error: err?.message || 'Excel 文件读取失败'
      });
    } finally {
      event.target.value = '';
      setOccupancyUploading(false);
    }
  };

  const handlePumpAnalysisExcelUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    const fileName = file.name.toLowerCase();
    if (!['.xlsx', '.xls', '.csv'].some((ext) => fileName.endsWith(ext))) {
      setPumpAnalysisUpload({
        fileName: file.name,
        sheetName: '',
        rows: [],
        columns: [],
        error: '仅支持上传 .xlsx、.xls 或 .csv 文件'
      });
      event.target.value = '';
      return;
    }

    setPumpAnalysisUploading(true);
    try {
      const buffer = await file.arrayBuffer();
      const workbook = XLSX.read(buffer, { type: 'array' });
      const sheetName = workbook.SheetNames[0] || '';
      const worksheet = sheetName ? workbook.Sheets[sheetName] : null;

      if (!worksheet) {
        setPumpAnalysisUpload({
          fileName: file.name,
          sheetName: '',
          rows: [],
          columns: [],
          error: '未找到可读取的工作表'
        });
        event.target.value = '';
        return;
      }

      const parsed = parseExcelWorksheetWithDetectedHeader(worksheet);
      const rows = parsed.rows;
      const columns = parsed.columns;

      setPumpAnalysisUpload({
        fileName: file.name,
        sheetName,
        rows,
        columns,
        error: rows.length === 0 ? '文件已读取，但工作表中没有数据' : ''
      });

      if (rows.length > 0 && columns.length > 0) {
        const saveResult = await fetchJson('/api/pump-tracking/upload-data', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ fileName: file.name, sheetName, rows, columns })
        });
        if (!saveResult.success) {
          setPumpAnalysisUpload(prev => ({ ...prev, error: saveResult.message || '检泵跟踪数据保存到本地数据库失败' }));
        }
      }

      const matched = buildPumpOldWellRecoveredOilSeries(rows, columns);
      if (matched.missing.length === 0) {
        void loadPumpProductionOilAnalysis(matched.groups);
      } else {
        setPumpProductionOilAnalysis({ loading: false, error: '', data: null });
      }
    } catch (err: any) {
      setPumpAnalysisUpload({
        fileName: file.name,
        sheetName: '',
        rows: [],
        columns: [],
        error: err?.message || 'Excel 文件读取失败'
      });
      setPumpProductionOilAnalysis({ loading: false, error: '', data: null });
    } finally {
      event.target.value = '';
      setPumpAnalysisUploading(false);
    }
  };

  const handlePumpDeepAnalysisExcelUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    const fileName = file.name.toLowerCase();
    if (!['.xlsx', '.xls', '.csv'].some((ext) => fileName.endsWith(ext))) {
      setPumpDeepAnalysisUpload({
        fileName: file.name,
        sheetName: '',
        rows: [],
        columns: [],
        error: '仅支持上传 .xlsx、.xls 或 .csv 文件'
      });
      event.target.value = '';
      return;
    }

    setPumpDeepAnalysisUploading(true);
    try {
      const buffer = await file.arrayBuffer();
      const workbook = XLSX.read(buffer, { type: 'array' });
      const sheetName = workbook.SheetNames[0] || '';
      const worksheet = sheetName ? workbook.Sheets[sheetName] : null;

      if (!worksheet) {
        setPumpDeepAnalysisUpload({
          fileName: file.name,
          sheetName: '',
          rows: [],
          columns: [],
          error: '未找到可读取的工作表'
        });
        event.target.value = '';
        return;
      }

      const parsedSheets = workbook.SheetNames.reduce<Record<string, { sheetName: string; rows: Record<string, unknown>[]; columns: string[] }>>((record, name) => {
        const sheet = workbook.Sheets[name];
        if (!sheet) return record;
        const parsedSheet = parseExcelWorksheetWithDetectedHeader(sheet);
        record[name] = {
          sheetName: name,
          rows: parsedSheet.rows,
          columns: parsedSheet.columns
        };
        return record;
      }, {});
      const parsed = parsedSheets[sheetName] || parseExcelWorksheetWithDetectedHeader(worksheet);
      setPumpDeepAnalysisUpload({
        fileName: file.name,
        sheetName,
        rows: parsed.rows,
        columns: parsed.columns,
        error: parsed.rows.length === 0 ? '文件已读取，但工作表中没有数据' : '',
        sheets: parsedSheets
      });
      if (parsed.rows.length > 0 && parsed.columns.length > 0) {
        const saveResult = await fetchJson('/api/pump-deep-analysis/upload-data', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            fileName: file.name,
            sheetName,
            rows: parsed.rows,
            columns: parsed.columns,
            sheets: parsedSheets
          })
        });
        if (!saveResult.success) {
          setPumpDeepAnalysisUpload(prev => ({ ...prev, error: saveResult.message || '检泵分析数据保存到本地数据库失败' }));
        }
      }
    } catch (err: any) {
      setPumpDeepAnalysisUpload({
        fileName: file.name,
        sheetName: '',
        rows: [],
        columns: [],
        error: err?.message || 'Excel 文件读取失败'
      });
    } finally {
      event.target.value = '';
      setPumpDeepAnalysisUploading(false);
    }
  };

  const handleWaterLabExcelUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    const fileName = file.name.toLowerCase();
    if (!['.xlsx', '.xls', '.csv'].some((ext) => fileName.endsWith(ext))) {
      setWaterLabUpload({
        fileName: file.name,
        sheetName: '',
        rows: [],
        columns: [],
        error: '仅支持上传 .xlsx、.xls 或 .csv 文件'
      });
      event.target.value = '';
      return;
    }

    setWaterLabUploading(true);
    try {
      const buffer = await file.arrayBuffer();
      const workbook = XLSX.read(buffer, { type: 'array' });
      const sheetName = workbook.SheetNames[0] || '';
      const worksheet = sheetName ? workbook.Sheets[sheetName] : null;

      if (!worksheet) {
        setWaterLabUpload({
          fileName: file.name,
          sheetName: '',
          rows: [],
          columns: [],
          error: '未找到可读取的工作表'
        });
        event.target.value = '';
        return;
      }

      const parsedSheets = workbook.SheetNames.reduce<Record<string, { sheetName: string; rows: Record<string, unknown>[]; columns: string[] }>>((record, name) => {
        const sheet = workbook.Sheets[name];
        if (!sheet) return record;
        const parsedSheet = parseExcelWorksheetWithDetectedHeader(sheet);
        record[name] = {
          sheetName: name,
          rows: parsedSheet.rows,
          columns: parsedSheet.columns
        };
        return record;
      }, {});
      const parsed = parsedSheets[sheetName] || parseExcelWorksheetWithDetectedHeader(worksheet);
      setWaterLabUpload({
        fileName: file.name,
        sheetName,
        rows: parsed.rows,
        columns: parsed.columns,
        error: parsed.rows.length === 0 ? '文件已读取，但工作表中没有数据' : '',
        sheets: parsedSheets
      });

      if (parsed.rows.length > 0 && parsed.columns.length > 0) {
        const saveResult = await fetchJson('/api/water-lab/upload-data', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            fileName: file.name,
            sheetName,
            rows: parsed.rows,
            columns: parsed.columns,
            sheets: parsedSheets
          })
        });
        if (!saveResult.success) {
          setWaterLabUpload(prev => ({ ...prev, error: saveResult.message || '含水化验数据保存到本地数据库失败' }));
        }
      }
    } catch (err: any) {
      setWaterLabUpload({
        fileName: file.name,
        sheetName: '',
        rows: [],
        columns: [],
        error: err?.message || 'Excel 文件读取失败'
      });
    } finally {
      event.target.value = '';
      setWaterLabUploading(false);
    }
  };

  const loadPumpProductionOilAnalysis = async (
    groups: Array<{ key: string; title: string; wells: Array<{ jh: string; openDate: string; previousOpenDate: string }> }>
  ) => {
    if (groups.every((group) => group.wells.length === 0)) {
      setPumpProductionOilAnalysis({ loading: false, error: '', data: null });
      return;
    }

    setPumpProductionOilAnalysis(prev => ({ ...prev, loading: true, error: '' }));
    try {
      const result = await fetchJson('/api/pump-tracking/old-well-recovered-oil', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ intervalDays: 5, groups })
      });

      if (!result.success) {
        setPumpProductionOilAnalysis({ loading: false, error: result.message || '检泵跟踪曲线生成失败', data: null });
        return;
      }

      setPumpProductionOilAnalysis({ loading: false, error: '', data: result.data as PumpProductionOilAnalysisData });
    } catch (err: any) {
      setPumpProductionOilAnalysis({ loading: false, error: err?.message || '检泵跟踪曲线生成失败', data: null });
    }
  };

  const loadPumpTrackingPersistedUpload = async () => {
    try {
      const result = await fetchJson('/api/pump-tracking/upload-data');
      if (!result.success || !result.data) return;
      const data = result.data as Partial<PumpAnalysisUploadState>;
      const rows = Array.isArray(data.rows) ? data.rows : [];
      const columns = Array.isArray(data.columns) ? data.columns : [];
      if (rows.length === 0 || columns.length === 0) return;

      setPumpAnalysisUpload({
        fileName: data.fileName || '',
        sheetName: data.sheetName || '',
        rows,
        columns,
        error: ''
      });

      const matched = buildPumpOldWellRecoveredOilSeries(rows, columns);
      if (matched.missing.length === 0) {
        void loadPumpProductionOilAnalysis(matched.groups);
      } else {
        setPumpProductionOilAnalysis({ loading: false, error: '', data: null });
      }
    } catch {
      // 首次使使用或旧库重建表时不阻断页面重
    }
  };

  const loadPumpDeepAnalysisPersistedUpload = async () => {
    try {
      const result = await fetchJson('/api/pump-deep-analysis/upload-data');
      if (!result.success || !result.data) return;
      const data = result.data as Partial<PumpAnalysisUploadState>;
      const rows = Array.isArray(data.rows) ? data.rows : [];
      const columns = Array.isArray(data.columns) ? data.columns : [];
      if (rows.length === 0 || columns.length === 0) return;

      setPumpDeepAnalysisUpload({
        fileName: data.fileName || '',
        sheetName: data.sheetName || '',
        rows,
        columns,
        error: '',
        sheets: data.sheets
      });
    } catch {
      // 首次使使用或旧库重建表时不阻断页面重
    }
  };

  const loadWaterLabPersistedUpload = async () => {
    try {
      const result = await fetchJson('/api/water-lab/upload-data');
      if (!result.success || !result.data) return;
      const data = result.data as Partial<PumpAnalysisUploadState>;
      const rows = Array.isArray(data.rows) ? data.rows : [];
      const columns = Array.isArray(data.columns) ? data.columns : [];
      if (rows.length === 0 || columns.length === 0) return;

      setWaterLabUpload({
        fileName: data.fileName || '',
        sheetName: data.sheetName || '',
        rows,
        columns,
        error: '',
        sheets: data.sheets
      });
    } catch {
      // 首次使使用或旧库重建表时不阻断页面重
    }
  };

  const loadWaterLabWellList = async () => {
    try {
      const result = await fetchJson('/api/water-lab/well-list');
      if (result.success) setWaterLabWellList(result.data || []);
    } catch { /* ignore */ }
  };

  const loadWaterLabBlockList = async () => {
    try {
      const result = await fetchJson('/api/water-lab/block-list');
      if (result.success) setWaterLabBlockList(result.data || []);
    } catch { /* ignore */ }
  };

  const loadWaterLabWellTrend = async (jh: string) => {
    if (!jh) return;
    setWaterLabLoading(true);
    try {
      const result = await fetchJson(`/api/water-lab/well-trend?jh=${encodeURIComponent(jh)}`);
      if (result.success) setWaterLabWellTrend(result.data);
    } catch { /* ignore */ }
    finally { setWaterLabLoading(false); }
  };

  const loadWaterLabBlockTrend = async (block: string) => {
    if (!block) return;
    setWaterLabLoading(true);
    try {
      const result = await fetchJson(`/api/water-lab/block-trend?block=${encodeURIComponent(block)}`);
      if (result.success) setWaterLabBlockTrend(result.data);
    } catch { /* ignore */ }
    finally { setWaterLabLoading(false); }
  };

  const loadWaterLabStationTrend = async (station: string) => {
    if (!station) return;
    setWaterLabLoading(true);
    try {
      const result = await fetchJson(`/api/water-lab/station-trend?station=${encodeURIComponent(station)}`);
      if (result.success) setWaterLabStationTrend(result.data);
    } catch { /* ignore */ }
    finally { setWaterLabLoading(false); }
  };

  const loadWaterLabAnomalies = async () => {
    setWaterLabLoading(true);
    try {
      const result = await fetchJson(`/api/water-lab/anomalies?threshold=${waterLabAnomalyThreshold}`);
      if (result.success) setWaterLabAnomalies(result.data);
    } catch { /* ignore */ }
    finally { setWaterLabLoading(false); }
  };

  const loadWaterLabCompare = async () => {
    setWaterLabLoading(true);
    try {
      const result = await fetchJson(`/api/water-lab/compare-prod?days=30` + `&threshold=${waterLabCompareThreshold}`);
      if (result.success) setWaterLabCompareResult(result.data);
    } catch { /* ignore */ }
    finally { setWaterLabLoading(false); }
  };

  const loadKeyWellTracking = async () => {
    setKeyWellTrackingLoading(true);
    try {
      const params = `highWc=${keyWellFilters.highWc}&labGap=${keyWellFilters.labGap}&wcDiff=${keyWellFilters.wcDiff}`;
      const result = await fetchJson(`/api/water-lab/key-well-tracking?${params}`);
      if (result.success) setKeyWellTracking(result.data);
    } catch { /* ignore */ }
    finally { setKeyWellTrackingLoading(false); }
  };

  const exportWaterLabCompare = () => {
    if (!waterLabCompareResult?.deviations?.length) return;
    const rows = waterLabCompareResult.deviations.map((r) => ({
      '井号': r.jh,
      '区块': r.block,
      '站名': r.station,
      '化验次数': r.lab_count,
      '化验平均含水(%)': r.lab_avg,
      '生产平均含水(%)': r.prod_avg,
      '偏差(%)': r.deviation
    }));
    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, '化验生产含水对比');
    XLSX.writeFile(wb, `化验生产含水对比_${new Date().toISOString().split('T')[0]}.xlsx`);
  };

  const exportKeyWellTracking = () => {
    if (!keyWellTracking) return;
    const rows: Record<string, unknown>[] = [];
    for (const w of keyWellTracking.highWaterWells) {
      rows.push({
        '类别': '高含水井',
        '井号': w.jh,
        '区块': w.block,
        '站名': w.station,
        '化验含水(%)': w.latest_lab_wc ?? '',
        '生产含水(%)': w.latest_prod_wc ?? '',
        '化验日期': w.latest_lab_date ?? '',
        '未化验天数': w.days_since_last_lab ?? '',
        '化验异常': w.no_lab_alert ? '是' : '否',
        '上轮含水(%)': '',
        '本轮含水(%)': '',
        '含水差距(%)': '',
        '生产天数': '',
        '转抽时间': ''
      });
    }
    for (const m of keyWellTracking.measureWcAlerts) {
      rows.push({
        '类别': '措施井含水对比异常',
        '井号': m.jh,
        '区块': m.block,
        '站名': '',
        '化验含水(%)': '',
        '生产含水(%)': '',
        '化验日期': '',
        '未化验天数': '',
        '化验异常': '',
        '上轮含水(%)': m.previous_avg_wc,
        '本轮含水(%)': m.current_avg_wc,
        '含水差距(%)': m.diff,
        '生产天数': m.production_days,
        '转抽时间': m.current_transfer_time
      });
    }
    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, '重点井含水跟踪');
    XLSX.writeFile(wb, `重点井含水跟踪_${new Date().toISOString().split('T')[0]}.xlsx`);
  };

  const normalizeMeasureEvaluationValue = (value: unknown) => {
    const match = String(value ?? '').trim().toUpperCase().match(/[ABCD]/);
    return match ? match[0] : '';
  };

  const loadProductionForecast = async () => {
    setForecastLoading(true);
    setForecastError('');
    try {
      const result = await fetchJson('/api/production-forecast');
      if (result.success) setForecastData(result.data);
      else setForecastError(result.message || '预测生成失败');
    } catch {
      setForecastError('预测请求失败');
    } finally {
      setForecastLoading(false);
    }
  };

  const handleInventoryUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    setInventoryUploading(true);
    setInventoryError('');
    try {
      const buffer = await file.arrayBuffer();
      const workbook = XLSX.read(buffer, { type: 'array' });
      const sheetName = workbook.SheetNames[0] || '';
      if (!sheetName) { setInventoryError('未找到有效工作表'); return; }
      const worksheet = workbook.Sheets[sheetName];
      const parsed = parseExcelWorksheetWithDetectedHeader(worksheet);
      if (parsed.rows.length === 0) { setInventoryError('工作表中无数据'); return; }

      const { rows: allRows, columns } = parsed;
      const colNames = columns.map((c, i) => ({ col: c, idx: i }));

      // Find date column (matches date-like header names)
      const dateCol = colNames.find(c => /日期|时间|旬度|旬|date|rq/i.test(c.col));
      // Find inventory column
      const invCol = colNames.find(c => /盘库|产量|库存|inventory|盘库产量/i.test(c.col));

      // Auto-detect: scan first few values per column
      let foundDateIdx = -1, foundInvIdx = -1;
      for (let i = 0; i < columns.length; i++) {
        const sampleVals = allRows.slice(0, 5).map(r => String(r[columns[i]] || ''));
        if (foundDateIdx < 0 && sampleVals.some(v => /^\d{4}[\/\-]\d{1,2}[\/\-]\d{1,2}$/.test(v) || /^\d{1,2}[\/\-]\d{1,2}$/.test(v))) {
          foundDateIdx = i;
        }
        if (foundInvIdx < 0 && sampleVals.some(v => /^\d+(\.\d+)?$/.test(v) && Number(v) > 50)) {
          foundInvIdx = i;
        }
      }

      const dateKey = dateCol?.col || (foundDateIdx >= 0 ? columns[foundDateIdx] : '');
      const invKey = invCol?.col || (foundInvIdx >= 0 ? columns[foundInvIdx] : '');
      if (!dateKey || !invKey) {
        setInventoryError(`未能识别列。表头=[${columns.join(', ')}]，日期候选="${dateKey}", 产量候选="${invKey}"。请确保 Excel 包含\"日期\"和\"盘库产量\"列`);
        return;
      }

      const rows: Array<{ date: string; inventory: number }> = [];
      const dateAliases = [dateKey, '日期', '日期时间', '时间', 'date', 'Date', 'rq'];
      const invAliases = [invKey, '盘库产量', '库存', '产量', '盘库', 'inventory'];

      for (const row of allRows) {
        let dateStr = '';
        for (const a of dateAliases) { if (row[a]) { dateStr = String(row[a]).trim(); break; } }
        let invVal: number | null = null;
        for (const a of invAliases) { const v = row[a]; if (v !== undefined && v !== null && v !== '') { invVal = Number(String(v).replace(/[,，\s]/g, '')); break; } }

        if (!dateStr || invVal === null || !Number.isFinite(invVal) || invVal <= 0) continue;

        // Normalize date: handle 旬度 formats like "1月上旬", "1月中旬", "1月下旬"
        const xdMatch = dateStr.match(/^(\d{1,2})\s*月\s*(上旬|中旬|下旬)$/);
        if (xdMatch) {
          const m = parseInt(xdMatch[1]);
          const d = xdMatch[2] === '上旬' ? 10 : xdMatch[2] === '中旬' ? 20 : 28;
          dateStr = `2026-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
        }

        // Handle "1月", "2月" etc (just month)
        const mOnly = dateStr.match(/^(\d{1,2})\s*月$/);
        if (mOnly) dateStr = `2026-${String(parseInt(mOnly[1])).padStart(2, '0')}-15`;

        // Handle date formats with separators
        dateStr = dateStr.replace(/\//g, '-').replace(/\./g, '-');
        if (/^\d{1,2}-\d{1,2}$/.test(dateStr)) dateStr = `2026-${dateStr}`;
        if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
          const m = dateStr.match(/(\d{4})-(\d{1,2})-(\d{1,2})/);
          if (m) dateStr = `${m[1]}-${String(m[2]).padStart(2, '0')}-${String(m[3]).padStart(2, '0')}`;
          else continue;
        }
        rows.push({ date: dateStr, inventory: invVal });
      }

      if (rows.length === 0) {
        setInventoryError(`未能解析出数据。日期列="${dateKey}", 产量列="${invKey}", 请检查 Excel 格式`);
        return;
      }

      rows.sort((a, b) => a.date.localeCompare(b.date));

      const result = await fetchJson('/api/inventory-forecast', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rows })
      });
      if (result.success) setInventoryPrediction(result.data);
      else setInventoryError(result.message || '预测失败');
    } catch {
      setInventoryError('Excel 解析或预测请求失败');
    } finally {
      event.target.value = '';
      setInventoryUploading(false);
    }
  };

  const calculateMeasureEvaluationByRatio = (current: unknown, previous: unknown) => {
    if (current == null || previous == null) return '';
    const currentValue = Number(current);
    const previousValue = Number(previous);
    if (!Number.isFinite(currentValue) || !Number.isFinite(previousValue)) return '';
    if (previousValue <= 0) return currentValue > 0 ? 'A' : 'D';
    const ratio = currentValue / previousValue;
    if (ratio >= 1) return 'A';
    if (ratio >= 0.8) return 'B';
    if (ratio >= 0.6) return 'C';
    return 'D';
  };

  const getMeasureEvaluationValue = (row: MeasureRow) => {
    if (measureMetricMode === 'cumulative_oil') {
      return calculateMeasureEvaluationByRatio(row.cumulative_oil, row.previous_period_cumulative_oil)
        || normalizeMeasureEvaluationValue(row.evaluation_by_cumulative_oil)
        || normalizeMeasureEvaluationValue(row.evaluation);
    }
    return calculateMeasureEvaluationByRatio(row.cumulative_oil_gain, row.previous_period_oil_gain)
      || normalizeMeasureEvaluationValue(row.evaluation_by_cumulative_oil_gain);
  };

  const openMeasureClassAnalysis = async (evaluation: string) => {
    const rows = measures.filter((row) => getMeasureEvaluationValue(row) === evaluation);
    setActiveTab('measures');
    setShowMeasureDetail(false);
    setShowMeasureForm(false);
    setMeasureClassAnalysis({
      evaluation,
      currentData: null,
      previousData: null,
      loading: true,
      error: '',
      wellCount: rows.length
    });

    if (rows.length === 0) {
      setMeasureClassAnalysis({
        evaluation,
        currentData: null,
        previousData: null,
        loading: false,
        error: `暂无 ${evaluation} 类井。`,
        wellCount: 0
      });
      return;
    }

    // Use the earliest转抽时间 among selected wells as display start
    const classTransferDates = rows
      .map((row) => normalizeMeasureDetailIsoDate(row.current_round_transfer_time))
      .filter(Boolean)
      .sort();
    const classStart = classTransferDates.length > 0 ? classTransferDates[0] : '2026-01-01';
    const classEnd = normalizeMeasureDetailIsoDate(syncStatus?.lastLocalDataDate) || new Date().toISOString().slice(0, 10);
    const classDayCount = getInclusiveDateRangeDayCount(classStart, classEnd);

    const rowRanges = rows
      .map((row) => {
        const currentStart = normalizeMeasureDetailIsoDate(row.current_round_transfer_time);
        const previousStart = getPreviousMeasureStartDate(row.detail);
        const dayCount = currentStart && classEnd >= currentStart
          ? getInclusiveDateRangeDayCount(currentStart, classEnd)
          : 0;
        return {
          row,
          currentStart,
          currentEnd: classEnd,
          previousStart,
          previousEnd: previousStart && dayCount > 0 ? shiftDateByDays(previousStart, dayCount - 1) : '',
          dayCount
        };
      })
      .filter((item) => item.row.jh && item.currentStart && item.dayCount > 0);

    if (rowRanges.length === 0) {
      setMeasureClassAnalysis({
        evaluation,
        currentData: null,
        previousData: null,
        loading: false,
        error: `暂无 ${evaluation} 类井曲线数据。`,
        wellCount: rows.length
      });
      return;
    }

    const displayDates = buildDateSequence(classStart, classDayCount);
    const currentAggregate = buildEmptyAggregateChartData(displayDates);
    const previousAggregate = buildEmptyAggregateChartData(displayDates);

    try {
      await Promise.all(rowRanges.map(async (item) => {
        const [currentResult, previousResult] = await Promise.all([
          fetchJson(`/api/chart/well?jh=${encodeURIComponent(item.row.jh)}&start=${item.currentStart}&end=${item.currentEnd}`),
          item.previousStart
            ? fetchJson(`/api/chart/well?jh=${encodeURIComponent(item.row.jh)}&start=${item.previousStart}&end=${item.previousEnd}`)
            : Promise.resolve({ success: true, data: null })
        ]);

        appendAggregateChartData(
          currentAggregate,
          alignChartDataByOffsetToDisplayDates(
            currentResult.success ? (currentResult.data ?? null) : null,
            item.currentStart,
            item.currentStart,
            item.dayCount,
            displayDates
          )
        );
        if (item.previousStart) {
          appendAggregateChartData(
            previousAggregate,
            alignChartDataByOffsetToDisplayDates(
              previousResult.success ? (previousResult.data ?? null) : null,
              item.previousStart,
              item.currentStart,
              item.dayCount,
              displayDates
            )
          );
        }
      }));

      fillAggregateWaterCut(currentAggregate);
      fillAggregateWaterCut(previousAggregate);
      setMeasureClassAnalysis({
        evaluation,
        currentData: currentAggregate,
        previousData: previousAggregate,
        loading: false,
        error: '',
        wellCount: rows.length
      });
    } catch (err: any) {
      setMeasureClassAnalysis(prev => ({
        ...prev,
        loading: false,
        error: err?.message || '类别曲线数据获取失败'
      }));
    }
  };

  const loadMeasureAnalysisCharts = async () => {
    const rows = measures.filter((row) => row.jh && row.current_status === '生产');
    const currentEnd = normalizeMeasureDetailIsoDate(syncStatus?.lastLocalDataDate) || new Date().toISOString().slice(0, 10);
    // Use the earliest转抽时间 as display start, not hardcoded '2026-01-01'
    const transferDates = rows
      .map((row) => normalizeMeasureDetailIsoDate(row.current_round_transfer_time))
      .filter(Boolean)
      .sort();
    const currentStart = transferDates.length > 0 ? transferDates[0] : '2026-01-01';
    const dayCount = getInclusiveDateRangeDayCount(currentStart, currentEnd);

    if (rows.length === 0 || dayCount <= 0) {
      setMeasureAnalysisCharts({
        currentData: null,
        previousData: null,
        currentRange: { start: currentStart, end: currentEnd },
        previousRange: null,
        loading: false,
        error: rows.length === 0 ? '没有措施井数据' : '日期范围无效',
        warning: ''
      });
      setMeasureMonthlyCohorts({
        rows: [],
        loading: false,
        error: rows.length === 0 ? '暂无措施井数据' : '日期范围无效'
      });
      setMeasureBlockCharts({
        rows: [],
        loading: false,
        error: rows.length === 0 ? '暂无措施井数据' : '日期范围无效'
      });
      setMeasureTypeCharts({
        rows: [],
        loading: false,
        error: rows.length === 0 ? '暂无措施井数据' : '日期范围无效'
      });
      return;
    }

    const displayDates = buildDateSequence(currentStart, dayCount);
    const currentAggregate = buildEmptyAggregateChartData(displayDates);
    const previousAggregate = buildEmptyAggregateChartData(displayDates);
    const rowRanges = rows
      .map((row) => {
        const rowCurrentStart = normalizeMeasureDetailIsoDate(row.current_round_transfer_time);
        const previousStart = getPreviousMeasureStartDate(row.detail);
        const rowDayCount = rowCurrentStart && currentEnd >= rowCurrentStart
          ? getInclusiveDateRangeDayCount(rowCurrentStart, currentEnd)
          : 0;
        return {
          row,
          currentStart: rowCurrentStart,
          currentEnd,
          previousStart,
          previousEnd: previousStart && rowDayCount > 0 ? shiftDateByDays(previousStart, rowDayCount - 1) : '',
          dayCount: rowDayCount,
          month: rowCurrentStart.slice(0, 7),
          block: normalizeMeasureBlockName(row.block),
          measureType: normalizeMeasureTypeName(row)
        };
      })
      .filter((item) => item.row.jh && item.currentStart && item.dayCount > 0);

    if (rowRanges.length === 0) {
      setMeasureAnalysisCharts({
        currentData: null,
        previousData: null,
        currentRange: { start: currentStart, end: currentEnd },
        previousRange: null,
        loading: false,
        error: '暂无按本轮转抽时间生成的措施井曲线',
        warning: ''
      });
      setMeasureMonthlyCohorts({
        rows: [],
        loading: false,
        error: '暂无按本轮转抽时间生成的月度分组曲线'
      });
      setMeasureBlockCharts({
        rows: [],
        loading: false,
        error: '暂无按本轮转抽时间生成的区块曲线'
      });
      setMeasureTypeCharts({
        rows: [],
        loading: false,
        error: '暂无按本轮转抽时间生成的措施类型曲线'
      });
      return;
    }

    const missingPreviousCount = rowRanges.filter((item) => !item.previousStart).length;
    const totalValidWells = rowRanges.length;
    setMeasureAnalysisCharts({
      currentData: null,
      previousData: null,
      currentRange: { start: currentStart, end: currentEnd },
      previousRange: null,
      loading: true,
      error: '',
      warning: missingPreviousCount > 0 ? `其中 ${missingPreviousCount} 口井缺少“上轮转抽时间”，上轮同期曲线仅基于 ${totalValidWells - missingPreviousCount} 口井` : ''
    });
    setMeasureMonthlyCohorts({ rows: [], loading: true, error: '' });
    setMeasureBlockCharts({ rows: [], loading: true, error: '' });
    setMeasureTypeCharts({ rows: [], loading: true, error: '' });

    const monthlyCohorts = new Map<string, {
      month: string;
      wellCount: number;
      displayDates: string[];
      currentAggregate: ChartData;
      previousAggregate: ChartData;
    }>();
    const blockCohorts = new Map<string, {
      block: string;
      wellCount: number;
      displayDates: string[];
      currentAggregate: ChartData;
      previousAggregate: ChartData;
    }>();
    const measureTypeCohorts = new Map<string, {
      measureType: string;
      wellCount: number;
      displayDates: string[];
      currentAggregate: ChartData;
      previousAggregate: ChartData;
    }>();

    rowRanges.forEach((item) => {
      if (!item.month.startsWith('2026-')) return;
      const monthStart = `${item.month}-01`;
      if (currentEnd < monthStart) return;
      const cohort = monthlyCohorts.get(item.month) || (() => {
        const displayDatesForMonth = buildDateSequence(monthStart, getInclusiveDateRangeDayCount(monthStart, currentEnd));
        return {
          month: item.month,
          wellCount: 0,
          displayDates: displayDatesForMonth,
          currentAggregate: buildEmptyAggregateChartData(displayDatesForMonth),
          previousAggregate: buildEmptyAggregateChartData(displayDatesForMonth)
        };
      })();
      cohort.wellCount += 1;
      monthlyCohorts.set(item.month, cohort);
    });
    rowRanges.forEach((item) => {
      const cohort = blockCohorts.get(item.block) || (() => ({
        block: item.block,
        wellCount: 0,
        displayDates,
        currentAggregate: buildEmptyAggregateChartData(displayDates),
        previousAggregate: buildEmptyAggregateChartData(displayDates)
      }))();
      cohort.wellCount += 1;
      blockCohorts.set(item.block, cohort);
    });
    rowRanges.forEach((item) => {
      const cohort = measureTypeCohorts.get(item.measureType) || (() => ({
        measureType: item.measureType,
        wellCount: 0,
        displayDates,
        currentAggregate: buildEmptyAggregateChartData(displayDates),
        previousAggregate: buildEmptyAggregateChartData(displayDates)
      }))();
      cohort.wellCount += 1;
      measureTypeCohorts.set(item.measureType, cohort);
    });

    try {
      await Promise.all(rowRanges.map(async (item) => {
        const [currentResult, previousResult] = await Promise.all([
          fetchJson(`/api/chart/well?jh=${encodeURIComponent(item.row.jh)}&start=${item.currentStart}&end=${item.currentEnd}`),
          item.previousStart
            ? fetchJson(`/api/chart/well?jh=${encodeURIComponent(item.row.jh)}&start=${item.previousStart}&end=${item.previousEnd}`)
            : Promise.resolve({ success: true, data: null })
        ]);
        const currentRawData = currentResult.success ? (currentResult.data ?? null) : null;
        const previousRawData = previousResult.success ? (previousResult.data ?? null) : null;

        appendAggregateChartData(
          currentAggregate,
          alignChartDataByOffsetToDisplayDates(
            currentRawData,
            item.currentStart,
            item.currentStart,
            item.dayCount,
            displayDates
          )
        );
        if (item.previousStart) {
          appendAggregateChartData(
            previousAggregate,
            alignChartDataByOffsetToDisplayDates(
              previousRawData,
              item.previousStart,
              item.currentStart,
              item.dayCount,
              displayDates
            )
          );
        }

        const cohort = monthlyCohorts.get(item.month);
        if (cohort) {
          appendAggregateChartData(
            cohort.currentAggregate,
            alignChartDataByOffsetToDisplayDates(
              currentRawData,
              item.currentStart,
              item.currentStart,
              item.dayCount,
              cohort.displayDates
            )
          );
          if (item.previousStart) {
            appendAggregateChartData(
              cohort.previousAggregate,
              alignChartDataByOffsetToDisplayDates(
                previousRawData,
                item.previousStart,
                item.currentStart,
                item.dayCount,
                cohort.displayDates
              )
            );
          }
        }

        const blockCohort = blockCohorts.get(item.block);
        if (blockCohort) {
          appendAggregateChartData(
            blockCohort.currentAggregate,
            alignChartDataByOffsetToDisplayDates(
              currentRawData,
              item.currentStart,
              item.currentStart,
              item.dayCount,
              blockCohort.displayDates
            )
          );
          if (item.previousStart) {
            appendAggregateChartData(
              blockCohort.previousAggregate,
              alignChartDataByOffsetToDisplayDates(
                previousRawData,
                item.previousStart,
                item.currentStart,
                item.dayCount,
                blockCohort.displayDates
              )
            );
          }
        }

        const typeCohort = measureTypeCohorts.get(item.measureType);
        if (typeCohort) {
          appendAggregateChartData(
            typeCohort.currentAggregate,
            alignChartDataByOffsetToDisplayDates(
              currentRawData,
              item.currentStart,
              item.currentStart,
              item.dayCount,
              typeCohort.displayDates
            )
          );
          if (item.previousStart) {
            appendAggregateChartData(
              typeCohort.previousAggregate,
              alignChartDataByOffsetToDisplayDates(
                previousRawData,
                item.previousStart,
                item.currentStart,
                item.dayCount,
                typeCohort.displayDates
              )
            );
          }
        }
      }));

      fillAggregateWaterCut(currentAggregate);
      fillAggregateWaterCut(previousAggregate);
      const monthlyRows = Array.from(monthlyCohorts.values())
        .sort((left, right) => left.month.localeCompare(right.month))
        .map((cohort) => {
          fillAggregateWaterCut(cohort.currentAggregate);
          fillAggregateWaterCut(cohort.previousAggregate);
          return {
            month: cohort.month,
            wellCount: cohort.wellCount,
            tenDayData: buildAverageOilPeriodData(cohort.currentAggregate, cohort.previousAggregate, 'tenDay')
          };
        });
      const blockRows = Array.from(blockCohorts.values())
        .sort((left, right) => right.wellCount - left.wellCount || left.block.localeCompare(right.block))
        .map((cohort) => {
          fillAggregateWaterCut(cohort.currentAggregate);
          fillAggregateWaterCut(cohort.previousAggregate);
          return {
            block: cohort.block,
            wellCount: cohort.wellCount,
            tenDayData: buildAverageOilPeriodData(cohort.currentAggregate, cohort.previousAggregate, 'tenDay')
          };
        });
      const typeRows = Array.from(measureTypeCohorts.values())
        .sort((left, right) => right.wellCount - left.wellCount || left.measureType.localeCompare(right.measureType))
        .map((cohort) => {
          fillAggregateWaterCut(cohort.currentAggregate);
          fillAggregateWaterCut(cohort.previousAggregate);
          return {
            measureType: cohort.measureType,
            wellCount: cohort.wellCount,
            tenDayData: buildAverageOilPeriodData(cohort.currentAggregate, cohort.previousAggregate, 'tenDay')
          };
        });
      setMeasureAnalysisCharts({
        currentData: currentAggregate,
        previousData: previousAggregate,
        currentRange: { start: currentStart, end: currentEnd },
        previousRange: null,
        loading: false,
        error: '',
        warning: missingPreviousCount > 0 ? `上轮同期曲线仅基于 ${totalValidWells - missingPreviousCount} 口井（${missingPreviousCount} 口井缺少“上轮转抽时间”）` : ''
      });
      setMeasureMonthlyCohorts({
        rows: monthlyRows,
        loading: false,
        error: monthlyRows.length > 0 ? '' : '暂无 2026 年转抽开的措施井月度分组'
      });
      setMeasureBlockCharts({
        rows: blockRows,
        loading: false,
        error: blockRows.length > 0 ? '' : '暂无区块措施井旬度曲线数据'
      });
      setMeasureTypeCharts({
        rows: typeRows,
        loading: false,
        error: typeRows.length > 0 ? '' : '暂无措施类型旬度曲线数据'
      });
    } catch (err: any) {
      setMeasureAnalysisCharts(prev => ({
        ...prev,
        loading: false,
        error: err?.message || '措施分析加载失败',
        warning: ''
      }));
      setMeasureMonthlyCohorts({
        rows: [],
        loading: false,
        error: err?.message || '月度分组曲线数据获取失败'
      });
      setMeasureBlockCharts({
        rows: [],
        loading: false,
        error: err?.message || '区块曲线数据获取失败'
      });
      setMeasureTypeCharts({
        rows: [],
        loading: false,
        error: err?.message || '措施类型曲线数据获取失败'
      });
    }
  };

  const runCustomMeasureAnalysis = async (filters = measureCustomFilters) => {
    const currentEnd = normalizeMeasureDetailIsoDate(syncStatus?.lastLocalDataDate) || new Date().toISOString().slice(0, 10);
    const displayStart = normalizeMeasureDetailIsoDate(filters.transferStart) || '2026-01-01';
    const displayDayCount = getInclusiveDateRangeDayCount(displayStart, currentEnd);
    const selectedRows = measures
      .filter((row) => row.jh && row.current_status === '生产')
      .filter((row) => !filters.block || normalizeMeasureBlockName(row.block) === filters.block)
      .filter((row) => !filters.measureType || normalizeMeasureTypeName(row) === filters.measureType)
      .map((row) => {
        const currentStart = normalizeMeasureDetailIsoDate(row.current_round_transfer_time);
        const previousStart = getPreviousMeasureStartDate(row.detail);
        const dayCount = currentStart && currentStart >= displayStart && currentEnd >= currentStart
          ? getInclusiveDateRangeDayCount(currentStart, currentEnd)
          : 0;
        return {
          row,
          currentStart,
          currentEnd,
          previousStart,
          previousEnd: previousStart && dayCount > 0 ? shiftDateByDays(previousStart, dayCount - 1) : '',
          dayCount
        };
      })
      .filter((item) => item.currentStart && item.dayCount > 0);

    if (displayDayCount <= 0) {
      setMeasureCustomAnalysis({
        currentData: null,
        previousData: null,
        loading: false,
        error: '自定义日期范围无效',
        wellCount: 0
      });
      return;
    }

    if (selectedRows.length === 0) {
      setMeasureCustomAnalysis({
        currentData: null,
        previousData: null,
        loading: false,
        error: '当前条件下没有可生成曲线的措施井',
        wellCount: 0
      });
      return;
    }

    const displayDates = buildDateSequence(displayStart, displayDayCount);
    const currentAggregate = buildEmptyAggregateChartData(displayDates);
    const previousAggregate = buildEmptyAggregateChartData(displayDates);

    setMeasureCustomAnalysis({
      currentData: null,
      previousData: null,
      loading: true,
      error: '',
      wellCount: selectedRows.length
    });

    try {
      await Promise.all(selectedRows.map(async (item) => {
        const [currentResult, previousResult] = await Promise.all([
          fetchJson(`/api/chart/well?jh=${encodeURIComponent(item.row.jh)}&start=${item.currentStart}&end=${item.currentEnd}`),
          item.previousStart
            ? fetchJson(`/api/chart/well?jh=${encodeURIComponent(item.row.jh)}&start=${item.previousStart}&end=${item.previousEnd}`)
            : Promise.resolve({ success: true, data: null })
        ]);
        const currentRawData = currentResult.success ? (currentResult.data ?? null) : null;
        const previousRawData = previousResult.success ? (previousResult.data ?? null) : null;

        appendAggregateChartData(
          currentAggregate,
          alignChartDataByOffsetToDisplayDates(
            currentRawData,
            item.currentStart,
            item.currentStart,
            item.dayCount,
            displayDates
          )
        );
        if (item.previousStart) {
          appendAggregateChartData(
            previousAggregate,
            alignChartDataByOffsetToDisplayDates(
              previousRawData,
              item.previousStart,
              item.currentStart,
              item.dayCount,
              displayDates
            )
          );
        }
      }));

      fillAggregateWaterCut(currentAggregate);
      fillAggregateWaterCut(previousAggregate);
      setMeasureCustomAnalysis({
        currentData: aggregateChartDataByTimeGrain(currentAggregate, filters.timeGrain),
        previousData: aggregateChartDataByTimeGrain(previousAggregate, filters.timeGrain),
        loading: false,
        error: '',
        wellCount: selectedRows.length
      });
    } catch (err: any) {
      setMeasureCustomAnalysis({
        currentData: null,
        previousData: null,
        loading: false,
        error: err?.message || '自定义分析曲线数据获取失败',
        wellCount: selectedRows.length
      });
    }
  };

  React.useEffect(() => {
    if (activeTab !== 'measureAnalysis' || !measureAnalysisExpanded.custom || measures.length === 0) return;
    const timer = window.setTimeout(() => {
      void runCustomMeasureAnalysis(measureCustomFilters);
    }, 250);
    return () => window.clearTimeout(timer);
  }, [activeTab, measureAnalysisExpanded.custom, measureCustomFilters, measures.length, syncStatus?.lastLocalDataDate]);

  const displayedMeasures = React.useMemo(() => {
    const cockpitFilteredMeasures = measureCockpitAlertFilter
      ? filterMeasuresByCockpitAlerts(measures, measureCockpitAlertFilter.alerts, measureCockpitAlertFilter.type)
      : measures;
    if (!measureEvaluationSorted) {
      return cockpitFilteredMeasures;
    }

    const evaluationOrder: Record<string, number> = { A: 0, B: 1, C: 2, D: 3 };
    return cockpitFilteredMeasures
      .map((row, index) => ({ row, index }))
      .sort((left, right) => {
        const leftOrder = evaluationOrder[getMeasureEvaluationValue(left.row)] ?? 99;
        const rightOrder = evaluationOrder[getMeasureEvaluationValue(right.row)] ?? 99;
        if (leftOrder !== rightOrder) {
          return leftOrder - rightOrder;
        }
        return left.index - right.index;
      })
      .map(({ row }) => row);
  }, [measures, measureEvaluationSorted, measureMetricMode, measureCockpitAlertFilter]);

  const exportMeasuresToExcel = () => {
    if (displayedMeasures.length === 0) return;

    const metricLabel = measureMetricMode === 'cumulative_oil' ? '本轮累产油' : '累增油';
    const previousMetricLabel = measureMetricMode === 'cumulative_oil' ? '上轮同期累产油' : '上轮同期累增油';
    const exportData = displayedMeasures.map((row, index) => ({
      '序号': row.seq_no || index + 1,
      '井号': row.jh,
      '目前状态': row.current_status,
      '区块': row.block,
      '措施类型': row.current_round_measure_type,
      '转抽时间': row.current_status === '生产' ? (row.current_round_transfer_time || '--') : '--',
      '生产天数': row.production_days ?? '',
      '日产液': row.current_liquid ?? '',
      '日产油': row.current_oil ?? '',
      '掺油': row.current_diluent ?? '',
      '含水': row.current_water_cut ?? '',
      [metricLabel]: measureMetricMode === 'cumulative_oil' ? (row.cumulative_oil ?? '') : (row.cumulative_oil_gain ?? ''),
      [previousMetricLabel]: measureMetricMode === 'cumulative_oil' ? (row.previous_period_cumulative_oil ?? '') : (row.previous_period_oil_gain ?? ''),
      '评价': getMeasureEvaluationValue(row)
    }));

    const ws = XLSX.utils.json_to_sheet(exportData);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, '措施跟踪');
    XLSX.writeFile(wb, `措施跟踪_${new Date().toISOString().split('T')[0]}.xlsx`);
  };

  const loadDashboardBootstrap = async () => {
    setDashboardBootstrapLoading(true);
    try {
      const result = await fetchJson('/api/dashboard/bootstrap');

      if (!result.success) {
        if (!dashboardBootstrapLoaded) {
          setBlocks([]);
          setChartBlocks([]);
          setStations([]);
          setOverallData(null);
          setAnalysisData(null);
          setSyncStatus(null);
        }
        showDataError(result.message);
        return false;
      }

      const data = (result.data || {}) as Partial<DashboardBootstrapData>;
      setBlocks(Array.isArray(data.blocks) ? data.blocks : []);
      setChartBlocks(Array.isArray(data.chartBlocks) ? data.chartBlocks : []);
      setStations(Array.isArray(data.stations) ? data.stations : []);
      setOverallData(data.overallData ?? null);
      setAnalysisData(data.analysisData ?? null);
      setSyncStatus(data.syncStatus ?? null);
      const nextCacheWarm = Boolean(data.cacheWarm);
      setCacheInfo({
        cacheWarm: nextCacheWarm,
        cacheSource: data.cacheSource ?? null,
        generatedAt: data.generatedAt ?? null,
        sourceDate: data.sourceDate ?? null
      });
      setDashboardBootstrapLoaded(true);
      setDashboardBootstrapNeedsRefresh(!nextCacheWarm);
      return true;
    } finally {
      setDashboardBootstrapLoading(false);
    }
  };

  const loadWells = async (silent = false) => {
    if (wellsLoaded || wellsLoadingRef.current) {
      return;
    }

    wellsLoadingRef.current = true;
    setWellsLoading(true);
    try {
      const result = await fetchJson('/api/wells');

      if (result.success) {
        setWells(Array.isArray(result.data) ? result.data : []);
        setWellsLoaded(true);
      } else if (!silent) {
        setWells([]);
        showDataError(result.message);
      }
    } finally {
      wellsLoadingRef.current = false;
      setWellsLoading(false);
    }
  };

  useEffect(() => {
    const loadInitialData = async () => {
      setGlobalError('');
      try {
        await loadDashboardBootstrap();
      } catch {
        if (!dashboardBootstrapLoaded) {
          setBlocks([]);
          setChartBlocks([]);
          setStations([]);
          setWells([]);
          setWellsLoaded(false);
          wellsLoadingRef.current = false;
          setWellsLoading(false);
          setOverallData(null);
          setAnalysisData(null);
          setSyncStatus(null);
          setCacheInfo({ cacheWarm: false, cacheSource: null, generatedAt: null, sourceDate: null });
        }
        showDataError();
      }
    };

    loadInitialData();
  }, [isLoggedIn]);

  useEffect(() => {
    if (selectedWell) {
      loadWellChart(selectedWell);
    }
  }, [wellRange.start, wellRange.end]);

  useEffect(() => {
    
    const timer = window.setInterval(() => {
      void loadSyncStatus(true);
    }, 30000);

    return () => window.clearInterval(timer);
  }, [isLoggedIn]);

  useEffect(() => {
    if (!syncStatus?.lastLocalDataDate) return;
    if (!dashboardBootstrapNeedsRefresh) return;
    if (cacheInfo.cacheWarm && overallData?.dates?.length) return;
    if (dashboardBootstrapLoading) return;
    void loadDashboardBootstrap();
  }, [isLoggedIn, syncStatus?.lastLocalDataDate, dashboardBootstrapNeedsRefresh, cacheInfo.cacheWarm, dashboardBootstrapLoading, overallData?.dates?.length]);

  useEffect(() => {
        if (activeTab === 'well') {
      void loadWells();
    }
  }, [activeTab, isLoggedIn]);

  useEffect(() => {
    if (!wellSearch.trim() || wellsLoaded) return;
    void loadWells(true);
  }, [isLoggedIn, wellSearch, wellsLoaded]);

  useEffect(() => {
        if (activeTab === 'measures' || activeTab === 'measureAnalysis') {
      void loadMeasures();
    }
  }, [activeTab, isLoggedIn]);

  useEffect(() => {
    if (activeTab === 'wellTemperature') {
      void loadWellTemperatureTests().then((tests) => {
        if (tests?.[0]) void loadWellTemperatureTestDetail(tests[0].id);
      });
    }
  }, [activeTab, isLoggedIn]);

  useEffect(() => {
    if (activeTab !== 'dashboard' || !dashboardExpanded.composition) return;
    if (measures.length === 0 && !measuresLoading) {
      void loadMeasures(true);
    }
  }, [activeTab, dashboardExpanded.composition, isLoggedIn, measures.length, measuresLoading]);

  useEffect(() => {
    if (activeTab !== 'dashboard' || !dashboardExpanded.composition) return;
    if (measuresLoading || measures.length === 0 || measureAnalysisCharts.loading || measureAnalysisCharts.currentData) return;
    void loadMeasureAnalysisCharts();
  }, [activeTab, dashboardExpanded.composition, isLoggedIn, measureAnalysisCharts.currentData, measureAnalysisCharts.loading, measures.length, measuresLoading, syncStatus?.lastLocalDataDate]);

  useEffect(() => {
    if (activeTab !== 'measureAnalysis' || measuresLoading || measures.length === 0) return;
    void loadMeasureAnalysisCharts();
  }, [activeTab, isLoggedIn, measuresLoading, measures.length, syncStatus?.lastLocalDataDate]);

  useEffect(() => {
    if (activeTab !== 'occupancyAnalysis') return;
    void loadOccupancySummary();
    void loadOccupancyTypeAnalysis(occupancyIntervalDays);
    void loadOccupancyBlockAnalysis(occupancyBlockIntervalDays);
  }, [activeTab, isLoggedIn]);

  useEffect(() => {
    if (activeTab !== 'pumpAnalysis') return;
    void loadPumpTrackingPersistedUpload();
  }, [activeTab, isLoggedIn]);

  useEffect(() => {
    if (activeTab !== 'pumpDeepAnalysis') return;
    void loadPumpDeepAnalysisPersistedUpload();
  }, [activeTab, isLoggedIn]);

  useEffect(() => {
    if (activeTab !== 'waterLab') return;
    void loadWaterLabPersistedUpload();
    void loadWaterLabWellList();
    void loadWaterLabBlockList();
  }, [activeTab, isLoggedIn]);

  // Auto-load first well when expanding analysis
  useEffect(() => {
    if (!waterLabExpanded.analysis || !waterLabWellList.length || waterLabSelectedWell) return;
    setWaterLabSelectedWell(waterLabWellList[0].jh);
  }, [waterLabExpanded.analysis, waterLabWellList]);

  useEffect(() => {
    if (!waterLabSelectedWell) return;
    void loadWaterLabWellTrend(waterLabSelectedWell);
  }, [waterLabSelectedWell]);

  // Auto-load compare when expanding
  useEffect(() => {
    if (!waterLabExpanded.compare || waterLabCompareResult) return;
    void loadWaterLabCompare();
  }, [waterLabExpanded.compare]);

  // Auto-load key well tracking when expanding
  useEffect(() => {
    if (!waterLabExpanded.keyWell || keyWellTracking) return;
    void loadKeyWellTracking();
  }, [waterLabExpanded.keyWell]);

  useEffect(() => {
    if (activeTab !== 'productionForecast') return;
    void loadProductionForecast();
    void loadPumpTrackingPersistedUpload();
    if (measures.length === 0 && !measuresLoading) {
      void loadMeasures();
    }
  }, [activeTab, isLoggedIn]);

  const loadBlockChart = async (blocksOverride?: string[]) => {
    const targetBlocks = Array.isArray(blocksOverride) ? blocksOverride : selectedChartBlocks;
    if (targetBlocks.length === 0) return alert('请先选择区块');
    setLoading(true);
    setBlockChartData(null);
    setBlockChartSource(null);

    try {
      const end = syncStatus?.lastLocalDataDate || new Date().toISOString().slice(0, 10);
      const start = shiftDateByYears(end, -3);
      const query = [
        ...targetBlocks.map(block => `block=${encodeURIComponent(block)}`),
        `start=${encodeURIComponent(start)}`,
        `end=${encodeURIComponent(end)}`
      ].join('&');
      const result = await fetchJson(`/api/chart/block?${query}`);
      if (result.success) {
        setBlockChartData(result.data);
        setBlockChartSource(result.dataSource ?? null);
      } else {
        showDataError(result.message);
      }
    } catch {
      showDataError();
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (activeTab !== 'block' || chartBlocks.length === 0) return;
    if (loading || blockDefaultAutoLoadedRef.current) return;

    const defaultBlock = chartBlocks.includes('高246块') ? '高246块' : chartBlocks[0];
    const shouldLoadDefault =
      selectedChartBlocks.length === 0 ||
      (selectedChartBlocks.length === 1 && selectedChartBlocks[0] === defaultBlock && !blockChartData);

    if (!shouldLoadDefault) return;

    const nextBlocks = selectedChartBlocks.length > 0 ? selectedChartBlocks : [defaultBlock];
    if (selectedChartBlocks.length === 0) {
      setSelectedChartBlocks(nextBlocks);
    }
    blockDefaultAutoLoadedRef.current = true;
    void loadBlockChart(nextBlocks);
  }, [activeTab, blockChartData, chartBlocks, isLoggedIn, loading, selectedChartBlocks, syncStatus?.lastLocalDataDate]);

  const loadWellChart = async (jh: string, range = wellRange) => {
    setSelectedWell(jh);
    setLoading(true);
    setWellChartData(null);
    setWellChartSource(null);

    try {
      const result = await fetchJson(`/api/chart/well?jh=${encodeURIComponent(jh)}&start=${range.start}&end=${range.end}`);
      if (result.success) {
        setWellChartData(result.data);
        setWellChartSource(result.dataSource ?? null);
      } else {
        showDataError(result.message);
      }
    } catch {
      showDataError();
    } finally {
      setLoading(false);
    }
  };

  const loadAnalysisChart = async () => {
    setLoading(true);
    setAnalysisData(null);

    try {
      const result = await fetchJson('/api/analysis/issues');
      if (result.success) {
        setAnalysisData(result.data);
      } else {
        showDataError(result.message);
      }
    } catch {
      showDataError();
    } finally {
      setLoading(false);
    }
  };

  const loadCompareData = async (
    ranges = compareRanges,
    options: { noTodayMessage?: string } = {}
  ) => {
    setLoading(true);
    setCompareResults([]);
    setCompareSummary(null);
    setLargeChangeData(null);

    try {
      const result = await fetchJson('/api/analysis/compare', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          rangeA: ranges.rangeA,
          rangeB: ranges.rangeB,
          stations: selectedStations
        })
      });
      if (result.success) {
        const data = (result.data || {}) as Partial<CompareResponseData>;
        if (options.noTodayMessage && data.hasRangeBData === false) {
          alert(options.noTodayMessage);
          return;
        }
        setCompareResults(Array.isArray(data.rows) ? data.rows : []);
        setCompareSummary(data.summary ?? null);
        setLargeChangeData(data.largeChange ?? null);
      } else {
        showDataError(result.message);
      }
    } catch {
      showDataError();
    } finally {
      setLoading(false);
    }
  };

  const loadTodayYesterdayCompare = async () => {
    const latestDate =
      normalizeMeasureDetailIsoDate(syncStatus?.lastLocalDataDate) ||
      overallData?.dates?.[overallData.dates.length - 1] ||
      new Date().toISOString().slice(0, 10);

    if (!latestDate) {
      alert('今日无数据');
      return;
    }

    const previousDate = shiftDateByDays(latestDate, -1);
    const nextRanges = {
      rangeA: { start: previousDate, end: previousDate },
      rangeB: { start: latestDate, end: latestDate }
    };

    setCompareRanges(nextRanges);
    await loadCompareData(nextRanges, {
      noTodayMessage: `今日（${latestDate}）无数据`
    });
  };

  const syncData = async () => {
    setSyncing(true);
    try {
      const result = await fetchJson('/api/sync');
      if (result.success) {
        setWellsLoaded(false);
        wellsLoadingRef.current = false;
        await Promise.all([loadDashboardBootstrap(), loadWells(true)]);
      } else {
        await loadSyncStatus(true);
      }
      alert(result.message || (result.success ? '同步完成' : '同步失败'));
    } catch {
      alert("同步失败");
    } finally {
      setSyncing(false);
    }
  };

  const exportToExcel = () => {
    if (compareResults.length === 0) return;

    const exportData = compareResults.map(row => ({
      "jh": row.jh,
      "station": row.station,
      "区块": row.block,
      "A_liquid": row.avgA?.liquid ?? 0,
      "A_oil": row.avgA?.oil ?? 0,
      "A_water_cut": row.avgA?.water_cut ?? 0,
      "A_gas": row.avgA?.gas ?? 0,
      "B_liquid": row.avgB?.liquid ?? 0,
      "B_oil": row.avgB?.oil ?? 0,
      "B_water_cut": row.avgB?.water_cut ?? 0,
      "B_gas": row.avgB?.gas ?? 0,
      "日产液差": row.diff?.liquid ?? 0,
      "日产油差": row.diff?.oil ?? 0,
      "water_cut_diff": row.diff?.water_cut ?? 0,
      "日产气差": row.diff?.gas ?? 0,
      "诊断备注": row.note || "正常波动"
    }));

    const ws = XLSX.utils.json_to_sheet(exportData);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, '对比分析');
    XLSX.writeFile(wb, `对比分析_${compareRanges.rangeA.start}_vs_${compareRanges.rangeB.start}.xlsx`);
  };

  const exportBlockDataToExcel = () => {
    if (!blockChartData || !selectedChartBlockLabel || !selectedChartBlockFileLabel) return;

    const exportData = blockChartData.dates.map((date, index) => ({
      "date": date,
      "block": selectedChartBlockLabel,
      "liquid_t": blockChartData.liquid[index],
      "oil_t": blockChartData.oil[index],
      "diluent_t": blockChartData.diluent[index],
      "water_cut_pct": blockChartData.water_cut[index],
      "gas_m3": blockChartData.gas[index]
    }));

    const ws = XLSX.utils.json_to_sheet(exportData);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, `${selectedChartBlockFileLabel}月度数据`);
    XLSX.writeFile(wb, `${selectedChartBlockFileLabel}_月度数据_${new Date().toISOString().split('T')[0]}.xlsx`);
  };

  // --- Chart Options Generator ---
  const getChartOption = (
    title: string,
    dates: string[],
    primarySeries: Array<number | null>,
    yAxisName: string,
    color: string,
    isPercent: boolean = false,
    secondarySeries?: Array<number | null>,
    secondaryLabel?: string,
    showIntegerLabels = false,
    adaptiveYAxis = false,
    labelInterval = 1,
    showChangeCurves = false
  ) => ({
    title: { text: title, left: 'center', textStyle: { fontSize: 14, fontWeight: 700, color: '#0f172a' } },
    tooltip: {
      trigger: 'axis',
      axisPointer: { type: 'cross', label: { backgroundColor: '#475569' } },
      backgroundColor: 'rgba(255, 255, 255, 0.96)',
      borderWidth: 1,
      borderColor: '#e2e8f0',
      textStyle: { color: '#0f172a' },
      formatter: (params: any) => {
        const points = Array.isArray(params) ? params : [params];
        const titleText = points[0]?.axisValueLabel || points[0]?.name || '';
        const lines = points.map((item: any) => `${item.marker || ''}${item.seriesName}: ${formatChartNumber(item.value, showIntegerLabels ? 0 : 1)}${isPercent ? '%' : ''}`);
        return [titleText, ...lines].join('<br/>');
      }
    },
    legend: secondarySeries ? {
      data: showChangeCurves
        ? ['本期', secondaryLabel || '同期', '本期变化', '上轮同期变化']
        : ['本期', secondaryLabel || '同期'],
      top: 28,
      textStyle: { color: '#475569' }
    } : undefined,
    grid: { left: '7%', right: showChangeCurves ? '8%' : '5%', bottom: '15%', top: secondarySeries ? '26%' : '20%', containLabel: true },
    toolbox: {
      feature: {
        dataZoom: { yAxisIndex: 'none' },
        restore: {},
        saveAsImage: {},
        magicType: { type: ['line', 'bar'] }
      },
      right: 10,
      top: 0
    },
    dataZoom: [
      { type: 'inside', start: 0, end: 100 },
      { type: 'slider', start: 0, end: 100, bottom: 0, height: 18, borderColor: '#cbd5e1', fillerColor: 'rgba(37, 99, 235, 0.12)' }
    ],
    xAxis: {
      type: 'category',
      data: dates,
      boundaryGap: false,
      axisLine: { lineStyle: { color: '#94a3b8' } },
      axisLabel: { color: '#475569' }
    },
    yAxis: showChangeCurves ? [
      {
        type: 'value',
        name: yAxisName,
        min: adaptiveYAxis ? getAdaptiveAxisBounds([primarySeries, secondarySeries], isPercent).min : (isPercent ? 0 : undefined),
        max: adaptiveYAxis ? getAdaptiveAxisBounds([primarySeries, secondarySeries], isPercent).max : (isPercent ? 100 : undefined),
        axisLine: { show: true, lineStyle: { color: color } },
        axisLabel: { color: '#475569' },
        splitLine: { lineStyle: { type: 'dashed', color: '#e2e8f0' } }
      },
      {
        type: 'value',
        name: '变化曲线',
        axisLine: { show: true, lineStyle: { color: '#0f766e' } },
        axisLabel: { color: '#0f766e' },
        splitLine: { show: false }
      }
    ] : {
      type: 'value',
      name: yAxisName,
      min: adaptiveYAxis ? getAdaptiveAxisBounds([primarySeries, secondarySeries], isPercent).min : (isPercent ? 0 : undefined),
      max: adaptiveYAxis ? getAdaptiveAxisBounds([primarySeries, secondarySeries], isPercent).max : (isPercent ? 100 : undefined),
      axisLine: { show: true, lineStyle: { color: color } },
      axisLabel: { color: '#475569' },
      splitLine: { lineStyle: { type: 'dashed', color: '#e2e8f0' } }
    },
    series: [
      {
        name: '本期',
        type: 'line',
        smooth: true,
        itemStyle: { color: color },
        lineStyle: { width: 3, color },
        areaStyle: {
          color: {
            type: 'linear',
            x: 0, y: 0, x2: 0, y2: 1,
            colorStops: [
              { offset: 0, color: color },
              { offset: 1, color: 'rgba(255,255,255,0)' }
            ]
          },
          opacity: 0.2
        },
        data: primarySeries,
        symbol: 'circle',
        symbolSize: showIntegerLabels ? 7 : 6,
        label: showIntegerLabels && labelInterval <= 1 ? {
          show: true,
          position: 'top',
          distance: 6,
          formatter: (params: any) => formatChartNumber(params.value, 0),
          color,
          fontSize: 11
        } : undefined
        ,
        labelLayout: showIntegerLabels ? { hideOverlap: false } : undefined,
        markPoint: showIntegerLabels && labelInterval > 1
          ? buildSparseAverageMarkPoints(dates, primarySeries, color, 'top', labelInterval)
          : undefined
      },
      ...(secondarySeries ? [{
        name: secondaryLabel || '同期',
        type: 'line',
        smooth: true,
        itemStyle: { color },
        lineStyle: { width: 2, type: 'dashed', color },
        data: secondarySeries,
        symbol: showIntegerLabels ? 'diamond' : 'none',
        symbolSize: showIntegerLabels ? 7 : undefined,
        label: showIntegerLabels && labelInterval <= 1 ? {
          show: true,
          position: 'bottom',
          distance: 6,
          formatter: (params: any) => formatChartNumber(params.value, 0),
          color: '#64748b',
          fontSize: 11
        } : undefined
        ,
        labelLayout: showIntegerLabels ? { hideOverlap: false } : undefined,
        markPoint: showIntegerLabels && labelInterval > 1
          ? buildSparseAverageMarkPoints(dates, secondarySeries, '#64748b', 'bottom', labelInterval)
          : undefined
      }] : []),
      ...(showChangeCurves ? [
        {
          name: '本期变化',
          type: 'line',
          yAxisIndex: 1,
          smooth: true,
          data: buildChangeSeries(primarySeries),
          symbol: 'none',
          lineStyle: { width: 2, type: 'dotted', color: '#0f766e' },
          itemStyle: { color: '#0f766e' }
        },
        ...(secondarySeries ? [{
          name: '上轮同期变化',
          type: 'line',
          yAxisIndex: 1,
          smooth: true,
          data: buildChangeSeries(secondarySeries),
          symbol: 'none',
          lineStyle: { width: 2, type: 'dotted', color: '#94a3b8' },
          itemStyle: { color: '#94a3b8' }
        }] : [])
      ] : [])
    ]
  });

  const getOilDiluentOption = (title: string, dates: string[], oil: number[], diluent: number[]) => ({
    title: { text: title, left: 'center', textStyle: { fontSize: 14, fontWeight: 700, color: '#0f172a' } },
    tooltip: { 
      trigger: 'axis', 
      axisPointer: { type: 'cross', label: { backgroundColor: '#475569' } },
      backgroundColor: 'rgba(255, 255, 255, 0.96)',
      borderWidth: 1,
      borderColor: '#e2e8f0',
      textStyle: { color: '#0f172a' }
    },
    legend: { data: ['日产油', '掺油'], top: 30 },
    grid: { left: '8%', right: '8%', bottom: '15%', top: '25%', containLabel: true },
    toolbox: {
      feature: {
        dataZoom: { yAxisIndex: 'none' },
        restore: {},
        saveAsImage: {},
        magicType: { type: ['line', 'bar'] }
      },
      right: 10,
      top: 0
    },
    dataZoom: [
      { type: 'inside', start: 0, end: 100 },
      { type: 'slider', start: 0, end: 100, bottom: 0, height: 18, borderColor: '#cbd5e1', fillerColor: 'rgba(37, 99, 235, 0.12)' }
    ],
    xAxis: { 
      type: 'category', 
      data: dates, 
      boundaryGap: false,
      axisLine: { lineStyle: { color: '#94a3b8' } },
      axisLabel: { color: '#475569' }
    },
    yAxis: [
      { 
        type: 'value', 
        name: '日产油(t)',
        axisLine: { show: true, lineStyle: { color: '#D32F2F' } },
        splitLine: { lineStyle: { type: 'dashed', color: '#e2e8f0' } }
      },
      { 
        type: 'value', 
        name: '掺油(t)',
        axisLine: { show: true, lineStyle: { color: '#9c27b0' } },
        splitLine: { show: false }
      }
    ],
    series: [
      {
        name: '日产油',
        type: 'line',
        smooth: true,
        itemStyle: { color: '#D32F2F' },
        data: oil,
        symbol: 'circle',
        symbolSize: 6
      },
      {
        name: '掺油',
        type: 'line',
        smooth: true,
        yAxisIndex: 1,
        itemStyle: { color: '#9c27b0' },
        data: diluent,
        symbol: 'circle',
        symbolSize: 6
      }
    ]
  });

  const getAverageOilPeriodOption = (
    title: string,
    periodData: AverageOilPeriodData,
    color = '#D32F2F',
    yAxisName = '平均日产油(t/d)',
    unit = 't/d',
    legendNames: [string, string] = ['本期平均日产油', '上轮同期平均日产油'],
    previousColor = '#64748b'
  ) => ({
    title: { text: title, left: 'center', textStyle: { fontSize: 14, fontWeight: 700, color: '#0f172a' } },
    color: [color, previousColor],
    tooltip: {
      trigger: 'axis',
      backgroundColor: 'rgba(255, 255, 255, 0.96)',
      borderWidth: 1,
      borderColor: '#e2e8f0',
      textStyle: { color: '#0f172a' },
      formatter: (params: any) => {
        const points = Array.isArray(params) ? params : [params];
        const titleText = points[0]?.axisValueLabel || points[0]?.name || '';
        return [
          titleText,
          ...points.map((item: any) => `${item.marker || ''}${item.seriesName}: ${formatChartNumber(item.value)} ${unit}`)
        ].join('<br/>');
      }
    },
    legend: { data: legendNames, top: 28, textStyle: { color: '#475569' } },
    grid: { left: '7%', right: '5%', bottom: '12%', top: '24%', containLabel: true },
    toolbox: {
      feature: {
        restore: {},
        saveAsImage: {},
        magicType: { type: ['line', 'bar'] }
      },
      right: 10,
      top: 0
    },
    xAxis: {
      type: 'category',
      data: periodData.labels,
      boundaryGap: false,
      axisLine: { lineStyle: { color: '#94a3b8' } },
      axisLabel: { color: '#475569' }
    },
    yAxis: {
      type: 'value',
      name: yAxisName,
      axisLine: { show: true, lineStyle: { color } },
      axisLabel: { color: '#475569' },
      splitLine: { lineStyle: { type: 'dashed', color: '#e2e8f0' } }
    },
    series: [
      {
        name: legendNames[0],
        type: 'line',
        smooth: true,
        data: periodData.current,
        itemStyle: { color },
        lineStyle: { width: 3, color },
        symbol: 'circle',
        symbolSize: 7,
        label: {
          show: true,
          position: 'top',
          formatter: (params: any) => formatChartNumber(params.value),
          color,
          fontSize: 11
        }
      },
      {
        name: legendNames[1],
        type: 'line',
        smooth: true,
        data: periodData.previous,
        itemStyle: { color: previousColor },
        lineStyle: { width: 2, type: 'dashed', color: previousColor },
        symbol: 'diamond',
        symbolSize: 7,
        label: {
          show: true,
          position: 'bottom',
          formatter: (params: any) => formatChartNumber(params.value),
          color: previousColor,
          fontSize: 11
        }
      }
    ]
  });

  const getMeasureSharePieOption = (
    title: string,
    data: Array<{ name: string; value: number }>,
    unit: string
  ) => ({
    title: { text: title, left: 'center', top: 4, textStyle: { fontSize: 14, fontWeight: 'bold', color: '#0f172a' } },
    tooltip: {
      trigger: 'item',
      formatter: (params: any) => `${params.marker || ''}${params.name}<br/>${formatChartNumber(params.value)} ${unit} (${params.percent}%)`
    },
    legend: { bottom: 0, left: 'center' },
    color: ['#2563eb', '#16a34a', '#f97316', '#8b5cf6'],
    series: [
      {
        name: title,
        type: 'pie',
        radius: ['42%', '68%'],
        center: ['50%', '48%'],
        data,
        minAngle: 4,
        avoidLabelOverlap: true,
        label: {
          formatter: (params: any) => `${params.name}\n${params.percent}%`,
          fontSize: 12,
          color: '#334155'
        },
        labelLine: { length: 12, length2: 8 },
        emphasis: {
          scale: true,
          itemStyle: { shadowBlur: 12, shadowColor: 'rgba(15, 23, 42, 0.18)' }
        }
      }
    ]
  });

  const getProductionCompositionOption = (
    title: string,
    data: Array<{ name: string; value: number }>,
    unit: string,
    colors: string[]
  ) => ({
    title: { text: title, left: 'center', top: 4, textStyle: { fontSize: 14, fontWeight: 700, color: '#0f172a' } },
    tooltip: {
      trigger: 'item',
      formatter: (params: any) => `${params.marker || ''}${params.name}<br/>${formatChartNumber(params.value, 1)} ${unit} (${params.percent}%)`
    },
    legend: { bottom: 0, left: 'center', textStyle: { color: '#475569' } },
    color: colors,
    series: [
      {
        name: title,
        type: 'pie',
        radius: ['42%', '68%'],
        center: ['50%', '48%'],
        data,
        avoidLabelOverlap: true,
        label: {
          formatter: (params: any) => `${params.name}\n${formatChartNumber(params.value, 1)} ${unit}`,
          fontSize: 12,
          color: '#334155'
        },
        labelLine: { length: 12, length2: 8 },
        emphasis: {
          scale: true,
          itemStyle: { shadowBlur: 12, shadowColor: 'rgba(15, 23, 42, 0.18)' }
        }
      }
    ]
  });

  const getDashboardOilCompositionOption = (
    labels: string[],
    totalOil: Array<number | null>,
    measureOil: Array<number | null>,
    oldWellOil: Array<number | null>,
    title = '全区产油构成平均日产油',
    yAxisName = '平均日产油(t/d)',
    forceTopLabels = false
  ) => ({
    title: { text: title, left: 'center', textStyle: { fontSize: 14, fontWeight: 700, color: '#0f172a' } },
    color: ['#D32F2F', '#2563eb', '#16a34a'],
    tooltip: {
      trigger: 'axis',
      backgroundColor: 'rgba(255, 255, 255, 0.96)',
      borderWidth: 1,
      borderColor: '#e2e8f0',
      textStyle: { color: '#0f172a' },
      formatter: (params: any) => {
        const points = Array.isArray(params) ? params : [params];
        const titleText = points[0]?.axisValueLabel || points[0]?.name || '';
        return [
          titleText,
          ...points.map((item: any) => `${item.marker || ''}${item.seriesName}: ${formatChartNumber(item.value, 0)} t/d`)
        ].join('<br/>');
      }
    },
    legend: { data: ['全区产油', '措施井产油', '老井产油'], top: 28, textStyle: { color: '#475569' } },
    grid: { left: '7%', right: '5%', bottom: '12%', top: '24%', containLabel: true },
    toolbox: {
      feature: {
        restore: {},
        saveAsImage: {},
        magicType: { type: ['line', 'bar'] }
      },
      right: 10,
      top: 0
    },
    xAxis: {
      type: 'category',
      data: labels,
      boundaryGap: false,
      axisLine: { lineStyle: { color: '#94a3b8' } },
      axisLabel: { color: '#475569' }
    },
    yAxis: {
      type: 'value',
      name: yAxisName,
      axisLine: { show: true, lineStyle: { color: '#D32F2F' } },
      axisLabel: { color: '#475569' },
      splitLine: { lineStyle: { type: 'dashed', color: '#e2e8f0' } }
    },
    series: [
      { name: '全区产油', type: 'line', smooth: true, data: totalOil, symbol: 'circle', symbolSize: 7, lineStyle: { width: 3 }, label: { show: true, position: 'top', distance: 6, formatter: (params: any) => formatChartNumber(params.value, 0), fontSize: 11, color: '#D32F2F' } },
      { name: '措施井产油', type: 'line', smooth: true, data: measureOil, symbol: 'diamond', symbolSize: 7, lineStyle: { width: 3 }, label: { show: true, position: forceTopLabels ? 'top' : 'bottom', distance: 6, formatter: (params: any) => formatChartNumber(params.value, 0), fontSize: 11, color: '#2563eb' } },
      { name: '老井产油', type: 'line', smooth: true, data: oldWellOil, symbol: 'triangle', symbolSize: 7, lineStyle: { width: 3 }, label: { show: true, position: forceTopLabels ? 'top' : 'bottom', distance: 6, formatter: (params: any) => formatChartNumber(params.value, 0), fontSize: 11, color: '#16a34a' } }
    ]
  });

  const getPieOption = () => ({
    title: { text: '含水分布诊断', subtext: '按含水区间统计井数', left: 'center' },
    tooltip: { trigger: 'item', formatter: '{a} <br/>{b}：{c} 口 ({d}%)' },
    legend: { bottom: '0', left: 'center' },
    series: [
      {
        name: '含水分布', type: 'pie', radius: '60%',
        data: analysisData?.water_cut_pie || [],
        emphasis: { itemStyle: { shadowBlur: 10, shadowOffsetX: 0, shadowColor: 'rgba(0, 0, 0, 0.5)' } },
        itemStyle: {
          color: (params: any) => {
            const name = params.name || '';
            if (name.includes('特高')) return '#D32F2F';
            if (name.includes('高含水')) return '#FF9800';
            if (name.includes('低含水')) return '#4CAF50';
            return '#2196F3';
          }
        }
      }
    ]
  });

  const occupancyColorMap: Record<string, string> = {
    '注汽占产': '#F59E0B',
    '注窜占产': '#16A34A',
    '检泵占产': '#2563EB',
    '三类合计': '#D32F2F',
    '总占产合计': '#D32F2F'
  };

  const getOccupancyTypeChartOption = (data: OccupancyTypeAnalysisData | null) => {
    const labels = data?.labels || [];
    const labelInterval = labels.length > 10 ? Math.ceil(labels.length / 8) - 1 : 0;
    const formatAxisDateLabel = (value: string) => {
      const formatOne = (dateText: string) => {
        const match = dateText.match(/^(\d{4})-(\d{2})-(\d{2})$/);
        return match ? `${match[2]}/${match[3]}` : dateText;
      };
      if (value.includes('~')) {
        const [start, end] = value.split('~');
        return `${formatOne(start)}\n~${formatOne(end)}`;
      }
      return formatOne(value);
    };
    return {
      color: (data?.series || []).map(s => occupancyColorMap[s.name] || '#64748b'),
      tooltip: {
        trigger: 'axis',
        formatter: (params: any[]) => {
          if (!Array.isArray(params) || params.length === 0) return '';
          const title = params[0]?.axisValueLabel || params[0]?.name || '';
          return [
            title,
            ...params.map((item) => `${item.marker}${item.seriesName}: ${formatChartNumber(item.value, 1)} t/d`)
          ].join('<br/>');
        }
      },
      legend: { top: 0, type: 'scroll' },
      grid: { left: 64, right: 24, top: 56, bottom: 72 },
      xAxis: {
        type: 'category',
        data: labels,
        axisLabel: {
          color: '#475569',
          interval: labelInterval,
          rotate: 0,
          margin: 14,
          formatter: formatAxisDateLabel
        }
      },
      yAxis: {
        type: 'value',
        name: '平均影响油(t/d)',
        axisLine: { show: true, lineStyle: { color: '#D32F2F' } },
        axisLabel: { color: '#475569' },
        splitLine: { lineStyle: { type: 'dashed', color: '#e2e8f0' } },
        scale: true
      },
      dataZoom: [{ type: 'inside' }, { type: 'slider', height: 18, bottom: 24 }],
      series: (data?.series || []).map((series, index) => {
        const seriesLabelInterval = labels.length > 10 ? Math.max(2, Math.ceil(labels.length / 10)) : 1;
        return {
        name: series.name,
        type: 'line',
        smooth: true,
        symbol: 'circle',
        symbolSize: 7,
        data: series.data,
        lineStyle: { width: 3 },
        label: {
          show: true,
          position: 'top',
          formatter: (params: any) => (params.dataIndex % seriesLabelInterval === 0 ? formatChartNumber(params.value, 1) : ''),
          fontSize: 11,
          color: occupancyColorMap[series.name] || '#64748b'
        }
      }})
    };
  };

  const getOccupancyTypeTotalChartOption = (data: OccupancyTypeAnalysisData | null) => {
    const labels = data?.labels || [];
    const labelInterval = labels.length > 10 ? Math.ceil(labels.length / 8) - 1 : 0;
    const formatAxisDateLabel = (value: string) => {
      const formatOne = (dateText: string) => {
        const match = dateText.match(/^(\d{4})-(\d{2})-(\d{2})$/);
        return match ? `${match[2]}/${match[3]}` : dateText;
      };
      if (value.includes('~')) {
        const [start, end] = value.split('~');
        return `${formatOne(start)}\n~${formatOne(end)}`;
      }
      return formatOne(value);
    };
    const totalSeries = labels.map((_, index) =>
      Number((data?.series || []).reduce((sum, series) => sum + Number(series.data[index] || 0), 0).toFixed(1))
    );
    return {
      color: ['#D32F2F'],
      tooltip: {
        trigger: 'axis',
        formatter: (params: any[]) => {
          if (!Array.isArray(params) || params.length === 0) return '';
          const title = params[0]?.axisValueLabel || params[0]?.name || '';
          return [
            title,
            ...params.map((item) => `${item.marker}${item.seriesName}: ${formatChartNumber(item.value, 1)} t/d`)
          ].join('<br/>');
        }
      },
      legend: { top: 0 },
      grid: { left: 64, right: 24, top: 56, bottom: 72 },
      xAxis: {
        type: 'category',
        data: labels,
        axisLabel: {
          color: '#475569',
          interval: labelInterval,
          rotate: 0,
          margin: 14,
          formatter: formatAxisDateLabel
        }
      },
      yAxis: {
        type: 'value',
        name: '合计影响油(t/d)',
        axisLine: { show: true, lineStyle: { color: '#D32F2F' } },
        axisLabel: { color: '#475569' },
        splitLine: { lineStyle: { type: 'dashed', color: '#e2e8f0' } },
        scale: true
      },
      dataZoom: [{ type: 'inside' }, { type: 'slider', height: 18, bottom: 24 }],
      series: [{
        name: '三类合计',
        type: 'line',
        smooth: true,
        symbol: 'circle',
        symbolSize: 7,
        data: totalSeries,
        lineStyle: { width: 3 },
        areaStyle: { color: 'rgba(211, 47, 47, 0.08)' },
        label: {
          show: true,
          position: 'top',
          formatter: (params: any) => (params.dataIndex % Math.max(2, Math.ceil(labels.length / 10)) === 0 ? formatChartNumber(params.value, 1) : ''),
          fontSize: 11,
          color: '#D32F2F'
        }
      }]
    };
  };

  const getOccupancyBlockChartOption = (blockData: OccupancyBlockAnalysisData['blocks'][number]) => {
    const labels = blockData.labels || [];
    const labelInterval = labels.length > 10 ? Math.ceil(labels.length / 8) - 1 : 0;
    const formatAxisDateLabel = (value: string) => {
      const formatOne = (dateText: string) => {
        const match = dateText.match(/^(\d{4})-(\d{2})-(\d{2})$/);
        return match ? `${match[2]}/${match[3]}` : dateText;
      };
      if (value.includes('~')) {
        const [start, end] = value.split('~');
        return `${formatOne(start)}\n~${formatOne(end)}`;
      }
      return formatOne(value);
    };

    return {
      color: [...blockData.series.map(s => occupancyColorMap[s.name] || '#64748b'), '#D32F2F'],
      tooltip: {
        trigger: 'axis',
        formatter: (params: any[]) => {
          if (!Array.isArray(params) || params.length === 0) return '';
          const title = params[0]?.axisValueLabel || params[0]?.name || '';
          return [
            title,
            ...params.map((item) => `${item.marker}${item.seriesName}: ${formatChartNumber(item.value, 1)} t/d`)
          ].join('<br/>');
        }
      },
      legend: { top: 0, type: 'scroll' },
      grid: { left: 64, right: 72, top: 60, bottom: 72 },
      xAxis: {
        type: 'category',
        data: labels,
        axisLabel: {
          color: '#475569',
          interval: labelInterval,
          rotate: 0,
          margin: 14,
          formatter: formatAxisDateLabel
        }
      },
      yAxis: [
        {
          type: 'value',
          name: '类型占产(t/d)',
          axisLine: { show: true, lineStyle: { color: '#D32F2F' } },
          axisLabel: { color: '#475569' },
          splitLine: { lineStyle: { type: 'dashed', color: '#e2e8f0' } },
          scale: true
        },
        {
          type: 'value',
          name: '合计(t/d)',
          axisLine: { show: true, lineStyle: { color: '#0f172a' } },
          axisLabel: { color: '#475569' },
          splitLine: { show: false },
          scale: true
        }
      ],
      dataZoom: [{ type: 'inside' }, { type: 'slider', height: 18, bottom: 24 }],
      series: [
        ...blockData.series.map((series, index) => {
          const blockLabelInterval = labels.length > 10 ? Math.max(2, Math.ceil(labels.length / 10)) : 1;
          return {
          name: series.name,
          type: 'line',
          yAxisIndex: 0,
          smooth: true,
          symbol: 'circle',
          symbolSize: 6,
          data: series.data,
          lineStyle: { width: 2.5 },
          label: {
            show: true,
            position: 'top',
            formatter: (params: any) => (params.dataIndex % blockLabelInterval === 0 ? formatChartNumber(params.value, 1) : ''),
            fontSize: 10,
            color: occupancyColorMap[series.name] || '#64748b'
          }
        }}),
        {
          name: '总占产合计',
          type: 'line',
          yAxisIndex: 1,
          smooth: true,
          symbol: 'diamond',
          symbolSize: 7,
          data: blockData.total,
          lineStyle: { width: 3, type: 'dashed' },
          label: {
            show: true,
            position: 'bottom',
            formatter: (params: any) => (params.dataIndex % Math.max(2, Math.ceil(labels.length / 10)) === 0 ? formatChartNumber(params.value, 1) : ''),
            fontSize: 10,
            color: '#0f172a'
          }
        }
      ]
    };
  };

  const overallFilteredData = React.useMemo(() => filterChartDataByRange(overallData, overallRange), [overallData, overallRange]);

  const overallCompareFilteredData = React.useMemo(() => filterChartDataByRange(overallData, overallCompareRange), [overallCompareRange, overallData]);

  const overallTenDayData = React.useMemo(
    () => aggregateChartDataByTimeGrain(overallFilteredData, 'tenDay'),
    [overallFilteredData]
  );

  const overallCompareTenDayData = React.useMemo(
    () => aggregateChartDataByTimeGrain(overallCompareFilteredData, 'tenDay'),
    [overallCompareFilteredData]
  );

  const overallPrimaryDates = React.useMemo(() => overallTenDayData?.dates ?? [], [overallTenDayData]);

  const overallCompareSeries = React.useMemo(() => {
    const primaryLength = overallPrimaryDates.length;
    return {
      liquid: padSeries(overallCompareTenDayData?.liquid, primaryLength),
      oil: padSeries(overallCompareTenDayData?.oil, primaryLength),
      diluent: padSeries(overallCompareTenDayData?.diluent, primaryLength),
      water_cut: padSeries(overallCompareTenDayData?.water_cut, primaryLength),
      gas: padSeries(overallCompareTenDayData?.gas, primaryLength)
    };
  }, [overallCompareTenDayData, overallPrimaryDates.length]);

  const overallDiluentRatioSeries = React.useMemo(
    () => calculateDiluentRatioSeries(overallTenDayData?.diluent, overallTenDayData?.oil),
    [overallTenDayData]
  );

  const overallCompareDiluentRatioSeries = React.useMemo(
    () => padSeries(calculateDiluentRatioSeries(overallCompareTenDayData?.diluent, overallCompareTenDayData?.oil), overallPrimaryDates.length),
    [overallCompareTenDayData, overallPrimaryDates.length]
  );
  const overallDiluentRatioPercentSeries = React.useMemo(
    () => overallDiluentRatioSeries.map(value => typeof value === 'number' ? Number((value * 100).toFixed(1)) : value),
    [overallDiluentRatioSeries]
  );
  const overallCompareDiluentRatioPercentSeries = React.useMemo(
    () => overallCompareDiluentRatioSeries.map(value => typeof value === 'number' ? Number((value * 100).toFixed(1)) : value),
    [overallCompareDiluentRatioSeries]
  );

  const latestOverallIndex = overallFilteredData?.dates?.length ? overallFilteredData.dates.length - 1 : -1;
  const latestOverall = latestOverallIndex >= 0 ? {
    oil: overallFilteredData?.oil[latestOverallIndex],
    liquid: overallFilteredData?.liquid[latestOverallIndex],
    diluent: overallFilteredData?.diluent[latestOverallIndex],
    water_cut: overallFilteredData?.water_cut[latestOverallIndex],
    gas: overallFilteredData?.gas[latestOverallIndex],
  } : null;
  const dashboardLiquidComposition = React.useMemo(() => {
    const oil = Number(latestOverall?.oil ?? 0);
    const liquid = Number(latestOverall?.liquid ?? 0);
    const diluent = Number(latestOverall?.diluent ?? 0);
    const water = Math.max(liquid - oil - diluent, 0);
    return [
      { name: '日产油', value: Number(oil.toFixed(1)) },
      { name: '产水量', value: Number(water.toFixed(1)) },
      { name: '掺油', value: Number(diluent.toFixed(1)) }
    ];
  }, [latestOverall?.diluent, latestOverall?.liquid, latestOverall?.oil]);
  const dashboardOilDiluentComposition = React.useMemo(() => {
    const oil = Number(latestOverall?.oil ?? 0);
    const diluent = Number(latestOverall?.diluent ?? 0);
    return [
      { name: '日产油', value: Number(oil.toFixed(1)) },
      { name: '掺油', value: Number(diluent.toFixed(1)) }
    ];
  }, [latestOverall?.diluent, latestOverall?.oil]);

  const blockMonthlyData = React.useMemo(
    () => aggregateChartDataByTimeGrain(blockChartData, 'month'),
    [blockChartData]
  );
  const blockDiluentRatioPercentSeries = React.useMemo(
    () => calculateDiluentRatioSeries(blockMonthlyData?.diluent, blockMonthlyData?.oil)
      .map(value => typeof value === 'number' ? Number((value * 100).toFixed(1)) : value),
    [blockMonthlyData]
  );

  const formatStat = (value: number | undefined, digits = 1) => (
    typeof value === 'number' ? value.toLocaleString('zh-CN', { maximumFractionDigits: digits }) : '--'
  );

  const filteredWells = wells.filter(w => {
    const matchBlock = !selectedWellBlock || w.block === selectedWellBlock;
    const matchStation = !selectedStation || w.station === selectedStation;
    const matchSearch = !wellSearch || w.jh?.toLowerCase().includes(wellSearch.toLowerCase());
    return matchBlock && matchStation && matchSearch;
  });

  const selectedChartBlockLabel = selectedChartBlocks.join('?');
  const selectedChartBlockFileLabel = selectedChartBlocks.length === 0
    ? ''
    : selectedChartBlockLabel.replace(/[\/:*?"<>|]/g, '?');

  const cacheSourceText = cacheInfo.cacheSource === 'sqlite'
    ? '本地缓存不可用，请检查 SQLite 配置'
    : cacheInfo.cacheSource === 'rebuilt'
      ? '正在同步本地数据...'
      : cacheInfo.cacheWarm
        ? '本地缓存可用'
        : dashboardBootstrapLoading
          ? '暂无本地缓存，请先同步'
          : '本地缓存待检查';

  const runtimeSyncStatus = getRuntimeSyncStatus(syncStatus, syncing);

  const showDashboardSkeleton = activeTab === 'dashboard' && dashboardBootstrapLoading && !dashboardBootstrapLoaded;

  const blockChartSourceText = blockChartSource === 'memory'
    ? '本地缓存不可用'
    : blockChartSource === 'summary'
      ? '本地缓存可用'
      : blockChartSource === 'local_production'
        ? '本地缓存待同步'
        : '';

  const wellChartSourceText = wellChartSource === 'memory'
    ? '数据获取失败'
    : wellChartSource === 'local_production'
      ? '本地缓存可用'
      : wellChartSource === 'oracle'
        ? '连接 Oracle'
        : '';

  const measureImportSummaryLines = buildMeasureImportSummaryLines(
    measureImportDialog.meta,
    measureImportDialog.file?.name,
    measureImportDialog.message
  );
  const measureDetailForCompare = React.useMemo<MeasureDetailPayload | undefined>(() => {
    if (!selectedMeasureDetail?.detail) {
      return selectedMeasureDetail?.detail;
    }

    return {
      ...selectedMeasureDetail.detail,
      currentRound: {
        ...(selectedMeasureDetail.detail.currentRound || {}),
        ...(selectedMeasureDetail.current_round_measure_type ? { '措施类型': selectedMeasureDetail.current_round_measure_type } : {})
      }
    };
  }, [selectedMeasureDetail]);
  const measureDetailCompareRows = buildMeasureDetailCompareRows(measureDetailForCompare);
  const measureClassChartConfigs = [
    { title: "A/B/C/D类日产液汇总", key: "liquid", yAxis: "日产液(t)", color: "#2563eb", percent: false },
    { title: "A/B/C/D类日产油汇总", key: "oil", yAxis: "日产油(t)", color: "#D32F2F", percent: false },
    { title: "A/B/C/D类含水汇总", key: "water_cut", yAxis: "含水率(%)", color: "#16a34a", percent: true },
    { title: "A/B/C/D类掺油汇总", key: "diluent", yAxis: "掺油(t)", color: "#9c27b0", percent: false },
    { title: "A/B/C/D类日产气汇总", key: "gas", yAxis: "日产气(m3)", color: "#facc15", percent: false }
  ] as const;
  const measureClassMonthlyAverageOil = React.useMemo(
    () => buildAverageOilPeriodData(measureClassAnalysis.currentData, measureClassAnalysis.previousData, 'month'),
    [measureClassAnalysis.currentData, measureClassAnalysis.previousData]
  );
  const measureClassTenDayAverageOil = React.useMemo(
    () => buildAverageOilPeriodData(measureClassAnalysis.currentData, measureClassAnalysis.previousData, 'tenDay'),
    [measureClassAnalysis.currentData, measureClassAnalysis.previousData]
  );
  const measureAnalysisMonthlyAverageOil = React.useMemo(
    () => buildAverageOilPeriodData(measureAnalysisCharts.currentData, measureAnalysisCharts.previousData, 'month'),
    [measureAnalysisCharts.currentData, measureAnalysisCharts.previousData]
  );
  const measureAnalysisTenDayAverageOil = React.useMemo(
    () => buildAverageOilPeriodData(measureAnalysisCharts.currentData, measureAnalysisCharts.previousData, 'tenDay'),
    [measureAnalysisCharts.currentData, measureAnalysisCharts.previousData]
  );
  const dashboardOilCompositionSeries = React.useMemo(() => {
    const total = aggregateOilByDayInterval(overallFilteredData, dashboardCompositionInterval);
    const measure = aggregateOilByDayInterval(measureAnalysisCharts.currentData, dashboardCompositionInterval);
    const measureOil = total.labels.map((_, index) => {
      const value = measure.oil[index];
      return typeof value === 'number' ? value : null;
    });
    const oldWellOil = total.oil.map((totalValue, index) => {
      const measureValue = measureOil[index];
      if (typeof totalValue !== 'number' || typeof measureValue !== 'number') return null;
      return Number(Math.max(totalValue - measureValue, 0).toFixed(1));
    });

    return {
      labels: total.labels,
      totalOil: total.oil,
      measureOil,
      oldWellOil,
      totalOilChange: buildChangeSeriesWithZeroBaseline(total.oil),
      measureOilChange: buildChangeSeriesWithZeroBaseline(measureOil),
      oldWellOilChange: buildChangeSeriesWithZeroBaseline(oldWellOil)
    };
  }, [dashboardCompositionInterval, measureAnalysisCharts.currentData, overallFilteredData]);
  const measureAnalysisTenDayOilDelta = React.useMemo(
    () => buildPeriodDeltaData(measureAnalysisTenDayAverageOil),
    [measureAnalysisTenDayAverageOil]
  );
  const measureAnalysisMonthlyOilDelta = React.useMemo(
    () => buildPeriodDeltaData(measureAnalysisMonthlyAverageOil),
    [measureAnalysisMonthlyAverageOil]
  );
  const tenDayDeltaPalette = TEN_DAY_DELTA_PALETTES[tenDayDeltaPaletteIndex % TEN_DAY_DELTA_PALETTES.length];
  const measureAnalysisRows = React.useMemo(() => ['A', 'B', 'C', 'D'].map((evaluation) => {
    const rows = measures.filter((row) => getMeasureEvaluationValue(row) === evaluation);
    const productionRows = rows.filter((row) => row.current_status === '生产');
    const sum = (selector: (row: MeasureRow) => number | null | undefined) =>
      rows.reduce((total, row) => total + Number(selector(row) ?? 0), 0);
    return {
      evaluation,
      count: rows.length,
      productionCount: productionRows.length,
      currentOil: sum(row => row.current_oil),
      currentLiquid: sum(row => row.current_liquid),
      cumulativeOil: sum(row => row.cumulative_oil),
      previousCumulativeOil: sum(row => row.previous_period_cumulative_oil)
    };
  }), [measures, measureMetricMode]);
  const measureAnalysisWellSharePie = React.useMemo(
    () => measureAnalysisRows.map(item => ({ name: `${item.evaluation}类`, value: item.count })),
    [measureAnalysisRows]
  );
  const measureAnalysisOilSharePie = React.useMemo(
    () => measureAnalysisRows.map(item => ({ name: `${item.evaluation}类`, value: Number(item.currentOil.toFixed(1)) })),
    [measureAnalysisRows]
  );
  const pumpOldWellRecoveredOilSeries = React.useMemo(
    () => buildPumpOldWellRecoveredOilSeries(pumpAnalysisUpload.rows, pumpAnalysisUpload.columns),
    [pumpAnalysisUpload.rows, pumpAnalysisUpload.columns]
  );
  const pumpDeepAnalysisData = React.useMemo(
    () => buildPumpDeepAnalysisData(pumpDeepAnalysisUpload),
    [pumpDeepAnalysisUpload]
  );
  const measureAnalysisBlockRows = React.useMemo(() => {
    const byBlock = new Map<string, {
      block: string;
      count: number;
      currentLiquid: number;
      currentOil: number;
      cumulativeOil: number;
      previousCumulativeOil: number;
    }>();
    measures.forEach((row) => {
      const blockName = normalizeMeasureBlockName(row.block);
      const item = byBlock.get(blockName) || {
        block: blockName,
        count: 0,
        currentLiquid: 0,
        currentOil: 0,
        cumulativeOil: 0,
        previousCumulativeOil: 0
      };
      item.count += 1;
      item.currentLiquid += Number(row.current_liquid ?? 0);
      item.currentOil += Number(row.current_oil ?? 0);
      item.cumulativeOil += Number(row.cumulative_oil ?? 0);
      item.previousCumulativeOil += Number(row.previous_period_cumulative_oil ?? 0);
      byBlock.set(blockName, item);
    });
    return Array.from(byBlock.values()).sort((left, right) => right.count - left.count);
  }, [measures]);
  const measureAnalysisTypeRows = React.useMemo(() => {
    const byType = new Map<string, {
      measureType: string;
      count: number;
      currentLiquid: number;
      currentOil: number;
      cumulativeOil: number;
      previousCumulativeOil: number;
    }>();
    measures.forEach((row) => {
      const measureType = normalizeMeasureTypeName(row);
      const item = byType.get(measureType) || {
        measureType,
        count: 0,
        currentLiquid: 0,
        currentOil: 0,
        cumulativeOil: 0,
        previousCumulativeOil: 0
      };
      item.count += 1;
      item.currentLiquid += Number(row.current_liquid ?? 0);
      item.currentOil += Number(row.current_oil ?? 0);
      item.cumulativeOil += Number(row.cumulative_oil ?? 0);
      item.previousCumulativeOil += Number(row.previous_period_cumulative_oil ?? 0);
      byType.set(measureType, item);
    });
    return Array.from(byType.values()).sort((left, right) => right.count - left.count || left.measureType.localeCompare(right.measureType));
  }, [measures]);
  const measureCustomBlockOptions = React.useMemo(
    () => Array.from(new Set(measures.map(row => normalizeMeasureBlockName(row.block)))).sort((left, right) => left.localeCompare(right)),
    [measures]
  );
  const measureCustomTypeOptions = React.useMemo(
    () => Array.from(new Set(measures.map(row => normalizeMeasureTypeName(row)))).sort((left, right) => left.localeCompare(right)),
    [measures]
  );
  const renderMeasureAnalysisPanel = (
    key: string,
    title: string,
    description: string,
    children: React.ReactNode
  ) => {
    const expanded = Boolean(measureAnalysisExpanded[key]);
    return (
      <div className="app-card overflow-hidden">
        <button
          type="button"
          onClick={() => setMeasureAnalysisExpanded(prev => ({ ...prev, [key]: !prev[key] }))}
          className="flex w-full cursor-pointer items-center justify-between gap-4 px-6 py-4 text-left hover:bg-slate-50"
        >
          <div>
            <h3 className="text-lg font-bold text-slate-900">{title}</h3>
            <p className="mt-1 text-sm text-slate-500">{description}</p>
          </div>
          <ChevronRight className={cn("h-5 w-5 text-slate-400 transition-transform", expanded && "rotate-90")} />
        </button>
        {expanded && (
          <div className="border-t border-slate-100 p-6">
            {children}
          </div>
        )}
      </div>
    );
  };
  const renderDashboardPanel = (
    key: string,
    title: string,
    description: string,
    icon: React.ReactNode,
    children: React.ReactNode
  ) => {
    const expanded = Boolean(dashboardExpanded[key]);
    return (
      <div className="app-card overflow-hidden border-t-4 border-t-[#D32F2F]">
        <button
          type="button"
          onClick={() => setDashboardExpanded(prev => ({ ...prev, [key]: !prev[key] }))}
          className="flex w-full cursor-pointer items-center justify-between gap-4 px-5 py-4 text-left hover:bg-slate-50"
        >
          <div>
            <h3 className="section-title border-l-0 pl-0">
              {icon}
              {title}
            </h3>
            <p className="mt-2 text-sm text-slate-500">{description}</p>
          </div>
          <ChevronRight className={cn("h-5 w-5 text-slate-400 transition-transform", expanded && "rotate-90")} />
        </button>
        {expanded && (
          <div className="border-t border-slate-100 p-5">
            {children}
          </div>
        )}
      </div>
    );
  };

  if (showDatacoreLanding) {
    return <DatacoreLandingPage onEnter={handleEnterFromLanding} onLogin={() => setShowDatacoreLogin(true)} onNavigate={handleNavigateFromDatacoreLanding} loginOverlay={showDatacoreLogin ? <Login overlay onLogin={handleDatacoreLogin} onCancel={() => setShowDatacoreLogin(false)} globalError={globalError} /> : null} />;
  }

  if (showLanding) {
    return <AxonLandingPage onEnter={handleEnterFromLanding} />;
  }

  if (!isLoggedIn) {
    return <Login onLogin={handleLogin} globalError={globalError} />;
  }

  return (
    <>
    <div
      className="app-shell"
      onClickCapture={blockGuestMutation}
      onChangeCapture={(event) => {
        const input = event.target as HTMLInputElement;
        if (isGuest && input.type === 'file') {
          event.stopPropagation();
          input.value = '';
          requestAccessLogin();
        }
      }}
    >
      {/* Sidebar */}
      <aside className="app-sidebar">
        <div className="app-sidebar-brand flex items-center gap-3 px-5 py-5">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-red-600 text-white shadow-sm">
            <Droplets size={19} />
          </div>
          <h1 className="text-base font-semibold tracking-wide text-white">数智化注采管理系统</h1>
        </div>
        
        <nav className="mt-4 flex-1">
        {sidebarNavigationGroups.map((group) => {
          const expanded = expandedSidebarGroup === group.key;

          return (
            <div key={group.key} className="mx-3 mb-2 overflow-hidden rounded-lg border border-white/5 bg-white/[0.025]">
              <button
                type="button"
                onClick={() => setExpandedSidebarGroup(expanded ? null : group.key)}
                className="flex w-full items-center justify-between px-4 py-3.5 text-left text-sm font-medium text-slate-300 transition-colors hover:bg-white/[0.05] hover:text-white"
              >
                <span>{group.label}</span>
                <ChevronRight size={16} className={cn('transition-transform', expanded && 'rotate-90')} />
              </button>
              {expanded && group.items.map((item) => (
                <SidebarItem
                  key={item.tab}
                  icon={sidebarIconMap[item.icon]}
                  label={item.label}
                  active={activeTab === item.tab}
                  onClick={() => setActiveTab(item.tab)}
                />
              ))}
            </div>
          );
        })}
        <SidebarItem
          icon={sidebarIconMap[runtimeLogNavigationItem.icon]}
          label={runtimeLogNavigationItem.label}
          active={activeTab === runtimeLogNavigationItem.tab}
          onClick={() => setActiveTab(runtimeLogNavigationItem.tab)}
        />

        <div className="mt-auto border-t border-white/10 pt-4">
        <div className="px-5 py-3 flex items-center gap-3 text-gray-400">
        <div className="w-8 h-8 rounded-full bg-blue-600 flex items-center justify-center text-white font-bold text-xs shadow-inner">
        {user?.name?.[0] || 'A'}
        </div>
        <div className="flex-1 overflow-hidden">
        <p className="text-sm font-medium text-white truncate">{user?.name || '系统管理员'}</p>
        <p className="text-[10px] text-gray-500 truncate tracking-tighter">{user?.role === 'admin' ? '系统管理员' : user?.role === 'guest' ? '访客浏览' : '系统用户'}</p>
        </div>
        </div>
        {isGuest && <SidebarItem icon={LogIn} label="系统登录" onClick={requestAccessLogin} />}
        <SidebarItem 
        icon={LogIn} 
        label="退出系统" 
        onClick={handleLogout} 
        />
        </div>
        </nav>

        <div className="border-t border-white/10 bg-slate-950/80 p-4">
        <div className="flex items-center gap-3 text-[#95A5A6] text-xs">
        <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse"></div>
        <span>系统运行正常</span>
        </div>
        </div>
      </aside>

      {/* Main Content */}
      <div className="app-main">
        {/* Header */}
        <header className="app-header">
          <div className="flex items-center gap-3">
          <Menu className="text-gray-400" size={20} />
          <h2 className="text-gray-700 font-bold text-lg">
          {activeTab === 'externalTransferTracking' && '外输跟踪'}
          {activeTab === 'dashboard' && '系统概览'}
          {activeTab === 'injectionProductionCockpit' && '注采驾驶舱'}
          {activeTab === 'oilWellMap' && '油井位图'}
          {activeTab === 'block' && '区块生产动态生成器'}
          {activeTab === 'well' && '单井精细化动态分析'}
          {activeTab === 'analysis' && '重点情况分析与建议'}
          {activeTab === 'comparison' && '对比分析'}
          {activeTab === 'measureWellSelection' && '措施选井'}
          {activeTab === 'injectionProjectManagement' && '注汽项目管理'}
          {activeTab === 'measures' && '措施跟踪'}
          {activeTab === 'measureAnalysis' && '措施分析'}
          {activeTab === 'wellTemperature' && '井温监控'}
          {activeTab === 'occupancyAnalysis' && '占产分析'}
          {activeTab === 'pumpAnalysis' && '检泵跟踪'}
          {activeTab === 'pumpDeepAnalysis' && '检泵分析'}
          {activeTab === 'waterLab' && '含水化验'}
          {activeTab === 'productionForecast' && '产量预测'}
          {activeTab === 'runtimeLogs' && '运行日志'}
          </h2>
          </div>
          <div className="flex min-w-0 items-center gap-4">
          <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={16} />
          <input
          type="text"
          placeholder="搜索井号..."
          className="h-9 w-48 rounded-full border border-slate-200 bg-slate-100 pl-10 pr-4 text-sm outline-none transition-all focus:border-[#D32F2F] focus:ring-2 focus:ring-red-500/10"
          value={wellSearch}
          onChange={(e) => {
          setWellSearch(e.target.value);
          setActiveTab('well');
          }}
          />
          </div>
          <div className="flex items-center gap-3 border-l border-slate-200 pl-4">
          <div className="w-8 h-8 rounded-full bg-[#D32F2F] flex items-center justify-center text-white text-xs font-bold">油</div>
          <span className="text-sm font-medium text-gray-700">措施班组</span>
          </div>
          </div>
        </header>
        <main className="app-content">
              {activeTab === 'measureWellSelection' && <MeasureWellSelection />}
              {activeTab === 'injectionProjectManagement' && <InjectionProjectManagement />}
              {activeTab === 'injectionProductionCockpit' && <InjectionProductionCockpit onNavigate={async (tab, filters = {}) => {
                setMeasureQuery((current) => ({ ...current, keyword: filters.keyword || '', block: filters.block || '' }));
                if (filters.alertType) {
                  try {
                    const result = await fetchJson('/api/injection-production/cockpit');
                    const cockpit = result.data as InjectionProductionCockpitData;
                    setMeasureCockpitAlertFilter({ type: filters.alertType, alerts: cockpit.alerts || [] });
                  } catch {
                    setMeasureCockpitAlertFilter({ type: filters.alertType, alerts: [] });
                  }
                } else {
                  setMeasureCockpitAlertFilter(null);
                }
                setActiveTab(tab);
              }} />}
              {activeTab === 'oilWellMap' && <OilWellMap isAdmin={user?.role === 'admin'} />}
              {activeTab === 'externalTransferTracking' && <ExternalTransferTracking />}
              {activeTab === 'runtimeLogs' && (
                <div className="page-stack">
                  <div className="app-card overflow-hidden border-t-4 border-t-slate-600">
                    <div className="app-card-header">
                      <h3 className="text-lg font-bold text-slate-900">运行日志</h3>
                      <p className="mt-1 text-sm text-slate-500">查看本地数据同步与首页缓存状态</p>
                    </div>
                    <div className="grid grid-cols-1 gap-px bg-slate-100 md:grid-cols-2">
                      <div className="bg-white p-5">
                        <div className="text-sm text-slate-500">数据更新日期</div>
                        <div className="mt-2 font-semibold text-slate-900">{syncStatus?.lastLocalDataDate || '--'}</div>
                      </div>
                      <div className="bg-white p-5">
                        <div className="text-sm text-slate-500">同步状态</div>
                        <div className={cn('mt-2 font-semibold', runtimeSyncStatus.className)}>
                          {runtimeSyncStatus.label}
                        </div>
                      </div>
                      <div className="bg-white p-5">
                        <div className="text-sm text-slate-500">缓存预热</div>
                        <div className={cn('mt-2 font-semibold', cacheInfo.cacheWarm ? 'text-emerald-600' : 'text-amber-600')}>
                          {cacheInfo.cacheWarm ? '已预热' : dashboardBootstrapLoading ? '预热中' : '未预热'}
                        </div>
                      </div>
                      <div className="bg-white p-5">
                        <div className="text-sm text-slate-500">缓存来源</div>
                        <div className="mt-2 font-semibold text-slate-900">{cacheSourceText}</div>
                      </div>
                    </div>
                  </div>
                  {syncStatus?.lastError && (
                    <div className="app-card border border-red-200 bg-red-50 p-5">
                      <h3 className="font-bold text-red-800">同步错误详情</h3>
                      <pre className="mt-3 whitespace-pre-wrap break-words font-sans text-sm text-red-700">{syncStatus.lastError}</pre>
                    </div>
                  )}
                </div>
              )}
              {activeTab === 'dashboard' && (
                <div className="page-stack animate-in fade-in duration-500">
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
                    {showDashboardSkeleton ? (
                      <>
                        <DashboardStatCardSkeleton />
                        <DashboardStatCardSkeleton />
                        <DashboardStatCardSkeleton />
                        <DashboardStatCardSkeleton />
                      </>
                    ) : (
                      <>
                        <StatCard title="日产油" value={formatStat(latestOverall?.oil)} unit="t" icon={Droplets} color="bg-red-500" />
                        <StatCard title="日产液" value={formatStat(latestOverall?.liquid)} unit="t" icon={Activity} color="bg-blue-500" />
                        <StatCard title="综合含水" value={formatStat(latestOverall?.water_cut)} unit="%" icon={Waves} color="bg-cyan-500" />
                        <StatCard title="日产气" value={formatStat(latestOverall?.gas, 0)} unit="m3" icon={Flame} color="bg-green-500" />
                      </>
                    )}
                  </div>

                  <div className="app-card flex flex-wrap items-center justify-between gap-3 border-blue-100 px-5 py-3 text-sm">
                    <div className="flex items-center gap-2 text-gray-600">
                      <Clock size={16} className="text-blue-500" />
                      <span>{syncStatus?.lastLocalDataDate ? `数据更新至 ${syncStatus.lastLocalDataDate}` : dashboardBootstrapLoading ? '正在检查本地缓存' : '等待同步数据'}</span>
                    </div>
                    <div className={cn('font-medium', syncStatus?.syncing || syncing ? 'text-blue-600' : syncStatus?.lastSyncStatus === 'error' ? 'text-red-500' : 'text-green-600')}>
                      {syncStatus?.syncing || syncing ? '同步中...' : syncStatus?.lastSyncStatus === 'error' ? '同步失败' : dashboardBootstrapLoading && !cacheInfo.cacheWarm ? '检查缓存中' : '立即同步'}
                    </div>
                  </div>

                  {showDashboardSkeleton ? (
                    <DashboardChartSkeleton title="全区趋势" />
                  ) : renderDashboardPanel(
                    'trend',
                    '全区产量走势',
                    '默认展开；按旬度平均展示本期与上轮同期产液、产油、含水、掺油、油比和产气走势。',
                    <Activity className="text-[#D32F2F]" size={20} />,
                    <div className="space-y-6">
                        <div className="grid grid-cols-1 xl:grid-cols-2 gap-4 text-sm">
                          <div className="filter-panel">
                            <div className="font-medium text-gray-700 mb-3">本期曲线</div>
                            <div className="flex flex-wrap items-center gap-3">
                              <div className="flex items-center gap-2">
                                <span className="text-gray-500">开始日期</span>
                                <input
                                  type="date"
                                  className="page-input"
                                  value={overallRange.start}
                                  max={overallRange.end}
                                  onChange={(e) => {
                                    const nextStart = e.target.value;
                                    setOverallRange(prev => ({ ...prev, start: nextStart }));
                                    setOverallCompareRange(prev => ({
                                      ...prev,
                                      start: shiftDateByYears(nextStart, -1)
                                    }));
                                  }}
                                />
                              </div>
                              <div className="flex items-center gap-2">
                                <span className="text-gray-500">结束日期</span>
                                <input
                                  type="date"
                                  className="page-input"
                                  value={overallRange.end}
                                  min={overallRange.start}
                                  max={new Date().toISOString().split('T')[0]}
                                  onChange={(e) => {
                                    const nextEnd = e.target.value;
                                    setOverallRange(prev => ({ ...prev, end: nextEnd }));
                                    setOverallCompareRange(prev => ({
                                      ...prev,
                                      end: shiftDateByYears(nextEnd, -1)
                                    }));
                                  }}
                                />
                              </div>
                            </div>
                          </div>
                          <div className="filter-panel bg-blue-50/40">
                            <div className="font-medium text-gray-700 mb-3">同期对比曲线</div>
                            <div className="flex flex-wrap items-center gap-3">
                              <div className="flex items-center gap-2">
                                <span className="text-gray-500">开始日期</span>
                                <input
                                  type="date"
                                  className="page-input"
                                  value={overallCompareRange.start}
                                  max={overallCompareRange.end}
                                  onChange={(e) => setOverallCompareRange(prev => ({ ...prev, start: e.target.value }))}
                                />
                              </div>
                              <div className="flex items-center gap-2">
                                <span className="text-gray-500">结束日期</span>
                                <input
                                  type="date"
                                  className="page-input"
                                  value={overallCompareRange.end}
                                  min={overallCompareRange.start}
                                  max={new Date().toISOString().split('T')[0]}
                                  onChange={(e) => setOverallCompareRange(prev => ({ ...prev, end: e.target.value }))}
                                />
                              </div>
                            </div>
                            <div className="mt-2 text-xs text-gray-500">默认显示上一年同期数据，可手动修改。</div>
                          </div>
                        </div>
                      {overallTenDayData && overallTenDayData.dates.length > 0 ? (
                        <div className="chart-grid">
                          <div className="chart-card">
                            <ReactECharts option={getChartOption("全区旬度平均日产液", overallPrimaryDates, overallTenDayData.liquid, "旬度平均日产液(t/d)", "#2563eb", false, overallCompareSeries.liquid, `${overallCompareRange.start} 至 ${overallCompareRange.end}`, true, true)} style={{ height: '100%' }} />
                          </div>
                          <div className="chart-card">
                            <ReactECharts option={getChartOption("全区旬度平均日产油", overallPrimaryDates, overallTenDayData.oil, "旬度平均日产油(t/d)", "#D32F2F", false, overallCompareSeries.oil, `${overallCompareRange.start} 至 ${overallCompareRange.end}`, true, true)} style={{ height: '100%' }} />
                          </div>
                          <div className="chart-card">
                            <ReactECharts option={getChartOption("全区旬度平均掺油", overallPrimaryDates, overallTenDayData.diluent, "旬度平均掺油(t/d)", "#9c27b0", false, overallCompareSeries.diluent, `${overallCompareRange.start} 至 ${overallCompareRange.end}`, true, true)} style={{ height: '100%' }} />
                          </div>
                          <div className="chart-card">
                            <ReactECharts option={getChartOption("全区旬度平均油比", overallPrimaryDates, overallDiluentRatioPercentSeries, "掺油/产油(%)", "#f97316", true, overallCompareDiluentRatioPercentSeries, `${overallCompareRange.start} 至 ${overallCompareRange.end}`, true, true)} style={{ height: '100%' }} />
                          </div>
                          <div className="chart-card">
                            <ReactECharts option={getChartOption("全区旬度平均含水", overallPrimaryDates, overallTenDayData.water_cut, "旬度平均含水(%)", "#16a34a", true, overallCompareSeries.water_cut, `${overallCompareRange.start} 至 ${overallCompareRange.end}`, true, true)} style={{ height: '100%' }} />
                          </div>
                          <div className="chart-card">
                            <ReactECharts option={getChartOption("全区旬度平均日产气", overallPrimaryDates, overallTenDayData.gas, "旬度平均日产气(m3/d)", "#facc15", false, overallCompareSeries.gas, `${overallCompareRange.start} 至 ${overallCompareRange.end}`, true, true)} style={{ height: '100%' }} />
                          </div>
                        </div>
                      ) : (
                        <div className="h-[220px] flex items-center justify-center text-gray-400 text-sm">
                          当前日期范围内暂无数据
                        </div>
                      )}
                    </div>
                  )}

                  {!showDashboardSkeleton && renderDashboardPanel(
                    'composition',
                    '全区产量构成',
                    '默认展开；展示全区产油、措施井产油、老井产油和自定义间隔平均曲线，并保留当前产液构成。',
                    <Waves className="text-[#2563eb]" size={20} />,
                    <div className="space-y-6">
                      <div className="filter-panel flex flex-wrap items-end justify-between gap-4">
                        <div>
                          <div className="text-sm font-bold text-slate-800">时间颗粒</div>
                          <p className="mt-1 text-xs text-slate-500">选择 1-100 天间隔，生成对应区间平均日产油曲线；默认 10 天。</p>
                        </div>
                        <label className="flex items-center gap-2 text-sm text-slate-600">
                          间隔天数
                          <input
                            type="number"
                            min={1}
                            max={100}
                            className="field-control w-28"
                            value={dashboardCompositionInterval}
                            onChange={(event) => {
                              const value = Number(event.target.value);
                              setDashboardCompositionInterval(Math.min(Math.max(Number.isFinite(value) ? value : 10, 1), 100));
                            }}
                          />
                        </label>
                      </div>

                      {measureAnalysisCharts.loading || measuresLoading ? (
                        <div className="empty-state flex-col gap-3 text-slate-500">
                          <div className="h-6 w-6 animate-spin rounded-full border-2 border-slate-300 border-t-[#D32F2F]"></div>
                          <span>措施井产油构成计算中...</span>
                        </div>
                      ) : dashboardOilCompositionSeries.labels.length > 0 ? (
                        <div className="space-y-5">
                          <div className="chart-card h-[380px]">
                            <ReactECharts
                              option={getDashboardOilCompositionOption(
                                dashboardOilCompositionSeries.labels,
                                dashboardOilCompositionSeries.totalOil,
                                dashboardOilCompositionSeries.measureOil,
                                dashboardOilCompositionSeries.oldWellOil
                              )}
                              style={{ height: '100%' }}
                            />
                          </div>
                          <div className="chart-card h-[360px]">
                            <ReactECharts
                              option={getDashboardOilCompositionOption(
                                dashboardOilCompositionSeries.labels,
                                dashboardOilCompositionSeries.totalOilChange,
                                dashboardOilCompositionSeries.measureOilChange,
                                dashboardOilCompositionSeries.oldWellOilChange,
                                '全区产油构成变化曲线',
                                '产油变化(t/d)',
                                true
                              )}
                              style={{ height: '100%' }}
                            />
                          </div>
                        </div>
                      ) : (
                        <div className="empty-state">暂无全区产油构成曲线数据</div>
                      )}

                      <div className="grid grid-cols-1 gap-4 md:grid-cols-4">
                        <div className="metric-card">
                          <div className="text-sm text-slate-500">日产液</div>
                          <div className="mt-2 text-2xl font-bold text-blue-700">{formatStat(latestOverall?.liquid)} <span className="text-xs text-slate-400">t</span></div>
                        </div>
                        <div className="metric-card">
                          <div className="text-sm text-slate-500">日产油</div>
                          <div className="mt-2 text-2xl font-bold text-red-700">{formatStat(latestOverall?.oil)} <span className="text-xs text-slate-400">t</span></div>
                        </div>
                        <div className="metric-card">
                          <div className="text-sm text-slate-500">产水量</div>
                          <div className="mt-2 text-2xl font-bold text-green-700">{formatStat(Math.max(Number(latestOverall?.liquid ?? 0) - Number(latestOverall?.oil ?? 0) - Number(latestOverall?.diluent ?? 0), 0))} <span className="text-xs text-slate-400">t</span></div>
                        </div>
                        <div className="metric-card">
                          <div className="text-sm text-slate-500">掺油</div>
                          <div className="mt-2 text-2xl font-bold text-purple-700">{formatStat(latestOverall?.diluent)} <span className="text-xs text-slate-400">t</span></div>
                        </div>
                      </div>

                      <div className="chart-grid">
                        <div className="chart-card h-[360px]">
                          <ReactECharts
                            option={getProductionCompositionOption(
                              '全区产液构成',
                              dashboardLiquidComposition,
                              't',
                              ['#D32F2F', '#16a34a', '#9c27b0']
                            )}
                            style={{ height: '100%' }}
                          />
                        </div>
                        <div className="chart-card h-[360px]">
                          <ReactECharts
                            option={getProductionCompositionOption(
                              '全区油掺构成',
                              dashboardOilDiluentComposition,
                              't',
                              ['#D32F2F', '#9c27b0']
                            )}
                            style={{ height: '100%' }}
                          />
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {activeTab === 'block' && (
                <div className="page-stack">
                  <div className="analysis-section">
                    <div className="section-title mb-4">区块生产动态生成器</div>
                    <div className="flex items-center gap-4 flex-wrap">
                      <select
                        multiple
                        className="min-w-[220px] h-28 rounded border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/10"
                        value={selectedChartBlocks}
                        onChange={(e) => {
                          setSelectedChartBlocks(Array.from(e.target.selectedOptions, option => option.value));
                          setBlockChartData(null);
                          setBlockChartSource(null);
                        }}
                      >
                        {chartBlocks.map(b => <option key={b} value={b}>{b}</option>)}
                      </select>
                      <div className="text-xs text-gray-500 leading-5">
                        按住 Ctrl / Shift 多选<br />
                        已选择：{selectedChartBlockLabel || '暂无'}
                      </div>
                      <button
                        onClick={() => void loadBlockChart()}
                        className="action-button action-danger"
                      >
                        生成区块曲线
                      </button>
                      {blockChartData && (
                        <button
                          onClick={exportBlockDataToExcel}
                          className="action-button action-primary"
                        >
                          <FileSpreadsheet size={16} />
                          导出 Excel
                        </button>
                      )}
                    </div>
                  </div>
              
                  {loading && activeTab === 'block' ? (
                    <div className="empty-state flex-col gap-3 text-slate-500">
                      <div className="w-6 h-6 border-2 border-gray-300 border-t-[#D32F2F] rounded-full animate-spin"></div>
                      <span>区块曲线生成中...</span>
                    </div>
                  ) : blockMonthlyData ? (
                    <div className="space-y-3">
                      {blockChartSourceText && (
                        <div className="status-banner status-banner-info">
                          {blockChartSourceText}
                        </div>
                      )}
                      <div className="chart-grid">
                        <div className="chart-card">
                          <ReactECharts option={getChartOption(`${selectedChartBlockLabel}月度平均日产液`, blockMonthlyData.dates, blockMonthlyData.liquid, "月度平均日产液(t/d)", "#2563eb", false, undefined, undefined, true, true)} style={{ height: '100%' }} />
                        </div>
                      <div className="chart-card">
                        <ReactECharts option={getChartOption(`${selectedChartBlockLabel}月度平均日产油`, blockMonthlyData.dates, blockMonthlyData.oil, "月度平均日产油(t/d)", "#D32F2F", false, undefined, undefined, true, true)} style={{ height: '100%' }} />
                      </div>
                      <div className="chart-card">
                        <ReactECharts option={getChartOption(`${selectedChartBlockLabel}月度平均含水`, blockMonthlyData.dates, blockMonthlyData.water_cut, "月度平均含水率(%)", "#16a34a", true, undefined, undefined, true, true)} style={{ height: '100%' }} />
                      </div>
                        <div className="chart-card">
                          <ReactECharts option={getChartOption(`${selectedChartBlockLabel}月度平均日产气`, blockMonthlyData.dates, blockMonthlyData.gas, "月度平均日产气(m3/d)", "#facc15", false, undefined, undefined, true, true)} style={{ height: '100%' }} />
                        </div>
                        <div className="chart-card">
                          <ReactECharts option={getChartOption(`${selectedChartBlockLabel}月度平均掺油`, blockMonthlyData.dates, blockMonthlyData.diluent, "月度平均掺油(t/d)", "#9c27b0", false, undefined, undefined, true, true)} style={{ height: '100%' }} />
                        </div>
                        <div className="chart-card">
                          <ReactECharts option={getChartOption(`${selectedChartBlockLabel}月度平均油比`, blockMonthlyData.dates, blockDiluentRatioPercentSeries, "掺油/产油(%)", "#f97316", true, undefined, undefined, true, true)} style={{ height: '100%' }} />
                        </div>
                      </div>
                    </div>
                  ) : selectedChartBlocks.length > 0 ? (
                    <div className="empty-state">
                      当前区块暂无曲线数据
                    </div>
                  ) : (
                    <div className="empty-state">
                      请先选择区块并生成曲线
                    </div>
                  )}
                </div>
              )}

              {activeTab === 'well' && (
                <div className="page-stack">
                  <div className="analysis-section">
                    <div className="section-title mb-4">单井精细化动态分析</div>
                    <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-4 gap-4 mb-5">
                      <div className="space-y-1">
                        <label className="text-xs text-gray-500">所属区块</label>
                        <select
                          className="field-control w-full"
                          value={selectedWellBlock}
                          onChange={(e) => {
                            setSelectedWellBlock(e.target.value);
                          }}
                        >
                          <option value="">全部区块</option>
                          {blocks.map(b => <option key={b} value={b}>{b}</option>)}
                        </select>
                      </div>
                      <div className="space-y-1">
                        <label className="text-xs text-gray-500">所属计量站</label>
                        <select 
                          className="field-control w-full"
                          value={selectedStation}
                          onChange={(e) => setSelectedStation(e.target.value)}
                        >
                          <option value="">全部计量站</option>
                          {stations.map(s => <option key={s} value={s}>{s}</option>)}
                        </select>
                      </div>
                      <div className="space-y-1">
                        <div className="flex justify-between items-end">
                          <label className="text-xs text-gray-500">查询时间范围</label>
                          <div className="flex gap-2">
                            <button 
                              onClick={() => setWellRange({ start: '2025-01-01', end: new Date().toISOString().split('T')[0] })}
                              className="text-[10px] text-blue-600 hover:underline"
                            >
                              近期
                            </button>
                            <button
                              onClick={() => setWellRange({ start: '2020-01-01', end: new Date().toISOString().split('T')[0] })}
                              className="text-[10px] text-blue-600 hover:underline"
                            >
                              全部历史
                            </button>
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          <input 
                            type="date" 
                            className="page-input min-w-0 flex-1 text-xs"
                            value={wellRange.start}
                            onChange={(e) => setWellRange(prev => ({ ...prev, start: e.target.value }))}
                          />
                          <span className="text-gray-400">-</span>
                          <input 
                            type="date" 
                            className="page-input min-w-0 flex-1 text-xs"
                            value={wellRange.end}
                            onChange={(e) => setWellRange(prev => ({ ...prev, end: e.target.value }))}
                          />
                        </div>
                      </div>
                      <div className="space-y-1">
                        <label className="text-xs text-gray-500">井号搜索</label>
                        <div className="relative">
                          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={14} />
                          <input 
                            type="text" 
                            placeholder="输入井号..."
                            className="field-control w-full pl-9"
                            value={wellSearch}
                            onChange={(e) => setWellSearch(e.target.value)}
                          />
                        </div>
                      </div>
                    </div>

                    <div className="max-h-[220px] overflow-y-auto rounded border border-slate-200">
                      {wellsLoading ? (
                        <div className="h-[140px] flex flex-col items-center justify-center gap-3 text-sm text-gray-500 bg-gray-50/60">
                          <div className="w-5 h-5 border-2 border-gray-300 border-t-[#D32F2F] rounded-full animate-spin"></div>
                          <span>井列表加载中...</span>
                        </div>
                      ) : (
                        <table
                          className="measure-table w-full text-left text-sm"
                          onClick={(event) => {
                            const header = (event.target as HTMLElement).closest('th');
                            if (header && [12, 13, 14].includes(header.cellIndex)) {
                              setMeasureEvaluationSorted(true);
                            }
                          }}
                        >
                          <thead>
                            <tr>
                              <th>井号</th>
                              <th>区块</th>
                              <th>计量站</th>
                              <th>操作</th>
                            </tr>
                          </thead>
                          <tbody>
                            {filteredWells.length > 0 ? filteredWells.map(w => (
                              <tr key={w.jh} className={cn(selectedWell === w.jh && "bg-blue-50")}>
                                <td className="font-medium">{w.jh}</td>
                                <td className="text-gray-500">{w.block}</td>
                                <td className="text-gray-500">{w.station}</td>
                                <td>
                                  <button
                                    onClick={() => loadWellChart(w.jh)}
                                    className="text-[#004a99] font-bold hover:underline"
                                  >
                                    分析动态
                                  </button>
                                </td>
                              </tr>
                            )) : (
                              <tr>
                                <td colSpan={4} className="px-4 py-8 text-center text-gray-400">
                                  {wellsLoaded ? '暂无匹配井号' : '请输入井号或切换页面后加载井列表'}
                                </td>
                              </tr>
                            )}
                          </tbody>
                        </table>
                      )}
                    </div>
                  </div>
              
                  {loading && activeTab === 'well' && selectedWell ? (
                    <div className="empty-state flex-col gap-3 text-slate-500">
                      <div className="w-6 h-6 border-2 border-gray-300 border-t-[#D32F2F] rounded-full animate-spin"></div>
                      <span>单井曲线加载中...</span>
                    </div>
                  ) : wellChartData ? (
                    <div className="space-y-3">
                      {wellChartSourceText && (
                        <div className="status-banner border-emerald-100 bg-emerald-50 text-emerald-700">
                          {wellChartSourceText}
                        </div>
                      )}
                      <div className="chart-grid">
                        <div className="chart-card">
                          <ReactECharts option={getChartOption(`${selectedWell} 日产液`, wellChartData.dates, wellChartData.liquid, "日产液(t)", "#2563eb")} style={{ height: '100%' }} />
                        </div>
                      <div className="chart-card">
                        <ReactECharts option={getOilDiluentOption(`${selectedWell} 产油/掺油`, wellChartData.dates, wellChartData.oil, wellChartData.diluent)} style={{ height: '100%' }} />
                      </div>
                      <div className="chart-card">
                        <ReactECharts option={getChartOption(`${selectedWell} 含水`, wellChartData.dates, wellChartData.water_cut, "含水率(%)", "#16a34a", true)} style={{ height: '100%' }} />
                      </div>
                        <div className="chart-card">
                          <ReactECharts option={getChartOption(`${selectedWell} 日产气`, wellChartData.dates, wellChartData.gas, "日产气(m3)", "#facc15")} style={{ height: '100%' }} />
                        </div>
                      </div>
                    </div>
                  ) : selectedWell ? (
                    <div className="empty-state">
                      当前井号暂无曲线数据
                    </div>
                  ) : (
                    <div className="empty-state">
                      请先选择井号查看单井曲线
                    </div>
                  )}
                </div>
              )}

              {activeTab === 'analysis' && (
                <div className="page-stack">
                  {/* Summary Stats */}
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                    <div className="app-card border-l-4 border-l-[#D32F2F] p-4">
                      <p className="text-sm text-gray-500">全区总井数</p>
                      <p className="text-2xl font-bold">{analysisData?.summary?.total_wells ?? '--'}</p>
                    </div>
                    <div className="app-card border-l-4 border-l-[#FF9800] p-4">
                      <p className="text-sm text-gray-500">异常待排查井</p>
                      <p className="text-2xl font-bold">{analysisData?.summary?.abnormal_wells ?? '--'}</p>
                    </div>
                    <div className="app-card border-l-4 border-l-[#4CAF50] p-4">
                      <p className="text-sm text-gray-500">预计增产空间</p>
                      <p className="text-2xl font-bold">{analysisData?.summary?.potential_gain || '--'}</p>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                    {/* Pie Chart */}
                    <div className="analysis-section border-t-[#facc15]">
                      <div className="flex justify-between items-center mb-4">
                        <h3 className="text-lg font-bold">含水分布诊断</h3>
                        <button 
                          onClick={loadAnalysisChart}
                          className="action-button action-danger h-8 px-3 text-xs"
                        >
                          刷新诊断
                        </button>
                      </div>
                      <div className="h-[400px]">
                        {analysisData ? (
                          <ReactECharts option={getPieOption()} style={{ height: '100%' }} />
                        ) : (
                          <div className="h-full flex items-center justify-center text-gray-400 text-sm">
                            正在加载实时诊断...
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Top Problematic Wells Table */}
                    <div className="analysis-section">
                      <h3 className="text-lg font-bold mb-4 flex items-center gap-2">
                        <AlertTriangle className="text-[#D32F2F]" size={20} />
                        特高含水井 Top 10
                      </h3>
                      <div className="overflow-x-auto">
                        <table
                          className="measure-table w-full text-left text-sm"
                          onClick={(event) => {
                            const header = (event.target as HTMLElement).closest('th');
                            if (header?.cellIndex === 13) {
                              setMeasureEvaluationSorted(true);
                            }
                          }}
                        >
                          <thead>
                            <tr>
                              <th>井号</th>
                              <th>含水率(%)</th>
                              <th>日产油(t)</th>
                              <th>日产液(t)</th>
                            </tr>
                          </thead>
                          <tbody>
                            {(analysisData?.top_water_cut_wells ?? []).map((w, i) => (
                              <tr key={i}>
                                <td className="font-medium">{w.jh}</td>
                                <td className="text-red-600 font-bold">{w.water_cut}%</td>
                                <td>{w.oil}</td>
                                <td>{w.liquid}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  </div>

                  {/* Decline Warnings & Recommendations */}
                  <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                    <div className="analysis-section lg:col-span-2 border-t-[#2563eb]">
                      <h3 className="text-lg font-bold mb-4 flex items-center gap-2">
                        <TrendingUp className="text-[#004a99]" size={20} />
                        产量递减异常预警
                      </h3>
                      <div className="space-y-4">
                        {(analysisData?.decline_warnings ?? []).map((w, i) => (
                          <div key={i} className="p-4 bg-blue-50 rounded-lg border-l-4 border-l-[#004a99] flex flex-col md:flex-row md:items-center justify-between gap-4">
                            <div>
                              <div className="flex items-center gap-2 mb-1">
                                <span className="font-bold text-gray-900">{w.jh}</span>
                                <span className="text-xs bg-orange-100 text-orange-600 px-2 py-0.5 rounded font-bold">递减率 {w.decline_rate}</span>
                              </div>
                              <p className="text-sm text-gray-600"><span className="font-medium">可能原因：</span> {w.reason}</p>
                            </div>
                            <div className="bg-white p-3 rounded border border-blue-100 min-w-[200px]">
                              <p className="text-xs font-bold text-[#004a99] mb-1">专家建议</p>
                              <p className="text-sm text-gray-700">{w.suggestion}</p>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>

                    <div className="analysis-section border-t-[#10b981]">
                      <h3 className="text-lg font-bold mb-4 flex items-center gap-2">
                        <Activity className="text-[#10b981]" size={20} />
                        重点措施建议
                      </h3>
                      <div className="p-3 bg-gray-50 rounded border border-gray-100">
                        <p className="text-sm text-gray-600">暂无真实措施建议数据。</p>
                      </div>
                    </div>
                  </div>
                </div>
              )}
              {activeTab === 'comparison' && (
                <div className="page-stack">
                  <div className="app-card overflow-hidden border-t-4 border-t-[#D32F2F]">
                    <div className="border-b border-slate-100 px-6 py-4">
                      <h3 className="text-lg font-bold text-slate-900">对比分析条件</h3>
                      <p className="mt-1 text-sm text-slate-500">选择基准期、对比期和计量站范围后生成两期生产动态差异。</p>
                    </div>
                    <div className="grid grid-cols-1 gap-5 p-6 xl:grid-cols-[1fr_1fr_240px]">
                      <div className="rounded-lg border border-slate-100 bg-slate-50 p-4">
                        <div className="mb-3 text-sm font-bold text-slate-800">阶段 A（基准期）</div>
                        <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2">
                          <input
                            type="date"
                            className="field-control w-full"
                            value={compareRanges.rangeA.start}
                            onChange={e => setCompareRanges({...compareRanges, rangeA: {...compareRanges.rangeA, start: e.target.value}})}
                          />
                          <span className="text-sm text-slate-400">至</span>
                          <input
                            type="date"
                            className="field-control w-full"
                            value={compareRanges.rangeA.end}
                            onChange={e => setCompareRanges({...compareRanges, rangeA: {...compareRanges.rangeA, end: e.target.value}})}
                          />
                        </div>
                      </div>
                      <div className="rounded-lg border border-slate-100 bg-slate-50 p-4">
                        <div className="mb-3 text-sm font-bold text-slate-800">阶段 B（对比期）</div>
                        <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2">
                          <input
                            type="date"
                            className="field-control w-full"
                            value={compareRanges.rangeB.start}
                            onChange={e => setCompareRanges({...compareRanges, rangeB: {...compareRanges.rangeB, start: e.target.value}})}
                          />
                          <span className="text-sm text-slate-400">至</span>
                          <input
                            type="date"
                            className="field-control w-full"
                            value={compareRanges.rangeB.end}
                            onChange={e => setCompareRanges({...compareRanges, rangeB: {...compareRanges.rangeB, end: e.target.value}})}
                          />
                        </div>
                      </div>
                      <div className="rounded-lg border border-slate-100 bg-slate-50 p-4">
                        <div className="mb-3 text-sm font-bold text-slate-800">计量站范围</div>
                        <select
                          multiple
                          className="field-control h-24 w-full"
                          value={selectedStations}
                          onChange={e => setSelectedStations(Array.from(e.target.selectedOptions, option => option.value))}
                        >
                          {stations.map(s => <option key={s} value={s}>{s}</option>)}
                        </select>
                      </div>
                    </div>
                    <div className="flex flex-wrap items-center justify-between gap-4 border-t border-slate-100 bg-slate-50 px-6 py-4">
                      <p className="max-w-3xl text-sm leading-6 text-slate-500">
                        <strong className="text-slate-700">性能提示：</strong>
                        首次使用或数据更新后先同步本地数据，可减少远程数据库压力并提升分析速度。
                      </p>
                      <div className="flex flex-wrap gap-3">
                        <button
                          onClick={loadTodayYesterdayCompare}
                          disabled={loading}
                          className="action-button action-primary"
                        >
                          <Clock className="w-4 h-4" />
                          今日/昨日对比
                        </button>
                        <button
                          onClick={() => void loadCompareData()}
                          disabled={loading}
                          className="action-button action-danger"
                        >
                          {loading ? "分析中..." : "开始分析"}
                        </button>
                        {compareResults.length > 0 && (
                          <button
                            onClick={exportToExcel}
                            className="action-button action-primary"
                          >
                            <FileSpreadsheet className="w-4 h-4" />
                            导出 Excel
                          </button>
                        )}
                        <button
                          onClick={syncData}
                          disabled={syncing}
                          className="action-button action-outline"
                        >
                          <Database className="w-4 h-4" />
                          {syncing ? "同步中..." : "同步本地数据"}
                        </button>
                      </div>
                    </div>
                  </div>

                  {compareSummary && (
                    <div className="space-y-4">
                      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-6 gap-4">
                        <div className="app-card border-l-4 border-l-blue-500 p-4">
                          <p className="text-sm text-gray-500">油井净变化</p>
                          <p className="text-2xl font-bold text-gray-900">{formatDiffText(compareSummary.totalWellDiff)}</p>
                        </div>
                        <div className="app-card border-l-4 border-l-green-500 p-4">
                          <p className="text-sm text-gray-500">日产液差</p>
                          <p className="text-2xl font-bold text-gray-900">{formatDiffText(compareSummary.totalLiquidDiff)}</p>
                        </div>
                        <div className="app-card border-l-4 border-l-red-500 p-4">
                          <p className="text-sm text-gray-500">日产油差</p>
                          <p className="text-2xl font-bold text-gray-900">{formatDiffText(compareSummary.totalOilDiff)}</p>
                        </div>
                        <div className="app-card border-l-4 border-l-emerald-500 p-4">
                          <p className="text-sm text-gray-500">新开井</p>
                          <p className="text-2xl font-bold text-gray-900">{compareSummary.openWellCount}</p>
                        </div>
                        <div className="app-card border-l-4 border-l-amber-500 p-4">
                          <p className="text-sm text-gray-500">关井</p>
                          <p className="text-2xl font-bold text-gray-900">{compareSummary.closedWellCount}</p>
                        </div>
                        <div className="app-card border-l-4 border-l-purple-500 p-4">
                          <p className="text-sm text-gray-500">增减产井</p>
                          <p className="text-2xl font-bold text-gray-900">{compareSummary.incrementWellCount + compareSummary.decrementWellCount}</p>
                        </div>
                      </div>
                      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
                        <CompareTypeTable title="新开井类型" rows={compareSummary.openWellTypes} />
                        <CompareTypeTable title="关井类型" rows={compareSummary.closedWellTypes} />
                        <CompareTypeTable title="增产井类型" rows={compareSummary.incrementTypes} />
                        <CompareTypeTable title="减产井类型" rows={compareSummary.decrementTypes} />
                      </div>
                    </div>

                  )}

                  {largeChangeData && largeChangeData.rows.length > 0 && (
                    <div className="app-card overflow-hidden">
                      <div className="p-4 border-b border-gray-100 bg-gray-50 flex flex-wrap items-center justify-between gap-3">
                        <h3 className="font-bold text-gray-800">大幅变化井汇总（共 {largeChangeData.count} 口）</h3>
                        <div className="flex flex-wrap gap-4 text-sm text-gray-600">
                          <span>日产液合计 {formatDiffText(largeChangeData.totalLiquidDiff)}</span>
                          <span>日产油合计 {formatDiffText(largeChangeData.totalOilDiff)}</span>
                          <span>掺油合计 {formatDiffText(largeChangeData.totalDiluentDiff)}</span>
                        </div>
                      </div>
                      <div className="overflow-x-auto">
                        <table className="w-full text-sm text-left">
                          <thead className="bg-gray-100 text-gray-700 uppercase text-xs font-bold">
                            <tr>
                              <th className="px-4 py-3 border-b">井号</th>
                              <th className="px-4 py-3 border-b">计量站</th>
                              <th className="px-4 py-3 border-b">区块</th>
                              <th className="px-4 py-3 border-b text-center">日产液差</th>
                              <th className="px-4 py-3 border-b text-center">日产油差</th>
                              <th className="px-4 py-3 border-b text-center">掺油差</th>
                              <th className="px-4 py-3 border-b text-center">含水差</th>
                              <th className="px-4 py-3 border-b">备注</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-gray-100">
                            {largeChangeData.rows.map((row) => (
                              <tr key={`${row.jh}-${row.oilDiff}`} className="hover:bg-gray-50">
                                <td className="px-4 py-3 font-bold text-gray-900">{row.jh}</td>
                                <td className="px-4 py-3 text-gray-500">{row.station}</td>
                                <td className="px-4 py-3 text-gray-500">{row.block}</td>
                                <td className="px-4 py-3 text-center">{formatDiffText(row.liquidDiff)}</td>
                                <td className="px-4 py-3 text-center font-bold">{formatDiffText(row.oilDiff)}</td>
                                <td className="px-4 py-3 text-center">{formatDiffText(row.diluentDiff)}</td>
                                <td className="px-4 py-3 text-center">{formatDiffText(row.waterDiff, '%')}</td>
                                <td className="px-4 py-3 text-gray-600">{row.note || '正常波动'}</td>
                              </tr>
                            ))}
                            <tr className="bg-gray-50 font-bold text-gray-800">
                              <td className="px-4 py-3" colSpan={3}>合计（{largeChangeData.count} 口）</td>
                              <td className="px-4 py-3 text-center">{formatDiffText(largeChangeData.totalLiquidDiff)}</td>
                              <td className="px-4 py-3 text-center">{formatDiffText(largeChangeData.totalOilDiff)}</td>
                              <td className="px-4 py-3 text-center">{formatDiffText(largeChangeData.totalDiluentDiff)}</td>
                              <td className="px-4 py-3 text-center">--</td>
                              <td className="px-4 py-3">--</td>
                            </tr>
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}

                  {compareResults.length > 0 && (
                    <div className="app-card overflow-hidden">
                      <div className="p-4 border-b border-gray-100 bg-gray-50 flex justify-between items-center">
                        <h3 className="font-bold text-gray-800">对比分析结果（共 {compareResults.length} 口井）</h3>
                        <div className="flex gap-4 text-sm">
                          <span className="bg-green-100 text-green-700 px-3 py-1 rounded-full font-bold">增产: {compareResults.filter(r => (r.diff?.oil ?? 0) > 0).length}</span>
                          <span className="bg-red-100 text-red-700 px-3 py-1 rounded-full font-bold">减产: {compareResults.filter(r => (r.diff?.oil ?? 0) < 0).length}</span>
                        </div>
                      </div>
                      <div className="overflow-x-auto">
                        <table className="w-full text-sm text-left">
                          <thead className="bg-gray-100 text-gray-700 uppercase text-xs font-bold">
                            <tr>
                              <th className="px-4 py-3 border-b">井号</th>
                              <th className="px-4 py-3 border-b">计量站</th>
                              <th className="px-4 py-3 border-b">区块</th>
                              <th className="px-4 py-3 border-b text-center bg-blue-50/50">A_日产油</th>
                              <th className="px-4 py-3 border-b text-center bg-green-50/50">B_日产油</th>
                              <th className="px-4 py-3 border-b text-center">日产油差</th>
                              <th className="px-4 py-3 border-b text-center">日产液差</th>
                              <th className="px-4 py-3 border-b text-center">含水差</th>
                              <th className="px-4 py-3 border-b">诊断备注</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-gray-100">
                            {[...compareResults].sort((a, b) => (b.diff?.oil ?? 0) - (a.diff?.oil ?? 0)).map((row, idx) => (
                              <tr key={idx} className="hover:bg-gray-50 transition-colors">
                                <td className="px-4 py-3 font-bold text-gray-900">{row.jh}</td>
                                <td className="px-4 py-3 text-gray-500">{row.station}</td>
                                <td className="px-4 py-3 text-gray-500">{row.block}</td>
                                <td className="px-4 py-3 text-center text-blue-600">{row.avgA?.oil ?? 0}</td>
                                <td className="px-4 py-3 text-center text-green-600">{row.avgB?.oil ?? 0}</td>
                                <td className={cn(
                                  "px-4 py-3 text-center font-bold",
                                  (row.diff?.oil ?? 0) >= 1 ? "text-green-600 bg-green-50" :
                                  (row.diff?.oil ?? 0) <= -1 ? "text-red-600 bg-red-50" : ""
                                )}>
                                  {formatDiffText(row.diff?.oil ?? 0)}
                                </td>
                                <td className="px-4 py-3 text-center">{formatDiffText(row.diff?.liquid ?? 0)}</td>
                                <td className="px-4 py-3 text-center">{formatDiffText(row.diff?.water_cut ?? 0, '%')}</td>
                                <td className="px-4 py-3">
                                  <span className={cn(
                                    "px-2 py-1 rounded text-xs font-medium",
                                    row.note?.includes("增产") ? "bg-green-100 text-green-700" :
                                    row.note?.includes("减产") ? "bg-red-100 text-red-700" :
                                    row.note?.includes("掺油") ? "bg-blue-100 text-blue-700" :
                                    "bg-gray-100 text-gray-600"
                                  )}>
                                    {row.note || "正常波动"}
                                  </span>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {activeTab === 'wellTemperature' && (
                <div className="page-stack">
                  <div className="app-card flex flex-wrap items-center justify-between gap-4 p-6">
                    <div>
                      <h3 className="text-lg font-bold text-slate-900">井温监控</h3>
                      <p className="mt-1 text-sm text-slate-500">上传井温测试 xlsx 文件，查看温度、压力随井深变化及射孔段。</p>
                    </div>
                    <div>
                      <button
                        type="button"
                        className={cn('action-button action-primary', wellTemperatureImporting && 'pointer-events-none opacity-60')}
                        onClick={() => wellTemperatureImportInputRef.current?.click()}
                      >
                        <FileSpreadsheet className="h-4 w-4" />
                        {wellTemperatureImporting ? '导入中...' : '上传 xlsx'}
                      </button>
                      <input
                        ref={wellTemperatureImportInputRef}
                        type="file"
                        accept=".xlsx"
                        className="hidden"
                        onChange={(event) => {
                          const file = event.target.files?.[0];
                          if (file) void importWellTemperatureTest(file);
                        }}
                      />
                    </div>
                  </div>

                  {wellTemperatureError && (
                    <div className="rounded-lg border border-red-100 bg-red-50 px-4 py-3 text-sm text-red-700">{wellTemperatureError}</div>
                  )}

                  <div className="grid grid-cols-1 gap-5 xl:grid-cols-[320px_minmax(0,1fr)]">
                    <div className="app-card p-5">
                      <div className="flex gap-2">
                        <input
                          value={wellTemperatureWellFilter}
                          onChange={(event) => setWellTemperatureWellFilter(event.target.value)}
                          onKeyDown={(event) => { if (event.key === 'Enter') void loadWellTemperatureTests(); }}
                          placeholder="按井号筛选"
                          className="h-9 min-w-0 flex-1 rounded-lg border border-slate-200 px-3 text-sm outline-none focus:border-emerald-500"
                        />
                        <button type="button" className="action-button action-outline" onClick={() => void loadWellTemperatureTests()}>筛选</button>
                      </div>
                      <div className="mt-4 space-y-2">
                        {wellTemperatureLoading && wellTemperatureTests.length === 0 ? (
                          <div className="py-10 text-center text-sm text-slate-500">井温记录加载中...</div>
                        ) : wellTemperatureTests.length === 0 ? (
                          <div className="py-10 text-center text-sm text-slate-400">暂无井温记录</div>
                        ) : wellTemperatureTests.map((item) => (
                          <div key={item.id} className={cn('rounded-lg border p-3', selectedWellTemperatureId === item.id ? 'border-emerald-300 bg-emerald-50' : 'border-slate-100 hover:bg-slate-50')}>
                            <div className="flex items-start justify-between gap-2">
                              <button type="button" className="min-w-0 flex-1 text-left" onClick={() => void loadWellTemperatureTestDetail(item.id)}>
                                <div className="font-bold text-slate-900">{item.wellNo}</div>
                                <div className="mt-1 text-xs text-slate-500">{item.testDate} · {item.pointCount} 点</div>
                              </button>
                              <button type="button" className="text-xs font-medium text-red-600 hover:text-red-700" onClick={() => void deleteWellTemperatureTest(item.id)}>删除</button>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>

                    <div className="space-y-5">
                      {wellTemperatureLoading && !selectedWellTemperatureTest ? (
                        <div className="app-card flex h-[480px] items-center justify-center text-sm text-slate-500">井温详情加载中...</div>
                      ) : !selectedWellTemperatureTest ? (
                        <div className="app-card flex h-[480px] items-center justify-center text-sm text-slate-400">请选择一条井温记录查看曲线</div>
                      ) : (
                        <>
                          <div className="app-card p-5">
                            <div className="flex flex-wrap items-center justify-between gap-3">
                              <div>
                                <h3 className="text-lg font-bold text-slate-900">{selectedWellTemperatureTest.wellNo} 井温测试</h3>
                                <p className="mt-1 text-sm text-slate-500">测试日期：{selectedWellTemperatureTest.testDate} · 数据点：{selectedWellTemperatureTest.pointCount}</p>
                              </div>
                              <div className="text-sm text-slate-600">射孔段：{selectedWellTemperatureTest.perforationTopDepth ?? '--'} m - {selectedWellTemperatureTest.perforationBottomDepth ?? '--'} m</div>
                            </div>
                          </div>
                          <div className="grid grid-cols-1 gap-5 2xl:grid-cols-2">
                            <div className="app-card p-4"><ReactECharts option={getWellTemperatureChartOption('温度-井深曲线', '温度', '℃', '#ef4444', selectedWellTemperatureTest.points, 'temperature', selectedWellTemperatureTest.perforationTopDepth, selectedWellTemperatureTest.perforationBottomDepth)} style={{ height: 420 }} /></div>
                            <div className="app-card p-4"><ReactECharts option={getWellTemperatureChartOption('压力-井深曲线', '压力', 'MPa', '#2563eb', selectedWellTemperatureTest.points, 'pressure', selectedWellTemperatureTest.perforationTopDepth, selectedWellTemperatureTest.perforationBottomDepth)} style={{ height: 420 }} /></div>
                          </div>
                        </>
                      )}
                    </div>
                  </div>
                </div>
              )}

              {activeTab === 'measureAnalysis' && (
                <div className="page-stack">
                  <div className="app-card p-6">
                    <div className="flex flex-wrap items-center justify-between gap-4">
                      <div>
                        <h3 className="text-lg font-bold text-slate-900">措施分析</h3>
                        <p className="mt-1 text-sm text-slate-500">
                          按 A/B/C/D 措施评价分类汇总当前措施井，支持快速进入对应类别曲线分析。
                        </p>
                        <p className="mt-2 rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-600">
                          分级规则：A ≥ 100%，B 80%–99.9%，C 60%–79.9%，D &lt; 60%；无上轮同期数据时暂不参与自动分级。当前口径跟随“措施累产油 / 措施累增油”切换。
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => setActiveTab('measures')}
                        className="action-button action-outline"
                      >
                        返回措施跟踪
                      </button>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
                    <div className="app-card p-5">
                      {measuresLoading ? (
                        <div className="flex h-[320px] items-center justify-center text-sm text-slate-500">措施数据加载中...</div>
                      ) : (
                        <ReactECharts
                          option={getMeasureSharePieOption('A/B/C/D 油井数占比', measureAnalysisWellSharePie, '口')}
                          style={{ height: 320 }}
                        />
                      )}
                    </div>
                    <div className="app-card p-5">
                      {measuresLoading ? (
                        <div className="flex h-[320px] items-center justify-center text-sm text-slate-500">措施数据加载中...</div>
                      ) : (
                        <ReactECharts
                          option={getMeasureSharePieOption('A/B/C/D 产油量占比', measureAnalysisOilSharePie, 't')}
                          style={{ height: 320 }}
                        />
                      )}
                    </div>
                  </div>

                  <div className="grid grid-cols-1 gap-4 xl:grid-cols-4">
                    {measureAnalysisRows.map((item) => (
                      <div key={item.evaluation} className="app-card p-5">
                        <div className="mb-4 flex items-center justify-between">
                          <div className="text-lg font-black text-slate-900">{item.evaluation} 类</div>
                          <button
                            type="button"
                            onClick={() => void openMeasureClassAnalysis(item.evaluation)}
                            className="cursor-pointer rounded-full bg-emerald-50 px-3 py-1 text-xs font-bold text-emerald-700 ring-1 ring-emerald-100 hover:bg-emerald-100"
                          >
                            查看曲线
                          </button>
                        </div>
                        <div className="grid grid-cols-2 gap-3 text-sm">
                          <div className="rounded bg-slate-50 p-3">
                            <div className="text-slate-500">井数</div>
                            <div className="mt-1 text-xl font-bold text-slate-900">{item.count}</div>
                          </div>
                          <div className="rounded bg-emerald-50 p-3">
                            <div className="text-emerald-700">生产井</div>
                            <div className="mt-1 text-xl font-bold text-emerald-800">{item.productionCount}</div>
                          </div>
                          <div className="rounded bg-blue-50 p-3">
                            <div className="text-blue-700">目前液</div>
                            <div className="mt-1 font-bold text-blue-900">{formatChartNumber(item.currentLiquid)} t</div>
                          </div>
                          <div className="rounded bg-red-50 p-3">
                            <div className="text-red-700">目前油</div>
                            <div className="mt-1 font-bold text-red-900">{formatChartNumber(item.currentOil)} t</div>
                          </div>
                          <div className="rounded bg-slate-50 p-3">
                            <div className="text-slate-500">本轮累产油</div>
                            <div className="mt-1 font-bold text-slate-900">{formatChartNumber(item.cumulativeOil)} t</div>
                          </div>
                          <div className="rounded bg-slate-50 p-3">
                            <div className="text-slate-500">上轮同期</div>
                            <div className="mt-1 font-bold text-slate-900">{formatChartNumber(item.previousCumulativeOil)} t</div>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>

                  {renderMeasureAnalysisPanel(
                    'all-curves',
                    '所有措施井本轮 / 上轮同期曲线',
                    `默认折叠；横坐标为 ${measureAnalysisCharts.currentData?.dates[0] || measureAnalysisCharts.currentRange?.start || '2026-01-01'} 至 ${measureAnalysisCharts.currentData?.dates[measureAnalysisCharts.currentData.dates.length - 1] || syncStatus?.lastLocalDataDate || new Date().toISOString().slice(0, 10)}，汇总当前所有措施井。`,
                    measureAnalysisCharts.loading ? (
                      <div className="flex h-[260px] items-center justify-center text-sm text-slate-500">所有措施井曲线加载中...</div>
                    ) : measureAnalysisCharts.error ? (
                      <div className="rounded-lg border border-amber-100 bg-amber-50 px-4 py-3 text-sm text-amber-700">
                        {measureAnalysisCharts.error}
                        {measureAnalysisCharts.warning && (
                          <>
                            <br />
                            <span className="text-amber-600">{measureAnalysisCharts.warning}</span>
                          </>
                        )}
                      </div>
                    ) : measureAnalysisCharts.currentData ? (
                      <div className="grid grid-cols-1 gap-6">
                        <div className="h-[360px] rounded-lg border border-gray-100 bg-white p-4">
                          <ReactECharts
                            option={getChartOption(
                              '所有措施井本轮产液 / 上轮同期产液',
                              measureAnalysisCharts.currentData.dates,
                              measureAnalysisCharts.currentData.liquid,
                              '日产液(t)',
                              '#2563eb',
                              false,
                              padSeries(measureAnalysisCharts.previousData?.liquid, measureAnalysisCharts.currentData.dates.length),
                              '上轮同期'
                            )}
                            style={{ height: '100%' }}
                          />
                        </div>
                        <div className="h-[360px] rounded-lg border border-gray-100 bg-white p-4">
                          <ReactECharts
                            option={getChartOption(
                              '所有措施井本轮产油 / 上轮同期产油',
                              measureAnalysisCharts.currentData.dates,
                              measureAnalysisCharts.currentData.oil,
                              '日产油(t)',
                              '#D32F2F',
                              false,
                              padSeries(measureAnalysisCharts.previousData?.oil, measureAnalysisCharts.currentData.dates.length),
                              '上轮同期'
                            )}
                            style={{ height: '100%' }}
                          />
                        </div>
                        <div className="h-[360px] rounded-lg border border-gray-100 bg-white p-4">
                          <ReactECharts
                            option={getChartOption(
                              '所有措施井本轮含水 / 上轮同期含水',
                              measureAnalysisCharts.currentData.dates,
                              measureAnalysisCharts.currentData.water_cut,
                              '含水率(%)',
                              '#16a34a',
                              true,
                              padSeries(measureAnalysisCharts.previousData?.water_cut, measureAnalysisCharts.currentData.dates.length),
                              '上轮同期'
                            )}
                            style={{ height: '100%' }}
                          />
                        </div>
                        <div className="h-[360px] rounded-lg border border-gray-100 bg-white p-4">
                          <ReactECharts
                            option={getChartOption(
                              '所有措施井本轮掺油 / 上轮同期掺油',
                              measureAnalysisCharts.currentData.dates,
                              measureAnalysisCharts.currentData.diluent,
                              '掺油(t)',
                              '#9c27b0',
                              false,
                              padSeries(measureAnalysisCharts.previousData?.diluent, measureAnalysisCharts.currentData.dates.length),
                              '上轮同期'
                            )}
                            style={{ height: '100%' }}
                          />
                        </div>
                        <div className="h-[360px] rounded-lg border border-gray-100 bg-white p-4">
                          <ReactECharts
                            option={getChartOption(
                              '所有措施井本轮产气 / 上轮同期产气',
                              measureAnalysisCharts.currentData.dates,
                              measureAnalysisCharts.currentData.gas,
                              '产气(m3)',
                              '#facc15',
                              false,
                              padSeries(measureAnalysisCharts.previousData?.gas, measureAnalysisCharts.currentData.dates.length),
                              '上轮同期'
                            )}
                            style={{ height: '100%' }}
                          />
                        </div>
                      </div>
                    ) : (
                      <div className="flex h-[240px] items-center justify-center text-sm text-slate-400">暂无可展示的措施分析曲线数据</div>
                    )
                  )}

                  {renderMeasureAnalysisPanel(
                    'ten-day',
                    '措施旬度分析',
                    '默认折叠；统计旬度平均日产油，并追加旬度增油变化曲线。',
                    measureAnalysisCharts.loading ? (
                      <div className="flex h-[260px] items-center justify-center text-sm text-slate-500">旬度分析加载中...</div>
                    ) : measureAnalysisCharts.currentData ? (
                      <div className="grid grid-cols-1 gap-6">
                        <div className="h-[420px] rounded-lg border border-gray-100 bg-white p-4">
                          <ReactECharts
                            option={getAverageOilPeriodOption(
                              '所有措施井旬度平均日产油',
                              measureAnalysisTenDayAverageOil,
                              '#f97316'
                            )}
                            style={{ height: '100%' }}
                          />
                        </div>
                        <div className="h-[420px] rounded-lg border border-gray-100 bg-white p-4">
                          <ReactECharts
                            option={getAverageOilPeriodOption(
                              '所有措施井旬度增油变化',
                              measureAnalysisTenDayOilDelta,
                              tenDayDeltaPalette.current,
                              '旬度增油变化(t/d)',
                              't/d',
                              ['本期旬度增油变化', '上轮同期旬度增油变化'],
                              tenDayDeltaPalette.previous
                            )}
                            onEvents={{
                              click: () => setTenDayDeltaPaletteIndex((index) => index + 1)
                            }}
                            style={{ height: '100%' }}
                          />
                        </div>
                      </div>
                    ) : (
                      <div className="flex h-[220px] items-center justify-center text-sm text-slate-400">暂无旬度分析数据</div>
                    )
                  )}

                  {renderMeasureAnalysisPanel(
                    'monthly',
                    '措施月度分析',
                    '默认折叠；统计所有措施井月度平均日产油，并按转抽月份生成各月措施井旬度走势。',
                    measureAnalysisCharts.loading || measureMonthlyCohorts.loading ? (
                      <div className="flex h-[260px] items-center justify-center text-sm text-slate-500">月度分析加载中...</div>
                    ) : measureAnalysisCharts.currentData ? (
                      <div className="space-y-6">
                        <div className="h-[380px] rounded-lg border border-gray-100 bg-white p-4">
                          <ReactECharts
                            option={getAverageOilPeriodOption(
                              '所有措施井月度平均日产油',
                              measureAnalysisMonthlyAverageOil
                            )}
                            style={{ height: '100%' }}
                          />
                        </div>
                        <div className="h-[380px] rounded-lg border border-gray-100 bg-white p-4">
                          <ReactECharts
                            option={getAverageOilPeriodOption(
                              '所有措施井月度增油变化',
                              measureAnalysisMonthlyOilDelta,
                              '#0f766e',
                              '月度增油变化(t/d)',
                              't/d',
                              ['本期月度增油变化', '上轮同期月度增油变化'],
                              '#f97316'
                            )}
                            style={{ height: '100%' }}
                          />
                        </div>

                        <div className="space-y-3">
                          <div>
                            <h4 className="text-base font-bold text-slate-800">各月转抽措施井旬度平均日产油</h4>
                            <p className="mt-1 text-sm text-slate-500">
                              按本轮转抽月份分组，每组统计当月转抽开的井；上轮同期按各井上轮转抽时间与本轮生产天数对齐。
                            </p>
                          </div>
                          {measureMonthlyCohorts.error && (
                            <div className="rounded-lg border border-amber-100 bg-amber-50 px-4 py-3 text-sm text-amber-700">
                              {measureMonthlyCohorts.error}
                            </div>
                          )}
                          {measureMonthlyCohorts.rows.length > 0 ? (
                            <div className="grid grid-cols-1 gap-5">
                              {measureMonthlyCohorts.rows.map((cohort, index) => (
                                <div key={cohort.month} className="h-[380px] rounded-lg border border-gray-100 bg-white p-4">
                                  <ReactECharts
                                    option={getAverageOilPeriodOption(
                                      `${cohort.month} 转抽措施井旬度平均日产油（${cohort.wellCount}口）`,
                                      cohort.tenDayData,
                                      ['#2563eb', '#16a34a', '#f97316', '#7c3aed'][index % 4],
                                      '旬度平均日产油(t/d)',
                                      't/d',
                                      ['本期旬度平均日产油', '上轮同期旬度平均日产油'],
                                      ['#dc2626', '#0891b2', '#9333ea', '#ea580c'][index % 4]
                                    )}
                                    style={{ height: '100%' }}
                                  />
                                </div>
                              ))}
                            </div>
                          ) : (
                            <div className="flex h-[180px] items-center justify-center rounded-lg border border-dashed border-slate-200 bg-slate-50 text-sm text-slate-400">
                              暂无各月转抽措施井旬度曲线数据
                            </div>
                          )}
                        </div>
                      </div>
                    ) : (
                      <div className="flex h-[220px] items-center justify-center text-sm text-slate-400">暂无月度分析数据</div>
                    )
                  )}

                  {renderMeasureAnalysisPanel(
                    'block',
                    '区块分析',
                    '默认折叠；按区块汇总措施井整体表现，并生成各区块本期 / 上轮同期旬度平均日产油曲线。',
                    measureBlockCharts.loading ? (
                      <div className="flex h-[260px] items-center justify-center text-sm text-slate-500">区块分析加载中...</div>
                    ) : measureAnalysisBlockRows.length > 0 ? (
                      <div className="space-y-6">
                        <div className="overflow-x-auto">
                          <table className="measure-table w-full text-left text-sm">
                            <thead>
                              <tr>
                                <th>区块</th>
                                <th className="text-center">井数</th>
                                <th className="text-center">日产液</th>
                                <th className="text-center">日产油</th>
                                <th className="text-center">本轮累产油</th>
                                <th className="text-center">上轮同期累产油</th>
                              </tr>
                            </thead>
                            <tbody>
                              {measureAnalysisBlockRows.map((row) => (
                                <tr key={row.block}>
                                  <td className="font-bold text-slate-900">{row.block}</td>
                                  <td className="text-center">{row.count}</td>
                                  <td className="text-center">{formatChartNumber(row.currentLiquid)} t</td>
                                  <td className="text-center">{formatChartNumber(row.currentOil)} t</td>
                                  <td className="text-center">{formatChartNumber(row.cumulativeOil)} t</td>
                                  <td className="text-center">{formatChartNumber(row.previousCumulativeOil)} t</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>

                        <div className="space-y-3">
                          <div>
                            <h4 className="text-base font-bold text-slate-800">各区块措施井旬度平均日产油</h4>
                            <p className="mt-1 text-sm text-slate-500">
                              按区块汇总措施井整体走势；高3624(北)、高3624(南) 已合并为 高3624。
                            </p>
                          </div>
                          {measureBlockCharts.error && (
                            <div className="rounded-lg border border-amber-100 bg-amber-50 px-4 py-3 text-sm text-amber-700">
                              {measureBlockCharts.error}
                            </div>
                          )}
                          {measureBlockCharts.rows.length > 0 ? (
                            <div className="grid grid-cols-1 gap-5">
                              {measureBlockCharts.rows.map((blockRow, index) => (
                                <div key={blockRow.block} className="h-[380px] rounded-lg border border-gray-100 bg-white p-4">
                                  <ReactECharts
                                    option={getAverageOilPeriodOption(
                                      `${blockRow.block} 措施井旬度平均日产油（${blockRow.wellCount}口）`,
                                      blockRow.tenDayData,
                                      ['#2563eb', '#16a34a', '#f97316', '#7c3aed'][index % 4],
                                      '旬度平均日产油(t/d)',
                                      't/d',
                                      ['本期旬度平均日产油', '上轮同期旬度平均日产油'],
                                      ['#dc2626', '#0891b2', '#9333ea', '#ea580c'][index % 4]
                                    )}
                                    style={{ height: '100%' }}
                                  />
                                </div>
                              ))}
                            </div>
                          ) : (
                            <div className="flex h-[180px] items-center justify-center rounded-lg border border-dashed border-slate-200 bg-slate-50 text-sm text-slate-400">
                              暂无各区块旬度曲线数据
                            </div>
                          )}
                        </div>
                      </div>
                    ) : (
                      <div className="flex h-[180px] items-center justify-center text-sm text-slate-400">暂无区块分析数据</div>
                    )
                  )}

                  {renderMeasureAnalysisPanel(
                    'measure-type',
                    '措施类型分析',
                    '默认折叠；按本轮措施类型汇总措施井整体表现，并生成各类型本期 / 上轮同期旬度平均日产油曲线。',
                    measureTypeCharts.loading ? (
                      <div className="flex h-[260px] items-center justify-center text-sm text-slate-500">措施类型分析加载中...</div>
                    ) : measureAnalysisTypeRows.length > 0 ? (
                      <div className="space-y-6">
                        <div className="overflow-x-auto">
                          <table className="measure-table w-full text-left text-sm">
                            <thead>
                              <tr>
                                <th>措施类型</th>
                                <th className="text-center">井数</th>
                                <th className="text-center">日产液</th>
                                <th className="text-center">日产油</th>
                                <th className="text-center">本轮累产油</th>
                                <th className="text-center">上轮同期累产油</th>
                              </tr>
                            </thead>
                            <tbody>
                              {measureAnalysisTypeRows.map((row) => (
                                <tr key={row.measureType}>
                                  <td className="font-bold text-slate-900">{row.measureType}</td>
                                  <td className="text-center">{row.count}</td>
                                  <td className="text-center">{formatChartNumber(row.currentLiquid)} t</td>
                                  <td className="text-center">{formatChartNumber(row.currentOil)} t</td>
                                  <td className="text-center">{formatChartNumber(row.cumulativeOil)} t</td>
                                  <td className="text-center">{formatChartNumber(row.previousCumulativeOil)} t</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>

                        <div className="space-y-3">
                          <div>
                            <h4 className="text-base font-bold text-slate-800">各措施类型旬度平均日产油</h4>
                            <p className="mt-1 text-sm text-slate-500">
                              按本轮措施类型汇总措施井整体走势；上轮同期按各井上轮转抽时间与本轮生产天数对齐。
                            </p>
                          </div>
                          {measureTypeCharts.error && (
                            <div className="rounded-lg border border-amber-100 bg-amber-50 px-4 py-3 text-sm text-amber-700">
                              {measureTypeCharts.error}
                            </div>
                          )}
                          {measureTypeCharts.rows.length > 0 ? (
                            <div className="grid grid-cols-1 gap-5">
                              {measureTypeCharts.rows.map((typeRow, index) => (
                                <div key={typeRow.measureType} className="h-[380px] rounded-lg border border-gray-100 bg-white p-4">
                                  <ReactECharts
                                    option={getAverageOilPeriodOption(
                                      `${typeRow.measureType} 旬度平均日产油（${typeRow.wellCount}口）`,
                                      typeRow.tenDayData,
                                      ['#2563eb', '#16a34a', '#f97316', '#7c3aed'][index % 4],
                                      '旬度平均日产油(t/d)',
                                      't/d',
                                      ['本期旬度平均日产油', '上轮同期旬度平均日产油'],
                                      ['#dc2626', '#0891b2', '#9333ea', '#ea580c'][index % 4]
                                    )}
                                    style={{ height: '100%' }}
                                  />
                                </div>
                              ))}
                            </div>
                          ) : (
                            <div className="flex h-[180px] items-center justify-center rounded-lg border border-dashed border-slate-200 bg-slate-50 text-sm text-slate-400">
                              暂无各措施类型旬度曲线数据
                            </div>
                          )}
                        </div>
                      </div>
                    ) : (
                      <div className="flex h-[180px] items-center justify-center text-sm text-slate-400">暂无措施类型分析数据</div>
                    )
                  )}

                  {renderMeasureAnalysisPanel(
                    'custom',
                    '自定义分析',
                    '默认折叠；按区块、措施类型、时间颗粒和转抽开始时间组合生成本轮 / 上轮同期曲线。',
                    <div className="space-y-6">
                      <div className="grid grid-cols-1 gap-4 md:grid-cols-4">
                        <div className="space-y-2">
                          <label className="text-sm font-bold text-slate-700">区块</label>
                          <select
                            className="field-control w-full"
                            value={measureCustomFilters.block}
                            onChange={(event) => setMeasureCustomFilters(prev => ({ ...prev, block: event.target.value }))}
                          >
                            <option value="">全部区块</option>
                            {measureCustomBlockOptions.map(block => <option key={block} value={block}>{block}</option>)}
                          </select>
                        </div>
                        <div className="space-y-2">
                          <label className="text-sm font-bold text-slate-700">措施类型</label>
                          <select
                            className="field-control w-full"
                            value={measureCustomFilters.measureType}
                            onChange={(event) => setMeasureCustomFilters(prev => ({ ...prev, measureType: event.target.value }))}
                          >
                            <option value="">全部措施类型</option>
                            {measureCustomTypeOptions.map(type => <option key={type} value={type}>{type}</option>)}
                          </select>
                        </div>
                        <div className="space-y-2">
                          <label className="text-sm font-bold text-slate-700">时间颗粒</label>
                          <select
                            className="field-control w-full"
                            value={measureCustomFilters.timeGrain}
                            onChange={(event) => setMeasureCustomFilters(prev => ({ ...prev, timeGrain: event.target.value as MeasureCustomTimeGrain }))}
                          >
                            <option value="day">日度</option>
                            <option value="tenDay">旬度</option>
                            <option value="month">月度</option>
                          </select>
                        </div>
                        <div className="space-y-2">
                          <label className="text-sm font-bold text-slate-700">转抽开始时间</label>
                          <input
                            type="date"
                            className="field-control w-full"
                            value={measureCustomFilters.transferStart}
                            onChange={(event) => setMeasureCustomFilters(prev => ({ ...prev, transferStart: event.target.value }))}
                          />
                        </div>
                      </div>

                      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-slate-100 bg-slate-50 px-4 py-3 text-sm text-slate-600">
                        <span>
                          当前条件匹配 {measureCustomAnalysis.wellCount} 口井，曲线口径与措施评价一致：本轮从本轮转抽时间开始，上轮同期从上轮转抽时间开始并按本轮生产天数对齐。
                        </span>
                        <button
                          type="button"
                          className="action-button action-primary"
                          onClick={() => void runCustomMeasureAnalysis(measureCustomFilters)}
                        >
                          生成曲线
                        </button>
                      </div>

                      {measureCustomAnalysis.loading ? (
                        <div className="flex h-[260px] items-center justify-center text-sm text-slate-500">自定义曲线生成中...</div>
                      ) : measureCustomAnalysis.error ? (
                        <div className="rounded-lg border border-amber-100 bg-amber-50 px-4 py-3 text-sm text-amber-700">
                          {measureCustomAnalysis.error}
                        </div>
                      ) : measureCustomAnalysis.currentData ? (
                        <div className="grid grid-cols-1 gap-6">
                          <div className="chart-card h-[360px]">
                            <ReactECharts
                              option={getChartOption(
                                '自定义分析：本轮 / 上轮同期产液',
                                measureCustomAnalysis.currentData.dates,
                                measureCustomAnalysis.currentData.liquid,
                                '产液(t)',
                                '#2563eb',
                                false,
                                padSeries(measureCustomAnalysis.previousData?.liquid, measureCustomAnalysis.currentData.dates.length),
                                '上轮同期',
                                true,
                                true,
                                measureCustomFilters.timeGrain === 'day' ? 5 : 1,
                                true
                              )}
                              style={{ height: '100%' }}
                            />
                          </div>
                          <div className="chart-card h-[360px]">
                            <ReactECharts
                              option={getChartOption(
                                '自定义分析：本轮 / 上轮同期产油',
                                measureCustomAnalysis.currentData.dates,
                                measureCustomAnalysis.currentData.oil,
                                '产油(t)',
                                '#D32F2F',
                                false,
                                padSeries(measureCustomAnalysis.previousData?.oil, measureCustomAnalysis.currentData.dates.length),
                                '上轮同期',
                                true,
                                true,
                                measureCustomFilters.timeGrain === 'day' ? 5 : 1,
                                true
                              )}
                              style={{ height: '100%' }}
                            />
                          </div>
                          <div className="chart-card h-[360px]">
                            <ReactECharts
                              option={getChartOption(
                                '自定义分析：本轮 / 上轮同期含水',
                                measureCustomAnalysis.currentData.dates,
                                measureCustomAnalysis.currentData.water_cut,
                                '含水率(%)',
                                '#16a34a',
                                true,
                                padSeries(measureCustomAnalysis.previousData?.water_cut, measureCustomAnalysis.currentData.dates.length),
                                '上轮同期',
                                true,
                                true,
                                measureCustomFilters.timeGrain === 'day' ? 5 : 1,
                                true
                              )}
                              style={{ height: '100%' }}
                            />
                          </div>
                          <div className="chart-card h-[360px]">
                            <ReactECharts
                              option={getChartOption(
                                '自定义分析：本轮 / 上轮同期掺油',
                                measureCustomAnalysis.currentData.dates,
                                measureCustomAnalysis.currentData.diluent,
                                '掺油(t)',
                                '#9c27b0',
                                false,
                                padSeries(measureCustomAnalysis.previousData?.diluent, measureCustomAnalysis.currentData.dates.length),
                                '上轮同期',
                                true,
                                true,
                                measureCustomFilters.timeGrain === 'day' ? 5 : 1,
                                true
                              )}
                              style={{ height: '100%' }}
                            />
                          </div>
                          <div className="chart-card h-[360px]">
                            <ReactECharts
                              option={getChartOption(
                                '自定义分析：本轮 / 上轮同期产气',
                                measureCustomAnalysis.currentData.dates,
                                measureCustomAnalysis.currentData.gas,
                                '产气(m3)',
                                '#facc15',
                                false,
                                padSeries(measureCustomAnalysis.previousData?.gas, measureCustomAnalysis.currentData.dates.length),
                                '上轮同期',
                                true,
                                true,
                                measureCustomFilters.timeGrain === 'day' ? 5 : 1,
                                true
                              )}
                              style={{ height: '100%' }}
                            />
                          </div>
                        </div>
                      ) : (
                        <div className="flex h-[180px] items-center justify-center rounded-lg border border-dashed border-slate-200 bg-white text-sm text-slate-400">
                          请选择条件，系统会自动生成本轮 / 上轮同期曲线。
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}

              {activeTab === 'occupancyAnalysis' && (
                <div className="page-stack">
                  <div className="app-card overflow-hidden border-t-4 border-t-blue-600">
                    <button
                      type="button"
                      className="flex w-full items-center justify-between px-6 py-5 text-left"
                      onClick={() => setOccupancyExpanded(prev => ({ ...prev, upload: !prev.upload }))}
                    >
                      <div>
                        <h3 className="text-lg font-bold text-slate-900">文件上传</h3>
                        <p className="mt-1 text-sm text-slate-500">上传 Excel 后写入本地数据库；每次上传新文件会自动删除上一批占产数据。</p>
                      </div>
                      <ChevronRight className={cn('h-5 w-5 text-slate-400 transition-transform', occupancyExpanded.upload ? 'rotate-90' : '')} />
                    </button>
                    {occupancyExpanded.upload && (
                      <div className="space-y-5 border-t border-slate-100 p-6">
                        <div className="flex flex-wrap items-start justify-between gap-4">
                          <div className="grid flex-1 grid-cols-1 gap-4 lg:grid-cols-3">
                            <div className="rounded-lg border border-slate-100 bg-slate-50 p-4">
                              <div className="text-sm font-bold text-slate-700">当前文件</div>
                              <div className="mt-2 break-all text-sm text-slate-600">{decodeMojibakeText(occupancySummary?.fileName || occupancyUpload.fileName || '暂未上传')}</div>
                            </div>
                            <div className="rounded-lg border border-slate-100 bg-slate-50 p-4">
                              <div className="text-sm font-bold text-slate-700">工作表</div>
                              <div className="mt-2 text-sm text-slate-600">{occupancySummary?.sheetName || occupancyUpload.sheetName || '--'}</div>
                            </div>
                            <div className="rounded-lg border border-slate-100 bg-slate-50 p-4">
                              <div className="text-sm font-bold text-slate-700">数据库记录</div>
                              <div className="mt-2 text-sm text-slate-600">{occupancySummary ? `${occupancySummary.count} 行` : '等待上传文件'}</div>
                            </div>
                          </div>
                          <label className={cn('action-button action-primary cursor-pointer', occupancyUploading && 'pointer-events-none opacity-60')}>
                            <FileSpreadsheet className="h-4 w-4" />
                            {occupancyUploading ? '上传中...' : '上传 Excel'}
                            <input type="file" accept=".xlsx,.xls,.csv" className="hidden" onChange={handleOccupancyExcelUpload} />
                          </label>
                        </div>

                        {occupancyUpload.error && (
                          <div className="rounded-lg border border-amber-100 bg-amber-50 px-4 py-3 text-sm text-amber-700">{occupancyUpload.error}</div>
                        )}

                        {occupancyUpload.columns.length > 0 && (
                          <div>
                            <h4 className="text-sm font-bold text-slate-800">已识别字段</h4>
                            <div className="mt-3 flex flex-wrap gap-2">
                              {occupancyUpload.columns.map((column) => <span key={column} className="status-pill bg-blue-50 text-blue-700">{column}</span>)}
                            </div>
                          </div>
                        )}

                        {occupancyUpload.columns.length > 0 ? (
                          <div className="overflow-x-auto rounded-lg border border-slate-100">
                            <table className="w-full min-w-[900px] text-sm">
                              <thead className="bg-slate-50 text-slate-600">
                                <tr>{occupancyUpload.columns.slice(0, 10).map((column) => <th key={column} className="px-4 py-3 text-left font-semibold">{column}</th>)}</tr>
                              </thead>
                              <tbody className="divide-y divide-slate-100">
                                {occupancyUpload.rows.slice(0, 8).map((row, rowIndex) => (
                                  <tr key={rowIndex} className="hover:bg-slate-50">
                                    {occupancyUpload.columns.slice(0, 10).map((column) => (
                                      <td key={column} className="max-w-[220px] truncate px-4 py-3 text-slate-700">{formatOccupancyPreviewValue(column, row[column])}</td>
                                    ))}
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        ) : (
                          <div className="flex h-[220px] flex-col items-center justify-center rounded-lg border border-dashed border-slate-200 bg-slate-50 text-center">
                            <FileSpreadsheet className="mb-3 h-10 w-10 text-slate-300" />
                            <div className="text-sm font-bold text-slate-600">等待上传占产分析 Excel</div>
                            <div className="mt-1 text-xs text-slate-400">仅支持 .xlsx / .xls / .csv</div>
                          </div>
                        )}
                      </div>
                    )}
                  </div>

                  <div className="app-card overflow-hidden">
                    <button
                      type="button"
                      className="flex w-full items-center justify-between px-6 py-5 text-left"
                      onClick={() => setOccupancyExpanded(prev => ({ ...prev, typeAnalysis: !prev.typeAnalysis }))}
                    >
                      <div>
                        <h3 className="text-lg font-bold text-slate-900">占产类型分析</h3>
                        <p className="mt-1 text-sm text-slate-500">按已分类的占产类型汇总“影响油”，生成对应周期的平均日产油曲线，默认 5 天。</p>
                      </div>
                      <ChevronRight className={cn('h-5 w-5 text-slate-400 transition-transform', occupancyExpanded.typeAnalysis ? 'rotate-90' : '')} />
                    </button>
                    {occupancyExpanded.typeAnalysis && (
                      <div className="space-y-5 border-t border-slate-100 p-6">
                        <div className="flex flex-wrap items-end justify-between gap-4 rounded-lg border border-slate-100 bg-slate-50 p-4">
                          <div className="space-y-2">
                            <label className="text-sm font-bold text-slate-700">时间颗粒度（天）</label>
                            <input
                              type="number"
                              min={1}
                              max={100}
                              className="field-control w-40"
                              value={occupancyIntervalDays}
                              onChange={(event) => setOccupancyIntervalDays(Math.min(100, Math.max(1, Number(event.target.value) || 5)))}
                            />
                          </div>
                          <button
                            type="button"
                            className="action-button action-primary"
                            onClick={() => {
                              void loadOccupancyTypeAnalysis(occupancyIntervalDays);
                            }}
                          >
                            生成曲线
                          </button>
                        </div>

                        {occupancySummary?.types?.length ? (
                          <div className="flex flex-wrap gap-2">
                            {occupancySummary.types.map((item) => (
                              <span key={item.type} className="status-pill bg-slate-100 text-slate-700">
                                {item.type}：{item.count} 条，影响油 {formatChartNumber(item.affectedOil, 1)} t
                              </span>
                            ))}
                          </div>
                        ) : null}

                        {occupancyTypeAnalysis.loading ? (
                          <div className="flex h-[320px] items-center justify-center text-sm text-slate-500">占产类型曲线生成中...</div>
                        ) : occupancyTypeAnalysis.error ? (
                          <div className="rounded-lg border border-amber-100 bg-amber-50 px-4 py-3 text-sm text-amber-700">{occupancyTypeAnalysis.error}</div>
                        ) : occupancyTypeAnalysis.data && occupancyTypeAnalysis.data.labels.length > 0 ? (
                          <div className="space-y-5">
                            <div className="chart-card h-[420px]">
                              <ReactECharts option={getOccupancyTypeChartOption(occupancyTypeAnalysis.data)} style={{ height: '100%' }} />
                            </div>
                            <div className="chart-card h-[380px]">
                              <ReactECharts option={getOccupancyTypeTotalChartOption(occupancyTypeAnalysis.data)} style={{ height: '100%' }} />
                            </div>
                          </div>
                        ) : (
                          <div className="flex h-[260px] items-center justify-center rounded-lg border border-dashed border-slate-200 bg-slate-50 text-sm text-slate-400">
                            上传占产 Excel 后可生成占产类型影响油平均日产曲线。
                          </div>
                        )}
                      </div>
                    )}
                  </div>

                  <div className="app-card overflow-hidden">
                    <button
                      type="button"
                      className="flex w-full items-center justify-between px-6 py-5 text-left"
                      onClick={() => setOccupancyExpanded(prev => ({ ...prev, blockAnalysis: !prev.blockAnalysis }))}
                    >
                      <div>
                        <h3 className="text-lg font-bold text-slate-900">区块占产分析</h3>
                        <p className="mt-1 text-sm text-slate-500">按区块归并规则汇总“影响油”，每个区块显示三类占产曲线与总占产合计曲线，默认 5 天。</p>
                      </div>
                      <ChevronRight className={cn('h-5 w-5 text-slate-400 transition-transform', occupancyExpanded.blockAnalysis ? 'rotate-90' : '')} />
                    </button>
                    {occupancyExpanded.blockAnalysis && (
                      <div className="space-y-5 border-t border-slate-100 p-6">
                        <div className="flex flex-wrap items-end justify-between gap-4 rounded-lg border border-slate-100 bg-slate-50 p-4">
                          <div className="space-y-2">
                            <label className="text-sm font-bold text-slate-700">区块时间颗粒度（天）</label>
                            <input
                              type="number"
                              min={1}
                              max={100}
                              className="field-control w-40"
                              value={occupancyBlockIntervalDays}
                              onChange={(event) => setOccupancyBlockIntervalDays(Math.min(100, Math.max(1, Number(event.target.value) || 5)))}
                            />
                          </div>
                          <button
                            type="button"
                            className="action-button action-primary"
                            onClick={() => void loadOccupancyBlockAnalysis(occupancyBlockIntervalDays)}
                          >
                            生成区块曲线
                          </button>
                        </div>

                        <div className="rounded-lg border border-slate-100 bg-slate-50 px-4 py-3 text-sm text-slate-600">
                          合并规则：246块L5、246块L6、高18(北) 归并为 246块；3618块L4/L5/L6 归并为 3618块；3624块(北/南)L5/L6、高10 归并为 3624块；3块L5/L6/L7、高372108 归并为 3块；高21(北/南) 归并为 高21。
                        </div>

                        {occupancyBlockAnalysis.loading ? (
                          <div className="flex h-[320px] items-center justify-center text-sm text-slate-500">区块占产曲线生成中...</div>
                        ) : occupancyBlockAnalysis.error ? (
                          <div className="rounded-lg border border-amber-100 bg-amber-50 px-4 py-3 text-sm text-amber-700">{occupancyBlockAnalysis.error}</div>
                        ) : occupancyBlockAnalysis.data && occupancyBlockAnalysis.data.blocks.some(block => block.labels.length > 0) ? (
                          <div className="grid grid-cols-1 gap-5">
                            {occupancyBlockAnalysis.data.blocks.map((block) => (
                              <div key={block.block} className="space-y-3">
                                <div className="flex flex-wrap items-center gap-2">
                                  <span className="text-sm font-bold text-slate-800">{block.block}</span>
                                  <span className="status-pill bg-slate-100 text-slate-700">{block.count} 条</span>
                                  <span className="status-pill bg-red-50 text-red-700">影响油 {formatChartNumber(block.affectedOil, 1)} t</span>
                                </div>
                                {block.labels.length > 0 ? (
                                  <div className="chart-card h-[390px]">
                                    <ReactECharts option={getOccupancyBlockChartOption(block)} style={{ height: '100%' }} />
                                  </div>
                                ) : (
                                  <div className="flex h-[160px] items-center justify-center rounded-lg border border-dashed border-slate-200 bg-slate-50 text-sm text-slate-400">
                                    {block.block} 暂无匹配的占产数据。
                                  </div>
                                )}
                              </div>
                            ))}
                          </div>
                        ) : (
                          <div className="flex h-[260px] items-center justify-center rounded-lg border border-dashed border-slate-200 bg-slate-50 text-sm text-slate-400">
                            上传占产 Excel 后可生成区块占产曲线。
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              )}

              {activeTab === 'pumpAnalysis' && (
                <div className="page-stack">
                  <div className="app-card overflow-hidden border-t-4 border-t-emerald-500">
                    <button
                      type="button"
                      className="flex w-full items-center justify-between px-6 py-5 text-left"
                      onClick={() => setPumpAnalysisExpanded(prev => ({ ...prev, upload: !prev.upload }))}
                    >
                      <div>
                        <h3 className="text-lg font-bold text-slate-900">文件上传</h3>
                        <p className="mt-1 text-sm text-slate-500">上传检泵跟踪 Excel 文件，写入本地 SQLite；再次上传会覆盖上一批检泵跟踪数据。</p>
                      </div>
                      <ChevronRight className={cn('h-5 w-5 text-slate-400 transition-transform', pumpAnalysisExpanded.upload ? 'rotate-90' : '')} />
                    </button>
                    {pumpAnalysisExpanded.upload && (
                      <div className="space-y-5 border-t border-slate-100 p-6">
                        <div className="flex flex-wrap items-start justify-between gap-4">
                          <div className="grid flex-1 grid-cols-1 gap-4 lg:grid-cols-3">
                            <div className="rounded-lg border border-slate-100 bg-slate-50 p-4">
                              <div className="text-sm font-bold text-slate-700">当前文件</div>
                              <div className="mt-2 break-all text-sm text-slate-600">{decodeMojibakeText(pumpAnalysisUpload.fileName || '暂未上传')}</div>
                            </div>
                            <div className="rounded-lg border border-slate-100 bg-slate-50 p-4">
                              <div className="text-sm font-bold text-slate-700">工作表</div>
                              <div className="mt-2 text-sm text-slate-600">{pumpAnalysisUpload.sheetName || '--'}</div>
                            </div>
                            <div className="rounded-lg border border-slate-100 bg-slate-50 p-4">
                              <div className="text-sm font-bold text-slate-700">识别结果</div>
                              <div className="mt-2 text-sm text-slate-600">
                                {pumpAnalysisUpload.rows.length > 0 ? `${pumpAnalysisUpload.rows.length} 行，${pumpAnalysisUpload.columns.length} 个字段` : '等待上传文件'}
                              </div>
                            </div>
                          </div>
                          <label className={cn('action-button action-primary cursor-pointer', pumpAnalysisUploading && 'pointer-events-none opacity-60')}>
                            <FileSpreadsheet className="h-4 w-4" />
                            {pumpAnalysisUploading ? '上传中...' : '上传 Excel'}
                            <input type="file" accept=".xlsx,.xls,.csv" className="hidden" onChange={handlePumpAnalysisExcelUpload} />
                          </label>
                        </div>

                        {pumpAnalysisUpload.error && (
                          <div className="rounded-lg border border-amber-100 bg-amber-50 px-4 py-3 text-sm text-amber-700">{pumpAnalysisUpload.error}</div>
                        )}

                        {pumpAnalysisUpload.columns.length > 0 && (
                          <div>
                            <h4 className="text-sm font-bold text-slate-800">已识别字段</h4>
                            <div className="mt-3 flex flex-wrap gap-2">
                              {pumpAnalysisUpload.columns.map((column) => <span key={column} className="status-pill bg-emerald-50 text-emerald-700">{column}</span>)}
                            </div>
                          </div>
                        )}

                        {pumpAnalysisUpload.columns.length > 0 ? (
                          <div className="overflow-x-auto rounded-lg border border-slate-100">
                            <table className="w-full min-w-[900px] text-sm">
                              <thead className="bg-slate-50 text-slate-600">
                                <tr>{pumpAnalysisUpload.columns.slice(0, 10).map((column) => <th key={column} className="px-4 py-3 text-left font-semibold">{column}</th>)}</tr>
                              </thead>
                              <tbody className="divide-y divide-slate-100">
                                {pumpAnalysisUpload.rows.slice(0, 8).map((row, rowIndex) => (
                                  <tr key={rowIndex} className="hover:bg-slate-50">
                                    {pumpAnalysisUpload.columns.slice(0, 10).map((column) => (
                                      <td key={column} className="max-w-[220px] truncate px-4 py-3 text-slate-700">{formatOccupancyPreviewValue(column, row[column])}</td>
                                    ))}
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        ) : (
                          <div className="flex h-[220px] flex-col items-center justify-center rounded-lg border border-dashed border-slate-200 bg-slate-50 text-center">
                            <FileSpreadsheet className="mb-3 h-10 w-10 text-slate-300" />
                            <div className="text-sm font-bold text-slate-600">等待上传检泵跟踪 Excel</div>
                            <div className="mt-1 text-xs text-slate-400">仅支持 .xlsx / .xls / .csv</div>
                          </div>
                        )}
                      </div>
                    )}
                  </div>

                  <div className="app-card overflow-hidden">
                    <button
                      type="button"
                      className="flex w-full items-center justify-between px-6 py-5 text-left"
                      onClick={() => setPumpAnalysisExpanded(prev => ({ ...prev, analysis: !prev.analysis }))}
                    >
                      <div>
                        <h3 className="text-lg font-bold text-slate-900">检泵跟踪</h3>
                        <p className="mt-1 text-sm text-slate-500">检泵数据跟踪入口；上传文件后，按指定字段和指标生成曲线、汇总和对比结果。</p>
                      </div>
                      <ChevronRight className={cn('h-5 w-5 text-slate-400 transition-transform', pumpAnalysisExpanded.analysis ? 'rotate-90' : '')} />
                    </button>
                    {pumpAnalysisExpanded.analysis && (
                      <div className="space-y-5 border-t border-slate-100 p-6">
                        {pumpAnalysisUpload.rows.length > 0 ? (
                          <div className="space-y-5">
                            <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
                              <div className="rounded-lg border border-slate-100 bg-slate-50 p-4">
                                <div className="text-sm font-bold text-slate-700">数据行数</div>
                                <div className="mt-2 text-2xl font-bold text-slate-900">{pumpAnalysisUpload.rows.length}</div>
                              </div>
                              <div className="rounded-lg border border-slate-100 bg-slate-50 p-4">
                                <div className="text-sm font-bold text-slate-700">匹配记录</div>
                                <div className="mt-2 text-2xl font-bold text-slate-900">{pumpOldWellRecoveredOilSeries.matchedRows}</div>
                              </div>
                              <div className="rounded-lg border border-slate-100 bg-slate-50 p-4">
                                <div className="text-sm font-bold text-slate-700">匹配井数</div>
                                <div className="mt-2 text-2xl font-bold text-slate-900">{pumpOldWellRecoveredOilSeries.matchedWells || '--'}</div>
                              </div>
                            </div>

                            {pumpOldWellRecoveredOilSeries.missing.length > 0 ? (
                              <div className="rounded-lg border border-amber-100 bg-amber-50 px-4 py-3 text-sm text-amber-700">
                                未识别到关键字段：{pumpOldWellRecoveredOilSeries.missing.join('、')}。请检查 Excel 表头是否包含这些字段。
                              </div>
                            ) : pumpProductionOilAnalysis.loading ? (
                              <div className="flex h-[220px] items-center justify-center rounded-lg border border-dashed border-slate-200 bg-slate-50 text-sm text-slate-500">
                                正在从本地生产数据库按井号和开井日期生成连续日产油曲线...
                              </div>
                            ) : pumpProductionOilAnalysis.error ? (
                              <div className="rounded-lg border border-amber-100 bg-amber-50 px-4 py-3 text-sm text-amber-700">
                                {pumpProductionOilAnalysis.error}
                              </div>
                            ) : pumpProductionOilAnalysis.data && pumpProductionOilAnalysis.data.groups.some((group) => group.labels.length > 0 || (group.wellDetails?.length || 0) > 0) ? (
                              <div className="space-y-5">
                                {pumpProductionOilAnalysis.data.groups.map((group) => (
                                  <div key={group.key} className="space-y-3">
                                    <div className="flex flex-wrap items-center gap-2 text-sm">
                                      <span className="font-bold text-slate-900">{group.title}</span>
                                      <span className="status-pill bg-slate-100 text-slate-600">{group.matchedRows} 条</span>
                                      <span className="status-pill bg-red-50 text-red-700">{group.matchedWells} 口井</span>
                                    </div>
                                    {group.labels.length > 0 ? (
                                      <div className="chart-card h-[380px]">
                                        <ReactECharts
                                          option={getChartOption(
                                            `${group.title} 5天平均日产油`,
                                            group.labels,
                                            group.oil,
                                            '平均日产油(t/d)',
                                            '#D32F2F',
                                            false,
                                            group.previousOil,
                                            '上次检泵同期',
                                            true,
                                            true,
                                            group.labels.length > 15 ? Math.ceil(group.labels.length / 10) : 1,
                                            false
                                          )}
                                          style={{ height: '100%' }}
                                        />
                                      </div>
                                    ) : (
                                      <div className="flex h-[120px] items-center justify-center rounded-lg border border-dashed border-slate-200 bg-slate-50 text-sm text-slate-400">
                                        {group.title} 暂无可用于生成曲线的本地生产数据。
                                      </div>
                                    )}
                                    {group.key === 'activePendingPump' && (group.wellDetails?.length || 0) > 0 && (
                                      <div className="overflow-x-auto rounded-lg border border-slate-100">
                                        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 bg-slate-50 px-4 py-3">
                                          <div>
                                            <h4 className="text-sm font-bold text-slate-900">未检泵/待检泵问题井基本情况</h4>
                                            <p className="mt-1 text-xs text-slate-500">可恢复产油 = 近 5 天上次检泵同期平均日产油 - 近 5 天本期平均日产油，小于 0 按 0 计。</p>
                                          </div>
                                          <span className="status-pill bg-red-50 text-red-700">
                                            预计可恢复 {formatChartNumber((group.wellDetails || []).reduce((sum, row) => sum + Number(row.recoverableOil || 0), 0), 1)} t/d
                                          </span>
                                        </div>
                                        <table className="w-full min-w-[760px] border-b border-slate-100 text-sm">
                                          <thead className="bg-white text-slate-600">
                                            <tr>
                                              <th className="px-4 py-3 text-left font-semibold">区块汇总</th>
                                              <th className="px-4 py-3 text-right font-semibold">井数</th>
                                              <th className="px-4 py-3 text-right font-semibold">本期近5天</th>
                                              <th className="px-4 py-3 text-right font-semibold">上次同期</th>
                                              <th className="px-4 py-3 text-right font-semibold">预计可恢复</th>
                                            </tr>
                                          </thead>
                                          <tbody className="divide-y divide-slate-100 bg-white">
                                            {buildPumpPendingSummaryRows(group.wellDetails).map((row) => (
                                              <tr key={row.block} className="hover:bg-slate-50">
                                                <td className="px-4 py-3 font-semibold text-slate-900">{row.block}</td>
                                                <td className="px-4 py-3 text-right text-slate-700">{row.count}</td>
                                                <td className="px-4 py-3 text-right text-slate-700">{formatChartNumber(row.current, 1)} t/d</td>
                                                <td className="px-4 py-3 text-right text-slate-700">{formatChartNumber(row.previous, 1)} t/d</td>
                                                <td className="px-4 py-3 text-right font-bold text-red-700">{formatChartNumber(row.recoverable, 1)} t/d</td>
                                              </tr>
                                            ))}
                                          </tbody>
                                        </table>
                                        <table className="w-full min-w-[980px] text-sm">
                                          <thead className="bg-slate-50 text-slate-600">
                                            <tr>
                                              <th className="px-4 py-3 text-left font-semibold">井号</th>
                                              <th className="px-4 py-3 text-left font-semibold">区块</th>
                                              <th className="px-4 py-3 text-left font-semibold">类型</th>
                                              <th className="px-4 py-3 text-left font-semibold">状态</th>
                                              <th className="px-4 py-3 text-left font-semibold">检泵原因</th>
                                              <th className="px-4 py-3 text-left font-semibold">本次检泵开日期</th>
                                              <th className="px-4 py-3 text-left font-semibold">上次检泵开日期</th>
                                              <th className="px-4 py-3 text-right font-semibold">作业间隔</th>
                                              <th className="px-4 py-3 text-right font-semibold">检泵前日产油</th>
                                              <th className="px-4 py-3 text-right font-semibold">预计潜力油</th>
                                              <th className="px-4 py-3 text-right font-semibold">本期近5天</th>
                                              <th className="px-4 py-3 text-right font-semibold">上次同期</th>
                                              <th className="px-4 py-3 text-right font-semibold">预计可恢复</th>
                                              <th className="px-4 py-3 text-left font-semibold">备注</th>
                                            </tr>
                                          </thead>
                                          <tbody className="divide-y divide-slate-100">
                                            {(group.wellDetails || [])
                                              .slice()
                                              .sort((a, b) => Number(b.recoverableOil || 0) - Number(a.recoverableOil || 0))
                                              .map((row) => (
                                                <tr key={row.jh} className="hover:bg-slate-50">
                                                  <td className="px-4 py-3 font-semibold text-slate-900">{row.jh}</td>
                                                  <td className="px-4 py-3 text-slate-700">{row.block || '--'}</td>
                                                  <td className="px-4 py-3 text-slate-700">{row.type || '--'}</td>
                                                  <td className="px-4 py-3 text-slate-700">{row.status || '--'}</td>
                                                  <td className="px-4 py-3 text-slate-700">{row.reason || '--'}</td>
                                                  <td className="px-4 py-3 text-slate-700">{row.openDate || '--'}</td>
                                                  <td className="px-4 py-3 text-slate-700">{row.previousOpenDate || '--'}</td>
                                                  <td className="px-4 py-3 text-right text-slate-700">{row.interval == null ? '--' : formatChartNumber(row.interval, 0)}</td>
                                                  <td className="px-4 py-3 text-right text-slate-700">{row.preOil == null ? '--' : `${formatChartNumber(row.preOil, 1)} t/d`}</td>
                                                  <td className="px-4 py-3 text-right text-slate-700">{row.potentialOil == null ? '--' : `${formatChartNumber(row.potentialOil, 1)} t/d`}</td>
                                                  <td className="px-4 py-3 text-right text-slate-700">{row.currentRecentOil == null ? '--' : `${formatChartNumber(row.currentRecentOil, 1)} t/d`}</td>
                                                  <td className="px-4 py-3 text-right text-slate-700">{row.previousRecentOil == null ? '--' : `${formatChartNumber(row.previousRecentOil, 1)} t/d`}</td>
                                                  <td className="px-4 py-3 text-right font-bold text-red-700">{row.recoverableOil == null ? '--' : `${formatChartNumber(row.recoverableOil, 1)} t/d`}</td>
                                                  <td className="max-w-[260px] px-4 py-3 text-slate-700">{row.remark || '--'}</td>
                                                </tr>
                                              ))}
                                          </tbody>
                                        </table>
                                      </div>
                                    )}
                                  </div>
                                ))}
                              </div>
                            ) : (
                              <div className="flex h-[220px] items-center justify-center rounded-lg border border-dashed border-slate-200 bg-slate-50 text-sm text-slate-400">
                                当前上传数据中没有匹配“已检泵（已恢复）老井 / 已检泵（已恢复）措施井 / 已检泵（待恢复） / 未检泵/待检泵”的井，或本地生产库没有对应井号的连续日产油记录。
                              </div>
                            )}
                          </div>
                        ) : (
                          <div className="flex h-[220px] items-center justify-center rounded-lg border border-dashed border-slate-200 bg-slate-50 text-sm text-slate-400">
                             请先在“文件上传”中上传检泵跟踪 Excel，随后可生成检泵跟踪曲线。
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              )}

              {activeTab === 'pumpDeepAnalysis' && (
                <div className="page-stack">
                  <div className="app-card overflow-hidden border-t-4 border-t-emerald-500">
                    <button
                      type="button"
                      className="flex w-full items-center justify-between px-6 py-5 text-left"
                      onClick={() => setPumpDeepAnalysisExpanded(prev => ({ ...prev, upload: !prev.upload }))}
                    >
                      <div>
                        <h3 className="text-lg font-bold text-slate-900">文件上传</h3>
                        <p className="mt-1 text-sm text-slate-500">上传检泵分析 Excel 文件，写入独立本地 SQLite；再次上传只覆盖检泵分析数据。</p>
                      </div>
                      <ChevronRight className={cn('h-5 w-5 text-slate-400 transition-transform', pumpDeepAnalysisExpanded.upload ? 'rotate-90' : '')} />
                    </button>
                    {pumpDeepAnalysisExpanded.upload && (
                      <div className="space-y-5 border-t border-slate-100 p-6">
                        <div className="flex flex-wrap items-start justify-between gap-4">
                          <div className="grid flex-1 grid-cols-1 gap-4 lg:grid-cols-3">
                            <div className="rounded-lg border border-slate-100 bg-slate-50 p-4">
                              <div className="text-sm font-bold text-slate-700">当前文件</div>
                              <div className="mt-2 break-all text-sm text-slate-600">{decodeMojibakeText(pumpDeepAnalysisUpload.fileName || '暂未上传')}</div>
                            </div>
                            <div className="rounded-lg border border-slate-100 bg-slate-50 p-4">
                              <div className="text-sm font-bold text-slate-700">工作表</div>
                              <div className="mt-2 text-sm text-slate-600">{pumpDeepAnalysisUpload.sheetName || '--'}</div>
                            </div>
                            <div className="rounded-lg border border-slate-100 bg-slate-50 p-4">
                              <div className="text-sm font-bold text-slate-700">识别结果</div>
                              <div className="mt-2 text-sm text-slate-600">
                                {pumpDeepAnalysisUpload.rows.length > 0 ? `${pumpDeepAnalysisUpload.rows.length} 行，${pumpDeepAnalysisUpload.columns.length} 个字段` : '等待上传文件'}
                              </div>
                            </div>
                          </div>
                          <label className={cn('action-button action-primary cursor-pointer', pumpDeepAnalysisUploading && 'pointer-events-none opacity-60')}>
                            <FileSpreadsheet className="h-4 w-4" />
                            {pumpDeepAnalysisUploading ? '上传中...' : '上传 Excel'}
                            <input type="file" accept=".xlsx,.xls,.csv" className="hidden" onChange={handlePumpDeepAnalysisExcelUpload} />
                          </label>
                        </div>

                        {pumpDeepAnalysisUpload.error && (
                          <div className="rounded-lg border border-amber-100 bg-amber-50 px-4 py-3 text-sm text-amber-700">{pumpDeepAnalysisUpload.error}</div>
                        )}

                        {pumpDeepAnalysisUpload.columns.length > 0 && (
                          <div>
                            <h4 className="text-sm font-bold text-slate-800">已识别字段</h4>
                            <div className="mt-3 flex flex-wrap gap-2">
                              {pumpDeepAnalysisUpload.columns.map((column) => (
                                <span key={column} className="status-pill bg-emerald-50 text-emerald-700">{column}</span>
                              ))}
                            </div>
                          </div>
                        )}

                        {pumpDeepAnalysisUpload.columns.length > 0 ? (
                          <div className="overflow-x-auto rounded-lg border border-slate-100">
                            <table className="w-full min-w-[900px] text-sm">
                              <thead className="bg-slate-50 text-slate-600">
                                <tr>
                                  {pumpDeepAnalysisUpload.columns.slice(0, 10).map((column) => (
                                    <th key={column} className="px-4 py-3 text-left font-semibold">{column}</th>
                                  ))}
                                </tr>
                              </thead>
                              <tbody className="divide-y divide-slate-100">
                                {pumpDeepAnalysisUpload.rows.slice(0, 8).map((row, rowIndex) => (
                                  <tr key={rowIndex} className="hover:bg-slate-50">
                                    {pumpDeepAnalysisUpload.columns.slice(0, 10).map((column) => (
                                      <td key={column} className="max-w-[220px] truncate px-4 py-3 text-slate-700">{formatOccupancyPreviewValue(column, row[column])}</td>
                                    ))}
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        ) : (
                          <div className="flex h-[220px] flex-col items-center justify-center rounded-lg border border-dashed border-slate-200 bg-slate-50 text-center">
                            <FileSpreadsheet className="mb-3 h-10 w-10 text-slate-300" />
                            <div className="text-sm font-bold text-slate-600">等待上传检泵分析 Excel</div>
                            <div className="mt-1 text-xs text-slate-400">仅支持 .xlsx / .xls / .csv</div>
                          </div>
                        )}
                      </div>
                    )}
                  </div>

                  <div className="app-card overflow-hidden">
                    <button
                      type="button"
                      className="flex w-full items-center justify-between px-6 py-5 text-left"
                      onClick={() => setPumpDeepAnalysisExpanded(prev => ({ ...prev, analysis: !prev.analysis }))}
                    >
                      <div>
                        <h3 className="text-lg font-bold text-slate-900">检泵分析</h3>
                        <p className="mt-1 text-sm text-slate-500">自动分析入口；上传文件后可根据字段生成自定义曲线、汇总表和对比结果。</p>
                      </div>
                      <ChevronRight className={cn('h-5 w-5 text-slate-400 transition-transform', pumpDeepAnalysisExpanded.analysis ? 'rotate-90' : '')} />
                    </button>
                    {pumpDeepAnalysisExpanded.analysis && (
                      <div className="space-y-5 border-t border-slate-100 p-6">
                        {pumpDeepAnalysisUpload.rows.length > 0 ? (
                          <div className="space-y-5">
                            <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
                              <div className="rounded-lg border border-slate-100 bg-slate-50 p-4">
                                <div className="text-sm font-bold text-slate-700">2025同期数据</div>
                                <div className="mt-2 text-2xl font-bold text-slate-900">{pumpDeepAnalysisData.samePeriodRows2025.length}</div>
                                <div className="mt-1 text-xs text-slate-500">{pumpDeepAnalysisData.latest2026Date ? `截至同月同日 ${pumpDeepAnalysisData.latest2026Date.slice(5)}` : '未识别 2026 截止日期'}</div>
                              </div>
                              <div className="rounded-lg border border-slate-100 bg-slate-50 p-4">
                                <div className="text-sm font-bold text-slate-700">2026阶段数据</div>
                                <div className="mt-2 text-2xl font-bold text-slate-900">{pumpDeepAnalysisData.samePeriodRows2026.length}</div>
                                <div className="mt-1 text-xs text-slate-500">{pumpDeepAnalysisData.latest2026Date ? `截至 ${pumpDeepAnalysisData.latest2026Date}` : '未识别 2026 截止日期'}</div>
                              </div>
                              <div className="rounded-lg border border-slate-100 bg-slate-50 p-4">
                                <div className="text-sm font-bold text-slate-700">实际/设计符合率</div>
                                <div className="mt-2 text-2xl font-bold text-emerald-700">{formatChartNumber(pumpDeepAnalysisData.conformity2026.rate * 100, 1)}%</div>
                                <div className="mt-1 text-xs text-slate-500">2026：{pumpDeepAnalysisData.conformity2026.matched}/{pumpDeepAnalysisData.conformity2026.total}</div>
                              </div>
                            </div>

                            <div className="rounded-lg border border-blue-100 bg-blue-50 px-4 py-3 text-sm text-blue-800">
                              当前按工作表“2025”和“2026”做分析；月度趋势图中 2025 显示全年每个月数据，2026 按当前阶段显示。原因、符合度、区块等其它对比仍按 2026 年最后一个有效“交井日期/作业日期”作为截止日期，2025 年按同月同日截取；月份按“交井日期”统计，未识别到“交井日期”时兜底使用“作业日期”，不再使用其它日期列；间隔来自“间隔天数/作业间隔”字段，原因字段按“设计检泵原因、勘察原因、实际检泵原因、具体原因”自动识别。
                            </div>

                            <div className="chart-card h-[420px]">
                              <ReactECharts option={getPumpMonthlyComparisonChartOption(pumpDeepAnalysisData.monthRows)} style={{ height: '100%' }} />
                            </div>

                            <div className="overflow-x-auto rounded-lg border border-slate-100">
                              <div className="border-b border-slate-100 bg-slate-50 px-4 py-3">
                                <h4 className="text-sm font-bold text-slate-900">同月份检泵数量与平均间隔天数</h4>
                              </div>
                              <table className="w-full min-w-[840px] text-sm">
                                <thead className="bg-white text-slate-600">
                                  <tr>
                                    <th className="px-4 py-3 text-left font-semibold">月份</th>
                                    <th className="px-4 py-3 text-right font-semibold">2025数量</th>
                                    <th className="px-4 py-3 text-right font-semibold">2026数量</th>
                                    <th className="px-4 py-3 text-right font-semibold">数量变化</th>
                                    <th className="px-4 py-3 text-right font-semibold">2025平均间隔</th>
                                    <th className="px-4 py-3 text-right font-semibold">2026平均间隔</th>
                                  </tr>
                                </thead>
                                <tbody className="divide-y divide-slate-100">
                                  {pumpDeepAnalysisData.monthRows.map((row) => (
                                    <tr key={row.month} className="hover:bg-slate-50">
                                      <td className="px-4 py-3 font-semibold text-slate-900">{row.month}</td>
                                      <td className="px-4 py-3 text-right text-slate-700">{row.count2025}</td>
                                      <td className="px-4 py-3 text-right text-slate-700">{row.count2026}</td>
                                      <td className={cn('px-4 py-3 text-right font-bold', row.count2026 - row.count2025 >= 0 ? 'text-red-600' : 'text-emerald-600')}>{row.count2026 - row.count2025}</td>
                                      <td className="px-4 py-3 text-right text-slate-700">{row.avgInterval2025 == null ? '--' : `${formatChartNumber(row.avgInterval2025, 0)} 天`}</td>
                                      <td className="px-4 py-3 text-right text-slate-700">{row.avgInterval2026 == null ? '--' : `${formatChartNumber(row.avgInterval2026, 0)} 天`}</td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </div>

                            <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
                              {pumpDeepAnalysisData.reasonTables.map((table) => (
                                <div key={table.title} className="overflow-hidden rounded-lg border border-slate-100">
                                  <div className="border-b border-slate-100 bg-slate-50 px-4 py-3">
                                    <h4 className="text-sm font-bold text-slate-900">{table.title}同期对比</h4>
                                    <p className="mt-1 text-xs text-slate-500">2025字段：{table.column2025 || '未识别'}；2026字段：{table.column2026 || '未识别'}</p>
                                  </div>
                                  <div className="h-[320px] border-b border-slate-100 px-3 py-3">
                                    <ReactECharts option={getPumpReasonComparisonChartOption(table.title, table.rows)} style={{ height: '100%' }} />
                                  </div>
                                  <table className="w-full text-sm">
                                    <thead className="bg-white text-slate-600">
                                      <tr>
                                        <th className="px-4 py-3 text-left font-semibold">原因</th>
                                        <th className="px-4 py-3 text-right font-semibold">2025</th>
                                        <th className="px-4 py-3 text-right font-semibold">2026</th>
                                        <th className="px-4 py-3 text-right font-semibold">变化</th>
                                      </tr>
                                    </thead>
                                    <tbody className="divide-y divide-slate-100">
                                      {table.rows.map((row) => (
                                        <tr key={`${table.title}-${row.name}`} className="hover:bg-slate-50">
                                          <td className="px-4 py-3 text-slate-700">{row.name}</td>
                                          <td className="px-4 py-3 text-right text-slate-700">{row.count2025}</td>
                                          <td className="px-4 py-3 text-right text-slate-700">{row.count2026}</td>
                                          <td className={cn('px-4 py-3 text-right font-bold', row.diff >= 0 ? 'text-red-600' : 'text-emerald-600')}>{row.diff}</td>
                                        </tr>
                                      ))}
                                    </tbody>
                                  </table>
                                </div>
                              ))}
                            </div>

                            <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
                              <div className="overflow-hidden rounded-lg border border-slate-100">
                                <div className="border-b border-slate-100 bg-slate-50 px-4 py-3">
                                  <h4 className="text-sm font-bold text-slate-900">实际检泵原因与设计检泵原因符合率</h4>
                                </div>
                                <table className="w-full text-sm">
                                  <thead className="bg-white text-slate-600">
                                    <tr>
                                      <th className="px-4 py-3 text-left font-semibold">年份</th>
                                      <th className="px-4 py-3 text-right font-semibold">可对比数</th>
                                      <th className="px-4 py-3 text-right font-semibold">符合数</th>
                                      <th className="px-4 py-3 text-right font-semibold">不符合数</th>
                                      <th className="px-4 py-3 text-right font-semibold">符合率</th>
                                    </tr>
                                  </thead>
                                  <tbody className="divide-y divide-slate-100">
                                    {[
                                      ['2025', pumpDeepAnalysisData.conformity2025],
                                      ['2026', pumpDeepAnalysisData.conformity2026]
                                    ].map(([year, item]) => {
                                      const stat = item as typeof pumpDeepAnalysisData.conformity2026;
                                      return (
                                        <tr key={year as string} className="hover:bg-slate-50">
                                          <td className="px-4 py-3 font-semibold text-slate-900">{year as string}</td>
                                          <td className="px-4 py-3 text-right text-slate-700">{stat.total}</td>
                                          <td className="px-4 py-3 text-right text-emerald-700">{stat.matched}</td>
                                          <td className="px-4 py-3 text-right text-red-600">{stat.unmatched}</td>
                                          <td className="px-4 py-3 text-right font-bold text-slate-900">{formatChartNumber(stat.rate * 100, 1)}%</td>
                                        </tr>
                                      );
                                    })}
                                  </tbody>
                                </table>
                              </div>

                              <div className="overflow-hidden rounded-lg border border-slate-100">
                                <div className="border-b border-slate-100 bg-slate-50 px-4 py-3">
                                  <h4 className="text-sm font-bold text-slate-900">设计原因与实际原因关系 Top</h4>
                                </div>
                                <div className="grid grid-cols-1 divide-y divide-slate-100 lg:grid-cols-2 lg:divide-x lg:divide-y-0">
                                  {[
                                    ['2025', pumpDeepAnalysisData.relation2025],
                                    ['2026', pumpDeepAnalysisData.relation2026]
                                  ].map(([year, rows]) => (
                                    <div key={year as string} className="p-4">
                                      <div className="mb-3 text-sm font-bold text-slate-900">{year as string}</div>
                                      <div className="space-y-2">
                                        {(rows as typeof pumpDeepAnalysisData.relation2026).slice(0, 6).map((row) => (
                                          <div key={`${year}-${row.design}-${row.actual}`} className="rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-700">
                                            <span className="font-semibold">{row.design}</span>
                                            <span className="px-1 text-slate-400">→</span>
                                            <span className="font-semibold">{row.actual}</span>
                                            <span className="float-right text-slate-500">{row.count} 条</span>
                                          </div>
                                        ))}
                                      </div>
                                    </div>
                                  ))}
                                </div>
                              </div>
                            </div>

                            <div className="chart-card h-[420px]">
                              <ReactECharts option={getPumpBlockComparisonChartOption(pumpDeepAnalysisData.blockRows)} style={{ height: '100%' }} />
                            </div>

                            <div className="overflow-x-auto rounded-lg border border-slate-100">
                              <div className="border-b border-slate-100 bg-slate-50 px-4 py-3">
                                <h4 className="text-sm font-bold text-slate-900">各区块检泵数量与类型同期对比</h4>
                                <p className="mt-1 text-xs text-slate-500">
                                  对比截止日期按 2026 年最后一个有效“交井日期/作业日期”计算：{pumpDeepAnalysisData.latest2026Date || '--'}；2025 年按同月同日截取。
                                </p>
                              </div>
                              <table className="w-full min-w-[920px] text-sm">
                                <thead className="bg-white text-slate-600">
                                  <tr>
                                    <th className="px-4 py-3 text-left font-semibold">区块</th>
                                    <th className="px-4 py-3 text-right font-semibold">2025数量</th>
                                    <th className="px-4 py-3 text-right font-semibold">2026数量</th>
                                    <th className="px-4 py-3 text-right font-semibold">变化</th>
                                    <th className="px-4 py-3 text-left font-semibold">2025类型</th>
                                    <th className="px-4 py-3 text-left font-semibold">2026类型</th>
                                  </tr>
                                </thead>
                                <tbody className="divide-y divide-slate-100">
                                  {pumpDeepAnalysisData.blockRows.map((row) => (
                                    <tr key={row.block} className="hover:bg-slate-50">
                                      <td className="px-4 py-3 font-semibold text-slate-900">{row.block}</td>
                                      <td className="px-4 py-3 text-right text-slate-700">{row.count2025}</td>
                                      <td className="px-4 py-3 text-right text-slate-700">{row.count2026}</td>
                                      <td className={cn('px-4 py-3 text-right font-bold', row.diff >= 0 ? 'text-red-600' : 'text-emerald-600')}>{row.diff}</td>
                                      <td className="px-4 py-3 text-slate-700">{row.types2025}</td>
                                      <td className="px-4 py-3 text-slate-700">{row.types2026}</td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </div>
                          </div>
                        ) : (
                          <div className="flex h-[220px] items-center justify-center rounded-lg border border-dashed border-slate-200 bg-slate-50 text-sm text-slate-400">
                            请先在“文件上传”中上传检泵分析 Excel，随后可按上传文档自定义生成分析。
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              )}

              {activeTab === 'waterLab' && (
                <div className="page-stack">
                  <div className="app-card overflow-hidden border-t-4 border-t-sky-500">
                    <button
                      type="button"
                      className="flex w-full items-center justify-between px-6 py-5 text-left"
                      onClick={() => setWaterLabExpanded(prev => ({ ...prev, upload: !prev.upload }))}
                    >
                      <div>
                        <h3 className="text-lg font-bold text-slate-900">文件上传</h3>
                        <p className="mt-1 text-sm text-slate-500">上传含水化验 Excel 文件，写入独立本地 SQLite；再次上传只覆盖含水化验数据。</p>
                      </div>
                      <ChevronRight className={cn('h-5 w-5 text-slate-400 transition-transform', waterLabExpanded.upload ? 'rotate-90' : '')} />
                    </button>
                    {waterLabExpanded.upload && (
                      <div className="space-y-5 border-t border-slate-100 p-6">
                        <div className="flex flex-wrap items-start justify-between gap-4">
                          <div className="grid flex-1 grid-cols-1 gap-4 lg:grid-cols-3">
                            <div className="rounded-lg border border-slate-100 bg-slate-50 p-4">
                              <div className="text-sm font-bold text-slate-700">当前文件</div>
                              <div className="mt-2 break-all text-sm text-slate-600">{decodeMojibakeText(waterLabUpload.fileName || '暂未上传')}</div>
                            </div>
                            <div className="rounded-lg border border-slate-100 bg-slate-50 p-4">
                              <div className="text-sm font-bold text-slate-700">工作表</div>
                              <div className="mt-2 text-sm text-slate-600">{waterLabUpload.sheetName || '--'}</div>
                            </div>
                            <div className="rounded-lg border border-slate-100 bg-slate-50 p-4">
                              <div className="text-sm font-bold text-slate-700">识别结果</div>
                              <div className="mt-2 text-sm text-slate-600">
                                {waterLabUpload.rows.length > 0 ? `${waterLabUpload.rows.length} 行，${waterLabUpload.columns.length} 个字段` : '等待上传文件'}
                              </div>
                            </div>
                          </div>
                          <label className={cn('action-button action-primary cursor-pointer', waterLabUploading && 'pointer-events-none opacity-60')}>
                            <FileSpreadsheet className="h-4 w-4" />
                            {waterLabUploading ? '上传中...' : '上传 Excel'}
                            <input type="file" accept=".xlsx,.xls,.csv" className="hidden" onChange={handleWaterLabExcelUpload} />
                          </label>
                        </div>

                        {waterLabUpload.error && (
                          <div className="rounded-lg border border-amber-100 bg-amber-50 px-4 py-3 text-sm text-amber-700">{waterLabUpload.error}</div>
                        )}

                        {waterLabUpload.columns.length > 0 && (
                          <div>
                            <h4 className="text-sm font-bold text-slate-800">已识别字段</h4>
                            <div className="mt-3 flex flex-wrap gap-2">
                              {waterLabUpload.columns.map((column) => (
                                <span key={column} className="status-pill bg-sky-50 text-sky-700">{column}</span>
                              ))}
                            </div>
                          </div>
                        )}

                        {waterLabUpload.columns.length > 0 ? (
                          <div className="overflow-x-auto rounded-lg border border-slate-100">
                            <table className="w-full min-w-[900px] text-sm">
                              <thead className="bg-slate-50 text-slate-600">
                                <tr>
                                  {waterLabUpload.columns.slice(0, 10).map((column) => (
                                    <th key={column} className="px-4 py-3 text-left font-semibold">{column}</th>
                                  ))}
                                </tr>
                              </thead>
                              <tbody className="divide-y divide-slate-100">
                                {waterLabUpload.rows.slice(0, 8).map((row, rowIndex) => (
                                  <tr key={rowIndex} className="hover:bg-slate-50">
                                    {waterLabUpload.columns.slice(0, 10).map((column) => (
                                      <td key={column} className="max-w-[220px] truncate px-4 py-3 text-slate-700">{formatOccupancyPreviewValue(column, row[column])}</td>
                                    ))}
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        ) : (
                          <div className="flex h-[220px] flex-col items-center justify-center rounded-lg border border-dashed border-slate-200 bg-slate-50 text-center">
                            <FileSpreadsheet className="mb-3 h-10 w-10 text-slate-300" />
                            <div className="text-sm font-bold text-slate-600">等待上传含水化验 Excel</div>
                            <div className="mt-1 text-xs text-slate-400">仅支持 .xlsx / .xls / .csv</div>
                          </div>
                        )}
                      </div>
                    )}
                  </div>

                  <div className="app-card overflow-hidden">
                    <button
                      type="button"
                      className="flex w-full items-center justify-between px-6 py-5 text-left"
                      onClick={() => setWaterLabExpanded(prev => ({ ...prev, analysis: !prev.analysis }))}
                    >
                      <div>
                        <h3 className="text-lg font-bold text-slate-900">含水化验分析</h3>
                        <p className="mt-1 text-sm text-slate-500">含水化验数据分析入口；后续按井号、日期、化验含水字段生成趋势、异常井和对比表。</p>
                      </div>
                      <ChevronRight className={cn('h-5 w-5 text-slate-400 transition-transform', waterLabExpanded.analysis ? 'rotate-90' : '')} />
                    </button>
                    {waterLabExpanded.analysis && (
                      <div className="space-y-5 border-t border-slate-100 p-6">
                        {waterLabWellList.length === 0 ? (
                          <div className="flex h-[220px] items-center justify-center rounded-lg border border-dashed border-slate-200 bg-slate-50 text-sm text-slate-400">
                            请先在“文件上传”中上传含水化验 Excel。
                          </div>
                        ) : (
                          <>
                            {/* Summary stats */}
                            <div className="grid grid-cols-1 gap-4 md:grid-cols-4">
                              <div className="rounded-lg border border-slate-100 bg-slate-50 p-4">
                                <div className="text-sm font-bold text-slate-700">化验井数</div>
                                <div className="mt-2 text-2xl font-bold text-sky-700">{waterLabWellList.length}</div>
                              </div>
                              <div className="rounded-lg border border-slate-100 bg-slate-50 p-4">
                                <div className="text-sm font-bold text-slate-700">覆盖区块</div>
                                <div className="mt-2 text-2xl font-bold text-sky-700">{waterLabBlockList.length}</div>
                              </div>
                              <div className="rounded-lg border border-slate-100 bg-slate-50 p-4">
                                <div className="text-sm font-bold text-slate-700">月度环比阈值</div>
                                <div className="mt-2 flex items-center gap-2">
                                  <input type="range" min={5} max={50} value={waterLabAnomalyThreshold} onChange={e => setWaterLabAnomalyThreshold(Number(e.target.value))} className="h-2 w-24 accent-sky-500" />
                                  <span className="text-lg font-bold text-sky-700">{waterLabAnomalyThreshold}%</span>
                                </div>
                              </div>
                              <div className="rounded-lg border border-slate-100 bg-slate-50 p-4">
                                <div className="text-sm font-bold text-slate-700">异常检测</div>
                                <button type="button" className={cn('mt-2 action-button action-primary text-sm', waterLabLoading && 'pointer-events-none opacity-60')}
                                  onClick={() => loadWaterLabAnomalies()}>
                                  {waterLabLoading ? '分析中...' : '执行分析'}
                                </button>
                              </div>
                            </div>

                            {/* Well trend */}
                            <div className="rounded-lg border border-slate-100 p-5">
                              <h4 className="text-sm font-bold text-slate-800 mb-3">单井含水趋势</h4>
                              <div className="flex flex-wrap items-end gap-3 mb-4">
                                <select className="field-control min-w-[180px]" value={waterLabSelectedWell}
                                  onChange={e => { setWaterLabSelectedWell(e.target.value); if (e.target.value) loadWaterLabWellTrend(e.target.value); }}>
                                  <option value="">-- 选择井号 --</option>
                                  {waterLabWellList.map(w => (
                                    <option key={w.jh} value={w.jh}>{w.jh} ({w.block})</option>
                                  ))}
                                </select>
                              </div>
                              {waterLabWellTrend ? (
                                <div className="h-[300px]">
                                  <ReactECharts option={{
                                    tooltip: {
                                      trigger: 'axis',
                                      formatter: (params: any[]) => {
                                        if (!Array.isArray(params) || params.length === 0) return '';
                                        const title = params[0]?.axisValueLabel || params[0]?.name || '';
                                        return [
                                          title,
                                          ...params.map((item) => `${item.marker}${item.seriesName}: ${item.value != null ? item.value + '%' : '--'}`)
                                        ].join('<br/>');
                                      }
                                    },
                                    legend: { top: 0, type: 'scroll' },
                                    grid: { left: 64, right: 24, top: 56, bottom: 72 },
                                    xAxis: { type: 'category', data: waterLabWellTrend.dates, boundaryGap: false, axisLabel: { color: '#475569', interval: waterLabWellTrend.dates.length > 10 ? Math.ceil(waterLabWellTrend.dates.length / 8) - 1 : 0, rotate: 0, margin: 14, formatter: (value: string) => { const m = value.match(/^(\d{4})-(\d{2})-(\d{2})$/); return m ? m[2] + '/' + m[3] : value; } } },
                                    yAxis: {
                                      type: 'value',
                                      name: '含水率(%)',
                                      max: 100,
                                      axisLabel: { color: '#475569' },
                                      splitLine: { lineStyle: { type: 'dashed', color: '#e2e8f0' } },
                                      scale: true
                                    },
                                    dataZoom: [{ type: 'inside' }, { type: 'slider', height: 18, bottom: 24 }],
                                    series: [{
                                      name: '化验含水', type: 'line', data: waterLabWellTrend.lab_water_cut,
                                      smooth: true, lineStyle: { color: '#0284c7', width: 2 },
                                      itemStyle: { color: '#0284c7' }, symbol: 'circle', symbolSize: 6,
                                      connectNulls: false,
                                      label: { show: true, position: 'top', fontSize: 10, color: '#0369a1', fontWeight: 'bold', formatter: (p: any) => p.value != null ? p.value + '%' : '' },
                                    }, {
                                      name: '生产含水', type: 'line', data: waterLabWellTrend.prod_water_cut,
                                      smooth: true, lineStyle: { color: '#ef4444', width: 2, type: 'dashed' },
                                      itemStyle: { color: '#ef4444' }, symbol: 'diamond', symbolSize: 5,
                                      connectNulls: false,
                                      markLine: { silent: true, symbol: 'none', data: [{ yAxis: 50, lineStyle: { color: '#f59e0b', type: 'dashed' } }, { yAxis: 80, lineStyle: { color: '#ef4444', type: 'dashed' } }] } }
                                    ]
                                  }} style={{ height: '100%', width: '100%' }} />
                                </div>
                              ) : (
                                <div className="flex h-[120px] items-center justify-center text-sm text-slate-400">请选择井号查看趋势</div>
                              )}
                            </div>

                            {/* Block trend */}
                            <div className="rounded-lg border border-slate-100 p-5">
                              <h4 className="text-sm font-bold text-slate-800 mb-3">区块/站含水趋势</h4>
                              <div className="flex flex-wrap items-end gap-3 mb-4">
                                <select className="field-control min-w-[180px]" value={waterLabSelectedBlock}
                                  onChange={e => { setWaterLabSelectedBlock(e.target.value); setWaterLabSelectedStation(''); if (e.target.value) loadWaterLabBlockTrend(e.target.value); }}>
                                  <option value="">-- 选择区块 --</option>
                                  {waterLabBlockList.map(b => (
                                    <option key={b.block} value={b.block}>{b.block} ({b.well_count}口井)</option>
                                  ))}
                                </select>
                                <span className="text-sm text-slate-400">或</span>
                                <input className="field-control min-w-[140px]" placeholder="输入站名" value={waterLabSelectedStation}
                                  onChange={e => setWaterLabSelectedStation(e.target.value)}
                                  onKeyDown={e => { if (e.key === 'Enter' && waterLabSelectedStation) { setWaterLabSelectedBlock(''); loadWaterLabStationTrend(waterLabSelectedStation); } }} />
                                <button type="button" className="action-button action-secondary text-sm"
                                  onClick={() => { if (waterLabSelectedStation) { setWaterLabSelectedBlock(''); loadWaterLabStationTrend(waterLabSelectedStation); } }}>
                                  查询站
                                </button>
                              </div>
                              {(waterLabBlockTrend || waterLabStationTrend) ? (
                                <div className="h-[300px]">
                                  <ReactECharts option={{
                                    tooltip: {
                                      trigger: 'axis',
                                      formatter: (params: any[]) => {
                                        if (!Array.isArray(params) || params.length === 0) return '';
                                        const title = params[0]?.axisValueLabel || params[0]?.name || '';
                                        return [
                                          title,
                                          ...params.map((item: any) => { const unit = item.seriesName === '井数' ? '口' : '%'; return item.marker + item.seriesName + ': ' + (item.value != null ? item.value + unit : '--'); })
                                        ].join('<br/>');
                                      }
                                    },
                                    legend: { top: 0, type: 'scroll' },
                                    grid: { left: 72, right: 72, top: 56, bottom: 72 },
                                    xAxis: { type: 'category', data: (waterLabBlockTrend || waterLabStationTrend)!.dates, boundaryGap: false, axisLabel: { color: '#475569', interval: ((waterLabBlockTrend || waterLabStationTrend)!.dates?.length || 0) > 10 ? Math.ceil(((waterLabBlockTrend || waterLabStationTrend)!.dates?.length || 0) / 8) - 1 : 0, rotate: 0, margin: 14, formatter: (value: string) => { const m = value.match(/^(\d{4})-(\d{2})-(\d{2})$/); return m ? m[2] + '/' + m[3] : value; } } },
                                    yAxis: [
                                      { type: 'value', name: '含水率(%)', max: 100, axisLabel: { color: '#475569' }, splitLine: { lineStyle: { type: 'dashed', color: '#e2e8f0' } }, scale: true },
                                      { type: 'value', name: '井数', min: 0, axisLabel: { color: '#475569' }, splitLine: { show: false }, scale: true }
                                    ],
                                    dataZoom: [{ type: 'inside' }, { type: 'slider', height: 18, bottom: 24 }],
                                    series: [
                                      {
                                        name: '平均含水', type: 'line', yAxisIndex: 0,
                                        data: (waterLabBlockTrend || waterLabStationTrend)!.avg_water_cut,
                                        smooth: true, lineStyle: { color: '#16a34a', width: 2 }, itemStyle: { color: '#16a34a' },
                                        symbol: 'circle', symbolSize: 6, connectNulls: false,
                                        markLine: { silent: true, symbol: 'none', data: [{ yAxis: 50, lineStyle: { color: '#f59e0b', type: 'dashed' } }, { yAxis: 80, lineStyle: { color: '#ef4444', type: 'dashed' } }] },
                                        label: { show: true, position: 'top', fontSize: 10, color: '#16a34a', fontWeight: 'bold', formatter: (p: any) => p.value != null ? p.value + '%' : '' }
                                      },
                                      {
                                        name: '井数', type: 'bar', yAxisIndex: 1,
                                        data: (waterLabBlockTrend || waterLabStationTrend)!.well_count,
                                        barWidth: 6, itemStyle: { color: '#94a3b8' },
                                        label: { show: true, position: 'top', fontSize: 10, color: '#64748b', formatter: (p: any) => p.value != null ? p.value + '口' : '' }
                                      }
                                    ]
                                  }} style={{ height: '100%', width: '100%' }} />
                                </div>
                               ) : null}

                            {/* Anomalies */}
                            {waterLabAnomalies && (
                              <div className="rounded-lg border border-slate-100 p-5">
                                <h4 className="text-sm font-bold text-slate-800 mb-3">
                                  异常井列表
                                  <span className="ml-2 text-xs text-slate-500">{waterLabAnomalies.previousMonth} 至 {waterLabAnomalies.currentMonth}（环比突增 &ge; {waterLabAnomalies.threshold}%）</span>
                                </h4>
                                {waterLabAnomalies.anomalies.length === 0 ? (
                                  <div className="rounded-lg border border-emerald-100 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
                                    未检测到异常井，所有井含水环比变化均在阈值以下。
                                  </div>
                                ) : (
                                  <div className="overflow-x-auto rounded-lg border border-slate-100">
                                    <table className="w-full text-sm">
                                      <thead className="bg-slate-50 text-slate-600">
                                        <tr>
                                          <th className="px-4 py-3 text-left font-semibold">井号</th>
                                          <th className="px-4 py-3 text-left font-semibold">区块</th>
                                          <th className="px-4 py-3 text-left font-semibold">站名</th>
                                          <th className="px-4 py-3 text-right font-semibold">上月含水</th>
                                          <th className="px-4 py-3 text-right font-semibold">本月含水</th>
                                          <th className="px-4 py-3 text-right font-semibold">涨幅</th>
                                          <th className="px-4 py-3 text-left font-semibold">日期</th>
                                        </tr>
                                      </thead>
                                      <tbody className="divide-y divide-slate-100">
                                        {waterLabAnomalies.anomalies.map((row, i) => (
                                          <tr key={i} className={cn('hover:bg-slate-50', row.rise >= 30 ? 'bg-red-50' : row.rise >= 20 ? 'bg-amber-50' : '')}>
                                            <td className="px-4 py-3 font-medium text-slate-900">{row.jh}</td>
                                            <td className="px-4 py-3 text-slate-600">{row.block}</td>
                                            <td className="px-4 py-3 text-slate-600">{row.station}</td>
                                            <td className="px-4 py-3 text-right text-slate-600">{row.previous_water_cut}%</td>
                                            <td className="px-4 py-3 text-right font-semibold text-slate-900">{row.current_water_cut}%</td>
                                            <td className={cn('px-4 py-3 text-right font-bold', row.rise >= 30 ? 'text-red-600' : 'text-amber-600')}>+{row.rise}%</td>
                                            <td className="px-4 py-3 text-slate-500">{row.record_date}</td>
                                          </tr>
                                        ))}
                                      </tbody>
                                    </table>
                                  </div>
                                )}
                              </div>
                            )}
                    </div>
                          </>
                        )}
                      </div>
                    )}
                  </div>



                  <div className="app-card overflow-hidden border-t-4 border-t-amber-500">
                        <button
                          type="button"
                          className="flex w-full items-center justify-between px-6 py-5 text-left"
                          onClick={() => setWaterLabExpanded(prev => ({ ...prev, compare: !prev.compare }))}
                        >
                          <div>
                            <h3 className="text-lg font-bold text-slate-900">化验-生产含水对比</h3>
                            <p className="mt-1 text-sm text-slate-500">自动对比最近一个月内化验含水与生产数据库含水平均值，筛选偏差超过阈值的油井。</p>
                          </div>
                          <ChevronRight className={cn('h-5 w-5 text-slate-400 transition-transform', waterLabExpanded.compare ? 'rotate-90' : '')} />
                        </button>
                        {waterLabExpanded.compare && (
                          <div className="space-y-5 border-t border-slate-100 p-6">
                            {waterLabWellList.length === 0 ? (
                              <div className="flex h-[220px] items-center justify-center rounded-lg border border-dashed border-slate-200 bg-slate-50 text-sm text-slate-400">
                                请先在文件上传中上传含水化验 Excel
                              </div>
                            ) : (
                              <>
                                <div className="flex flex-wrap items-end gap-4">
                                  <div className="flex items-center gap-2">
                                    <span className="text-sm font-bold text-slate-700">偏差阈值</span>
                                    <input type="range" min={10} max={60} value={waterLabCompareThreshold} onChange={e => setWaterLabCompareThreshold(Number(e.target.value))} className="h-2 w-24 accent-amber-500" />
                                    <span className="text-lg font-bold text-amber-700">{waterLabCompareThreshold}%</span>
                                  </div>
                                  <button type="button"
                                    className={cn('action-button action-primary text-sm', waterLabLoading && 'pointer-events-none opacity-60')}
                                    onClick={() => loadWaterLabCompare()}>
                                    {waterLabLoading ? '对比中...' : '执行对比'}
                                  </button>
                                  {waterLabCompareResult?.deviations?.length > 0 && (
                                    <button type="button" className="action-button action-secondary text-sm" onClick={exportWaterLabCompare}>
                                      导出 Excel
                                    </button>
                                  )}
                                  <span className="text-xs text-slate-400">对比最近30天</span>
                                </div>
    
                                {waterLabCompareResult && (
                                  <>
                                    <div className="rounded-lg border border-slate-100 bg-slate-50 p-4">
                                      <div className="flex flex-wrap gap-6 text-sm">
                                        <div><span className="text-slate-500">日期范围：</span><span className="font-bold text-slate-800">{waterLabCompareResult.startDate} 至 {waterLabCompareResult.endDate}</span></div>
                                        <div><span className="text-slate-500">偏差阈值：</span><span className="font-bold text-amber-700">&ge; {waterLabCompareResult.threshold}%</span></div>
                                        <div><span className="text-slate-500">筛选结果：</span><span className="font-bold text-red-600">{waterLabCompareResult.deviations.length} 口井</span></div>
                                      </div>
                                    </div>
    
                                    {waterLabCompareResult.deviations.length === 0 ? (
                                      <div className="rounded-lg border border-emerald-100 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
                                        未检测到化验含水与生产含水偏差超过阈值的油井
                                      </div>
                                    ) : (
                                      <div className="overflow-x-auto rounded-lg border border-slate-100">
                                        <table className="w-full text-sm">
                                          <thead className="bg-slate-50 text-slate-600">
                                            <tr>
                                              <th className="px-4 py-3 text-left font-semibold">井号</th>
                                              <th className="px-4 py-3 text-left font-semibold">区块</th>
                                              <th className="px-4 py-3 text-right font-semibold">化验次数</th>
                                              <th className="px-4 py-3 text-right font-semibold">化验平均含水</th>
                                              <th className="px-4 py-3 text-right font-semibold">生产平均含水</th>
                                              <th className="px-4 py-3 text-right font-semibold">偏差</th>
                                            </tr>
                                          </thead>
                                          <tbody className="divide-y divide-slate-100">
                                            {waterLabCompareResult.deviations.map((row, i) => (
                                              <tr key={i} className={cn('hover:bg-slate-50', row.deviation >= 50 ? 'bg-red-50' : row.deviation >= 30 ? 'bg-amber-50' : '')}>
                                                <td className="px-4 py-3 font-medium text-slate-900">{row.jh}</td>
                                                <td className="px-4 py-3 text-slate-600">{row.block}</td>
                                                <td className="px-4 py-3 text-right text-slate-600">{row.lab_count}</td>
                                                <td className="px-4 py-3 text-right font-semibold text-sky-700">{row.lab_avg}%</td>
                                                <td className="px-4 py-3 text-right font-semibold text-slate-900">{row.prod_avg}%</td>
                                                <td className={cn('px-4 py-3 text-right font-bold', row.deviation >= 50 ? 'text-red-600' : 'text-amber-600')}>{row.deviation}%</td>
                                              </tr>
                                            ))}
                                          </tbody>
                                        </table>
                                      </div>
                                    )}
                                  </>
                                )}
                              </>
                            )}
                          </div>
                        )}
                      </div>
    

                  <div className="app-card overflow-hidden border-t-4 border-t-emerald-500">
                    <button
                      type="button"
                      className="flex w-full items-center justify-between px-6 py-5 text-left"
                      onClick={() => setWaterLabExpanded(prev => ({ ...prev, keyWell: !prev.keyWell }))}
                    >
                      <div>
                        <h3 className="text-lg font-bold text-slate-900">重点井含水跟踪</h3>
                        <p className="mt-1 text-sm text-slate-500">高含水井（&gt;80%）监控、化验缺失提醒、措施井本轮/上轮含水对比告警。</p>
                      </div>
                      <ChevronRight className={cn('h-5 w-5 text-slate-400 transition-transform', waterLabExpanded.keyWell ? 'rotate-90' : '')} />
                    </button>
                    {waterLabExpanded.keyWell && (
                      <div className="space-y-5 border-t border-slate-100 p-6">
                        {/* Filter controls */}
                        <div className="flex flex-wrap items-end gap-4 rounded-lg border border-slate-100 bg-slate-50 p-4">
                          <div className="flex flex-col gap-1">
                            <label className="text-xs font-medium text-slate-500">高含水阈值 (%)</label>
                            <input type="number" min={50} max={100} className="field-control w-20 text-center" value={keyWellFilters.highWc}
                              onChange={e => setKeyWellFilters(prev => ({ ...prev, highWc: Math.max(50, Math.min(100, Number(e.target.value) || 80)) }))} />
                          </div>
                          <div className="flex flex-col gap-1">
                            <label className="text-xs font-medium text-slate-500">未化验警报 (天)</label>
                            <input type="number" min={1} max={30} className="field-control w-20 text-center" value={keyWellFilters.labGap}
                              onChange={e => setKeyWellFilters(prev => ({ ...prev, labGap: Math.max(1, Math.min(30, Number(e.target.value) || 3)) }))} />
                          </div>
                          <div className="flex flex-col gap-1">
                            <label className="text-xs font-medium text-slate-500">含水对比阈值 (%)</label>
                            <input type="number" min={5} max={50} className="field-control w-20 text-center" value={keyWellFilters.wcDiff}
                              onChange={e => setKeyWellFilters(prev => ({ ...prev, wcDiff: Math.max(5, Math.min(50, Number(e.target.value) || 20)) }))} />
                          </div>
                          <button type="button"
                            className={cn('action-button action-primary text-sm', keyWellTrackingLoading && 'pointer-events-none opacity-60')}
                            onClick={() => loadKeyWellTracking()}>
                            {keyWellTrackingLoading ? '加载中...' : '加载重点井'}
                          </button>
                          {keyWellTracking && (
                            <button type="button" className="action-button action-secondary text-sm" onClick={exportKeyWellTracking}>
                              导出 Excel
                            </button>
                          )}
                        </div>

                        {keyWellTracking && (
                          <>
                            {/* Summary bar */}
                            <div className="rounded-lg border border-slate-100 bg-slate-50 p-4">
                              <div className="flex flex-wrap gap-6 text-sm">
                                <div><span className="text-slate-500">化验最新日期：</span><span className="font-bold text-slate-800">{keyWellTracking.labMaxDate}</span></div>
                                <div><span className="text-slate-500">高含水井（&gt;{keyWellFilters.highWc}%）：</span><span className="font-bold text-red-600">{keyWellTracking.highWaterWells.length} 口</span></div>
                                <div><span className="text-slate-500">含水对比异常（&ge;{keyWellFilters.wcDiff}%）：</span><span className="font-bold text-amber-600">{keyWellTracking.measureWcAlerts.length} 口</span></div>
                              </div>
                            </div>

                            {keyWellTracking.highWaterWells.length === 0 && keyWellTracking.measureWcAlerts.length === 0 ? (
                              <div className="rounded-lg border border-emerald-100 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
                                当前未发现高含水井或含水对比异常井
                              </div>
                            ) : (
                              <div className="space-y-6">
                                {/* Feature 1: High water cut wells */}
                                {keyWellTracking.highWaterWells.length > 0 && (
                                  <div>
                                    <h4 className="text-sm font-bold text-red-700 mb-3">高含水井（化验或生产含水 &gt; 80%）</h4>
                                    <div className="overflow-x-auto rounded-lg border border-red-100">
                                      <table className="w-full text-sm">
                                        <thead className="bg-red-50 text-slate-600">
                                          <tr>
                                            <th className="px-4 py-3 text-left font-semibold">井号</th>
                                            <th className="px-4 py-3 text-left font-semibold">区块</th>
                                            <th className="px-4 py-3 text-right font-semibold">化验含水</th>
                                            <th className="px-4 py-3 text-right font-semibold">生产含水</th>
                                            <th className="px-4 py-3 text-center font-semibold">化验日期</th>
                                            <th className="px-4 py-3 text-center font-semibold">状态</th>
                                          </tr>
                                        </thead>
                                        <tbody className="divide-y divide-red-50">
                                          {keyWellTracking.highWaterWells.map((well, i) => (
                                            <tr key={i} className={cn('hover:bg-red-50/50', well.no_lab_alert ? 'bg-amber-50' : '')}>
                                              <td className="px-4 py-3 font-medium text-slate-900">{well.jh}</td>
                                              <td className="px-4 py-3 text-slate-600">{well.block || '--'}</td>
                                              <td className={cn('px-4 py-3 text-right font-bold', (well.latest_lab_wc || 0) >= 80 ? 'text-red-600' : 'text-slate-600')}>{well.latest_lab_wc != null ? well.latest_lab_wc + '%' : '--'}</td>
                                              <td className={cn('px-4 py-3 text-right font-bold', (well.latest_prod_wc || 0) >= 80 ? 'text-red-600' : 'text-slate-600')}>{well.latest_prod_wc != null ? well.latest_prod_wc + '%' : '--'}</td>
                                              <td className="px-4 py-3 text-center text-slate-500">{well.latest_lab_date || '--'}</td>
                                              <td className="px-4 py-3 text-center">
                                                {well.no_lab_alert ? (
                                                  <span className="px-2 py-0.5 rounded text-xs font-medium bg-amber-100 text-amber-700">
                                                    {well.days_since_last_lab == null ? '无化验记录' : `${well.days_since_last_lab}天未化验`}
                                                  </span>
                                                ) : (
                                                  <span className="px-2 py-0.5 rounded text-xs font-medium bg-emerald-100 text-emerald-700">正常</span>
                                                )}
                                              </td>
                                            </tr>
                                          ))}
                                        </tbody>
                                      </table>
                                    </div>
                                  </div>
                                )}

                                {/* Feature 2: Measure wells water cut comparison */}
                                {keyWellTracking.measureWcAlerts.length > 0 && (
                                  <div>
                                    <h4 className="text-sm font-bold text-amber-700 mb-3">措施井含水对比异常（本轮 vs 上轮同期，差距 &ge; 20%）</h4>
                                    <div className="overflow-x-auto rounded-lg border border-amber-100">
                                      <table className="w-full text-sm">
                                        <thead className="bg-amber-50 text-slate-600">
                                          <tr>
                                            <th className="px-4 py-3 text-left font-semibold">井号</th>
                                            <th className="px-4 py-3 text-left font-semibold">区块</th>
                                            <th className="px-4 py-3 text-right font-semibold">生产天数</th>
                                            <th className="px-4 py-3 text-right font-semibold">上轮含水</th>
                                            <th className="px-4 py-3 text-right font-semibold">本轮含水</th>
                                            <th className="px-4 py-3 text-right font-semibold">差距</th>
                                            <th className="px-4 py-3 text-left font-semibold">转抽时间</th>
                                          </tr>
                                        </thead>
                                        <tbody className="divide-y divide-amber-50">
                                          {keyWellTracking.measureWcAlerts.map((item, i) => (
                                            <tr key={i} className={cn('hover:bg-amber-50/50', Math.abs(item.diff) >= 30 ? 'bg-red-50' : '')}>
                                              <td className="px-4 py-3 font-medium text-slate-900">{item.jh}</td>
                                              <td className="px-4 py-3 text-slate-600">{item.block || '--'}</td>
                                              <td className="px-4 py-3 text-right text-slate-700">{item.production_days} 天</td>
                                              <td className="px-4 py-3 text-right font-semibold text-slate-700">{item.previous_avg_wc}%</td>
                                              <td className="px-4 py-3 text-right font-bold text-red-600">{item.current_avg_wc}%</td>
                                              <td className={cn('px-4 py-3 text-right font-bold', item.diff > 0 ? 'text-red-600' : 'text-emerald-600')}>{item.diff > 0 ? '+' : ''}{item.diff}%</td>
                                              <td className="px-4 py-3 text-slate-500">{item.current_transfer_time}</td>
                                            </tr>
                                          ))}
                                        </tbody>
                                      </table>
                                    </div>
                                  </div>
                                )}
                              </div>
                            )}
                          </>
                        )}
                      </div>
                    )}
                  </div>


                </div>
              )}
              {activeTab === 'productionForecast' && (
                <div className="page-stack">
                  {/* 盘库预测 */}
                  <div className="app-card overflow-hidden border-t-4 border-t-blue-500 mt-6">
                    <div className="px-6 py-5">
                      <h3 className="text-lg font-bold text-slate-900">盘库预测</h3>
                      <p className="mt-1 text-sm text-slate-500">上传旬度盘库 Excel 文件，基于线性回归模型预测未来2个月的盘库产量趋势。</p>
                    </div>
                    <div className="space-y-5 border-t border-slate-100 p-6">
                      <div className="flex flex-wrap items-end gap-4">
                        <label className={cn('action-button action-primary cursor-pointer', inventoryUploading && 'pointer-events-none opacity-60')}>
                          {inventoryUploading ? '上传中...' : '上传旬度盘库 Excel'}
                          <input type="file" accept=".xlsx,.xls,.csv" className="hidden" onChange={handleInventoryUpload} />
                        </label>
                        <span className="text-xs text-slate-400">Excel 需包含日期列和盘库产量列，支持旬度格式（如"1月上旬"）</span>
                      </div>

                      {inventoryError && (
                        <div className="rounded-lg border border-red-100 bg-red-50 px-4 py-3 text-sm text-red-700">{inventoryError}</div>
                      )}

                      {inventoryPrediction ? (
                        <div className="chart-card h-[380px]">
                          <ReactECharts
                            option={(() => {
                              const d = inventoryPrediction;
                              const fmt = (v: string) => { const m = v.match(/^(\d{4})-(\d{2})-(\d{2})$/); return m ? `${m[2]}/${m[3]}` : v; };
                              const xInt = Math.max(1, Math.ceil(d.dates.length / 14));
                              return {
                                title: { text: '旬度盘库产量预测（未来2个月）', left: 'center', textStyle: { fontSize: 14, fontWeight: 700, color: '#0f172a' } },
                                tooltip: { trigger: 'axis', formatter: (p: any[]) => { const t = p[0]?.axisValueLabel || ''; return [t, ...p.map(i => `${i.marker}${i.seriesName}: ${formatChartNumber(i.value, 1)} t`)].join('<br/>'); } },
                                legend: { top: 28, data: ['实际盘库', '预测盘库'] },
                                grid: { left: 80, right: 24, top: 72, bottom: 64 },
                                xAxis: { type: 'category', data: d.dates, axisLabel: { color: '#475569', interval: xInt, rotate: 0, formatter: fmt } },
                                yAxis: { type: 'value', name: '盘库产量(t)', splitLine: { lineStyle: { type: 'dashed', color: '#e2e8f0' } }, scale: true },
                                dataZoom: [{ type: 'inside' }, { type: 'slider', height: 18, bottom: 24 }],
                                series: [
                                  { name: '实际盘库', type: 'bar', data: d.actual, barMaxWidth: 24, itemStyle: { color: '#2563eb' },
                                    label: { show: true, position: 'top', fontSize: 10, formatter: (p: any) => p.value > 0 ? formatChartNumber(p.value, 0) : '' } },
                                  { name: '预测盘库', type: 'bar', data: d.predicted, barMaxWidth: 24, itemStyle: { color: '#f59e0b' },
                                    label: { show: true, position: 'top', fontSize: 10, formatter: (p: any) => p.value > 0 ? formatChartNumber(p.value, 0) : '' } }
                                ]
                              };
                            })()}
                            style={{ height: '100%' }}
                          />
                        </div>
                      ) : (
                        <div className="flex h-[200px] items-center justify-center rounded-lg border border-dashed border-slate-200 bg-slate-50 text-sm text-slate-400">
                          请上传旬度盘库 Excel 文件以生成预测曲线
                        </div>
                      )}
                    </div>
                  </div>
                  <div className="app-card overflow-hidden border-t-4 border-t-amber-500">
                    <div className="px-6 py-5">
                      <h3 className="text-lg font-bold text-slate-900">产量预测</h3>
                      <p className="mt-1 text-sm text-slate-500">基于措施跟踪中各状态井的上轮生产数据，按规则模拟本轮未来365天的产油/产液趋势。</p>
                    </div>
                    <div className="space-y-5 border-t border-slate-100 p-6">
                      <div className="flex flex-wrap items-end gap-4">
                        <button type="button" className={cn('action-button action-primary', forecastLoading && 'pointer-events-none opacity-60')}
                          onClick={() => loadProductionForecast()}>
                          {forecastLoading ? '生成中...' : '生成预测曲线'}
                        </button>
                        <span className="text-xs text-slate-400">
                          生产 = 本轮转抽时间；转注 = 转注时间+30天；正注 = 开注时间+20天；焖井 = 停注时间+10天 | 均取上轮365天数据
                        </span>
                      </div>

                      {forecastError && (
                        <div className="rounded-lg border border-red-100 bg-red-50 px-4 py-3 text-sm text-red-700">{forecastError}</div>
                      )}

                      {forecastData && (
                        <div className="space-y-6">
                          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                            {(['生产', '焖井', '正注', '转注'] as const).map((key) => (
                              <div key={key} className={cn('rounded-lg border p-4',
                                key === '生产' ? 'border-emerald-100 bg-emerald-50' :
                                key === '转注' ? 'border-purple-100 bg-purple-50' :
                                key === '正注' ? 'border-blue-100 bg-blue-50' :
                                'border-amber-100 bg-amber-50')}>
                                <div className="text-sm font-bold text-slate-700">{key}井</div>
                                <div className="mt-1 text-2xl font-bold text-slate-900">{forecastData[key].wellCount} 口</div>
                              </div>
                            ))}
                          </div>

                          {/* Combined stacked area chart */}
                          {(() => {
                            const cats = (['生产', '焖井', '正注', '转注'] as const).filter(k => forecastData[k].wellCount > 0);
                            if (cats.length === 0) return null;
                            const colors: Record<string, string> = { '生产': '#16a34a', '转注': '#8b5cf6', '正注': '#2563eb', '焖井': '#f59e0b' };
                            const yearStart = `${new Date().getFullYear()}-01-01`;
                            // X-axis: Jan 1 to today + 2 months
                            const now = new Date();
                            const endDate = new Date(now.getFullYear(), now.getMonth() + 2, now.getDate());
                            const totalDays = Math.ceil((endDate.getTime() - new Date(yearStart).getTime()) / 86400000);
                            const dateLabels = Array.from({ length: totalDays }, (_, i) => {
                              const dt = new Date(yearStart); dt.setDate(dt.getDate() + i);
                              return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}-${String(dt.getDate()).padStart(2, "0")}`;
                            });
                            // Pad each category data so they align to Jan 1
                            const paddedSeries: Record<string, number[]> = {};
                            for (const k of cats) {
                              const raw = forecastData[k].aggregate.tenDayOil || [];
                              const offset = forecastData[k].minPredictedStart
                                ? Math.max(0, Math.floor((new Date(forecastData[k].minPredictedStart).getTime() - new Date(yearStart).getTime()) / 86400000))
                                : 0;
                              paddedSeries[k] = [...Array(offset).fill(0), ...raw].slice(0, totalDays);
                            }
                            const fmtCombDate = (d: string) => { const m = d.match(/^(\d{4})-(\d{2})-(\d{2})$/); return m ? `${m[2]}/${m[3]}` : d; };
                            const combXInterval = Math.max(2, Math.ceil(totalDays / 12));
                            const totalLabels = Array.from({ length: totalDays }, (_, i) => {
                              const total = cats.reduce((s, k) => s + (paddedSeries[k]?.[i] || 0), 0);
                              return Number(total.toFixed(1));
                            });
                            return (
                              <div className="chart-card h-[400px]">
                                <ReactECharts
                                  option={{
                                    title: { text: '四类预测旬度日产油叠加', left: 'center', textStyle: { fontSize: 14, fontWeight: 700, color: '#0f172a' } },
                                    tooltip: { trigger: 'axis', formatter: (p: any[]) => { const t = p[0]?.axisValueLabel || ''; return [t, ...p.map(i => `${i.marker}${i.seriesName}: ${formatChartNumber(i.value, 1)} t/d`)].join('<br/>'); } },
                                    legend: { top: 28, data: [...cats, '合计'] },
                                    grid: { left: 72, right: 64, top: 80, bottom: 64 },
                                    xAxis: { type: 'category', data: dateLabels, axisLabel: { color: '#475569', interval: combXInterval, rotate: 0, formatter: fmtCombDate } },
                                    yAxis: { type: 'value', name: '旬度日产油(t/d)', splitLine: { lineStyle: { type: 'dashed', color: '#e2e8f0' } }, scale: true },
                                    dataZoom: [{ type: 'inside' }, { type: 'slider', height: 18, bottom: 24 }],
                                    series: [
                                      ...cats.map(k => ({
                                        name: k,
                                        type: 'line',
                                        stack: 'total',
                                        data: paddedSeries[k] || [],
                                        smooth: true, symbol: 'none',
                                        lineStyle: { width: 1, color: colors[k] },
                                        areaStyle: { color: colors[k] + '60' },
                                        emphasis: { focus: 'series' },
                                        label: {
                                          show: true, fontSize: 10, fontWeight: 'bold', color: colors[k],
                                          formatter: (p: any) => formatChartNumber(p.value, 1)
                                        }
                                      })),
                                      {
                                        name: '合计', type: 'line', data: totalLabels,
                                        smooth: true, symbol: 'circle', symbolSize: 4,
                                        lineStyle: { width: 2.5, color: '#D32F2F' },
                                        label: {
                                          show: true, position: 'top', fontSize: 11, color: '#D32F2F', fontWeight: 'bold',
                                          formatter: (p: any) => formatChartNumber(p.value, 1)
                                        }
                                      }
                                    ]
                                  }}
                                  style={{ height: '100%' }}
                                />
                              </div>
                            );
                          })()}

                          {/* Ten-day delta chart */}
                          {(() => {
                            const cats = (['生产', '焖井', '正注', '转注'] as const).filter(k => forecastData[k].wellCount > 0);
                            if (cats.length === 0) return null;
                            // Pad each category data to Jan 1 for proper alignment
                            const yearStart = `${new Date().getFullYear()}-01-01`;
                            const nowD = new Date(); const endD = new Date(nowD.getFullYear(), nowD.getMonth() + 2, nowD.getDate());
                            const maxLen = Math.ceil((endD.getTime() - new Date(yearStart).getTime()) / 86400000);
                            const paddedDelta: Record<string, number[]> = {};
                            for (const k of cats) {
                              const raw = forecastData[k].aggregate.tenDayOil || [];
                              const offset = forecastData[k].minPredictedStart
                                ? Math.max(0, Math.floor((new Date(forecastData[k].minPredictedStart).getTime() - new Date(yearStart).getTime()) / 86400000))
                                : 0;
                              paddedDelta[k] = [...Array(offset).fill(0), ...raw].slice(0, maxLen);
                            }
                            const totalByDay = Array.from({ length: maxLen }, (_, i) =>
                              cats.reduce((s, k) => s + (paddedDelta[k]?.[i] || 0), 0)
                            );
                            // Compute 10-day deltas with dates from Jan 1
                            const makeDate = (offset: number) => {
                              const dt = new Date(yearStart);
                              dt.setDate(dt.getDate() + offset);
                              return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}-${String(dt.getDate()).padStart(2, "0")}`;
                            };
                            const fmtD = (v: string) => { const m = v.match(/^(\d{4})-(\d{2})-(\d{2})$/); return m ? `${m[2]}/${m[3]}` : v; };
                            const deltaLabels: string[] = [];
                            const deltaValues: number[] = [];
                            for (let i = 10; i < maxLen; i += 10) {
                              const end = Math.min(i + 9, maxLen - 1);
                              const prevSum = totalByDay.slice(Math.max(0, i - 10), i).reduce((s, v) => s + v, 0);
                              const currSum = totalByDay.slice(i, end + 1).reduce((s, v) => s + v, 0);
                              const prevAvg = prevSum / Math.min(10, i);
                              const currAvg = currSum / Math.min(10, end - i + 1);
                              deltaLabels.push(makeDate(i));
                              deltaValues.push(Number((currAvg - prevAvg).toFixed(1)));
                            }
                            const dInt = Math.max(1, Math.ceil(deltaLabels.length / 12));
                            return (
                              <div className="chart-card h-[340px]">
                                <ReactECharts
                                  option={{
                                    title: { text: '旬度叠加产量变化', left: 'center', textStyle: { fontSize: 14, fontWeight: 700, color: '#0f172a' } },
                                    tooltip: { trigger: 'axis', formatter: (p: any[]) => { const t = p[0]?.axisValueLabel || ''; return [t, ...p.map(i => `${i.marker}旬度产量变化: ${formatChartNumber(i.value, 1)} t/d`)].join('<br/>'); } },
                                    grid: { left: 80, right: 24, top: 56, bottom: 64 },
                                    xAxis: { type: 'category', data: deltaLabels, axisLabel: { color: '#475569', interval: dInt, rotate: 0, formatter: fmtD } },
                                    yAxis: { type: 'value', name: '产量变化(t/d)', splitLine: { lineStyle: { type: 'dashed', color: '#e2e8f0' } }, scale: true },
                                    dataZoom: [{ type: 'inside' }, { type: 'slider', height: 18, bottom: 24 }],
                                    series: [{
                                      name: '旬度产量变化', type: 'bar', data: deltaValues, barMaxWidth: 28,
                                      itemStyle: { color: (p: any) => p.value >= 0 ? '#16a34a' : '#ef4444' },
                                      label: {
                                        show: true, position: 'top', fontSize: 10, fontWeight: 'bold',
                                        color: '#475569',
                                        formatter: (p: any) => formatChartNumber(p.value, 1)
                                      }
                                    }]
                                  }}
                                  style={{ height: '100%' }}
                                />
                              </div>
                            );
                          })()}

                          {(['生产', '焖井', '正注', '转注'] as const).map((key) => {
                            const cat = forecastData[key];
                            if (cat.wellCount === 0) return null;
                            const catColor = key === '生产' ? '#16a34a' : key === '转注' ? '#8b5cf6' : key === '正注' ? '#2563eb' : '#f59e0b';
                            // Pad data so x-axis starts from Jan 1, actual data begins at minPredictedStart
                            const yearStart = `${new Date().getFullYear()}-01-01`;
                            const rawData = cat.aggregate.tenDayOil || [];
                            const offsetDays = cat.minPredictedStart ? Math.max(0, Math.floor((new Date(cat.minPredictedStart).getTime() - new Date(yearStart).getTime()) / 86400000)) : 0;
                            const paddedData = offsetDays > 0 ? [...Array(offsetDays).fill(0), ...rawData] : rawData;
                            const dates = Array.from({ length: paddedData.length }, (_, i) => { const dt = new Date(yearStart); dt.setDate(dt.getDate() + i); return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}-${String(dt.getDate()).padStart(2, "0")}`; });
                            const xInterval = Math.max(2, Math.ceil(dates.length / 12));
                            const labelInterval = dates.length > 60 ? Math.ceil(dates.length / 24) : Math.max(2, Math.ceil(dates.length / 12));
                            const fmtDate = (d: string) => { const m = d.match(/^(\d{4})-(\d{2})-(\d{2})$/); return m ? `${m[2]}/${m[3]}` : d; };
                            return (
                              <div key={key} className="space-y-3">
                                <h4 className="text-sm font-bold text-slate-900">{cat.label}（{cat.wellCount} 口井）</h4>
                                <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                                  <div className="chart-card h-[340px]">
                                    <ReactECharts
                                      option={{
                                        title: { text: `${key}井旬度日产油`, left: 'center', textStyle: { fontSize: 13, fontWeight: 700, color: '#0f172a' } },
                                        tooltip: { trigger: 'axis', formatter: (p: any[]) => { const t = p[0]?.axisValueLabel || ''; return [t, ...p.map(i => `${i.marker}${i.seriesName}: ${formatChartNumber(i.value, 1)} t/d`)].join('<br/>'); } },
                                        legend: { top: 26, data: ['旬度日产油'] },
                                        grid: { left: 72, right: 64, top: 72, bottom: 64 },
                                        xAxis: { type: 'category', data: dates, axisLabel: { color: '#475569', interval: xInterval, rotate: 0, formatter: fmtDate } },
                                        yAxis: { type: 'value', name: '旬度日产油(t/d)', splitLine: { lineStyle: { type: 'dashed', color: '#e2e8f0' } }, scale: true },
                                        dataZoom: [{ type: 'inside' }, { type: 'slider', height: 18, bottom: 24 }],
                                        series: [{
                                          name: '旬度日产油', type: 'line', data: paddedData || [],
                                          smooth: true, symbol: 'circle', symbolSize: 5, lineStyle: { width: 2.5, color: '#D32F2F' },
                                          label: {
                                            show: true, position: 'top', fontSize: 11, color: '#D32F2F', fontWeight: 'bold',
                                            formatter: (p: any) => formatChartNumber(p.value, 1)
                                          }
                                        }]
                                      }}
                                      style={{ height: '100%' }}
                                    />
                                  </div>
                                  <div className="chart-card h-[340px]">
                                    <ReactECharts
                                      option={(() => {
                                        const td = paddedData || [];
                                        const deltaVals: number[] = []; const deltaLbls: string[] = [];
                                        for (let i = 10; i < td.length; i += 10) {
                                          const prev = td.slice(i - 10, i).reduce((s, v) => s + v, 0) / 10;
                                          const curr = td.slice(i, Math.min(i + 9, td.length - 1) + 1).reduce((s, v) => s + v, 0) / Math.min(10, td.length - i);
                                          deltaLbls.push(fmtDate(dates[i] || ''));
                                          deltaVals.push(Number((curr - prev).toFixed(1)));
                                        }
                                        const dInt = Math.max(1, Math.ceil(deltaLbls.length / 12));
                                        return {
                                          title: { text: `${key}井旬度日产油变化`, left: 'center', textStyle: { fontSize: 13, fontWeight: 700, color: '#0f172a' } },
                                          tooltip: { trigger: 'axis', formatter: (p: any[]) => { const t = p[0]?.axisValueLabel || ''; return [t, ...p.map(i => `${i.marker}: ${formatChartNumber(i.value, 1)} t/d`)].join('<br/>'); } },
                                          grid: { left: 72, right: 24, top: 56, bottom: 64 },
                                          xAxis: { type: 'category', data: deltaLbls, axisLabel: { color: '#475569', interval: dInt } },
                                          yAxis: { type: 'value', name: '产量变化(t/d)', splitLine: { lineStyle: { type: 'dashed', color: '#e2e8f0' } }, scale: true },
                                          dataZoom: [{ type: 'inside' }, { type: 'slider', height: 18, bottom: 24 }],
                                          series: [{
                                            name: '旬度产量变化', type: 'bar', data: deltaVals, barMaxWidth: 28,
                                            itemStyle: { color: (p: any) => p.value >= 0 ? '#16a34a' : '#ef4444' },
                                            label: { show: true, position: 'top', fontSize: 10, fontWeight: 'bold', color: '#475569', formatter: (p: any) => formatChartNumber(p.value, 1) }
                                          }]
                                        };
                                      })()}
                                      style={{ height: '100%' }}
                                    />
                                  </div>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              )}

              {activeTab === 'measures' && (
              <div className="page-stack">
                <input
                  ref={measureImportInputRef}
                  type="file"
                  accept=".xlsx,.xls,.csv"
                  className="hidden"
                  onChange={handleMeasureExcelImport}
                />

                <div className="app-card space-y-5 border-t-4 border-t-emerald-500 p-6">
                  <div className="flex flex-wrap items-end gap-4">
                    <div className="space-y-2">
                      <label className="text-sm font-bold text-gray-700">开始转抽时间</label>
                      <input
                        type="date"
                        className="field-control"
                        value={measureQuery.start}
                        onChange={(e) => setMeasureQuery(prev => ({ ...prev, start: e.target.value }))}
                      />
                    </div>
                    <div className="space-y-2">
                      <label className="text-sm font-bold text-gray-700">结束转抽时间</label>
                      <input
                        type="date"
                        className="field-control"
                        value={measureQuery.end}
                        onChange={(e) => setMeasureQuery(prev => ({ ...prev, end: e.target.value }))}
                      />
                    </div>
                    <div className="space-y-2">
                      <label className="text-sm font-bold text-gray-700">区块</label>
                      <select
                        className="field-control min-w-[140px]"
                        value={measureQuery.block}
                        onChange={(e) => setMeasureQuery(prev => ({ ...prev, block: e.target.value }))}
                      >
                        <option value="">全部区块</option>
                        {measureFilterMeta.blocks.map(item => <option key={item} value={item}>{item}</option>)}
                      </select>
                    </div>
                    <div className="space-y-2">
                      <label className="text-sm font-bold text-gray-700">计量站</label>
                      <select
                        className="field-control min-w-[140px]"
                        value={measureQuery.station}
                        onChange={(e) => setMeasureQuery(prev => ({ ...prev, station: e.target.value }))}
                      >
                        <option value="">全部计量站</option>
                        {measureFilterMeta.stations.map(item => <option key={item} value={item}>{item}</option>)}
                      </select>
                    </div>
                    <div className="space-y-2">
                      <label className="text-sm font-bold text-gray-700">状态</label>
                      <select
                        className="field-control min-w-[120px]"
                        value={measureQuery.status}
                        onChange={(e) => setMeasureQuery(prev => ({ ...prev, status: e.target.value }))}
                      >
                        <option value="">全部状态</option>
                        {[...new Set([...DEFAULT_MEASURE_STATUS_OPTIONS, ...measureFilterMeta.statuses])].map(item => <option key={item} value={item}>{item}</option>)}
                      </select>
                    </div>
                    <div className="space-y-2" style={{ minWidth: '100px' }}>
                      <label className="text-sm font-bold text-gray-700">年份</label>
                      <select
                        className="field-control"
                        value={measureQuery.year}
                        onChange={(e) => setMeasureQuery(prev => ({ ...prev, year: e.target.value }))}
                      >
                        <option value="">全部年份</option>
                        {measureAvailableYears.map(y => <option key={y} value={y}>{y}</option>)}
                      </select>
                    </div>
                    <div className="space-y-2 min-w-[220px] flex-1">
                      <label className="text-sm font-bold text-gray-700">关键字</label>
                      <input
                        type="text"
                  placeholder="请输入井号、措施类型或备注"
                        className="field-control w-full"
                        value={measureQuery.keyword}
                        onChange={(e) => setMeasureQuery(prev => ({ ...prev, keyword: e.target.value }))}
                      />
                    </div>
                  </div>

                  {measureCockpitAlertFilter && (
                    <div className="status-banner status-banner-info flex items-center justify-between gap-3">
                      <span>????????{measureCockpitAlertFilter.type}?{displayedMeasures.length} ???</span>
                      <button type="button" className="action-button action-outline" onClick={() => setMeasureCockpitAlertFilter(null)}>??????</button>
                    </div>
                  )}

                  <div className="flex flex-wrap gap-3">
                    <button
                      onClick={() => loadMeasures()}
                      className="action-button action-primary"
                    >
                      查询
                    </button>
                    <div className="flex rounded-lg border border-gray-200 overflow-hidden">
                      <button
                        onClick={() => setMeasureMetricMode('cumulative_oil')}
                        className={cn(
                          'h-10 px-4 text-sm font-bold transition-colors',
                          measureMetricMode === 'cumulative_oil' ? 'bg-emerald-600 text-white' : 'bg-white text-gray-700 hover:bg-gray-50'
                        )}
                      >
                        措施累产油
                      </button>
                      <button
                        onClick={() => setMeasureMetricMode('cumulative_oil_gain')}
                        className={cn(
                          'h-10 px-4 text-sm font-bold transition-colors border-l border-gray-200',
                          measureMetricMode === 'cumulative_oil_gain' ? 'bg-emerald-600 text-white border-l-emerald-700' : 'bg-white text-gray-700 hover:bg-gray-50'
                        )}
                      >
                        措施累增油
                      </button>
                    </div>
                    <button
                      onClick={openCreateMeasureForm}
                      className="action-button action-danger"
                    >
                      新增
                    </button>
                    <div className="flex items-center gap-2">
                      <input
                        type="text"
                        className="field-control w-20 text-center"
                        placeholder="年份"
                        value={measureImportYear}
                        onChange={(e) => setMeasureImportYear(e.target.value.replace(/\D/g, '').slice(0, 4))}
                        title="导入数据的年份（如2025），同名年份的旧数据将被覆盖"
                      />
                      <button
                        onClick={() => measureImportInputRef.current?.click()}
                        disabled={measureImporting}
                        className="action-button action-blue"
                      >
                        {measureImporting ? '导入中...' : '导入 Excel'}
                      </button>
                    </div>
                    <button
                      onClick={exportMeasuresToExcel}
                      disabled={measures.length === 0}
                      className="action-button action-primary"
                    >
                      导出 Excel
                    </button>
                  </div>
                </div>

                {showMeasureForm && (
                  <div className="app-card space-y-4 p-6">
                    <div className="flex items-center justify-between gap-4">
                      <div>
                        <h3 className="text-lg font-bold text-gray-800">{editingMeasureId ? '编辑措施记录' : '新增措施记录'}</h3>
                        <p className="text-sm text-gray-500 mt-1">支持页面手工维护，建议以 Excel 覆盖导入为主。</p>
                      </div>
                      <button
                        onClick={() => {
                          setShowMeasureForm(false);
                          resetMeasureForm();
                        }}
                        className="action-button action-outline"
                      >
                        关闭
                      </button>
                    </div>
                    <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
                      <div className="space-y-4 xl:col-span-2">
                        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                          <label className="space-y-2 text-sm text-gray-600">
                            <span className="font-medium text-gray-700">本轮转抽时间</span>
                            <input type="date" className="w-full border rounded px-3 py-2 text-sm outline-none focus:border-[#10b981]" value={measureForm.measure_date} onChange={(e) => setMeasureForm(prev => ({ ...prev, measure_date: e.target.value }))} />
                          </label>
                          <label className="space-y-2 text-sm text-gray-600">
                            <span className="font-medium text-gray-700">井号</span>
                            <input type="text" placeholder="如：GC-001" className="field-control w-full" value={measureForm.jh} onChange={(e) => setMeasureForm(prev => ({ ...prev, jh: e.target.value }))} />
                          </label>
                          <label className="space-y-2 text-sm text-gray-600">
                            <span className="font-medium text-gray-700">目前状态</span>
                            <select className="field-control w-full" value={measureForm.status} onChange={(e) => setMeasureForm(prev => ({ ...prev, status: e.target.value }))}>
                              {[...new Set([...DEFAULT_MEASURE_STATUS_OPTIONS, ...measureFilterMeta.statuses])].map(item => <option key={item} value={item}>{item}</option>)}
                            </select>
                          </label>
                          <label className="space-y-2 text-sm text-gray-600">
                            <span className="font-medium text-gray-700">区块</span>
                            <input type="text" placeholder="请输入区块" className="field-control w-full" value={measureForm.block} onChange={(e) => setMeasureForm(prev => ({ ...prev, block: e.target.value }))} />
                          </label>
                          <label className="space-y-2 text-sm text-gray-600">
                            <span className="font-medium text-gray-700">计量站</span>
                            <input type="text" placeholder="所属计量站" className="field-control w-full" value={measureForm.station} onChange={(e) => setMeasureForm(prev => ({ ...prev, station: e.target.value }))} />
                          </label>
                          <label className="space-y-2 text-sm text-gray-600">
                            <span className="font-medium text-gray-700">责任人/班组</span>
                            <input type="text" placeholder="请输入责任人或班组" className="field-control w-full" value={measureForm.owner} onChange={(e) => setMeasureForm(prev => ({ ...prev, owner: e.target.value }))} />
                          </label>
                        </div>

                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                          <label className="space-y-2 text-sm text-gray-600">
                            <span className="font-medium text-gray-700">本轮措施类型</span>
                            <input type="text" placeholder="请输入措施类型" className="field-control w-full" value={measureForm.measure_type} onChange={(e) => setMeasureForm(prev => ({ ...prev, measure_type: e.target.value }))} />
                          </label>
                          <label className="space-y-2 text-sm text-gray-600">
                            <span className="font-medium text-gray-700">措施名称</span>
                            <input type="text" placeholder="请输入措施名称" className="field-control w-full" value={measureForm.measure_name} onChange={(e) => setMeasureForm(prev => ({ ...prev, measure_name: e.target.value }))} />
                          </label>
                        </div>

                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                          <label className="space-y-2 text-sm text-gray-600">
                            <span className="font-medium text-gray-700">效果描述</span>
                            <textarea placeholder="请输入效果描述" className="field-control min-h-[88px] w-full" value={measureForm.result_text} onChange={(e) => setMeasureForm(prev => ({ ...prev, result_text: e.target.value }))} />
                          </label>
                          <label className="space-y-2 text-sm text-gray-600">
                            <span className="font-medium text-gray-700">备注</span>
                            <textarea placeholder="请输入备注" className="field-control min-h-[88px] w-full" value={measureForm.remark} onChange={(e) => setMeasureForm(prev => ({ ...prev, remark: e.target.value }))} />
                          </label>
                        </div>
                      </div>

                      <div className="bg-gray-50 border border-gray-100 rounded-xl p-4 space-y-4">
                        <div>
                          <h4 className="font-bold text-gray-800">计算说明</h4>
                          <p className="text-xs text-gray-500 mt-1">目前液、目前油、目前掺油、目前含水从生产库获取；默认按本轮转抽后逐日累计产油进行评价，可切换查看按同期日增油计算的评价与数据。</p>
                        </div>
                        <label className="space-y-2 text-sm text-gray-600 block">
                          <span className="font-medium text-gray-700">增液</span>
                          <input type="number" placeholder="0" className="field-control w-full" value={measureForm.liquid_gain} onChange={(e) => setMeasureForm(prev => ({ ...prev, liquid_gain: Number(e.target.value) || 0 }))} />
                        </label>
                        <div className="rounded-lg border border-emerald-100 bg-emerald-50 px-3 py-3 text-sm text-emerald-700">
                          {measureForm.status === '生产' ? '生产状态将纳入曲线和评价统计' : measureForm.status === '焖井' ? '焖井状态保留跟踪记录' : measureForm.status === '正注' ? '正注状态保留跟踪记录' : '转注状态保留跟踪记录'}
                        </div>
                      </div>
                    </div>
                    <div className="flex gap-3">
                      <button
                        onClick={submitMeasureForm}
                        disabled={measuresSaving}
                        className="action-button action-primary"
                      >
                        {measuresSaving ? '保存中...' : '保存'}
                      </button>
                      <button
                        onClick={() => {
                          setShowMeasureForm(false);
                          resetMeasureForm();
                        }}
                        className="action-button action-outline"
                      >
                        取消
                      </button>
                    </div>
                  </div>
                )}

                {showMeasureDetail && selectedMeasureDetail && (
                  <div className="fixed inset-y-0 right-0 left-64 z-30 overflow-y-auto bg-slate-100 p-8 space-y-5">
                  <div className="app-card space-y-5 p-6">
                    <div className="flex items-center justify-between gap-4">
                      <div>
                        <h3 className="text-lg font-bold text-gray-800">措施详情</h3>
                        <p className="text-sm text-gray-500 mt-1">井号：{selectedMeasureDetail.jh || '--'}，本轮转抽时间：{selectedMeasureDetail.current_round_transfer_time || '--'}</p>
                      </div>
                      <button
                        onClick={() => {
                          setShowMeasureDetail(false);
                          setSelectedMeasureDetail(null);
                        }}
                        className="action-button action-outline"
                      >
                        关闭
                      </button>
                    </div>

                    <div className="space-y-4 text-sm">
                      <div className="border rounded-lg overflow-hidden bg-white">
                        <div className="grid grid-cols-[1.2fr_1fr_1fr_0.8fr] bg-gray-100 text-gray-700 text-xs font-bold uppercase">
                          <div className="px-4 py-3 border-r border-gray-200">对比项</div>
                          <div className="px-4 py-3 border-r border-gray-200 text-right">本轮详情</div>
                          <div className="px-4 py-3 border-r border-gray-200 text-right">上轮详情</div>
                          <div className="px-4 py-3 text-center">对比结果</div>
                        </div>
                        {measureDetailCompareRows.length === 0 ? (
                          <div className="px-4 py-6 text-gray-400">暂无本轮/上轮详情</div>
                        ) : (
                          measureDetailCompareRows.map((row) => {
                            const diff = getMeasureDetailDiff(row);
                            return (
                              <div key={row.label} className="grid grid-cols-[1.2fr_1fr_1fr_0.8fr] border-t border-gray-100">
                                <div className="px-4 py-3 border-r border-gray-100 bg-gray-50 text-gray-600 break-all">{row.label}</div>
                                <div className="px-4 py-3 border-r border-gray-100 text-right text-gray-800 break-all">{row.currentKey ? formatMeasureDetailValue(row.currentKey, row.currentValue) : '--'}</div>
                                <div className="px-4 py-3 border-r border-gray-100 text-right text-gray-800 break-all">{row.previousKey ? formatMeasureDetailValue(row.previousKey, row.previousValue) : '--'}</div>
                                <div className={cn('px-4 py-3 text-center font-medium', diff?.className || 'text-gray-400')}>
                                  {diff?.text || '--'}
                                </div>
                              </div>
                            );
                          })
                        )}
                      </div>
                      <div className="border rounded-lg p-4 bg-gray-50 space-y-3">
                        <h4 className="font-bold text-gray-800">补充信息</h4>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-gray-700">
                          <div className="rounded-lg bg-white border border-gray-100 px-3 py-2">原始状态：{selectedMeasureDetail.detail?.rawStatus || '--'}</div>
                          <div className="rounded-lg bg-white border border-gray-100 px-3 py-2">原始评价：{selectedMeasureDetail.detail?.rawEvaluation || '--'}</div>
                        </div>
                        {Object.entries(selectedMeasureDetail.detail?.rawExtras || {}).length === 0 ? (
                          <div className="text-gray-400">暂无补充字段</div>
                        ) : (
                          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                            {Object.entries(selectedMeasureDetail.detail?.rawExtras || {}).map(([key, value]) => (
                              <div key={key} className="rounded-lg bg-white border border-gray-100 px-3 py-2 flex justify-between gap-3">
                                <span className="text-gray-500 break-all">{key}</span>
                                <span className="text-gray-800 text-right break-all">{formatMeasureDetailValue(key, value)}</span>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                  </div>

                  <div className="bg-white rounded-lg shadow-sm border border-gray-100 p-6 space-y-4">
                    <div>
                      <h3 className="text-lg font-bold text-gray-800">单井本轮/上轮同期曲线</h3>
                      <p className="text-sm text-gray-500 mt-1">
                        本轮：{measureDetailCharts.currentRange ? `${measureDetailCharts.currentRange.start} 至 ${measureDetailCharts.currentRange.end}` : '--'}
                        {measureDetailCharts.previousRange ? `；上轮同期：${measureDetailCharts.previousRange.start} 至 ${measureDetailCharts.previousRange.end}` : ''}
                      </p>
                    </div>

                    {measureDetailCharts.loading ? (
                      <div className="h-[240px] flex items-center justify-center text-sm text-gray-500">曲线数据加载中...</div>
                    ) : (
                      <>
                        {measureDetailCharts.error && (
                          <div className="rounded-lg border border-amber-100 bg-amber-50 px-4 py-3 text-sm text-amber-700">
                            {measureDetailCharts.error}
                          </div>
                        )}
                        {measureDetailCharts.currentData && measureDetailCharts.currentData.dates.length > 0 ? (
                          <div className="grid grid-cols-1 gap-6">
                            <div className="h-[360px] rounded-lg border border-gray-100 bg-white p-4">
                              <ReactECharts
                                option={getChartOption(
                                  "本轮 产液 / 上轮同期产液",
                                  measureDetailCharts.currentData.dates,
                                  measureDetailCharts.currentData.liquid,
                                  "日产液(t)",
                                  "#2563eb",
                                  false,
                                  padSeries(measureDetailCharts.previousData?.liquid, measureDetailCharts.currentData.dates.length),
                                  "上轮同期"
                                )}
                                style={{ height: '100%' }}
                              />
                            </div>
                            <div className="h-[360px] rounded-lg border border-gray-100 bg-white p-4">
                              <ReactECharts
                                option={getChartOption(
                                  "本轮 产油 / 上轮同期产油",
                                  measureDetailCharts.currentData.dates,
                                  measureDetailCharts.currentData.oil,
                                  "日产油(t)",
                                  "#D32F2F",
                                  false,
                                  padSeries(measureDetailCharts.previousData?.oil, measureDetailCharts.currentData.dates.length),
                                  "上轮同期"
                                )}
                                style={{ height: '100%' }}
                              />
                            </div>
                            <div className="h-[360px] rounded-lg border border-gray-100 bg-white p-4">
                              <ReactECharts
                                option={getChartOption(
                                  "本轮含水 / 上轮同期含水",
                                  measureDetailCharts.currentData.dates,
                                  measureDetailCharts.currentData.water_cut,
                                  "含水率(%)",
                                  "#16a34a",
                                  true,
                                  padSeries(measureDetailCharts.previousData?.water_cut, measureDetailCharts.currentData.dates.length),
                                  "上轮同期"
                                )}
                                style={{ height: '100%' }}
                              />
                            </div>
                            <div className="h-[360px] rounded-lg border border-gray-100 bg-white p-4">
                              <ReactECharts
                                option={getChartOption(
                                  "本轮掺油 / 上轮同期掺油",
                                  measureDetailCharts.currentData.dates,
                                  measureDetailCharts.currentData.diluent,
                                  "掺油(t)",
                                  "#9c27b0",
                                  false,
                                  padSeries(measureDetailCharts.previousData?.diluent, measureDetailCharts.currentData.dates.length),
                                  "上轮同期"
                                )}
                                style={{ height: '100%' }}
                              />
                            </div>
                            <div className="h-[360px] rounded-lg border border-gray-100 bg-white p-4">
                              <ReactECharts
                                option={getChartOption(
                                  "本轮产气 / 上轮同期产气",
                                  measureDetailCharts.currentData.dates,
                                  measureDetailCharts.currentData.gas,
                                  "产气(m3)",
                                  "#facc15",
                                  false,
                                  padSeries(measureDetailCharts.previousData?.gas, measureDetailCharts.currentData.dates.length),
                                  "上轮同期"
                                )}
                                style={{ height: '100%' }}
                              />
                            </div>
                          </div>
                        ) : (
                          <div className="h-[240px] flex items-center justify-center text-sm text-gray-400">暂无可展示的本轮曲线数据</div>
                        )}
                      </>
                    )}
                  </div>
                  </div>
                )}

                {measureClassAnalysis.evaluation && (
                  <div className="fixed inset-y-0 right-0 left-64 z-30 overflow-y-auto bg-[#F0F2F5] p-8 space-y-5">
                    <div className="bg-white rounded-lg shadow-sm border border-gray-100 p-6 flex flex-wrap items-center justify-between gap-4">
                      <div>
                        <h3 className="text-lg font-bold text-gray-800">{measureClassAnalysis.evaluation} 类井汇总曲线</h3>
                        <p className="text-sm text-gray-500 mt-1">
                          共 {measureClassAnalysis.wellCount} 条记录；横坐标为 {measureClassAnalysis.currentData?.dates[0] || '2026-01-01'} 至 {(measureClassAnalysis.currentData?.dates[measureClassAnalysis.currentData.dates.length - 1] || syncStatus?.lastLocalDataDate || new Date().toISOString().slice(0, 10))} 的自然日期，汇总本轮与上轮同期日产液、日产油、含水、掺油、日产气。
                        </p>
                      </div>
                      <button
                        onClick={() => setMeasureClassAnalysis({ evaluation: null, currentData: null, previousData: null, loading: false, error: '', wellCount: 0 })}
                        className="cursor-pointer rounded border border-gray-200 bg-white px-4 py-2 text-sm font-bold text-gray-600 hover:bg-gray-50 hover:text-gray-900"
                      >
                        返回列表
                      </button>
                    </div>

                    <div className="bg-white rounded-lg shadow-sm border border-gray-100 p-6 space-y-4">
                      {measureClassAnalysis.loading ? (
                      <div className="h-[240px] flex items-center justify-center text-sm text-gray-500">类别曲线加载中...</div>
                      ) : measureClassAnalysis.error ? (
                        <div className="rounded-lg border border-amber-100 bg-amber-50 px-4 py-3 text-sm text-amber-700">
                          {measureClassAnalysis.error}
                        </div>
                      ) : measureClassAnalysis.currentData ? (
                        <div className="grid grid-cols-1 gap-6">
                          {measureClassChartConfigs.map((config) => (
                            <div key={config.key} className="h-[360px] rounded-lg border border-gray-100 bg-white p-4">
                              <ReactECharts
                                option={getChartOption(
                                  `${measureClassAnalysis.evaluation} 类${config.title.replace("A/B/C/D类", "")}`,
                                  measureClassAnalysis.currentData!.dates,
                                  measureClassAnalysis.currentData![config.key],
                                  config.yAxis,
                                  config.color,
                                  config.percent,
                                  padSeries(measureClassAnalysis.previousData?.[config.key], measureClassAnalysis.currentData!.dates.length),
                                  "上轮同期"
                                )}
                                style={{ height: '100%' }}
                              />
                            </div>
                          ))}
                          <div className="border-t border-slate-100 pt-2">
                            <div className="mb-1 text-sm font-bold text-slate-800">
                              {measureClassAnalysis.evaluation} 类井平均日产油统计
                            </div>
                            <p className="text-xs text-slate-500">
                              基于此类所有油井日产油求和后，按月度/旬度计算平均日产油，并与上轮同期对比。
                            </p>
                          </div>
                          <div className="h-[380px] rounded-lg border border-gray-100 bg-white p-4">
                            <ReactECharts
                              option={getAverageOilPeriodOption(
                                `${measureClassAnalysis.evaluation}类月度平均日产油`,
                                measureClassMonthlyAverageOil
                              )}
                              style={{ height: '100%' }}
                            />
                          </div>
                          <div className="h-[420px] rounded-lg border border-gray-100 bg-white p-4">
                            <ReactECharts
                              option={getAverageOilPeriodOption(
                                `${measureClassAnalysis.evaluation}类旬度平均日产油`,
                                measureClassTenDayAverageOil,
                                '#f97316'
                              )}
                              style={{ height: '100%' }}
                            />
                          </div>
                        </div>
                      ) : (
                        <div className="h-[240px] flex items-center justify-center text-sm text-gray-400">暂无可展示的类别曲线数据</div>
                      )}
                    </div>
                  </div>
                )}

                {measureImportDialog.open && (
                  <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/35 px-4">
                    <div className="w-full max-w-2xl rounded-2xl bg-white shadow-2xl border border-gray-100 overflow-hidden">
                      <div className={cn(
                        'px-6 py-4 border-b',
                        measureImportDialog.kind === 'error'
                          ? 'bg-red-50 border-red-100'
                          : measureImportDialog.kind === 'success'
                            ? 'bg-emerald-50 border-emerald-100'
                            : 'bg-blue-50 border-blue-100'
                      )}>
                        <div className="flex items-start justify-between gap-4">
                          <div>
                            <h3 className="text-lg font-bold text-gray-800">{measureImportDialog.title}</h3>
                            <p className="text-sm text-gray-600 mt-1">
                              {measureImportDialog.kind === 'preview'
                                ? '即将覆盖导入措施跟踪数据'
                                : measureImportDialog.kind === 'success'
                                  ? '导入已完成，请检查结果'
                                  : '导入文件校验结果'}
                            </p>
                          </div>
                          <button
                            onClick={closeMeasureImportDialog}
                            disabled={measureImporting}
                            className="text-sm text-gray-500 hover:text-gray-800 disabled:opacity-50"
                          >
                            关闭
                          </button>
                        </div>
                      </div>

                      <div className="px-6 py-5 space-y-4">
                        <div className={cn(
                          'rounded-xl border px-4 py-3 text-sm',
                          measureImportDialog.kind === 'error'
                            ? 'border-red-100 bg-red-50 text-red-700'
                            : measureImportDialog.kind === 'success'
                              ? 'border-emerald-100 bg-emerald-50 text-emerald-700'
                              : 'border-blue-100 bg-blue-50 text-blue-700'
                        )}>
                          {measureImportDialog.message || '--'}
                        </div>

                        <div className="rounded-xl border border-gray-100 bg-gray-50 px-4 py-4">
                          <div className="text-sm font-bold text-gray-800 mb-3">摘要信息</div>
                          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-sm text-gray-700">
                            {measureImportSummaryLines.map((line) => (
                              <div key={line} className="rounded-lg bg-white border border-gray-100 px-3 py-2 break-all">
                                {line}
                              </div>
                            ))}
                            {measureImportSummaryLines.length === 0 && (
                              <div className="text-gray-400">暂无可展示的导入摘要</div>
                            )}
                          </div>
                        </div>

                        {measureImportDialog.meta?.yearMismatch && measureImportDialog.kind === 'preview' && (
                          <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 font-bold">
                            ⚠ 年份不匹配：你输入的年份为「{measureImportDialog.meta.expectedYear}」，但 Excel 中数据转抽时间的年份为「{measureImportDialog.meta.dataYear}」，不一致！请检查年份输入框。
                          </div>
                        )}
                        {!measureImportDialog.meta?.yearMismatch && measureImportDialog.meta?.dataYear && measureImportDialog.kind === 'preview' && (
                          <div className="rounded-xl border border-emerald-100 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
                            ✓ 年份匹配：数据年份「{measureImportDialog.meta.dataYear}」与你输入的「{measureImportDialog.meta.expectedYear || measureImportDialog.meta.dataYear}」一致
                          </div>
                        )}
                        {measureImportDialog.kind === 'preview' && (
                          <div className="rounded-xl border border-amber-100 bg-amber-50 px-4 py-3 text-sm text-amber-700">
                            确认后将使用该文件覆盖「{measureImportDialog.meta?.expectedYear || measureImportDialog.meta?.dataYear || measureImportYear}」年的措施跟踪数据；同名年份的旧数据将被替换，其他年份不受影响。
                          </div>
                        )}
                      </div>

                      <div className="px-6 py-4 border-t border-gray-100 bg-gray-50 flex justify-end gap-3">
                        <button
                          onClick={closeMeasureImportDialog}
                          disabled={measureImporting}
                          className="bg-white text-gray-700 px-5 py-2 rounded font-bold border border-gray-200 hover:bg-gray-100 transition-colors disabled:opacity-60"
                        >
                          {measureImportDialog.kind === 'preview' ? '取消' : '知道了'}
                        </button>
                        {measureImportDialog.kind === 'preview' && (
                          <button
                            onClick={confirmMeasureExcelImport}
                            disabled={measureImporting}
                            className="bg-[#10b981] text-white px-5 py-2 rounded font-bold hover:bg-emerald-700 transition-colors disabled:opacity-60"
                          >
                            {measureImporting ? '导入中...' : '确认覆盖导入'}
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                )}

                <div className="app-card overflow-hidden">
                  <div className="app-card-header flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <h3 className="font-bold text-gray-800">措施跟踪列表（共 {measures.length} 条）</h3>
                      <p className="text-sm text-gray-500 mt-1">支持 Excel 覆盖导入与详情对比查看</p>
                    </div>
                    <div className="flex flex-wrap gap-2 text-xs">
                      {['A', 'B', 'C', 'D'].map((item) => (
                        <button
                          key={item}
                          type="button"
                          onClick={() => void openMeasureClassAnalysis(item)}
                          className="status-pill cursor-pointer bg-white text-slate-700 ring-1 ring-slate-200 transition-colors hover:bg-emerald-100 hover:text-emerald-700 hover:ring-emerald-200"
                          title={`生成 ${item} 类井汇总曲线`}
                        >
                          {item}类
                        </button>
                      ))}
                      <span className="status-pill bg-green-100 text-green-700">生产</span>
                      <span className="status-pill bg-amber-100 text-amber-700">焖井</span>
                      <span className="status-pill bg-blue-100 text-blue-700">正注</span>
                      <span className="status-pill bg-purple-100 text-purple-700">转注</span>
                    </div>
                  </div>
                  {measuresLoading ? (
                    <div className="h-[220px] flex items-center justify-center text-sm text-gray-500">措施数据加载中...</div>
                  ) : measures.length === 0 ? (
                    <div className="h-[220px] flex items-center justify-center text-sm text-gray-400">暂无措施数据，请先导入 Excel 或手动新增</div>
                  ) : (
                    <div className="max-h-[calc(100vh-300px)] overflow-auto">
                      <table
                        className="measure-table w-full text-left text-sm"
                        onClick={(event) => {
                          const header = (event.target as HTMLElement).closest('th');
                          if (header && [12, 13, 14].includes(header.cellIndex)) {
                            setMeasureEvaluationSorted(true);
                          }
                        }}
                      >
                        <thead>
                          <tr>
                            <th>序号</th>
                            <th>井号</th>
                            <th>目前状态</th>
                            <th>区块</th>
                            <th>措施类型</th>
                            <th>转抽时间</th>
                            <th className="text-center">生产天数</th>
                            <th className="text-center">日产液</th>
                            <th className="text-center">日产油</th>
                            <th className="text-center">掺油</th>
                            <th className="text-center">含水</th>
                            <th className="text-center">{measureMetricMode === 'cumulative_oil' ? '本轮累产油' : '累增油'}</th>
                            <th className="text-center">{measureMetricMode === 'cumulative_oil' ? '上轮同期累产油' : '上轮同期累增油'}</th>
                            <th className="text-center">评价</th>
                            <th>详情</th>
                            <th>操作</th>
                          </tr>
                        </thead>
                        <tbody>
                          {displayedMeasures.map((row, index) => (
                            <tr key={row.id}>
                              <td className="font-medium text-gray-900">{row.seq_no || index + 1}</td>
                              <td className="font-semibold text-slate-900">{row.jh || '--'}</td>
                              <td>
                                <span className={cn(
                                  'px-2 py-1 rounded text-xs font-medium',
                                  row.current_status === '生产' ? 'bg-green-100 text-green-700' :
                                  row.current_status === '焖井' ? 'bg-amber-100 text-amber-700' :
                                  row.current_status === '正注' ? 'bg-blue-100 text-blue-700' :
                                  row.current_status === '转注' ? 'bg-purple-100 text-purple-700' :
                                  'bg-gray-100 text-gray-700'
                                )}>
                                  {row.current_status || '--'}
                                </span>
                              </td>
                              <td>{row.block || '--'}</td>
                              <td>{row.current_round_measure_type || '--'}</td>
                              <td>{row.current_status === '生产' ? (row.current_round_transfer_time || '--') : '--'}</td>
                              <td className="text-center">{row.production_days ?? '--'}</td>
                              <td className="text-center">{row.current_liquid ?? '--'}</td>
                              <td className="text-center">{row.current_oil ?? '--'}</td>
                              <td className="text-center">{row.current_diluent ?? '--'}</td>
                              <td className="text-center">{row.current_water_cut ?? '--'}</td>
                              <td className="text-center font-medium text-slate-900">{measureMetricMode === 'cumulative_oil' ? (row.cumulative_oil ?? '--') : (row.cumulative_oil_gain ?? '--')}</td>
                              <td className="text-center font-medium text-slate-900">{measureMetricMode === 'cumulative_oil' ? (row.previous_period_cumulative_oil ?? '--') : (row.previous_period_oil_gain ?? '--')}</td>
                              <td className="text-center font-bold text-slate-900">{getMeasureEvaluationValue(row) || '--'}</td>
                              <td>
                                <button onClick={() => openMeasureDetail(row)} className="cursor-pointer text-emerald-600 font-bold hover:underline hover:text-emerald-800">详情</button>
                              </td>
                              <td>
                                <div className="flex gap-3 text-sm">
                                  <button onClick={() => openEditMeasureForm(row)} className="cursor-pointer font-bold text-blue-600 hover:underline">编辑</button>
                                  <button onClick={() => deleteMeasureRow(row.id)} className="cursor-pointer font-bold text-red-600 hover:underline">删除</button>
                                </div>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              </div>
            )}
        </main>
      </div>
    </div>
    {showAccessLogin && <Login overlay onLogin={handleAccessLogin} onCancel={() => setShowAccessLogin(false)} globalError={globalError} />}
    </>
  );
}
