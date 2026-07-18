import * as XLSX from 'xlsx';

export interface ExternalTransferRecord {
  date: string;
  station: string;
  wellCount: number | null;
  liquid: number | null;
  oil: number | null;
  diluent: number | null;
  waterCut: number | null;
  transfer: number | null;
  transferDifference: number | null;
  sewage: number | null;
  returnFlow: number | null;
  thinOil: number | null;
}

export interface ExternalTransferDaily extends Omit<ExternalTransferRecord, 'station'> {}

const headers = {
  date: '日期',
  station: '计量站',
  wellCount: '井数',
  liquid: '日产液总量',
  oil: '日产油总量',
  diluent: '日掺油总量',
  waterCut: '综合含水',
  transfer: '外输',
  transferDifference: '外输差',
  sewage: '排污',
  returnFlow: '回流',
  thinOil: '稀油用量（方）',
} as const;

export function parseExternalTransferWorkbook(workbook: XLSX.WorkBook) {
  const sheet = workbook.Sheets.Sheet1;
  if (!sheet) throw new Error('文件缺少 Sheet1 工作表');

  const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: null, raw: true });
  const headerRow = rows[0] ?? [];
  const indexes = new Map(headerRow.map((value, index) => [String(value ?? '').trim(), index]));

  for (const header of Object.values(headers)) {
    if (!indexes.has(header)) throw new Error(`Sheet1 缺少必要列：${header}`);
  }

  const valueAt = (row: unknown[], key: keyof typeof headers) => row[indexes.get(headers[key])!];
  const records = rows.slice(1).flatMap((row): ExternalTransferRecord[] => {
    const date = normalizeDate(valueAt(row, 'date'));
    const station = String(valueAt(row, 'station') ?? '').trim();
    if (!date || !station) return [];

    return [{
      date,
      station,
      wellCount: normalizeNumber(valueAt(row, 'wellCount')),
      liquid: normalizeNumber(valueAt(row, 'liquid')),
      oil: normalizeNumber(valueAt(row, 'oil')),
      diluent: normalizeNumber(valueAt(row, 'diluent')),
      waterCut: normalizeNumber(valueAt(row, 'waterCut')),
      transfer: normalizeNumber(valueAt(row, 'transfer')),
      transferDifference: normalizeNumber(valueAt(row, 'transferDifference')),
      sewage: normalizeNumber(valueAt(row, 'sewage')),
      returnFlow: normalizeNumber(valueAt(row, 'returnFlow')),
      thinOil: normalizeNumber(valueAt(row, 'thinOil')),
    }];
  });

  return {
    records,
    stations: [...new Set(records.map((record) => record.station))].sort((left, right) => left.localeCompare(right, 'zh-CN')),
  };
}

export function summarizeExternalTransfer(
  records: ExternalTransferRecord[],
  stations: Set<string>,
  startDate: string,
  endDate: string,
): ExternalTransferDaily[] {
  const grouped = new Map<string, ExternalTransferRecord[]>();
  for (const record of records) {
    if (!stations.has(record.station) || record.date < startDate || record.date > endDate) continue;
    const items = grouped.get(record.date) ?? [];
    items.push(record);
    grouped.set(record.date, items);
  }

  return [...grouped.entries()].sort(([left], [right]) => left.localeCompare(right)).map(([date, items]) => {
    const sum = (key: keyof ExternalTransferRecord) => items.reduce((total, item) => total + (typeof item[key] === 'number' ? item[key] : 0), 0);
    const waterRows = items.filter((item) => item.waterCut !== null && item.wellCount !== null);
    const totalWaterWeight = waterRows.reduce((total, item) => total + item.waterCut! * item.wellCount!, 0);
    const totalWaterWells = waterRows.reduce((total, item) => total + item.wellCount!, 0);

    return {
      date,
      wellCount: sum('wellCount'),
      liquid: sum('liquid'),
      oil: sum('oil'),
      diluent: sum('diluent'),
      waterCut: totalWaterWells ? totalWaterWeight / totalWaterWells : null,
      transfer: sum('transfer'),
      transferDifference: sum('transferDifference'),
      sewage: sum('sewage'),
      returnFlow: sum('returnFlow'),
      thinOil: sum('thinOil'),
    };
  });
}

export function summarizeExternalTransferByTenDayPeriod(daily: ExternalTransferDaily[]): ExternalTransferDaily[] {
  const grouped = new Map<string, ExternalTransferDaily[]>();

  for (const item of daily) {
    const day = Number(item.date.slice(-2));
    const period = day <= 10 ? '上旬' : day <= 20 ? '中旬' : '下旬';
    const key = `${item.date.slice(0, 7)}${period}`;
    const items = grouped.get(key) ?? [];
    items.push(item);
    grouped.set(key, items);
  }

  const metrics: Array<Exclude<keyof ExternalTransferDaily, 'date'>> = [
    'wellCount', 'liquid', 'oil', 'diluent', 'waterCut', 'transfer', 'transferDifference', 'sewage', 'returnFlow', 'thinOil',
  ];

  return [...grouped.entries()].map(([date, items]) => {
    const result: ExternalTransferDaily = { date, wellCount: null, liquid: null, oil: null, diluent: null, waterCut: null, transfer: null, transferDifference: null, sewage: null, returnFlow: null, thinOil: null };
    for (const metric of metrics) {
      const values = items.map((item) => item[metric]).filter((value): value is number => value !== null);
      result[metric] = values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
    }
    return result;
  });
}

function normalizeNumber(value: unknown): number | null {
  if (value === null || value === undefined || String(value).trim() === '') return null;
  const number = typeof value === 'number' ? value : Number(String(value).trim());
  return Number.isFinite(number) ? number : null;
}

function normalizeDate(value: unknown): string | null {
  if (typeof value === 'number') {
    const parsed = XLSX.SSF.parse_date_code(value);
    return parsed ? formatDate(parsed.y, parsed.m, parsed.d) : null;
  }

  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return formatDate(value.getFullYear(), value.getMonth() + 1, value.getDate());
  }

  const parts = /^(\d{1,4})[./-](\d{1,2})[./-](\d{1,4})$/.exec(String(value ?? '').trim());
  if (!parts) return null;

  const first = Number(parts[1]);
  const second = Number(parts[2]);
  const third = Number(parts[3]);
  return parts[1].length === 4
    ? formatDate(first, second, third)
    : formatDate(2000 + third, first, second);
}

function formatDate(year: number, month: number, day: number): string | null {
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  return date.toISOString().slice(0, 10);
}
