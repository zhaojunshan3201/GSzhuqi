export type InjectionProjectView = 'plan' | 'construction' | 'soakTransfer';

type ViewProject = {
  lifecycleStatus: string;
  plannedTransferDate?: string | null;
};

export function getInjectionProjectView(tab: string): InjectionProjectView {
  if (tab === 'injectionConstruction') return 'construction';
  if (tab === 'injectionSoakTransfer') return 'soakTransfer';
  return 'plan';
}

export function filterProjectsForView<T extends ViewProject>(projects: T[], view: InjectionProjectView, today = new Date().toISOString().slice(0, 10)) {
  if (view === 'plan') return projects;

  const statuses = view === 'construction' ? new Set(['pending', 'injecting']) : new Set(['soaking', 'pendingTransfer']);
  const filtered = projects.filter((project) => statuses.has(project.lifecycleStatus));
  if (view !== 'soakTransfer') return filtered;

  return filtered.sort((left, right) => Number(isOverdue(right, today)) - Number(isOverdue(left, today)));
}

export function isOverdue(project: ViewProject, today = new Date().toISOString().slice(0, 10)) {
  return Boolean(project.plannedTransferDate && project.plannedTransferDate < today);
}

export type ViewComparisonRow = {
  projectId: number;
  comparisonStatus: string;
  actualStartDate?: string | null;
  startVarianceDays?: number | null;
  endVarianceDays?: number | null;
  plannedBoiler?: string | null;
  plannedSteam?: number | null;
  actualSteam?: number | null;
};

type ComparisonProject = { id: number };

export function filterComparisonForView<T extends ViewComparisonRow>(rows: T[], viewProjects: ComparisonProject[]) {
  const projectIds = new Set(viewProjects.map((project) => project.id));
  return rows.filter((row) => projectIds.has(row.projectId));
}

export function summarizeComparisonForView<T extends ViewComparisonRow>(rows: T[]) {
  const summary = {
    planned: rows.length,
    executed: rows.filter((row) => row.actualStartDate != null).length,
    onSchedule: rows.filter((row) => row.comparisonStatus === 'on_schedule').length,
    early: rows.filter((row) => row.comparisonStatus === 'early').length,
    delayed: rows.filter((row) => row.comparisonStatus === 'delayed').length,
    notStarted: rows.filter((row) => row.comparisonStatus === 'not_started').length,
    suspectedOtherCycle: rows.filter((row) => row.comparisonStatus === 'suspected_other_cycle').length,
  };
  const varianceBuckets = (key: 'startVarianceDays' | 'endVarianceDays') => {
    const buckets = [
      { label: '\u63d0\u524d', count: 0 }, { label: '\u6309\u8ba1\u5212', count: 0 }, { label: '\u6ede\u540e', count: 0 }, { label: '\u4e25\u91cd\u6ede\u540e', count: 0 },
    ];
    for (const row of rows) {
      if (row.comparisonStatus === 'suspected_other_cycle') continue;
      const value = row[key];
      if (value == null) continue;
      if (value <= -2) buckets[0].count++;
      else if (value <= 1) buckets[1].count++;
      else if (value <= 7) buckets[2].count++;
      else buckets[3].count++;
    }
    return buckets;
  };
  const totals = new Map<string, { plannedSteam: number; actualSteam: number }>();
  for (const row of rows) {
    const boiler = row.plannedBoiler || '--';
    const total = totals.get(boiler) || { plannedSteam: 0, actualSteam: 0 };
    total.plannedSteam += row.plannedSteam ?? 0;
    total.actualSteam += row.actualSteam ?? 0;
    totals.set(boiler, total);
  }
  return {
    summary,
    charts: {
      startVarianceBuckets: varianceBuckets('startVarianceDays'),
      endVarianceBuckets: varianceBuckets('endVarianceDays'),
      boilerSteamTotals: [...totals.entries()].map(([boiler, total]) => ({ boiler, ...total })).sort((left, right) => left.boiler.localeCompare(right.boiler)),
    },
  };
}
