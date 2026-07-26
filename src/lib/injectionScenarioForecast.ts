export type ForecastScenarioId = 'naturalDecline' | 'currentPlan' | 'stableProductionOptimization' | 'riskConstrained';

export type InjectionScenarioForecastInput = {
  historicalDailyOil?: Array<number | null>;
  baselineDailyOil?: number | null;
  plannedGain?: number | null;
  optimizedGain?: number | null;
  riskConstrainedGain?: number | null;
  channelingLoss?: number | null;
  occupancyLoss?: number | null;
};

export type ForecastPoint = {
  day: number;
  baseline: number | null;
  gain: number | null;
  channelingLoss: number | null;
  occupancyLoss: number | null;
  dailyOil: number | null;
};

export type ForecastScenario = {
  id: ForecastScenarioId;
  points: ForecastPoint[];
  dailyOilAtHorizon: Record<30 | 90 | 180, number | null>;
  cumulativeOil: Record<30 | 90 | 180, number | null>;
  netGain: Record<30 | 90 | 180, number | null>;
};

export type InjectionScenarioForecast = {
  horizons: Array<30 | 90 | 180>;
  source: 'historical-fit' | 'rule-case';
  confidence: number;
  completeness: number;
  assumptions: string[];
  scenarios: ForecastScenario[];
};

const horizons = [30, 90, 180] as Array<30 | 90 | 180>;
const scenarioGains: Array<[ForecastScenarioId, keyof Pick<InjectionScenarioForecastInput, 'plannedGain' | 'optimizedGain' | 'riskConstrainedGain'> | null]> = [
  ['naturalDecline', null],
  ['currentPlan', 'plannedGain'],
  ['stableProductionOptimization', 'optimizedGain'],
  ['riskConstrained', 'riskConstrainedGain'],
];
const valid = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value >= 0;

function fittedDecline(history: number[]) {
  if (history.length < 2) return null;
  const changes = history.slice(1).map((value, index) => history[index] > 0 ? 1 - value / history[index] : null).filter((value): value is number => value !== null && value >= 0 && value < 1);
  return changes.length ? changes.reduce((sum, value) => sum + value, 0) / changes.length : 0;
}

function summary(points: ForecastPoint[], horizon: 30 | 90 | 180) {
  const slice = points.slice(0, horizon);
  if (slice.some((point) => point.dailyOil === null || point.baseline === null)) return { daily: null, cumulative: null, netGain: null };
  return {
    daily: slice.at(-1)?.dailyOil ?? null,
    cumulative: slice.reduce((sum, point) => sum + (point.dailyOil as number), 0),
    netGain: slice.reduce((sum, point) => sum + ((point.dailyOil as number) - (point.baseline as number)), 0),
  };
}

export function buildInjectionScenarioForecast(input: InjectionScenarioForecastInput): InjectionScenarioForecast {
  const history = (input.historicalDailyOil ?? []).filter(valid);
  const hasHistoricalFit = history.length >= 2;
  const baselineStart = hasHistoricalFit ? history.at(-1)! : (valid(input.baselineDailyOil) ? input.baselineDailyOil : null);
  const decline = hasHistoricalFit ? fittedDecline(history)! : 0.003;
  const missing = [baselineStart === null ? '基线产量' : null, valid(input.channelingLoss) ? null : '注窜损失', valid(input.occupancyLoss) ? null : '占产损失'].filter((item): item is string => item !== null);
  const assumptions = [
    hasHistoricalFit ? `基于${history.length}条历史日产油拟合自然递减率` : '历史曲线不足，使用规则案例递减率 0.3%/日',
    ...missing.map((field) => `${field}待补全，未按 0 处理`),
  ];
  const knownInputs = [baselineStart, input.plannedGain, input.optimizedGain, input.riskConstrainedGain, input.channelingLoss, input.occupancyLoss].filter(valid).length;
  const completeness = knownInputs / 6;
  const confidence = Math.max(0.1, Math.min(0.95, (hasHistoricalFit ? 0.72 : 0.48) * completeness * (missing.length ? 0.75 : 1)));

  const scenarios = scenarioGains.map(([id, gainKey]) => {
    const gain = gainKey === null ? 0 : (valid(input[gainKey]) ? input[gainKey]! : null);
    const points = Array.from({ length: 180 }, (_, index) => {
      const baseline = baselineStart === null ? null : baselineStart * Math.pow(1 - decline, index);
      const channelingLoss = valid(input.channelingLoss) ? input.channelingLoss : null;
      const occupancyLoss = valid(input.occupancyLoss) ? input.occupancyLoss : null;
      const dailyOil = baseline === null || gain === null || channelingLoss === null || occupancyLoss === null ? null : baseline + gain - channelingLoss - occupancyLoss;
      return { day: index + 1, baseline, gain, channelingLoss, occupancyLoss, dailyOil };
    });
    const summaries = Object.fromEntries(horizons.map((horizon) => [horizon, summary(points, horizon)])) as Record<30 | 90 | 180, { daily: number | null; cumulative: number | null; netGain: number | null }>;
    return {
      id,
      points,
      dailyOilAtHorizon: Object.fromEntries(horizons.map((horizon) => [horizon, summaries[horizon].daily])) as ForecastScenario['dailyOilAtHorizon'],
      cumulativeOil: Object.fromEntries(horizons.map((horizon) => [horizon, summaries[horizon].cumulative])) as ForecastScenario['cumulativeOil'],
      netGain: Object.fromEntries(horizons.map((horizon) => [horizon, summaries[horizon].netGain])) as ForecastScenario['netGain'],
    };
  });
  return { horizons, source: hasHistoricalFit ? 'historical-fit' : 'rule-case', confidence, completeness, assumptions, scenarios };
}
