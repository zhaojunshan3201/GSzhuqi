import XLSX from 'xlsx';

export interface WellTemperaturePoint {
  depth: number;
  temperature: number | null;
  pressure: number | null;
}

export interface ParsedWellTemperatureTest {
  wellNumber: string;
  date: string;
  perforationTopDepth?: number;
  perforationBottomDepth?: number;
  points: WellTemperaturePoint[];
}

const FIRST_DATA_ROW = 2;
const WELL_NUMBER_COLUMN = 2;
const DATE_COLUMN = 3;
const DEPTH_COLUMN = 4;
const PERFORATION_TOP_DEPTH_COLUMN = 5;
const PERFORATION_BOTTOM_DEPTH_COLUMN = 6;
const TEMPERATURE_COLUMN = 7;
const PRESSURE_COLUMN = 8;

export function parseWellTemperatureWorkbook(
  fileName: string,
  buffer: ArrayBuffer | Uint8Array,
): ParsedWellTemperatureTest {
  let workbook: XLSX.WorkBook;

  try {
    workbook = XLSX.read(buffer, { type: 'array' });
  } catch {
    throw new Error('无法读取 Excel 文件');
  }

  const sheetName = workbook.SheetNames[0];
  if (!sheetName) {
    throw new Error('未读取到有效测试测点');
  }

  const sheet = workbook.Sheets[sheetName];
  const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
    header: 1,
    raw: true,
    defval: null,
  });

  const fallback = parseFileNameMetadata(fileName);
  let wellNumber: string | undefined;
  let date: string | undefined;
  let perforationTopDepth: number | undefined;
  let perforationBottomDepth: number | undefined;
  const points: WellTemperaturePoint[] = [];

  for (let rowIndex = FIRST_DATA_ROW; rowIndex < rows.length; rowIndex += 1) {
    const row = rows[rowIndex];
    if (!row) continue;

    wellNumber ??= formatWellNumber(
      sheet[XLSX.utils.encode_cell({ r: rowIndex, c: WELL_NUMBER_COLUMN })],
      row[WELL_NUMBER_COLUMN],
    );
    date ??= formatDate(sheet[XLSX.utils.encode_cell({ r: rowIndex, c: DATE_COLUMN })]);
    perforationTopDepth ??= toNumber(row[PERFORATION_TOP_DEPTH_COLUMN]);
    perforationBottomDepth ??= toNumber(row[PERFORATION_BOTTOM_DEPTH_COLUMN]);

    const depth = toNumber(row[DEPTH_COLUMN]);
    const temperature = toNumber(row[TEMPERATURE_COLUMN]);
    const pressure = toNumber(row[PRESSURE_COLUMN]);
    if (depth === undefined || (temperature === undefined && pressure === undefined)) continue;

    points.push({
      depth,
      temperature: temperature ?? null,
      pressure: pressure ?? null,
    });
  }

  if (points.length === 0) {
    throw new Error('未读取到有效测试测点');
  }

  wellNumber ??= fallback?.wellNumber;
  date ??= fallback?.date;
  if (!wellNumber || !date) {
    throw new Error('无法确定井号或测试日期');
  }

  points.sort((left, right) => left.depth - right.depth);
  return { wellNumber, date, perforationTopDepth, perforationBottomDepth, points };
}

function toText(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const text = value.trim();
  return text || undefined;
}

function formatWellNumber(cell: XLSX.CellObject | undefined, value: unknown): string | undefined {
  return toText(cell?.w) ?? (typeof value === 'number' ? String(value) : toText(value));
}

function toNumber(value: unknown): number | undefined {
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined;
  if (typeof value !== 'string' || value.trim() === '') return undefined;
  const number = Number(value);
  return Number.isFinite(number) ? number : undefined;
}

function formatDate(cell: XLSX.CellObject | undefined): string | undefined {
  if (!cell) return undefined;

  if (typeof cell.v === 'number') {
    const date = XLSX.SSF.parse_date_code(cell.v);
    if (date) {
      return `${date.y}-${String(date.m).padStart(2, '0')}-${String(date.d).padStart(2, '0')}`;
    }
  }

  const formatted = cell.w?.match(/(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/);
  if (formatted) return `${formatted[1]}-${formatted[2].padStart(2, '0')}-${formatted[3].padStart(2, '0')}`;

  const shortDate = cell.w?.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (shortDate) {
    const year = shortDate[3].length === 2 ? `20${shortDate[3]}` : shortDate[3];
    return `${year}-${shortDate[1].padStart(2, '0')}-${shortDate[2].padStart(2, '0')}`;
  }

  if (cell.v instanceof Date && !Number.isNaN(cell.v.getTime())) {
    return `${cell.v.getFullYear()}-${String(cell.v.getMonth() + 1).padStart(2, '0')}-${String(cell.v.getDate()).padStart(2, '0')}`;
  }

  return toText(cell.v)?.match(/^\d{4}-\d{2}-\d{2}$/)?.[0];
}

function parseFileNameMetadata(fileName: string): { wellNumber: string; date: string } | undefined {
  const match = fileName.match(/^(.+?)[（(](\d{4}-\d{2}-\d{2})[）)].*\.xlsx$/i);
  if (!match) return undefined;
  return { wellNumber: match[1].trim(), date: match[2] };
}
