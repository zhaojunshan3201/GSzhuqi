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
