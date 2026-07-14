import XLSX from 'xlsx';

export interface WellMapMarkerInput {
  block: string;
  xPercent: number;
  yPercent: number;
}

export interface ProducingWellsResult {
  date: string;
  wells: string[];
}

function text(value: unknown) {
  return String(value ?? '').trim();
}

function formatDate(value: unknown): string | null {
  if (typeof value === 'number') {
    const date = XLSX.SSF.parse_date_code(value);
    return date ? `${date.y}-${String(date.m).padStart(2, '0')}-${String(date.d).padStart(2, '0')}` : null;
  }

  const match = text(value).match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/);
  return match ? `${match[1]}-${match[2].padStart(2, '0')}-${match[3].padStart(2, '0')}` : null;
}

export function parseProducingWellsWorkbook(buffer: Buffer): ProducingWellsResult {
  const workbook = XLSX.read(buffer, { type: 'buffer' });
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: '' });
  const values = rows
    .map((row) => ({ well: text(row.JH), date: formatDate(row.RQ), scsj: Number(row.SCSJ) }))
    .filter((row) => row.well && row.date && Number.isFinite(row.scsj));
  const date = values.reduce<string | null>((latest, row) => !latest || row.date! > latest ? row.date : latest, null);

  return {
    date: date ?? '',
    wells: [...new Set(values.filter((row) => row.date === date && row.scsj > 0).map((row) => row.well))]
      .sort((left, right) => left.localeCompare(right, 'zh-CN')),
  };
}

export function validateWellMapMarkerInput(input: WellMapMarkerInput): WellMapMarkerInput | null {
  const block = text(input.block);
  const xPercent = Number(input.xPercent);
  const yPercent = Number(input.yPercent);

  if (!block || !Number.isFinite(xPercent) || !Number.isFinite(yPercent) || xPercent < 0 || xPercent > 100 || yPercent < 0 || yPercent > 100) {
    return null;
  }

  return { block, xPercent, yPercent };
}
