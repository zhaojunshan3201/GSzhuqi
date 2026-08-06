export type ChannelingRole = 'admin' | 'guest';
export type ChannelingWellRole = 'injector' | 'producer';
export type TrackingSubjectType = 'project' | 'relation' | 'well';
export type TrackingSubject = { subjectType: TrackingSubjectType; subjectId: number };
export type TrackingLink = TrackingSubject;
export type TrackingEventType =
  | 'discovered'
  | 'measure_planned'
  | 'executed'
  | 'evaluated'
  | 'reviewed'
  | 'closed'
  | 'recurred'
  | 'status_changed'
  | 'relation_confirmed'
  | 'relation_released'
  | 'corrected';
export type ManualTrackingEventType = Extract<
  TrackingEventType,
  'discovered' | 'measure_planned' | 'executed' | 'reviewed' | 'closed' | 'recurred'
>;

export type TrackingEvent = {
  id: number;
  eventType: TrackingEventType;
  occurredOn: string;
  content: string;
  evidence: string;
  owner: string;
  metricsSnapshot: unknown | null;
  supersedesEventId: number | null;
  voidedAt: string | null;
  voidReason: string | null;
  createdBy: string;
  createdAt: string;
  links: TrackingLink[];
};

export type ChannelingWellProfile = {
  id: number;
  wellNo: string;
  normalizedWellNo: string;
  block: string;
  owner: string;
  createdAt: string;
  updatedAt: string;
  roles?: ChannelingWellRole[];
  relationCount?: number;
  projectCount?: number;
};

export type MetricRange = { start: string; end: string };
export type ComparisonRange = { beforeStart: string; splitDate: string; afterEnd: string };
export type MetricPoint = { average: number | null; validDays: number };
export type ProductionRow = { date: string; oil: number | null; liquid: number | null; waterCut: number | null; block: string | null };
export type ProductionSummary = {
  rows: ProductionRow[];
  latest: ProductionRow;
  oil: MetricPoint;
  liquid: MetricPoint;
  waterCut: MetricPoint;
  last7Days: { oil: MetricPoint; liquid: MetricPoint; waterCut: MetricPoint };
  last30Days: { oil: MetricPoint; liquid: MetricPoint; waterCut: MetricPoint };
};
export type InjectionStage = { cycleNo: number | null; startDate: string; endDate: string | null; steamVolume: number | null; temperature: number | null; pressure: number | null; dryness: number | null; productionHours: number | null };
export type InjectionSummary = { stages: InjectionStage[]; cumulativeSteam: number | null; cycleCount: number };
export type WellMetrics = {
  wellNo: string;
  normalizedWellNo: string;
  roles: ChannelingWellRole[];
  queriedAt: string;
  range: MetricRange;
  production: ProductionSummary | null;
  injection: InjectionSummary | null;
};
export type ProductionWindowMetric = { beforeAverage: number | null; afterAverage: number | null; change: number | null; changeRate: number | null; beforeValidDays: number; afterValidDays: number };
export type ProductionWindowComparison = { oil: ProductionWindowMetric; liquid: ProductionWindowMetric; waterCut: ProductionWindowMetric };
export type RelationDetail = {
  relationId: number;
  injectionWell: string;
  productionWell: string;
  range: ComparisonRange;
  injector: WellMetrics;
  producerSeries: ProductionRow[];
  comparison: ProductionWindowComparison;
  generatedAt: string;
};
export type ProjectSummary = {
  projectId: number;
  start: string;
  end: string;
  range: MetricRange;
  generatedAt: string;
  relationCount: number;
  activeRelationCount: number;
  releasedRelationCount: number;
  injectorCount: number;
  producerCount: number;
  uniqueWellCount: number;
  cumulativeSteam: number | null;
  initialTotalOil: number | null;
  latestTotalOil: number | null;
  totalOilChange: number | null;
  latestAvailableDate: string | null;
  evaluatedCount: number;
  latestEvaluationConclusion: string | null;
};

type ApiEnvelope<T> = { success: boolean; data?: T; message?: string };

export class ChannelingApiError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

export async function channelingRequest<T>(url: string, options: RequestInit = {}): Promise<T> {
  const headers = new Headers(options.headers);
  const token = typeof localStorage === 'undefined' ? null : localStorage.getItem('token');
  if (token && !headers.has('Authorization')) headers.set('Authorization', `Bearer ${token}`);
  const response = await fetch(url, { ...options, headers });
  if (response.status === 401 && typeof localStorage !== 'undefined') {
    const hadSession = localStorage.getItem('token') !== null;
    localStorage.removeItem('token');
    localStorage.removeItem('oil_system_user');
    if (hadSession && typeof window !== 'undefined' && typeof window.dispatchEvent === 'function') {
      window.dispatchEvent(new Event('auth-expired'));
    }
  }
  if (response.status === 204) return undefined as T;

  const text = await response.text();
  let parsed: unknown;
  try {
    parsed = JSON.parse(text) as unknown;
  } catch {
    throw new ChannelingApiError('服务响应格式异常，请刷新页面或重试', response.status);
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)
    || typeof (parsed as { success?: unknown }).success !== 'boolean') {
    throw new ChannelingApiError('服务响应格式异常，请刷新页面或重试', response.status);
  }
  const payload = parsed as ApiEnvelope<T>;
  if (!response.ok || !payload.success) throw new ChannelingApiError(payload.message || '请求失败', response.status);
  if (payload.data === undefined) throw new ChannelingApiError('服务响应数据缺失', response.status);
  return payload.data;
}
