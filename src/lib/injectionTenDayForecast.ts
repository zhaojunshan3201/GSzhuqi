export type ForecastProductionRow = { wellNo: string; date: string; oil: number | null; block: string };
export type PlannedProductionResponse = { wellNo?: string; startDate: string; dailyOil: Array<number | null> };
export type TenDayScenarioId = 'naturalDecline' | 'currentPlan' | 'stableProductionOptimization' | 'riskConstrained';

type ForecastInput = {
  productionRows: ForecastProductionRow[];
  excludedWellNos: string[];
  block?: string | null;
  asOfDate: string;
  plannedResponses: PlannedProductionResponse[];
  channelingLossRate: number | null;
};

type Period = { label: string; startDate: string; endDate: string; actual: number | null };

const dayMs = 86400000;
const iso = (date: Date) => date.toISOString().slice(0, 10);
const utcDate = (value: string) => new Date(`${value}T00:00:00Z`);
const normalizedWell = (value: string) => value.replace(/\s+/g, '').toUpperCase();

export function normalizeForecastBlock(block: string | null | undefined): string {
  const value = String(block ?? '').trim();
  if (!value) return '未分区';
  const compact = value.replace(/\s+/g, '').replace(/（/g, '(').replace(/）/g, ')');
  if (/^(高)?3624/.test(compact)) return '高3624';
  if (/^(高)?3618/.test(compact)) return '高3618';
  if (/^(高)?246/.test(compact)) return '高246';
  if (/^(高)?3块/.test(compact) || compact === '高3') return '高3';
  if (/^高21/.test(compact)) return '高21';
  if (/^高18/.test(compact)) return '高18';
  if (/^高10/.test(compact)) return '高10';
  return value;
}

function lastDayOfMonth(year: number, monthIndex: number) {
  return new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate();
}

function tenDayPeriods(start: string, end: string): Omit<Period, 'actual'>[] {
  const result: Omit<Period, 'actual'>[] = [];
  const cursor = utcDate(start);
  cursor.setUTCDate(1);
  const endTime = utcDate(end).getTime();
  while (cursor.getTime() <= endTime) {
    const year = cursor.getUTCFullYear();
    const month = cursor.getUTCMonth();
    const monthText = String(month + 1).padStart(2, '0');
    const last = lastDayOfMonth(year, month);
    for (const [from, to, label] of [[1, 10, '上'], [11, 20, '中'], [21, last, '下']] as const) {
      const startDate = `${year}-${monthText}-${String(from).padStart(2, '0')}`;
      const endDate = `${year}-${monthText}-${String(to).padStart(2, '0')}`;
      if (utcDate(endDate).getTime() < utcDate(start).getTime() || utcDate(startDate).getTime() > endTime) continue;
      result.push({ label: `${year}-${monthText}-${label}旬`, startDate, endDate });
    }
    cursor.setUTCMonth(month + 1, 1);
  }
  return result;
}

function dailyTotals(rows: ForecastProductionRow[]) {
  const totals = new Map<string, number>();
  for (const row of rows) {
    if (row.oil == null || !Number.isFinite(row.oil)) continue;
    totals.set(row.date, (totals.get(row.date) ?? 0) + row.oil);
  }
  return totals;
}

function average(values: number[]): number | null {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
}

function monthlyDecline(daily: Map<string, number>, asOfDate: string) {
  const asOf = utcDate(asOfDate);
  const months: number[] = [];
  for (let offset = 3; offset >= 1; offset--) {
    const date = new Date(Date.UTC(asOf.getUTCFullYear(), asOf.getUTCMonth() - offset, 1));
    const prefix = `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-`;
    const monthAverage = average([...daily.entries()].filter(([day]) => day.startsWith(prefix)).map(([, oil]) => oil));
    if (monthAverage != null && monthAverage > 0) months.push(monthAverage);
  }
  if (months.length < 2) return 0;
  const rates = months.slice(1).map((value, index) => Math.max(-0.5, Math.min(0.5, 1 - value / months[index])));
  return Math.max(0, average(rates) ?? 0);
}

