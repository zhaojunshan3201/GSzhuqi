export type StatusMapNavigationAction = 'project' | 'production' | 'evaluation';

export type StatusMapNavigationWell = {
  wellNo: string;
  projectId: number | null;
};

export function buildInjectionStatusMapQuery(filters: Record<string, string | boolean | undefined>) {
  const params = new URLSearchParams();
  Object.entries(filters).forEach(([key, value]) => {
    if (value !== '' && value !== undefined && value !== false) params.set(key, String(value));
  });
  return params.toString();
}

export function filterProjectsByInitialId<T extends { id: number | string }>(projects: T[], initialProjectId?: string) {
  return initialProjectId ? projects.filter((project) => String(project.id) === initialProjectId) : projects;
}

export type ProjectLocationEvent =
  | { type: 'map-project'; projectId: number }
  | { type: 'clear' }
  | { type: 'workflow-tab' };

export function nextProjectLocationId(_current: number | null, event: ProjectLocationEvent) {
  return event.type === 'map-project' ? event.projectId : null;
}

export function createLatestRequestGate() {
  let latestRequestId = 0;
  return {
    start: () => ++latestRequestId,
    isCurrent: (requestId: number, signal: { aborted: boolean }) => !signal.aborted && requestId === latestRequestId,
  };
}

export function getDrawerFocusIndex(count: number, currentIndex: number, shiftKey: boolean) {
  if (count <= 0) return -1;
  return shiftKey ? (currentIndex - 1 + count) % count : (currentIndex + 1) % count;
}

export function getStatusMapNavigation(action: StatusMapNavigationAction, well: StatusMapNavigationWell) {
  if (action === 'project') {
    return well.projectId == null ? null : { tab: 'injectionPlan' as const, filters: { projectId: well.projectId } };
  }

  return action === 'production'
    ? { tab: 'measures' as const, filters: { keyword: well.wellNo } }
    : { tab: 'measureAnalysis' as const, filters: { keyword: well.wellNo } };
}
