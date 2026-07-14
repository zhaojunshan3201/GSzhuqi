import type { StoredSelectionCycle } from './measureWellSelectionStore.ts';

export interface MeasureTrackingRow {
  jh?: string | null;
  block?: string | null;
  station?: string | null;
  detail_json?: string | null;
}

const keys = {
  well: '\u4e95 \u53f7', wellCompact: '\u4e95\u53f7', block: '\u533a\u5757',
  transfer: '\u8f6c\u62bd\u65f6\u95f4', previousTransfer: '\u4e0a\u8f6e\u8f6c\u62bd\u65f6\u95f4',
  round: '\u8f6e\u6b21', designSteam: '\u8bbe\u8ba1\u6ce8\u6c7d\u91cf', actualSteam: '\u7d2f\u6ce8\u6c7d\u91cf',
  pressure: '\u538b\u529b', rate: '\u6ce8\u6c7d\u901f\u5ea6', measureType: '\u63aa\u65bd\u7c7b\u578b', boiler: '\u9505\u7089\u7f16\u53f7',
  previousPeakOil: '\u4e0a\u8f6e\u5cf0\u503c\u4ea7\u6cb9', peakOil: '\u5cf0\u503c\u4ea7\u6cb9', oilSeeing: '\u89c1\u6cb9\u65e5\u671f',
  cycleOil: '\u5468\u671f\u91c7\u6cb9', currentCycleOil: '\u672c\u8f6e\u5468\u671f\u4ea7\u6cb9',
} as const;

export function buildSelectionCyclesFromTrackingRows(rows: readonly MeasureTrackingRow[]): StoredSelectionCycle[] {
  const cycles = new Map<string, StoredSelectionCycle>();
  for (const row of rows) {
    const detail = parseDetail(row.detail_json);
    const wellName = text(detail[keys.well]) || text(detail[keys.wellCompact]) || text(row.jh);
    if (!wellName) continue;
    const common = { wellName, block: text(detail[keys.block]) || text(row.block), station: text(row.station) || null };
    for (const previous of [false, true]) {
      const suffix = previous ? '_1' : '';
      const transferDate = dateValue(detail[previous ? keys.previousTransfer : keys.transfer]);
      const round = numberValue(detail[`${keys.round}${suffix}`]);
      if (!transferDate || round === null) continue;
      const cycle: StoredSelectionCycle = {
        ...common, transferDate, round,
        designSteam: numberValue(detail[`${keys.designSteam}${suffix}`]), actualSteam: numberValue(detail[`${keys.actualSteam}${suffix}`]),
        maxPressure: numberValue(detail[`${keys.pressure}${suffix}`]), pressure: numberValue(detail[`${keys.pressure}${suffix}`]),
        rate: numberValue(detail[`${keys.rate}${suffix}`]), injectN2: /N2/i.test(text(detail[`${keys.measureType}${suffix}`])),
        boiler: text(detail[`${keys.boiler}${suffix}`]) || null,
        peakOil: numberValue(detail[previous ? keys.previousPeakOil : keys.peakOil]),
        oilSeeingDays: previous ? daysBetween(transferDate, dateValue(detail[keys.oilSeeing])) : null,
        cycleOil: previous ? numberValue(detail[keys.cycleOil]) : numberValue(detail[keys.currentCycleOil]),
      };
      cycles.set(`${cycle.block}\u0000${wellName}\u0000${transferDate}\u0000${round}`, cycle);
    }
  }
  return [...cycles.values()].sort((left, right) => left.wellName.localeCompare(right.wellName) || right.transferDate.localeCompare(left.transferDate) || right.round - left.round);
}

function parseDetail(raw: string | null | undefined): Record<string, unknown> {
  if (!raw) return {};
  try { const parsed = JSON.parse(raw); return parsed && typeof parsed === 'object' ? parsed as Record<string, unknown> : {}; } catch { return {}; }
}
function text(value: unknown): string { return typeof value === 'string' ? value.trim() : value === null || value === undefined ? '' : String(value).trim(); }
function numberValue(value: unknown): number | null { const number = typeof value === 'number' ? value : Number(text(value).replace(/,/g, '')); return Number.isFinite(number) ? number : null; }
function dateValue(value: unknown): string | null {
  if (typeof value === 'number' && Number.isFinite(value)) return new Date(Date.UTC(1899, 11, 30) + Math.round(value) * 86_400_000).toISOString().slice(0, 10);
  const match = /^(\d{4})[-/]?(\d{1,2})[-/]?(\d{1,2})$/.exec(text(value));
  if (!match) return null;
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  return Number.isNaN(date.getTime()) ? null : date.toISOString().slice(0, 10);
}
function daysBetween(start: string, end: string | null): number | null { if (!end) return null; const days = (Date.parse(`${end}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / 86_400_000; return Number.isFinite(days) && days >= 0 ? days : null; }