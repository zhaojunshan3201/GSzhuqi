export type LifecycleStatus = 'pending' | 'injecting' | 'soaking' | 'pendingTransfer' | 'producing' | 'closed';
export type PlanStatus = 'draft' | 'issued' | 'cancelled' | 'closed';
type DatabaseLike = { exec(sql: string): Promise<void>; run(sql: string, params?: unknown[]): Promise<{ lastID?: number }>; get(sql: string, params?: unknown[]): Promise<any> };
export type ProjectInput = { wellNo: string; block: string; processType: string; plannedTransferDate: string; owner: string; plannedSteam?: number | null; plannedPressure?: number | null; plannedRate?: number | null; remark?: string };
export type InjectionProject = ProjectInput & { id: number; projectNo: string; planStatus: PlanStatus; lifecycleStatus: LifecycleStatus; createdAt: string; updatedAt: string };

const nextStatuses: Record<LifecycleStatus, LifecycleStatus | null> = { pending: 'injecting', injecting: 'soaking', soaking: 'pendingTransfer', pendingTransfer: 'producing', producing: 'closed', closed: null };

export async function initInjectionProjectTables(db: DatabaseLike) {
  await db.exec(`CREATE TABLE IF NOT EXISTS injection_projects (
    id INTEGER PRIMARY KEY AUTOINCREMENT, project_no TEXT NOT NULL UNIQUE, well_no TEXT NOT NULL, block TEXT NOT NULL, process_type TEXT NOT NULL,
    planned_steam REAL, planned_pressure REAL, planned_rate REAL, planned_transfer_date TEXT NOT NULL, owner TEXT NOT NULL, remark TEXT,
    plan_status TEXT NOT NULL DEFAULT 'draft', lifecycle_status TEXT NOT NULL DEFAULT 'pending', created_at TEXT NOT NULL, updated_at TEXT NOT NULL
  ); CREATE TABLE IF NOT EXISTS injection_project_transitions (
    id INTEGER PRIMARY KEY AUTOINCREMENT, project_id INTEGER NOT NULL, from_status TEXT NOT NULL, to_status TEXT NOT NULL, actual_date TEXT NOT NULL, remark TEXT, created_at TEXT NOT NULL
  );`);
}

function validate(input: ProjectInput) {
  if (!input.wellNo?.trim()) throw new Error('井号不能为空');
  if (!input.block?.trim()) throw new Error('区块不能为空');
  if (!input.processType?.trim()) throw new Error('注汽工艺不能为空');
  if (!input.plannedTransferDate?.trim()) throw new Error('计划转抽日不能为空');
  if (!input.owner?.trim()) throw new Error('负责人不能为空');
}

function toProject(row: any): InjectionProject {
  return { id: row.id, projectNo: row.project_no, wellNo: row.well_no, block: row.block, processType: row.process_type, plannedTransferDate: row.planned_transfer_date, owner: row.owner, plannedSteam: row.planned_steam, plannedPressure: row.planned_pressure, plannedRate: row.planned_rate, remark: row.remark || '', planStatus: row.plan_status, lifecycleStatus: row.lifecycle_status, createdAt: row.created_at, updatedAt: row.updated_at };
}

export async function createInjectionProject(db: DatabaseLike, input: ProjectInput): Promise<InjectionProject> {
  validate(input); const now = new Date().toISOString(); const projectNo = `ZQ-${Date.now()}`;
  const result = await db.run(`INSERT INTO injection_projects (project_no, well_no, block, process_type, planned_steam, planned_pressure, planned_rate, planned_transfer_date, owner, remark, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, [projectNo, input.wellNo.trim(), input.block.trim(), input.processType.trim(), input.plannedSteam ?? null, input.plannedPressure ?? null, input.plannedRate ?? null, input.plannedTransferDate, input.owner.trim(), input.remark || '', now, now]);
  return toProject(await db.get('SELECT * FROM injection_projects WHERE id = ?', [result.lastID]));
}

export async function updatePlanStatus(db: DatabaseLike, id: number, status: PlanStatus): Promise<InjectionProject> {
  const project = await db.get('SELECT * FROM injection_projects WHERE id = ?', [id]); if (!project) throw new Error('项目不存在');
  if (project.lifecycle_status !== 'pending' && status === 'cancelled') throw new Error('执行中的项目不能取消');
  await db.run('UPDATE injection_projects SET plan_status = ?, updated_at = ? WHERE id = ?', [status, new Date().toISOString(), id]);
  return toProject(await db.get('SELECT * FROM injection_projects WHERE id = ?', [id]));
}

export async function transitionInjectionProject(db: DatabaseLike, id: number, target: LifecycleStatus, actualDate: string, remark = ''): Promise<InjectionProject> {
  const project = await db.get('SELECT * FROM injection_projects WHERE id = ?', [id]); if (!project) throw new Error('项目不存在');
  if (project.plan_status !== 'issued' && project.lifecycle_status === 'pending') throw new Error('方案必须已下达才能开始正注');
  if (nextStatuses[project.lifecycle_status as LifecycleStatus] !== target) throw new Error('无效的项目状态流转');
  const now = new Date().toISOString();
  await db.run('UPDATE injection_projects SET lifecycle_status = ?, updated_at = ? WHERE id = ?', [target, now, id]);
  await db.run('INSERT INTO injection_project_transitions (project_id, from_status, to_status, actual_date, remark, created_at) VALUES (?, ?, ?, ?, ?, ?)', [id, project.lifecycle_status, target, actualDate, remark, now]);
  return toProject(await db.get('SELECT * FROM injection_projects WHERE id = ?', [id]));
}