function responseGain(period: Omit<Period, 'actual'>, responses: PlannedProductionResponse[]) {
  let total = 0;
  let days = 0;
  const from = utcDate(period.startDate).getTime();
  const to = utcDate(period.endDate).getTime();
  for (let time = from; time <= to; time += dayMs) {
    let daily = 0;
    for (const response of responses) {
      const index = Math.round((time - utcDate(response.startDate).getTime()) / dayMs);
      const value = index >= 0 ? response.dailyOil[index] : null;
      if (typeof value === 'number' && Number.isFinite(value)) daily += value;
    }
    total += daily;
    days++;
  }
  return days ? total / days : 0;
}

export function buildInjectionTenDayForecast(input: ForecastInput) {
  const selectedBlock = input.block ? normalizeForecastBlock(input.block) : null;
  const excluded = new Set(input.excludedWellNos.map(normalizedWell));
  const scopedRows = input.productionRows.filter((row) =>
    (!selectedBlock || normalizeForecastBlock(row.block) === selectedBlock)
    && row.date >= `${input.asOfDate.slice(0, 4)}-01-01`
    && row.date <= input.asOfDate);
  const excludedInScope = new Set(scopedRows.map((row) => normalizedWell(row.wellNo)).filter((wellNo) => excluded.has(wellNo)));
  const rows = scopedRows.filter((row) => !excluded.has(normalizedWell(row.wellNo)));
  const daily = dailyTotals(rows);
  const decline = monthlyDecline(daily, input.asOfDate);
  const forecastEndDate = new Date(utcDate(input.asOfDate));
  forecastEndDate.setUTCMonth(forecastEndDate.getUTCMonth() + 3);
  const periodDefinitions = tenDayPeriods(`${input.asOfDate.slice(0, 4)}-01-01`, iso(forecastEndDate));
  const latestActual = [...daily.entries()].sort(([left], [right]) => left.localeCompare(right)).at(-1);
  const baselineStart = latestActual?.[1] ?? null;

  const periods: Period[] = periodDefinitions.map((period) => {
    const values = [...daily.entries()].filter(([date]) => date >= period.startDate && date <= period.endDate).map(([, oil]) => oil);
    return { ...period, actual: average(values) };
  });
  const natural = periods.map((period) => {
    if (period.startDate <= input.asOfDate) return period.actual;
    if (baselineStart == null) return null;
    const days = Math.max(0, (utcDate(period.startDate).getTime() - utcDate(input.asOfDate).getTime()) / dayMs);
    return baselineStart * Math.pow(1 - decline, days / 30);
  });
  const gains = periodDefinitions.map((period) => period.startDate > input.asOfDate ? responseGain(period, input.plannedResponses) : 0);
  const current = natural.map((value, index) => value == null ? null : value + gains[index]);
  const stableGains = gains.map((_, index) => average(gains.slice(Math.max(0, index - 1), Math.min(gains.length, index + 2))) ?? 0);
  const stable = natural.map((value, index) => value == null ? null : value + stableGains[index]);
  const risk = stable.map((value, index) => {
    if (periods[index].startDate <= input.asOfDate) return value;
    return value == null || input.channelingLossRate == null ? null : value * (1 - input.channelingLossRate);
  });
  const scenarios = [
    { id: 'naturalDecline' as const, values: natural },
    { id: 'currentPlan' as const, values: current },
    { id: 'stableProductionOptimization' as const, values: stable },
    { id: 'riskConstrained' as const, values: risk },
  ];
  return {
    block: selectedBlock ?? '全部区块',
    asOfDate: input.asOfDate,
    monthlyDeclineRate: decline,
    excludedWellCount: excludedInScope.size,
    plannedWellCount: input.plannedResponses.length,
    channelingLossRate: input.channelingLossRate,
    periods,
    scenarios,
  };
}
