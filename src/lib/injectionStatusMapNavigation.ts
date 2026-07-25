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

export function getStatusMapNavigation(action: StatusMapNavigationAction, well: StatusMapNavigationWell) {
  if (action === 'project') {
    return well.projectId == null ? null : { tab: 'injectionPlan' as const, filters: { projectId: well.projectId } };
  }

  return action === 'production'
    ? { tab: 'measures' as const, filters: { keyword: well.wellNo } }
    : { tab: 'measureAnalysis' as const, filters: { keyword: well.wellNo } };
}
