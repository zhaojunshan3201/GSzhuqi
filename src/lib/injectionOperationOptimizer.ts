export type OperationConstraints = {
  boilerSteamCapacity: number;
  maxConcurrentWells: number;
  maxChannelingRisk: number;
  oilPrice: number;
  steamUnitCost: number;
};

export type InjectionOperation = {
  id: string;
  name: string;
  wellOrder: string[];
  staggerDays: number;
  steamVolume: number;
  pressure: number;
  steamRate: number;
  soakDays: number;
  convertToProductionDay: number;
  boiler: string;
  grossIncrementalOil: number | null;
  productionVolatility: number | null;
  channelingRisk: number | null;
  concurrentWells?: number;
  boilerDailyCapacity?: number;
};

export type OperationAdjustment = {
  planId: string;
  reason: string;
  patch: Partial<Pick<InjectionOperation, 'wellOrder' | 'staggerDays' | 'steamVolume' | 'pressure' | 'steamRate' | 'soakDays' | 'convertToProductionDay' | 'boiler'>>;
};

export type InjectionOperationOptimizerInput = {
  candidates: InjectionOperation[];
  constraints: OperationConstraints;
  channelingLoss: number | null | undefined;
  occupancyLoss: number | null | undefined;
  confidence: number;
  similarCaseEvidence?: string[];
  adjustments?: OperationAdjustment[];
};

export type RecommendedOperation = {
  id: string;
  name: string;
  operation: InjectionOperation;
  score: number | null;
  confidence: number;
  metrics: { grossIncrementalOil: number | null; channelingLoss: number | null; occupancyLoss: number | null; netIncrementalOil: number | null; productionVolatility: number | null; channelingRisk: number | null; steamCost: number; incrementalRevenue: number | null; netBenefit: number | null };
  evidence: string[];
  assumptions: string[];
  adjustments: OperationAdjustment[];
};

export type InjectionOperationRecommendationResult = { recommendations: RecommendedOperation[]; rejected: Array<{ id: string; reason: string }>; constraints: OperationConstraints };

const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);

export function buildInjectionOperationRecommendations(input: InjectionOperationOptimizerInput): InjectionOperationRecommendationResult {
  const adjustments = input.adjustments ?? [];
  const rejected: Array<{ id: string; reason: string }> = [];
  const recommendations = input.candidates.flatMap((candidate) => {
    const applied = adjustments.filter((adjustment) => adjustment.planId === candidate.id);
    const operation = applied.reduce<InjectionOperation>((current, adjustment) => ({ ...current, ...adjustment.patch }), candidate);
    const rejection = constraintViolation(operation, input.constraints);
    if (rejection) { rejected.push({ id: operation.id, reason: rejection }); return []; }

    const lossesKnown = finite(input.channelingLoss) && finite(input.occupancyLoss);
    const grossKnown = finite(operation.grossIncrementalOil);
    const netIncrementalOil = lossesKnown && grossKnown ? operation.grossIncrementalOil - input.channelingLoss - input.occupancyLoss : null;
    const steamCost = operation.steamVolume * input.constraints.steamUnitCost;
    const incrementalRevenue = netIncrementalOil === null ? null : netIncrementalOil * input.constraints.oilPrice;
    const netBenefit = incrementalRevenue === null ? null : incrementalRevenue - steamCost;
    const riskKnown = finite(operation.productionVolatility) && finite(operation.channelingRisk);
    const score = netBenefit === null || !riskKnown ? null : netBenefit - operation.productionVolatility * input.constraints.oilPrice * 10 - operation.channelingRisk * input.constraints.oilPrice * 10;
    const assumptions = lossesKnown ? [] : ['注窜损失或占产损失待补全，未按 0 处理；净增油与成本收益暂不计算'];
    const confidence = Math.max(0.05, Math.min(0.95, input.confidence * (lossesKnown ? 1 : 0.55) * (riskKnown ? 1 : 0.75)));
    const evidence = [
      `锅炉 ${operation.boiler} 注汽量 ${operation.steamVolume} 吨，未超过 ${input.constraints.boilerSteamCapacity} 吨能力`,
      `注井顺序：${operation.wellOrder.join(' → ')}；错峰 ${operation.staggerDays} 天；焖井 ${operation.soakDays} 天后第 ${operation.convertToProductionDay} 天转抽`,
      ...(input.similarCaseEvidence ?? []),
    ];
    return [{ id: operation.id, name: operation.name, operation, score, confidence, metrics: { grossIncrementalOil: operation.grossIncrementalOil, channelingLoss: finite(input.channelingLoss) ? input.channelingLoss : null, occupancyLoss: finite(input.occupancyLoss) ? input.occupancyLoss : null, netIncrementalOil, productionVolatility: finite(operation.productionVolatility) ? operation.productionVolatility : null, channelingRisk: finite(operation.channelingRisk) ? operation.channelingRisk : null, steamCost, incrementalRevenue, netBenefit }, evidence, assumptions, adjustments: applied }];
  });
  recommendations.sort((left, right) => (right.score ?? -Infinity) - (left.score ?? -Infinity) || right.confidence - left.confidence || left.name.localeCompare(right.name));
  return { recommendations: recommendations.slice(0, 3), rejected, constraints: input.constraints };
}

function constraintViolation(operation: InjectionOperation, constraints: OperationConstraints): string | null {
  if (!finite(operation.productionVolatility)) return "\u751f\u4ea7\u6ce2\u52a8\u7f3a\u5931\uff0c\u4e0d\u53ef\u63a8\u8350";
  if (!finite(operation.channelingRisk)) return "\u6ce8\u7a9c\u98ce\u9669\u7f3a\u5931\uff0c\u4e0d\u53ef\u63a8\u8350";
  if (operation.channelingRisk > constraints.maxChannelingRisk) return `\u6ce8\u7a9c\u98ce\u9669\u8d85\u9650\uff1a${operation.channelingRisk} > ${constraints.maxChannelingRisk}`;
  const concurrent = operation.concurrentWells ?? (operation.staggerDays > 0 ? 1 : operation.wellOrder.length);
  if (concurrent > constraints.maxConcurrentWells) return `\u5b9e\u9645\u5e76\u53d1\u6ce8\u4e95\u6570\u8d85\u9650\uff1a${concurrent} > ${constraints.maxConcurrentWells}`;
  const dailyLoad = concurrent * operation.steamRate;
  const dailyCapacity = operation.boilerDailyCapacity ?? constraints.boilerSteamCapacity;
  if (dailyLoad > dailyCapacity) return `\u9505\u7089\u5b9e\u9645\u6392\u91cf\u8d85\u9650\uff1a${dailyLoad} > ${dailyCapacity}`;
  if (operation.steamVolume > constraints.boilerSteamCapacity) return `\u9505\u7089\u6ce8\u6c7d\u91cf\u8d85\u9650\uff1a${operation.steamVolume} > ${constraints.boilerSteamCapacity}`;
  return null;
}
