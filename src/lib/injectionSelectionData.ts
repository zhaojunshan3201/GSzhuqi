import * as XLSX from 'xlsx';

export interface GasFlags {
  nitrogen: boolean;
  carbonDioxide: boolean;
}

export interface SkippedWorkbookRow {
  rowNumber: number;
  reason: string;
}

export interface StageOilRow {
  wellNo: string;
  cycleNo: number;
  startDate: string;
  endDate: string | null;
  steamVolume: number;
  temperature: number | null;
  pressure: number | null;
  dryness: number | null;
  productionHours: number | null;
  stageOil: number;
  stageWater: number | null;
  oilSteamRatio: number | null;
}

export interface DailyInjectionRow {
  wellNo: string;
  recordDate: string;
  boilerNo: string | null;
  productionHours: number | null;
  flow: number | null;
  dailySteam: number | null;
  designSteam: number | null;
  cumulativeSteam: number | null;
  pressure: number | null;
  dryness: number | null;
  temperature: number | null;
  gasFlags: GasFlags;
  remarks: string[];
}

export interface WorkbookParseResult<T> {
  rows: T[];
  skippedRows: SkippedWorkbookRow[];
}

type Cell = string | number | boolean | Date | null | undefined;
type HeaderMap = Map<string, number>;

const stageHeaders = {
  wellNo: '井号', cycleNo: '周期序号', startDate: '开注汽日期', endDate: '停注汽日期',
  steamVolume: '周期注汽量', temperature: '温度', pressure: '压力', dryness: '干度',
  productionHours: '生产时间', stageOil: '阶段产油', stageWater: '阶段产水', oilSteamRatio: '油汽比',
} as const;

const dailyHeaders = {
  wellNo: '井号', recordDate: '日期', boilerPrimary: '锅炉编号1', boilerSecondary: '锅炉编号2',
  productionHours: '生产时间', flow: '流量', dailySteam: '日注汽量', designSteam: '设计注汽量',
  cumulativeSteam: '累积注汽量', pressure: '压力', dryness: '干度', temperature: '温度',
} as const;

export function parseStageOilWorkbook(workbook: XLSX.WorkBook): WorkbookParseResult<StageOilRow> {
  const { headers, rows } = firstSheetRows(workbook);
  const missing = requiredHeaders(headers, [stageHeaders.wellNo, stageHeaders.cycleNo, stageHeaders.startDate, stageHeaders.steamVolume, stageHeaders.stageOil]);
  if (missing.length) return { rows: [], skippedRows: [{ rowNumber: 1, reason: `缺少必填列：${missing.join('、')}` }] };

  const parsed: StageOilRow[] = [];
  const skippedRows: SkippedWorkbookRow[] = [];
  for (const [index, row] of rows.entries()) {
    if (isBlankRow(row)) continue;
    const rowNumber = index + 2;
    const wellNo = requiredText(valueAt(row, headers, stageHeaders.wellNo), stageHeaders.wellNo);
    const cycleNo = requiredNumber(valueAt(row, headers, stageHeaders.cycleNo), stageHeaders.cycleNo, { integer: true, positive: true });
    const startDate = requiredDate(valueAt(row, headers, stageHeaders.startDate), stageHeaders.startDate);
    const steamVolume = requiredNumber(valueAt(row, headers, stageHeaders.steamVolume), stageHeaders.steamVolume, { nonNegative: true });
    const stageOil = requiredNumber(valueAt(row, headers, stageHeaders.stageOil), stageHeaders.stageOil, { nonNegative: true });
    const optional: [ValueResult<string>, ValueResult<number>, ValueResult<number>, ValueResult<number>, ValueResult<number>, ValueResult<number>, ValueResult<number>] = [
      optionalDate(valueAt(row, headers, stageHeaders.endDate), stageHeaders.endDate),
      optionalNumber(valueAt(row, headers, stageHeaders.temperature), stageHeaders.temperature),
      optionalNumber(valueAt(row, headers, stageHeaders.pressure), stageHeaders.pressure),
      optionalNumber(valueAt(row, headers, stageHeaders.dryness), stageHeaders.dryness),
      optionalNumber(valueAt(row, headers, stageHeaders.productionHours), stageHeaders.productionHours),
      optionalNumber(valueAt(row, headers, stageHeaders.stageWater), stageHeaders.stageWater),
      optionalNumber(valueAt(row, headers, stageHeaders.oilSteamRatio), stageHeaders.oilSteamRatio),
    ];
    const reason = [wellNo, cycleNo, startDate, steamVolume, stageOil, ...optional].find((result) => result.error)?.error;
    if (reason) { skippedRows.push({ rowNumber, reason }); continue; }
    parsed.push({
      wellNo: wellNo.value!, cycleNo: cycleNo.value!, startDate: startDate.value!, endDate: optional[0].value!,
      steamVolume: steamVolume.value!, temperature: optional[1].value!, pressure: optional[2].value!, dryness: optional[3].value!,
      productionHours: optional[4].value!, stageOil: stageOil.value!, stageWater: optional[5].value!, oilSteamRatio: optional[6].value!,
    });
  }
  return { rows: parsed, skippedRows };
}

