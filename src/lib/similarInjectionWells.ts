export const SIMILARITY_WEIGHTS = {
  block: 15,
  layer: 15,
  wellType: 10,
  process: 10,
  production: 15,
  decline: 10,
  injectionScheme: 10,
  risk: 7.5,
  outcome: 7.5,
} as const;

type Feature = keyof typeof SIMILARITY_WEIGHTS;
type Nullable<T> = T | null | undefined;

export interface InjectionWellProfile {
  wellName: string;
  block?: Nullable<string>;
  layer?: Nullable<string>;
  wellType?: Nullable<string>;
  process?: Nullable<string>;
  production?: Nullable<number>;
  declineRate?: Nullable<number>;
  steamVolume?: Nullable<number>;
  steamRate?: Nullable<number>;
  pressure?: Nullable<number>;
  channelingRisk?: Nullable<number>;
  cycleOil?: Nullable<number>;
}

export interface SimilarityScorePart {
  score: number | null;
  max: number;
  compared: boolean;
  reason: string;
}

export interface SimilarInjectionWellMatch {
  wellName: string;
  block: string | null;
  score: number;
  completeness: number;
  confidence: number;
  scoreBreakdown: Record<Feature, SimilarityScorePart>;
  caseEffect: { production: number | null; cycleOil: number | null; declineRate: number | null };
  profile: InjectionWellProfile;
}

export interface ParameterRange { min: number; max: number; median: number; count: number }
export interface SimilarInjectionWellsResult {
  matches: SimilarInjectionWellMatch[];
  parameterRanges: Partial<Record<'production' | 'declineRate' | 'steamVolume' | 'steamRate' | 'pressure' | 'channelingRisk' | 'cycleOil', ParameterRange>>;
}

export function findSimilarInjectionWells(target: InjectionWellProfile, candidates: readonly InjectionWellProfile[]): SimilarInjectionWellsResult {
  const matches = candidates
    .filter((candidate) => candidate.wellName !== target.wellName)
    .map((candidate) => scoreCandidate(target, candidate))
    .sort((left, right) => right.score - left.score || right.confidence - left.confidence || left.wellName.localeCompare(right.wellName))
    .slice(0, 10);
  return { matches, parameterRanges: ranges(matches.map((match) => match.profile)) };
}

function scoreCandidate(target: InjectionWellProfile, candidate: InjectionWellProfile): SimilarInjectionWellMatch {
  const scoreBreakdown = {
    block: categorical(target.block, candidate.block, SIMILARITY_WEIGHTS.block, '区块'),
    layer: categorical(target.layer, candidate.layer, SIMILARITY_WEIGHTS.layer, '层系'),
    wellType: categorical(target.wellType, candidate.wellType, SIMILARITY_WEIGHTS.wellType, '井型'),
    process: categorical(target.process, candidate.process, SIMILARITY_WEIGHTS.process, '工艺'),
    production: numeric(target.production, candidate.production, SIMILARITY_WEIGHTS.production, '生产水平'),
    decline: numeric(target.declineRate, candidate.declineRate, SIMILARITY_WEIGHTS.decline, '递减率'),
    injectionScheme: injection(target, candidate),
    risk: numeric(target.channelingRisk, candidate.channelingRisk, SIMILARITY_WEIGHTS.risk, '风险'),
    outcome: numeric(target.cycleOil, candidate.cycleOil, SIMILARITY_WEIGHTS.outcome, '效果'),
  };
  const parts = Object.values(scoreBreakdown);
  const comparedWeight = parts.filter((part) => part.compared).reduce((sum, part) => sum + part.max, 0);
  const raw = parts.reduce((sum, part) => sum + (part.score ?? 0), 0);
  const completeness = comparedWeight / 100;
  // The normalized score uses only observed features; completeness/confidence makes missingness explicit.
  const score = comparedWeight === 0 ? 0 : raw / comparedWeight * 100;
  const confidence = completeness * (0.6 + 0.4 * Math.min(1, comparedWeight / 70));
  return {
    wellName: candidate.wellName,
    block: text(candidate.block),
    score,
    completeness,
    confidence,
    scoreBreakdown,
    caseEffect: { production: numberOrNull(candidate.production), cycleOil: numberOrNull(candidate.cycleOil), declineRate: numberOrNull(candidate.declineRate) },
    profile: candidate,
  };
}

function categorical(left: Nullable<string>, right: Nullable<string>, max: number, label: string): SimilarityScorePart {
  if (!text(left) || !text(right)) return missing(max, `${label}缺失，未计入评分`);
  const same = text(left) === text(right);
  return { score: same ? max : 0, max, compared: true, reason: same ? `${label}一致` : `${label}不一致` };
}

function numeric(left: Nullable<number>, right: Nullable<number>, max: number, label: string): SimilarityScorePart {
  if (!finite(left) || !finite(right)) return missing(max, `${label}缺失，未计入评分`);
  const distance = Math.abs(left - right) / Math.max(Math.abs(left), Math.abs(right), 1);
  return { score: max * Math.max(0, 1 - distance), max, compared: true, reason: `${label}相对差异 ${(distance * 100).toFixed(1)}%` };
}

function injection(target: InjectionWellProfile, candidate: InjectionWellProfile): SimilarityScorePart {
  const fields: Array<keyof Pick<InjectionWellProfile, 'steamVolume' | 'steamRate' | 'pressure'>> = ['steamVolume', 'steamRate', 'pressure'];
  const parts = fields.map((field) => numeric(target[field], candidate[field], 1, field));
  const known = parts.filter((part) => part.compared);
  if (known.length !== fields.length) return missing(SIMILARITY_WEIGHTS.injectionScheme, '注汽方案参数缺失，未计入评分');
  return { score: known.reduce((sum, part) => sum + (part.score ?? 0), 0) / known.length * SIMILARITY_WEIGHTS.injectionScheme, max: SIMILARITY_WEIGHTS.injectionScheme, compared: true, reason: `注汽量/速率/压力均已比较` };
}

function missing(max: number, reason: string): SimilarityScorePart { return { score: null, max, compared: false, reason }; }
function finite(value: unknown): value is number { return typeof value === 'number' && Number.isFinite(value); }
function numberOrNull(value: unknown): number | null { return finite(value) ? value : null; }
function text(value: unknown): string | null { return typeof value === 'string' && value.trim() ? value.trim() : null; }

function ranges(profiles: readonly InjectionWellProfile[]): SimilarInjectionWellsResult['parameterRanges'] {
  const fields = ['production', 'declineRate', 'steamVolume', 'steamRate', 'pressure', 'channelingRisk', 'cycleOil'] as const;
  return Object.fromEntries(fields.flatMap((field) => {
    const values = profiles.map((profile) => profile[field]).filter(finite).sort((a, b) => a - b);
    if (!values.length) return [];
    return [[field, { min: values[0], max: values[values.length - 1], median: values[Math.floor(values.length / 2)], count: values.length }]];
  })) as SimilarInjectionWellsResult['parameterRanges'];
}

