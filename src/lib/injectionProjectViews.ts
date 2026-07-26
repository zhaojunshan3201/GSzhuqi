export type InjectionProjectView = 'plan' | 'construction' | 'soakTransfer';

type ViewProject = {
  lifecycleStatus: string;
  plannedTransferDate?: string | null;
};

export type BusinessDate = string;

export type ConstructionDashboardProject = ViewProject & { id: number };
export type SoakTransferDashboardProject = ConstructionDashboardProject & { soakStartDate?: string | null };
export type ConstructionDashboard<TProject extends ConstructionDashboardProject = ConstructionDashboardProject, TRow extends ViewComparisonRow = ViewComparisonRow> = {
  projects: TProject[];
  rows: TRow[];
  kpis: { active: number; cumulativeSteam: number; dailySteam: null; delayed: number; missingData: number };
  boilerSteamTotals: { boiler: string; plannedSteam: number; actualSteam: number }[];
  statusDistribution: { status: string; count: number }[];
};
export type SoakTransferDashboard<TProject extends SoakTransferDashboardProject = SoakTransferDashboardProject> = {
  projects: TProject[];
  kpis: { soaking: number; pendingTransfer: number; overdue: number; averageSoakDays: number | null; missingSoakDate: number };
  durationDistribution: { label: string; count: number }[];
  statusDistribution: { status: string; count: number }[];
  todo: TProject[];
};

export function getInjectionProjectView(tab: string): InjectionProjectView {
  if (tab === 'injectionConstruction') return 'construction';
  if (tab === 'injectionSoakTransfer') return 'soakTransfer';
  return 'plan';
}

export function filterProjectsForView<T extends ViewProject>(projects: T[], view: InjectionProjectView, today: BusinessDate) {
  if (view === 'plan') return projects;

  const statuses = view === 'construction' ? new Set(['pending', 'injecting']) : new Set(['soaking', 'pendingTransfer']);
  const filtered = projects.filter((project) => statuses.has(project.lifecycleStatus));
  if (view !== 'soakTransfer') return filtered;

  return filtered.sort((left, right) => Number(isOverdue(right, today)) - Number(isOverdue(left, today)));
}

function validDate(value: string | null | undefined): string | null {
  const date = value;
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  const time = Date.parse(`${date}T00:00:00Z`);
  return Number.isFinite(time) && new Date(time).toISOString().slice(0, 10) === date ? date : null;
}

function dateTime(value: string | null | undefined): number | null {
  const date = validDate(value);
  return date ? Date.parse(`${date}T00:00:00Z`) : null;
}

export function isOverdue(project: ViewProject, today: BusinessDate) {
  const plannedTransferDate = validDate(project.plannedTransferDate);
  const currentDate = validDate(today);
  return Boolean(plannedTransferDate && currentDate && plannedTransferDate < currentDate);
}

export type ViewComparisonRow = {
  projectId: number;
  wellNo?: string;
  comparisonStatus: string;
  actualStartDate?: string | null;
  startVarianceDays?: number | null;
  endVarianceDays?: number | null;
  plannedBoiler?: string | null;
  actualBoiler?: string | null;
  plannedSteam?: number | null;
  actualSteam?: number | null;
  completionRate?: number | null;
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
  return {
    summary,
    charts: {
      startVarianceBuckets: varianceBuckets('startVarianceDays'),
      endVarianceBuckets: varianceBuckets('endVarianceDays'),
      boilerSteamTotals: boilerSteamTotals(rows),
    },
  };
}

function boilerSteamTotals(rows: ViewComparisonRow[]) {
  const totals = new Map<string, { plannedSteam: number; actualSteam: number }>();
  for (const row of rows) {
    const boiler = row.plannedBoiler || '--';
    const total = totals.get(boiler) || { plannedSteam: 0, actualSteam: 0 };
    total.plannedSteam += row.plannedSteam ?? 0;
    total.actualSteam += row.actualSteam ?? 0;
    totals.set(boiler, total);
  }
  return [...totals.entries()].map(([boiler, total]) => ({ boiler, ...total })).sort((left, right) => left.boiler.localeCompare(right.boiler));
}

function statusDistribution(items: { lifecycleStatus?: string; comparisonStatus?: string }[], key: 'lifecycleStatus' | 'comparisonStatus') {
  const counts = new Map<string, number>();
  for (const item of items) {
    const status = item[key];
    if (!status) continue;
    counts.set(status, (counts.get(status) || 0) + 1);
  }
  return [...counts.entries()].map(([status, count]) => ({ status, count }));
}

export function buildConstructionDashboard<T extends ConstructionDashboardProject, R extends ViewComparisonRow>(projects: T[], comparisonRows: R[], today: BusinessDate): ConstructionDashboard<T, R> {
  const constructionProjects = filterProjectsForView(projects, 'construction', today);
  const rows = filterComparisonForView(comparisonRows, constructionProjects);
  const rowsByProject = new Map(rows.map((row) => [row.projectId, row]));
  return {
    projects: constructionProjects,
    rows,
    kpis: {
      active: constructionProjects.filter((project) => project.lifecycleStatus === 'injecting').length,
      cumulativeSteam: rows.reduce((total, row) => total + (row.actualSteam ?? 0), 0),
      dailySteam: null,
      delayed: rows.filter((row) => row.comparisonStatus === 'delayed').length,
      missingData: constructionProjects.filter((project) => rowsByProject.get(project.id)?.actualSteam == null).length,
    },
    boilerSteamTotals: boilerSteamTotals(rows),
    statusDistribution: statusDistribution(constructionProjects, 'lifecycleStatus'),
  };
}

export function buildSoakTransferDashboard<T extends SoakTransferDashboardProject>(projects: T[], today: BusinessDate): SoakTransferDashboard<T> {
  const soakTransferProjects = filterProjectsForView(projects, 'soakTransfer', today);
  const todayTime = dateTime(today);
  const soakDays = soakTransferProjects.flatMap((project) => {
    const soakStartTime = dateTime(project.soakStartDate);
    return soakStartTime == null || todayTime == null ? [] : [Math.floor((todayTime - soakStartTime) / 86400000)];
  });
  const durationDistribution = [
    { label: '0-7\u5929', count: 0 },
    { label: '8-14\u5929', count: 0 },
    { label: '15\u5929\u4ee5\u4e0a', count: 0 },
  ];
  for (const days of soakDays) {
    if (days <= 7) durationDistribution[0].count++;
    else if (days <= 14) durationDistribution[1].count++;
    else durationDistribution[2].count++;
  }
  return {
    projects: soakTransferProjects,
    kpis: {
      soaking: soakTransferProjects.filter((project) => project.lifecycleStatus === 'soaking').length,
      pendingTransfer: soakTransferProjects.filter((project) => project.lifecycleStatus === 'pendingTransfer').length,
      overdue: soakTransferProjects.filter((project) => isOverdue(project, today)).length,
      averageSoakDays: soakDays.length ? soakDays.reduce((total, days) => total + days, 0) / soakDays.length : null,
      missingSoakDate: soakTransferProjects.length - soakDays.length,
    },
    durationDistribution,
    statusDistribution: statusDistribution(soakTransferProjects, 'lifecycleStatus'),
    todo: soakTransferProjects,
  };
}