export function parseDailyInjectionWorkbook(workbook: XLSX.WorkBook): WorkbookParseResult<DailyInjectionRow> {
  const { headers, rows } = firstSheetRows(workbook);
  const missing = requiredHeaders(headers, [dailyHeaders.wellNo, dailyHeaders.recordDate]);
  if (missing.length) return { rows: [], skippedRows: [{ rowNumber: 1, reason: `缺少必填列：${missing.join('、')}` }] };

  const parsed: DailyInjectionRow[] = [];
  const skippedRows: SkippedWorkbookRow[] = [];
  for (const [index, row] of rows.entries()) {
    if (isBlankRow(row)) continue;
    const rowNumber = index + 2;
    const wellNo = requiredText(valueAt(row, headers, dailyHeaders.wellNo), dailyHeaders.wellNo);
    const recordDate = requiredDate(valueAt(row, headers, dailyHeaders.recordDate), dailyHeaders.recordDate);
    const values = [
      optionalNumber(valueAt(row, headers, dailyHeaders.productionHours), dailyHeaders.productionHours),
      optionalNumber(valueAt(row, headers, dailyHeaders.flow), dailyHeaders.flow),
      optionalNumber(valueAt(row, headers, dailyHeaders.dailySteam), dailyHeaders.dailySteam),
      optionalNumber(valueAt(row, headers, dailyHeaders.designSteam), dailyHeaders.designSteam),
      optionalNumber(valueAt(row, headers, dailyHeaders.cumulativeSteam), dailyHeaders.cumulativeSteam),
      optionalNumber(valueAt(row, headers, dailyHeaders.pressure), dailyHeaders.pressure),
      optionalNumber(valueAt(row, headers, dailyHeaders.dryness), dailyHeaders.dryness),
      optionalNumber(valueAt(row, headers, dailyHeaders.temperature), dailyHeaders.temperature),
    ];
    const reason = [wellNo, recordDate, ...values].find((result) => result.error)?.error;
    if (reason) { skippedRows.push({ rowNumber, reason }); continue; }
    const remarks = [...headers.entries()]
      .filter(([header]) => header.startsWith('备注'))
      .map(([, column]) => text(row[column]))
      .filter(Boolean);
    parsed.push({
      wellNo: wellNo.value!, recordDate: recordDate.value!,
      boilerNo: text(valueAt(row, headers, dailyHeaders.boilerPrimary)) || text(valueAt(row, headers, dailyHeaders.boilerSecondary)) || null,
      productionHours: values[0].value!, flow: values[1].value!, dailySteam: values[2].value!, designSteam: values[3].value!,
      cumulativeSteam: values[4].value!, pressure: values[5].value!, dryness: values[6].value!, temperature: values[7].value!,
      gasFlags: detectGasFlags(remarks), remarks,
    });
  }
  return { rows: parsed, skippedRows };
}

