export type DatabaseLike = { exec(sql: string): Promise<void>; run(sql: string, params?: unknown[]): Promise<{ lastID?: number }>; get(sql: string, params?: unknown[]): Promise<any>; all(sql: string, params?: unknown[]): Promise<any[]> };
export type ImpactLevel = 'high' | 'medium' | 'low';
export type RelationStatus = 'confirmed' | 'suspected' | 'released';
export type RelationSource = 'manual' | 'import' | 'suspected';
export type ChannelingProjectInput = { projectName: string; block: string; owner: string };
export type ChannelingRelationInput = {
  projectId: number; injectionWell: string; productionWell: string; reservoirLayer: string; impactLevel: ImpactLevel;
  confidence: number; status: RelationStatus; source: RelationSource; evidence: string; effectiveStartDate: string; effectiveEndDate: string; owner: string;
};
export type ChannelingProject = ChannelingProjectInput & { id: number; createdAt: string; updatedAt: string };
export type ChannelingRelation = ChannelingRelationInput & { id: number; block: string; createdAt: string; updatedAt: string };

const impactLevels = new Set<ImpactLevel>(['high', 'medium', 'low']);
const statuses = new Set<RelationStatus>(['confirmed', 'suspected', 'released']);
const sources = new Set<RelationSource>(['manual', 'import', 'suspected']);

export async function initChannelingProjectTables(db: DatabaseLike) {
  await db.exec(`CREATE TABLE IF NOT EXISTS channeling_projects (
    id INTEGER PRIMARY KEY AUTOINCREMENT, project_name TEXT NOT NULL, block TEXT NOT NULL, owner TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
  ); CREATE TABLE IF NOT EXISTS channeling_relations (
    id INTEGER PRIMARY KEY AUTOINCREMENT, project_id INTEGER NOT NULL, injection_well TEXT NOT NULL, production_well TEXT NOT NULL, reservoir_layer TEXT NOT NULL,
    impact_level TEXT NOT NULL, confidence REAL NOT NULL, status TEXT NOT NULL, source TEXT NOT NULL, evidence TEXT NOT NULL,
    effective_start_date TEXT NOT NULL, effective_end_date TEXT NOT NULL, owner TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
    FOREIGN KEY(project_id) REFERENCES channeling_projects(id)
  );`);
}

