import * as XLSX from 'xlsx';

export type MonthlyInjectionPlanRow = {
  unit: string | null;
  boiler: string | null;
  wellNo: string | null;
  plannedSteam: number | null;
  gasSupport: string | null;
  startDate: string | null;
  endDate: string | null;
  planStatus: string | null;
  remark: string | null;
  sourceCell: string;
  rawWellText: string;
  rawScheduleText: string;
};

export type MonthlyInjectionPlanResult = {
  sheetName: string | null;
  planMonth: string | null;
  rows: MonthlyInjectionPlanRow[];
  pendingRows: MonthlyInjectionPlanRow[];
  invalidRows: MonthlyInjectionPlanRow[];
  totalPlannedSteam: number;
};

const pendingStatuses = ['\u505c\u6ce8\u68c0\u4fee', '\u5f85\u5b9a', '\u505c\u6ce8', '\u5148\u642c\u5bb6', '\u63a5\u5927\u4e00\u7ad9'];

function text(value: unknown): string {
  return value == null ? '' : String(value).trim();
}

function planMonth(title: string): string | null {
  const monthMatch = title.match(/(?:(20\d{2})\u5e74)?\s*(1[0-2]|[1-9])\s*\u6708\u4efd?/);
  if (!monthMatch) return null;
  const year = monthMatch[1] ?? '2026';
  return `${year}-${monthMatch[2].padStart(2, '0')}`;
}

function parseDateRange(raw: string, year: number): { startDate: string | null; endDate: string | null } {
  const dates = [...raw.matchAll(/(\d{1,2})\s*(?:\.|\u6708)\s*(\d{1,2})(?:\u65e5)?/g)];
  if (dates.length < 2) return { startDate: null, endDate: null };
  const toDate = (match: RegExpMatchArray) => `${year}-${match[1].padStart(2, '0')}-${match[2].padStart(2, '0')}`;
  return { startDate: toDate(dates[0]), endDate: toDate(dates[1]) };
}

function normalizeGas(raw: string): string | null {
  const gases = raw.split('+').map((part) => part.trim()).filter(Boolean).map((part) => part === 'N' ? 'N2' : part);
  return gases.length ? gases.join('+') : null;
}

function cell(row: number, column: number): string {
  return XLSX.utils.encode_cell({ r: row, c: column });
}

function selectedSheet(workbook: XLSX.WorkBook): { name: string; values: unknown[][]; title: string; titleRow: number } | null {
  for (const name of workbook.SheetNames) {
    const values = XLSX.utils.sheet_to_json<unknown[]>(workbook.Sheets[name], { header: 1, defval: '' });
    let titleRow = -1;
    let title = '';
    for (let row = 0; row < values.length; row += 1) {
      const found = values[row].map(text).find((value) => value.includes('\u6ce8\u6c7d\u8fd0\u884c\u8ba1\u5212\u8868'));
      if (found) { titleRow = row; title = found; break; }
    }
    if (titleRow >= 0) {
      return { name, values, title: title || name, titleRow };
    }
  }
  return null;
}

export function parseMonthlyInjectionPlan(workbook: XLSX.WorkBook): MonthlyInjectionPlanResult {
  const selected = selectedSheet(workbook);
  const empty: MonthlyInjectionPlanResult = { sheetName: null, planMonth: null, rows: [], pendingRows: [], invalidRows: [], totalPlannedSteam: 0 };
  if (!selected) return empty;

  const month = planMonth(selected.title);
  const year = Number(month?.slice(0, 4) ?? 2026);
  const result: MonthlyInjectionPlanResult = { ...empty, sheetName: selected.name, planMonth: month };
  let unit: string | null = null;
  let boiler: string | null = null;
  const startRow = selected.titleRow >= 0 ? selected.titleRow + 1 : 0;

  for (let row = startRow; row < selected.values.length; row += 2) {
    const wellRow = selected.values[row] ?? [];
    const scheduleRow = selected.values[row + 1] ?? [];
    const currentUnit = text(wellRow[0]);
    const currentBoiler = text(wellRow[1]);
    if (currentUnit) unit = currentUnit;
    if (currentBoiler) boiler = currentBoiler;

    for (let column = 2; column < wellRow.length; column += 1) {
      const rawWellText = text(wellRow[column]);
      if (!rawWellText) continue;
      const rawScheduleText = text(scheduleRow[column]);
      const base = {
        unit, boiler, wellNo: null, plannedSteam: null, gasSupport: null,
        startDate: null, endDate: null, planStatus: null, remark: null,
        sourceCell: cell(row, column), rawWellText, rawScheduleText,
      } satisfies MonthlyInjectionPlanRow;
      const status = pendingStatuses.find((candidate) => rawWellText.includes(candidate));
      if (status) {
        result.pendingRows.push({ ...base, planStatus: status, remark: rawScheduleText || null });
        continue;
      }

      const expression = rawWellText.match(/^\s*(.+?)\s*[\uff08(]\s*(.*?)\s*[\uff09)]\s*$/);
      if (!expression) {
        result.invalidRows.push({ ...base, planStatus: 'invalid', remark: '\u65e0\u6cd5\u89e3\u6790\u4e95\u8868\u8fbe\u5f0f' });
        continue;
      }
      const parts = expression[2].split('+').map((part) => part.trim()).filter(Boolean);
      const steamText = parts.at(-1) ?? '';
      const plannedSteam = Number(steamText);
      if (!expression[1].trim() || !Number.isFinite(plannedSteam) || plannedSteam <= 0) {
        result.invalidRows.push({ ...base, planStatus: 'invalid', remark: '\u65e0\u6cd5\u89e3\u6790\u4e95\u8868\u8fbe\u5f0f' });
        continue;
      }
      const range = parseDateRange(rawScheduleText, year);
      const parsed = {
        ...base, wellNo: expression[1].trim(), plannedSteam,
        gasSupport: normalizeGas(parts.slice(0, -1).join('+')),
        startDate: range.startDate, endDate: range.endDate,
      } satisfies MonthlyInjectionPlanRow;
      if (rawScheduleText.includes('\u505c\u6ce8')) {
        result.pendingRows.push({ ...parsed, startDate: null, endDate: null, planStatus: 'stopped', remark: rawScheduleText });
        continue;
      }
      if (!range.startDate || !range.endDate) {
        result.invalidRows.push({ ...parsed, planStatus: 'invalid', remark: '无法解析\u65e5期' });
        continue;
      }
      result.rows.push(parsed);
      result.totalPlannedSteam += plannedSteam;
    }
  }
  return result;
}
