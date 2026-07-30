export type BlockDateRangePreset = '3m' | '6m' | 'year' | 'custom';

export interface BlockDateRange {
  start: string;
  end: string;
}

const parseIsoDate = (value: string) => {
  const [year, month, day] = value.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day));
};

const formatIsoDate = (date: Date) => date.toISOString().slice(0, 10);

const shiftUtcMonths = (value: string, months: number) => {
  const source = parseIsoDate(value);
  const day = source.getUTCDate();
  const shifted = new Date(Date.UTC(source.getUTCFullYear(), source.getUTCMonth() + months, 1));
  const lastDay = new Date(Date.UTC(
    shifted.getUTCFullYear(),
    shifted.getUTCMonth() + 1,
    0,
  )).getUTCDate();
  shifted.setUTCDate(Math.min(day, lastDay));
  return formatIsoDate(shifted);
};

export function getBlockDateRangePreset(
  preset: Exclude<BlockDateRangePreset, 'custom'>,
  endDate: string,
): BlockDateRange {
  if (preset === 'year') {
    return { start: `${endDate.slice(0, 4)}-01-01`, end: endDate };
  }
  return {
    start: shiftUtcMonths(endDate, preset === '3m' ? -3 : -6),
    end: endDate,
  };
}

export function getBlockDateRangeDayCount(range: BlockDateRange): number {
  const start = parseIsoDate(range.start).getTime();
  const end = parseIsoDate(range.end).getTime();
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return 0;
  return Math.floor((end - start) / 86_400_000) + 1;
}

export function calculateBlockDeclineRate(
  previousYearOilTotal: number | null | undefined,
  monthlyAverageOil: number | null | undefined,
  targetYear: number,
): number | null {
  if (
    typeof previousYearOilTotal !== 'number'
    || !Number.isFinite(previousYearOilTotal)
    || previousYearOilTotal <= 0
    || typeof monthlyAverageOil !== 'number'
    || !Number.isFinite(monthlyAverageOil)
    || monthlyAverageOil < 0
    || !Number.isInteger(targetYear)
  ) {
    return null;
  }

  const isLeapYear = targetYear % 4 === 0
    && (targetYear % 100 !== 0 || targetYear % 400 === 0);
  const yearDays = isLeapYear ? 366 : 365;
  const declineRate = (
    (previousYearOilTotal - monthlyAverageOil * yearDays) / previousYearOilTotal
  ) * 100;
  return Number.isFinite(declineRate) ? declineRate : null;
}

export function calculateDeclineRateSeries(
  dates: string[],
  monthlyAverageOil: Array<number | null | undefined>,
  previousYearOilTotals: Record<string, number>,
): Array<number | null> {
  return dates.map((date, index) => {
    const current = monthlyAverageOil[index];
    const currentYear = Number(date.slice(0, 4));
    const baseline = previousYearOilTotals[String(currentYear - 1)];
    return calculateBlockDeclineRate(baseline, current, currentYear);
  });
}