function required(value: unknown, field: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${field} is required`);
  return value.trim();
}
function validDate(value: unknown, field: string): string {
  const date = required(value, field);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(`${date}T00:00:00Z`)) || new Date(`${date}T00:00:00Z`).toISOString().slice(0, 10) !== date) throw new Error(`${field} must be a calendar date`);
  return date;
}
function validateProject(input: ChannelingProjectInput) { required(input.projectName, 'projectName'); required(input.block, 'block'); required(input.owner, 'owner'); }
function validateRelation(input: ChannelingRelationInput) {
  if (!Number.isInteger(input.projectId) || input.projectId <= 0) throw new Error('projectId is required');
  for (const field of ['injectionWell', 'productionWell', 'reservoirLayer', 'evidence', 'owner'] as const) required(input[field], field);
  if (!impactLevels.has(input.impactLevel)) throw new Error('impactLevel is invalid');
  if (!statuses.has(input.status)) throw new Error('status is invalid');
  if (!sources.has(input.source)) throw new Error('source is invalid');
  if (typeof input.confidence !== 'number' || !Number.isFinite(input.confidence) || input.confidence < 0 || input.confidence > 1) throw new Error('confidence must be between 0 and 1');
  const start = validDate(input.effectiveStartDate, 'effectiveStartDate');
  const end = validDate(input.effectiveEndDate, 'effectiveEndDate');
  if (end < start) throw new Error('effectiveEndDate must not precede effectiveStartDate');
}
function project(row: any): ChannelingProject { return { id: row.id, projectName: row.project_name, block: row.block, owner: row.owner, createdAt: row.created_at, updatedAt: row.updated_at }; }
function relation(row: any): ChannelingRelation { return { id: row.id, projectId: row.project_id, injectionWell: row.injection_well, productionWell: row.production_well, reservoirLayer: row.reservoir_layer, impactLevel: row.impact_level, confidence: row.confidence, status: row.status, source: row.source, evidence: row.evidence, effectiveStartDate: row.effective_start_date, effectiveEndDate: row.effective_end_date, owner: row.owner, block: row.block, createdAt: row.created_at, updatedAt: row.updated_at }; }

export async function createChannelingProject(db: DatabaseLike, input: ChannelingProjectInput): Promise<ChannelingProject> {
  validateProject(input); const now = new Date().toISOString();
  const result = await db.run('INSERT INTO channeling_projects (project_name, block, owner, created_at, updated_at) VALUES (?, ?, ?, ?, ?)', [input.projectName.trim(), input.block.trim(), input.owner.trim(), now, now]);
  return project(await db.get('SELECT * FROM channeling_projects WHERE id = ?', [result.lastID]));
}
export async function listChannelingProjects(db: DatabaseLike, options: { block?: string } = {}): Promise<ChannelingProject[]> {
  const where = options.block ? ' WHERE block = ?' : ''; return (await db.all(`SELECT * FROM channeling_projects${where} ORDER BY updated_at DESC, id DESC`, options.block ? [options.block] : [])).map(project);
}
export async function createChannelingRelation(db: DatabaseLike, input: ChannelingRelationInput): Promise<ChannelingRelation> {
  validateRelation(input); if (!await db.get('SELECT id FROM channeling_projects WHERE id = ?', [input.projectId])) throw new Error('Project not found');
  const now = new Date().toISOString(); const values = [input.projectId, input.injectionWell.trim(), input.productionWell.trim(), input.reservoirLayer.trim(), input.impactLevel, input.confidence, input.status, input.source, input.evidence.trim(), input.effectiveStartDate, input.effectiveEndDate, input.owner.trim(), now, now];
  const result = await db.run('INSERT INTO channeling_relations (project_id, injection_well, production_well, reservoir_layer, impact_level, confidence, status, source, evidence, effective_start_date, effective_end_date, owner, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)', values);
  return relation(await db.get('SELECT r.*, p.block FROM channeling_relations r JOIN channeling_projects p ON p.id = r.project_id WHERE r.id = ?', [result.lastID]));
}
export async function listChannelingRelations(db: DatabaseLike, options: { projectId?: number; status?: string; source?: string; block?: string } = {}): Promise<ChannelingRelation[]> {
  if (options.status !== undefined && !statuses.has(options.status as RelationStatus)) throw new Error('status is invalid');
  if (options.source !== undefined && !sources.has(options.source as RelationSource)) throw new Error('source is invalid');
  const clauses: string[] = []; const params: unknown[] = [];
  for (const [column, value] of [['r.project_id', options.projectId], ['r.status', options.status], ['r.source', options.source], ['p.block', options.block]] as const) if (value !== undefined) { clauses.push(`${column} = ?`); params.push(value); }
  return (await db.all(`SELECT r.*, p.block FROM channeling_relations r JOIN channeling_projects p ON p.id = r.project_id${clauses.length ? ` WHERE ${clauses.join(' AND ')}` : ''} ORDER BY r.updated_at DESC, r.id DESC`, params)).map(relation);
}
export async function updateChannelingRelation(db: DatabaseLike, id: number, changes: Partial<Omit<ChannelingRelationInput, 'projectId'>>): Promise<ChannelingRelation> {
  const current = await db.get('SELECT * FROM channeling_relations WHERE id = ?', [id]); if (!current) throw new Error('Relation not found');
  const merged: ChannelingRelationInput = { projectId: current.project_id, injectionWell: current.injection_well, productionWell: current.production_well, reservoirLayer: current.reservoir_layer, impactLevel: current.impact_level, confidence: current.confidence, status: current.status, source: current.source, evidence: current.evidence, effectiveStartDate: current.effective_start_date, effectiveEndDate: current.effective_end_date, owner: current.owner, ...changes };
  validateRelation(merged); const now = new Date().toISOString();
  await db.run('UPDATE channeling_relations SET injection_well=?, production_well=?, reservoir_layer=?, impact_level=?, confidence=?, status=?, source=?, evidence=?, effective_start_date=?, effective_end_date=?, owner=?, updated_at=? WHERE id=?', [merged.injectionWell.trim(), merged.productionWell.trim(), merged.reservoirLayer.trim(), merged.impactLevel, merged.confidence, merged.status, merged.source, merged.evidence.trim(), merged.effectiveStartDate, merged.effectiveEndDate, merged.owner.trim(), now, id]);
  return relation(await db.get('SELECT r.*, p.block FROM channeling_relations r JOIN channeling_projects p ON p.id = r.project_id WHERE r.id = ?', [id]));
}
