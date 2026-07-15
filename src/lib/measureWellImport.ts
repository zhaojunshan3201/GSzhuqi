import XLSX from 'xlsx';

import type { StoredSelectionCycle } from './measureWellSelectionStore.ts';

export interface MeasureWellImportResult {
  cycles: StoredSelectionCycle[];
  skippedRows: Array<{ row: number; reason: string }>;
}

const headers = {
  block: '区块',
  station: '井站',
  wellName: '井号',
  transferDate: '上轮转抽时间',
  round: '上轮轮次',
  designSteam: '上轮设计注汽量',
  maxPressure: '上轮注汽最高压力',
  rate: '上轮排量',
  injectN2: '上轮是否注N2',
  boiler: '上次锅炉',
  peakOil: '上轮峰值产油',
  oilSeeingDays: '上轮见油时间（天）',
  cycleOil: '上轮周期产油',
} as const;

type ColumnName = keyof typeof headers;
type Columns = Record<ColumnName, number | undefined>;
const requiredColumns: readonly ColumnName[] = ['block', 'wellName', 'transferDate', 'round'];

export function parseMeasureWellWorkbook(workbook: XLSX.WorkBook): MeasureWellImportResult {
  const sheetName = workbook.SheetNames[0];
  if (!sheetName || !workbook.Sheets[sheetName]) throw new Error('工作簿没有可读取的工作表');

  const rows = XLSX.utils.sheet_to_json<unknown[]>(workbook.Sheets[sheetName], { header: 1, defval: null, raw: true });
  const headerRow = rows[0];
  if (!headerRow) throw new Error('工作表缺少表头');

  const columns = findColumns(headerRow);
  const cycles: StoredSelectionCycle[] = [];
  const skippedRows: Array<{ row: number; reason: string }> = [];

  rows.slice(1).forEach((row, index) => {
    const rowNumber = index + 2;
    if (row.every(isBlank)) return;

    const block = textAt(row, columns.block);
    if (!block) return skippedRows.push({ row: rowNumber, reason: '区块不能为空' });
    const wellName = textAt(row, columns.wellName);
    if (!wellName) return skippedRows.push({ row: rowNumber, reason: '井号不能为空' });
    const transferDate = dateAt(row, columns.transferDate);
    if (!transferDate) return skippedRows.push({ row: rowNumber, reason: '上轮转抽时间无效' });

    const designSteam = numberAt(row, columns.designSteam);
    const maxPressure = numberAt(row, columns.maxPressure);
    cycles.push({
      block,
      station: textAt(row, columns.station) ?? null,
      wellName,
      transferDate,
      round: roundAt(row, columns.round, rowNumber),
      designSteam,
      actualSteam: designSteam,
      maxPressure,
      pressure: maxPressure,
      rate: numberAt(row, columns.rate),
      injectN2: booleanAt(row, columns.injectN2),
      boiler: textAt(row, columns.boiler) ?? null,
      peakOil: numberAt(row, columns.peakOil),
      oilSeeingDays: numberAt(row, columns.oilSeeingDays),
      cycleOil: numberAt(row, columns.cycleOil),
    });
  });

  return { cycles, skippedRows };
}

function findColumns(headerRow: unknown[]): Columns {
  const locations = new Map(headerRow.map((value, index) => [normalizeHeader(value), index]));
  const columns = {} as Columns;
  for (const [name, header] of Object.entries(headers) as Array<[ColumnName, string]>) {
    const column = locations.get(normalizeHeader(header));
    if (column === undefined && requiredColumns.includes(name)) throw new Error(`缺少必填列：${header}`);
    columns[name] = column;
  }
  return columns;
}

function normalizeHeader(value: unknown): string {
  return String(value ?? '').replace(/\s+/g, '').trim();
}

function isBlank(value: unknown): boolean {
  return value === null || value === undefined || (typeof value === 'string' && value.trim() === '');
}

function textAt(row: unknown[], column: number | undefined): string | undefined {
  if (column === undefined) return undefined;
  const value = row[column];
  if (isBlank(value)) return undefined;
  return String(value).trim();
}

function numberAt(row: unknown[], column: number | undefined): number | undefined {
  if (column === undefined) return undefined;
  const value = row[column];
  if (isBlank(value)) return undefined;
  const number = typeof value === 'number' ? value : Number(String(value).trim());
  return Number.isFinite(number) ? number : undefined;
}

function roundAt(row: unknown[], column: number | undefined, fallback: number): number {
  const digits = String(row[column] ?? '').match(/\d+/g)?.join('');
  const round = digits ? Number(digits) : fallback;
  return Number.isSafeInteger(round) ? round : fallback;
}

function booleanAt(row: unknown[], column: number | undefined): boolean | null {
  const value = textAt(row, column)?.toLowerCase();
  if (!value) return null;
  if (['是', 'y', 'yes', 'true', '1'].includes(value)) return true;
  if (['否', 'n', 'no', 'false', '0'].includes(value)) return false;
  return null;
}

function dateAt(row: unknown[], column: number | undefined): string | undefined {
  if (column === undefined) return undefined;
  const value = row[column];
  if (value instanceof Date && !Number.isNaN(value.getTime())) return formatDate(value.getFullYear(), value.getMonth() + 1, value.getDate());
  if (typeof value === 'number') {
    const date = XLSX.SSF.parse_date_code(value);
    return date ? formatDate(date.y, date.m, date.d) : undefined;
  }
  const match = /^(\d{2}|\d{4})[.\-/](\d{1,2})[.\-/](\d{1,2})$/.exec(textAt(row, column) ?? '');
  if (!match) return undefined;
  const year = match[1].length === 2 ? 2000 + Number(match[1]) : Number(match[1]);
  return formatDate(year, Number(match[2]), Number(match[3]));
}

function formatDate(year: number, month: number, day: number): string | undefined {
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return undefined;
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}