export function detectGasFlags(remarks: readonly string[]): GasFlags {
  const combined = remarks.join('\n');
  return { nitrogen: /氮气|n2/i.test(combined), carbonDioxide: /二氧化碳|co2/i.test(combined) };
}

function firstSheetRows(workbook: XLSX.WorkBook): { headers: HeaderMap; rows: Cell[][] } {
  const sheetName = workbook.SheetNames[0];
  if (!sheetName) return { headers: new Map(), rows: [] };
  const sheet = workbook.Sheets[sheetName];
  const allRows = XLSX.utils.sheet_to_json<Cell[]>(sheet, { header: 1, defval: null, raw: true });
  const [headerRow = [], ...rows] = allRows;
  const entries: [string, number][] = headerRow.map((header, index): [string, number] => [text(header).replace(/^\uFEFF/, ''), index]).filter(([header]) => Boolean(header));
  return { headers: new Map(entries), rows };
}

function requiredHeaders(headers: HeaderMap, expected: readonly string[]): string[] { return expected.filter((header) => !headers.has(header)); }
function valueAt(row: Cell[], headers: HeaderMap, header: string): Cell { const column = headers.get(header); return column === undefined ? null : row[column]; }
function isBlankRow(row: Cell[]): boolean { return row.every((value) => !text(value)); }
function text(value: unknown): string { return value === null || value === undefined ? '' : String(value).trim(); }

type ValueResult<T> = { value: T | null; error?: string };
function requiredText(value: Cell, name: string): ValueResult<string> { const parsed = text(value); return parsed ? { value: parsed } : { value: null, error: `${name}不能为空` }; }
function requiredNumber(value: Cell, name: string, options: { integer?: boolean; positive?: boolean; nonNegative?: boolean } = {}): ValueResult<number> {
  const result = optionalNumber(value, name, options);
  return result.value === null && !result.error ? { value: null, error: `${name}不能为空` } : result;
}
function optionalNumber(value: Cell, name: string, options: { integer?: boolean; positive?: boolean; nonNegative?: boolean } = {}): ValueResult<number> {
  if (!text(value)) return { value: null };
  const parsed = typeof value === 'number' ? value : Number(text(value).replace(/,/g, ''));
  if (!Number.isFinite(parsed) || (options.integer && !Number.isInteger(parsed)) || (options.positive && parsed <= 0) || (options.nonNegative && parsed < 0)) return { value: null, error: `${name}格式无效` };
  return { value: parsed };
}
function requiredDate(value: Cell, name: string): ValueResult<string> { const result = optionalDate(value, name); return result.value === null && !result.error ? { value: null, error: `${name}不能为空` } : result; }
function optionalDate(value: Cell, name: string): ValueResult<string> {
  if (!text(value)) return { value: null };
  const date = normalizeDate(value);
  return date ? { value: date } : { value: null, error: `${name}格式无效` };
}
function normalizeDate(value: Cell): string | null {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return dateString(value.getUTCFullYear(), value.getUTCMonth() + 1, value.getUTCDate());
  if (typeof value === 'number' && Number.isFinite(value)) {
    const date = new Date(Date.UTC(1899, 11, 30) + Math.round(value) * 86_400_000);
    return dateString(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate());
  }
  const match = /^(\d{4})\s*[年\/-]\s*(\d{1,2})\s*[月\/-]\s*(\d{1,2})\s*日?$/.exec(text(value));
  return match ? dateString(Number(match[1]), Number(match[2]), Number(match[3])) : null;
}
function dateString(year: number, month: number, day: number): string | null {
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  return date.toISOString().slice(0, 10);
}


