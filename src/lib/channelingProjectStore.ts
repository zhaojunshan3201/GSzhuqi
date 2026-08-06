import { withChannelingWriteLock } from './channelingWriteQueue.ts';

import { createTrackingEventUnlocked, initChannelingTrackingTables } from './channelingTrackingStore.ts';
import { ensureWellProfileUnlocked, initChannelingWellTables } from './channelingWellStore.ts';

export type DatabaseLike = { exec(sql: string): Promise<void>; run(sql: string, params?: unknown[]): Promise<{ lastID?: number }>; get(sql: string, params?: unknown[]): Promise<any>; all(sql: string, params?: unknown[]): Promise<any[]> };
export type ChannelingType = 'steam' | 'nitrogen';
export type ImpactLevel = 'high' | 'medium' | 'low';
export type RelationStatus = 'confirmed' | 'suspected' | 'released';
export type RelationSource = 'manual' | 'import' | 'suspected';
export type ChannelingGovernanceStatus = 'identified' | 'confirmed' | 'risk_assessed' | 'planned' | 'governing' | 'verifying' | 'closed' | 'recurred';
export type ChannelingProjectInput = { projectName: string; block: string; owner: string; status?: ChannelingGovernanceStatus; governanceMeasure?: string; plannedDate?: string | null; actualDate?: string | null; beforeMetric?: number | null; afterMetric?: number | null; closureEvidence?: string; riskLevel?: ImpactLevel; estimatedLoss?: number | null; affectedWellCount?: number | null; affectedDailyOil?: number | null; occupiedProduction?: number | null };
export type ChannelingProjectPatch = Partial<ChannelingProjectInput>;
export type ChannelingRelationInput = { projectId: number; channelingType: ChannelingType; injectionWell: string; productionWell: string; reservoirLayer: string; impactLevel: ImpactLevel; confidence: number; status: RelationStatus; source: RelationSource; evidence: string; effectiveStartDate: string; effectiveEndDate: string; owner: string };
export type ChannelingProject = Required<Omit<ChannelingProjectInput, 'plannedDate' | 'actualDate' | 'beforeMetric' | 'afterMetric' | 'estimatedLoss' | 'affectedWellCount' | 'affectedDailyOil' | 'occupiedProduction'>> & { id: number; plannedDate: string | null; actualDate: string | null; beforeMetric: number | null; afterMetric: number | null; estimatedLoss: number | null; affectedWellCount: number | null; affectedDailyOil: number | null; occupiedProduction: number | null; relationCount: number; hasTrackingHistory: boolean; canDelete: boolean; createdAt: string; updatedAt: string };
export type ChannelingGovernanceTodo = ChannelingProject & { overdue: boolean };
export type ChannelingRelation = ChannelingRelationInput & { id: number; block: string; hasTrackingHistory: boolean; canDelete: boolean; createdAt: string; updatedAt: string };
export type ChannelingAuditContext = { createdBy: string };

const impactLevels = new Set<ImpactLevel>(['high', 'medium', 'low']);
const channelingTypes = new Set<ChannelingType>(['steam', 'nitrogen']);
const statuses = new Set<RelationStatus>(['confirmed', 'suspected', 'released']);
const sources = new Set<RelationSource>(['manual', 'import', 'suspected']);
const governanceStatuses = new Set<ChannelingGovernanceStatus>(['identified', 'confirmed', 'risk_assessed', 'planned', 'governing', 'verifying', 'closed', 'recurred']);
const nextGovernanceStatuses: Record<ChannelingGovernanceStatus, ChannelingGovernanceStatus[]> = { identified: ['confirmed'], confirmed: ['risk_assessed'], risk_assessed: ['planned'], planned: ['governing'], governing: ['verifying'], verifying: ['closed'], closed: ['recurred'], recurred: ['confirmed'] };

export async function initChannelingProjectTables(db: DatabaseLike) {
  await db.exec(`CREATE TABLE IF NOT EXISTS channeling_projects (
    id INTEGER PRIMARY KEY AUTOINCREMENT, project_name TEXT NOT NULL, block TEXT NOT NULL, owner TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'identified', governance_measure TEXT NOT NULL DEFAULT '', planned_date TEXT, actual_date TEXT, before_metric REAL, after_metric REAL, closure_evidence TEXT NOT NULL DEFAULT '', risk_level TEXT NOT NULL DEFAULT 'medium', estimated_loss REAL, affected_well_count INTEGER, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
  ); CREATE TABLE IF NOT EXISTS channeling_relations (
    id INTEGER PRIMARY KEY AUTOINCREMENT, project_id INTEGER NOT NULL, channeling_type TEXT NOT NULL DEFAULT 'steam', injection_well TEXT NOT NULL, production_well TEXT NOT NULL, reservoir_layer TEXT NOT NULL,
    impact_level TEXT NOT NULL, confidence REAL NOT NULL, status TEXT NOT NULL, source TEXT NOT NULL, evidence TEXT NOT NULL,
    effective_start_date TEXT NOT NULL, effective_end_date TEXT NOT NULL, owner TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
    FOREIGN KEY(project_id) REFERENCES channeling_projects(id)
  );`);
  for (const definition of ["status TEXT NOT NULL DEFAULT 'identified'", "governance_measure TEXT NOT NULL DEFAULT ''", 'planned_date TEXT', 'actual_date TEXT', 'before_metric REAL', 'after_metric REAL', "closure_evidence TEXT NOT NULL DEFAULT ''", "risk_level TEXT NOT NULL DEFAULT 'medium'", 'estimated_loss REAL', 'affected_well_count INTEGER', 'affected_daily_oil REAL', 'occupied_production REAL']) {
    try { await db.exec(`ALTER TABLE channeling_projects ADD COLUMN ${definition}`); } catch (error: any) { if (!String(error.message).includes('duplicate column name')) throw error; }
  }
  try { await db.exec("ALTER TABLE channeling_relations ADD COLUMN channeling_type TEXT NOT NULL DEFAULT 'steam'"); } catch (error: any) { if (!String(error.message).includes('duplicate column name')) throw error; }
  await db.exec('CREATE INDEX IF NOT EXISTS idx_channeling_relations_pair ON channeling_relations(project_id, channeling_type, injection_well, production_well)');
  await initChannelingWellTables(db);
  await initChannelingTrackingTables(db);
}

function withTransaction<T>(db: DatabaseLike, operation: () => Promise<T>): Promise<T> {
  return withChannelingWriteLock(db, async () => {
    await db.exec('BEGIN IMMEDIATE');
    try { const result = await operation(); await db.exec('COMMIT'); return result; }
    catch (error) { await db.exec('ROLLBACK'); throw error; }
  });
}

function shanghaiCalendarDate(now = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now);
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((item) => item.type === type)!.value;
  return `${part('year')}-${part('month')}-${part('day')}`;
}

function required(value: unknown, field: string): string { if (typeof value !== 'string' || !value.trim()) throw new Error(`${field} is required`); return value.trim(); }
function optionalText(value: unknown, field: string): string { if (value === undefined || value === null) return ''; if (typeof value !== 'string') throw new Error(`${field} is invalid`); return value.trim(); }
function validDate(value: unknown, field: string): string { const date = required(value, field); if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(`${date}T00:00:00Z`)) || new Date(`${date}T00:00:00Z`).toISOString().slice(0, 10) !== date) throw new Error(`${field} must be a calendar date`); return date; }
function nullableDate(value: unknown, field: string): string | null { return value === undefined || value === null || value === '' ? null : validDate(value, field); }
function nullableNonNegative(value: unknown, field: string, integer = false): number | null { if (value === undefined || value === null || value === '') return null; if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || (integer && !Number.isInteger(value))) throw new Error(`${field} is invalid`); return value; }
function validateProject(input: ChannelingProjectInput) {
  required(input.projectName, 'projectName'); required(input.block, 'block'); required(input.owner, 'owner');
  if (input.status !== undefined && !governanceStatuses.has(input.status)) throw new Error('status is invalid');
  if (input.riskLevel !== undefined && !impactLevels.has(input.riskLevel)) throw new Error('riskLevel is invalid');
  const planned = nullableDate(input.plannedDate, 'plannedDate'); const actual = nullableDate(input.actualDate, 'actualDate');
  if (planned && actual && actual < planned) throw new Error('actualDate must not precede plannedDate');
  nullableNonNegative(input.beforeMetric, 'beforeMetric'); nullableNonNegative(input.afterMetric, 'afterMetric'); nullableNonNegative(input.estimatedLoss, 'estimatedLoss'); nullableNonNegative(input.affectedWellCount, 'affectedWellCount', true); nullableNonNegative(input.affectedDailyOil, 'affectedDailyOil'); nullableNonNegative(input.occupiedProduction, 'occupiedProduction');
  if (input.status === 'closed' && !optionalText(input.closureEvidence, 'closureEvidence')) throw new Error('closureEvidence is required when closing a project');
}
function validateRelation(input: ChannelingRelationInput) { if (!Number.isInteger(input.projectId) || input.projectId <= 0) throw new Error('projectId is required'); if (!channelingTypes.has(input.channelingType)) throw new Error('channelingType is invalid'); for (const field of ['injectionWell', 'productionWell', 'reservoirLayer', 'evidence', 'owner'] as const) required(input[field], field); if (!impactLevels.has(input.impactLevel)) throw new Error('impactLevel is invalid'); if (!statuses.has(input.status)) throw new Error('status is invalid'); if (!sources.has(input.source)) throw new Error('source is invalid'); if (typeof input.confidence !== 'number' || !Number.isFinite(input.confidence) || input.confidence < 0 || input.confidence > 1) throw new Error('confidence must be between 0 and 1'); const start = validDate(input.effectiveStartDate, 'effectiveStartDate'); const end = validDate(input.effectiveEndDate, 'effectiveEndDate'); if (end < start) throw new Error('effectiveEndDate must not precede effectiveStartDate'); }
function project(row: any): ChannelingProject { return { id: row.id, projectName: row.project_name, block: row.block, owner: row.owner, status: row.status || 'identified', governanceMeasure: row.governance_measure || '', plannedDate: row.planned_date, actualDate: row.actual_date, beforeMetric: row.before_metric, afterMetric: row.after_metric, closureEvidence: row.closure_evidence || '', riskLevel: row.risk_level || 'medium', estimatedLoss: row.estimated_loss, affectedWellCount: row.affected_well_count, affectedDailyOil: row.affected_daily_oil, occupiedProduction: row.occupied_production, relationCount: Number(row.relation_count ?? 0), hasTrackingHistory: Boolean(row.has_tracking_history), canDelete: row.can_delete === undefined ? true : Boolean(row.can_delete), createdAt: row.created_at, updatedAt: row.updated_at }; }
function relation(row: any): ChannelingRelation { return { id: row.id, projectId: row.project_id, channelingType: row.channeling_type, injectionWell: row.injection_well, productionWell: row.production_well, reservoirLayer: row.reservoir_layer, impactLevel: row.impact_level, confidence: row.confidence, status: row.status, source: row.source, evidence: row.evidence, effectiveStartDate: row.effective_start_date, effectiveEndDate: row.effective_end_date, owner: row.owner, block: row.block, hasTrackingHistory: Boolean(row.has_tracking_history), canDelete: row.can_delete === undefined ? true : Boolean(row.can_delete), createdAt: row.created_at, updatedAt: row.updated_at }; }

const projectCapabilitiesSql = `,
  (SELECT COUNT(*) FROM channeling_relations counted_relation WHERE counted_relation.project_id = p.id) AS relation_count,
  (EXISTS(SELECT 1 FROM channeling_tracking_event_links direct_link WHERE direct_link.subject_type = 'project' AND direct_link.subject_id = p.id)
    OR EXISTS(SELECT 1 FROM channeling_relations history_relation JOIN channeling_tracking_event_links relation_link ON relation_link.subject_type = 'relation' AND relation_link.subject_id = history_relation.id WHERE history_relation.project_id = p.id)) AS has_tracking_history,
  (NOT EXISTS(SELECT 1 FROM channeling_relations delete_relation WHERE delete_relation.project_id = p.id)
    AND NOT EXISTS(SELECT 1 FROM channeling_tracking_event_links delete_link WHERE delete_link.subject_type = 'project' AND delete_link.subject_id = p.id)) AS can_delete`;
const relationCapabilitiesSql = `,
  EXISTS(SELECT 1 FROM channeling_tracking_event_links history_link WHERE history_link.subject_type = 'relation' AND history_link.subject_id = r.id) AS has_tracking_history,
  NOT EXISTS(SELECT 1 FROM channeling_tracking_event_links delete_link WHERE delete_link.subject_type = 'relation' AND delete_link.subject_id = r.id) AS can_delete`;

async function getProjectWithCapabilities(db: DatabaseLike, id: number): Promise<ChannelingProject> {
  return project(await db.get(`SELECT p.*${projectCapabilitiesSql} FROM channeling_projects p WHERE p.id = ?`, [id]));
}

async function getRelationWithCapabilities(db: DatabaseLike, id: number): Promise<ChannelingRelation> {
  return relation(await db.get(`SELECT r.*, p.block${relationCapabilitiesSql} FROM channeling_relations r JOIN channeling_projects p ON p.id = r.project_id WHERE r.id = ?`, [id]));
}

async function createChannelingProjectUnlocked(db: DatabaseLike, input: ChannelingProjectInput): Promise<ChannelingProject> {
  const normalized: ChannelingProjectInput = { ...input, status: input.status ?? 'identified', governanceMeasure: optionalText(input.governanceMeasure, 'governanceMeasure'), plannedDate: nullableDate(input.plannedDate, 'plannedDate'), actualDate: nullableDate(input.actualDate, 'actualDate'), beforeMetric: nullableNonNegative(input.beforeMetric, 'beforeMetric'), afterMetric: nullableNonNegative(input.afterMetric, 'afterMetric'), closureEvidence: optionalText(input.closureEvidence, 'closureEvidence'), riskLevel: input.riskLevel ?? 'medium', estimatedLoss: nullableNonNegative(input.estimatedLoss, 'estimatedLoss'), affectedWellCount: nullableNonNegative(input.affectedWellCount, 'affectedWellCount', true), affectedDailyOil: nullableNonNegative(input.affectedDailyOil, 'affectedDailyOil'), occupiedProduction: nullableNonNegative(input.occupiedProduction, 'occupiedProduction') };
  validateProject(normalized); const now = new Date().toISOString();
  const result = await db.run('INSERT INTO channeling_projects (project_name, block, owner, status, governance_measure, planned_date, actual_date, before_metric, after_metric, closure_evidence, risk_level, estimated_loss, affected_well_count, affected_daily_oil, occupied_production, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)', [normalized.projectName.trim(), normalized.block.trim(), normalized.owner.trim(), normalized.status, normalized.governanceMeasure, normalized.plannedDate, normalized.actualDate, normalized.beforeMetric, normalized.afterMetric, normalized.closureEvidence, normalized.riskLevel, normalized.estimatedLoss, normalized.affectedWellCount, normalized.affectedDailyOil, normalized.occupiedProduction, now, now]);
  return project(await db.get('SELECT * FROM channeling_projects WHERE id = ?', [result.lastID]));
}
export function createChannelingProject(db: DatabaseLike, input: ChannelingProjectInput): Promise<ChannelingProject> { return withChannelingWriteLock(db, () => createChannelingProjectUnlocked(db, input)); }
export async function listChannelingProjects(db: DatabaseLike, options: { block?: string } = {}): Promise<ChannelingProject[]> { const where = options.block ? ' WHERE p.block = ?' : ''; return (await db.all(`SELECT p.*${projectCapabilitiesSql} FROM channeling_projects p${where} ORDER BY p.updated_at DESC, p.id DESC`, options.block ? [options.block] : [])).map(project); }
async function updateChannelingProjectUnlocked(db: DatabaseLike, id: number, changes: ChannelingProjectPatch, audit: ChannelingAuditContext = { createdBy: 'system' }): Promise<ChannelingProject> {
  const current = await db.get('SELECT * FROM channeling_projects WHERE id = ?', [id]); if (!current) throw new Error('Project not found');
  const previous = project(current); const merged: ChannelingProjectInput = { ...previous, ...changes };
  if (changes.status !== undefined && changes.status !== previous.status && !nextGovernanceStatuses[previous.status].includes(changes.status)) throw new Error(`Invalid governance status transition: ${previous.status} -> ${changes.status}`);
  validateProject(merged);
  const normalized = { ...merged, governanceMeasure: optionalText(merged.governanceMeasure, 'governanceMeasure'), closureEvidence: optionalText(merged.closureEvidence, 'closureEvidence'), plannedDate: nullableDate(merged.plannedDate, 'plannedDate'), actualDate: nullableDate(merged.actualDate, 'actualDate'), beforeMetric: nullableNonNegative(merged.beforeMetric, 'beforeMetric'), afterMetric: nullableNonNegative(merged.afterMetric, 'afterMetric'), estimatedLoss: nullableNonNegative(merged.estimatedLoss, 'estimatedLoss'), affectedWellCount: nullableNonNegative(merged.affectedWellCount, 'affectedWellCount', true), affectedDailyOil: nullableNonNegative(merged.affectedDailyOil, 'affectedDailyOil'), occupiedProduction: nullableNonNegative(merged.occupiedProduction, 'occupiedProduction') };
  await db.run('UPDATE channeling_projects SET project_name=?, block=?, owner=?, status=?, governance_measure=?, planned_date=?, actual_date=?, before_metric=?, after_metric=?, closure_evidence=?, risk_level=?, estimated_loss=?, affected_well_count=?, affected_daily_oil=?, occupied_production=?, updated_at=? WHERE id=?', [normalized.projectName.trim(), normalized.block.trim(), normalized.owner.trim(), normalized.status, normalized.governanceMeasure, normalized.plannedDate, normalized.actualDate, normalized.beforeMetric, normalized.afterMetric, normalized.closureEvidence, normalized.riskLevel, normalized.estimatedLoss, normalized.affectedWellCount, normalized.affectedDailyOil, normalized.occupiedProduction, new Date().toISOString(), id]);
  const updated = project(await db.get('SELECT * FROM channeling_projects WHERE id = ?', [id]));
  if (updated.status !== previous.status) await createTrackingEventUnlocked(db, {
    eventType: 'status_changed', occurredOn: shanghaiCalendarDate(), content: `Project status changed: ${previous.status} -> ${updated.status}`,
    evidence: updated.closureEvidence || updated.governanceMeasure, owner: updated.owner, createdBy: audit.createdBy,
    links: [{ subjectType: 'project', subjectId: updated.id }],
  });
  return getProjectWithCapabilities(db, id);
}
export function updateChannelingProject(db: DatabaseLike, id: number, changes: ChannelingProjectPatch, audit?: ChannelingAuditContext): Promise<ChannelingProject> { return withTransaction(db, () => updateChannelingProjectUnlocked(db, id, changes, audit)); }
export async function listChannelingGovernanceTodos(db: DatabaseLike, date = new Date().toISOString().slice(0, 10)): Promise<ChannelingGovernanceTodo[]> {
  validDate(date, 'date'); const rows = (await db.all(`SELECT p.*${projectCapabilitiesSql} FROM channeling_projects p WHERE p.status != 'closed'`, [])).map(project);
  const risk = { high: 3, medium: 2, low: 1 } as const;
  return rows.map((item) => ({ ...item, overdue: Boolean(item.plannedDate && item.plannedDate < date && !item.actualDate) })).sort((a, b) => risk[b.riskLevel] - risk[a.riskLevel] || Number(b.overdue) - Number(a.overdue) || (b.estimatedLoss ?? 0) - (a.estimatedLoss ?? 0) || (b.affectedWellCount ?? 0) - (a.affectedWellCount ?? 0) || b.id - a.id);
}
export async function createChannelingRelationUnlocked(db: DatabaseLike, input: ChannelingRelationInput, audit: ChannelingAuditContext = { createdBy: 'system' }): Promise<ChannelingRelation> {
  validateRelation(input);
  if (input.source === 'suspected' && input.status !== 'suspected') throw new Error('suspected relations must be created as suspected');
  const projectRow = await db.get('SELECT id, block FROM channeling_projects WHERE id = ?', [input.projectId]);
  if (!projectRow) throw new Error('Project not found');
  const injectionProfile = await ensureWellProfileUnlocked(db, { wellNo: input.injectionWell, block: projectRow.block, owner: input.owner });
  const productionProfile = await ensureWellProfileUnlocked(db, { wellNo: input.productionWell, block: projectRow.block, owner: input.owner });
  const now = new Date().toISOString();
  const values = [input.projectId, input.channelingType, input.injectionWell.trim(), input.productionWell.trim(), input.reservoirLayer.trim(), input.impactLevel, input.confidence, input.status, input.source, input.evidence.trim(), input.effectiveStartDate, input.effectiveEndDate, input.owner.trim(), now, now];
  const result = await db.run('INSERT INTO channeling_relations (project_id, channeling_type, injection_well, production_well, reservoir_layer, impact_level, confidence, status, source, evidence, effective_start_date, effective_end_date, owner, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)', values);
  const created = relation(await db.get('SELECT r.*, p.block FROM channeling_relations r JOIN channeling_projects p ON p.id = r.project_id WHERE r.id = ?', [result.lastID]));
  if (created.status === 'confirmed') await createRelationStatusEvent(db, created, 'relation_confirmed', audit, injectionProfile.id, productionProfile.id);
  return getRelationWithCapabilities(db, created.id);
}
export function createChannelingRelation(db: DatabaseLike, input: ChannelingRelationInput, audit?: ChannelingAuditContext): Promise<ChannelingRelation> { return withTransaction(db, () => createChannelingRelationUnlocked(db, input, audit)); }
export async function listChannelingRelations(db: DatabaseLike, options: { projectId?: number; channelingType?: string; status?: string; source?: string; block?: string } = {}): Promise<ChannelingRelation[]> { if (options.channelingType !== undefined && !channelingTypes.has(options.channelingType as ChannelingType)) throw new Error('channelingType is invalid'); if (options.status !== undefined && !statuses.has(options.status as RelationStatus)) throw new Error('status is invalid'); if (options.source !== undefined && !sources.has(options.source as RelationSource)) throw new Error('source is invalid'); const clauses: string[] = []; const params: unknown[] = []; for (const [column, value] of [['r.project_id', options.projectId], ['r.channeling_type', options.channelingType], ['r.status', options.status], ['r.source', options.source], ['p.block', options.block]] as const) if (value !== undefined) { clauses.push(`${column} = ?`); params.push(value); } return (await db.all(`SELECT r.*, p.block${relationCapabilitiesSql} FROM channeling_relations r JOIN channeling_projects p ON p.id = r.project_id${clauses.length ? ` WHERE ${clauses.join(' AND ')}` : ''} ORDER BY r.updated_at DESC, r.id DESC`, params)).map(relation); }
async function createRelationStatusEvent(db: DatabaseLike, current: ChannelingRelation, eventType: 'relation_confirmed' | 'relation_released', audit: ChannelingAuditContext, injectionProfileId?: number, productionProfileId?: number): Promise<void> {
  const injection = injectionProfileId ?? (await ensureWellProfileUnlocked(db, { wellNo: current.injectionWell, block: current.block, owner: current.owner })).id;
  const production = productionProfileId ?? (await ensureWellProfileUnlocked(db, { wellNo: current.productionWell, block: current.block, owner: current.owner })).id;
  const verb = eventType === 'relation_confirmed' ? '关系已确认' : '关系已解除';
  await createTrackingEventUnlocked(db, {
    eventType, occurredOn: shanghaiCalendarDate(), content: `${verb}：${current.injectionWell} → ${current.productionWell}`,
    evidence: current.evidence, owner: current.owner, createdBy: audit.createdBy,
    links: [{ subjectType: 'project', subjectId: current.projectId }, { subjectType: 'relation', subjectId: current.id }, { subjectType: 'well', subjectId: injection }, { subjectType: 'well', subjectId: production }],
  });
}

async function updateChannelingRelationUnlocked(db: DatabaseLike, id: number, changes: Partial<Omit<ChannelingRelationInput, 'projectId'>>, audit: ChannelingAuditContext = { createdBy: 'system' }): Promise<ChannelingRelation> {
  const current = await db.get('SELECT r.*, p.block FROM channeling_relations r JOIN channeling_projects p ON p.id = r.project_id WHERE r.id = ?', [id]);
  if (!current) throw new Error('Relation not found');
  const merged: ChannelingRelationInput = { projectId: current.project_id, channelingType: current.channeling_type, injectionWell: current.injection_well, productionWell: current.production_well, reservoirLayer: current.reservoir_layer, impactLevel: current.impact_level, confidence: current.confidence, status: current.status, source: current.source, evidence: current.evidence, effectiveStartDate: current.effective_start_date, effectiveEndDate: current.effective_end_date, owner: current.owner, ...changes };
  validateRelation(merged);
  const injectionProfile = await ensureWellProfileUnlocked(db, { wellNo: merged.injectionWell, block: current.block, owner: merged.owner });
  const productionProfile = await ensureWellProfileUnlocked(db, { wellNo: merged.productionWell, block: current.block, owner: merged.owner });
  const now = new Date().toISOString();
  await db.run('UPDATE channeling_relations SET channeling_type=?, injection_well=?, production_well=?, reservoir_layer=?, impact_level=?, confidence=?, status=?, source=?, evidence=?, effective_start_date=?, effective_end_date=?, owner=?, updated_at=? WHERE id=?', [merged.channelingType, merged.injectionWell.trim(), merged.productionWell.trim(), merged.reservoirLayer.trim(), merged.impactLevel, merged.confidence, merged.status, merged.source, merged.evidence.trim(), merged.effectiveStartDate, merged.effectiveEndDate, merged.owner.trim(), now, id]);
  const updated = relation(await db.get('SELECT r.*, p.block FROM channeling_relations r JOIN channeling_projects p ON p.id = r.project_id WHERE r.id = ?', [id]));
  if (updated.status !== current.status && updated.status === 'confirmed') await createRelationStatusEvent(db, updated, 'relation_confirmed', audit, injectionProfile.id, productionProfile.id);
  if (updated.status !== current.status && updated.status === 'released') await createRelationStatusEvent(db, updated, 'relation_released', audit, injectionProfile.id, productionProfile.id);
  return getRelationWithCapabilities(db, id);
}
export function updateChannelingRelation(db: DatabaseLike, id: number, changes: Partial<Omit<ChannelingRelationInput, 'projectId'>>, audit?: ChannelingAuditContext): Promise<ChannelingRelation> { return withTransaction(db, () => updateChannelingRelationUnlocked(db, id, changes, audit)); }

async function deleteChannelingProjectUnlocked(db: DatabaseLike, id: number): Promise<void> {
  if (!await db.get('SELECT id FROM channeling_projects WHERE id = ?', [id])) throw new Error('Project not found');
  if (await db.get("SELECT 1 FROM channeling_relations WHERE project_id = ? UNION ALL SELECT 1 FROM channeling_tracking_event_links WHERE subject_type = 'project' AND subject_id = ? LIMIT 1", [id, id])) throw new Error('Project has relations or tracking history');
  if (await db.get("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'channeling_relation_imports'")) {
    await db.run('DELETE FROM channeling_relation_import_rows WHERE import_id IN (SELECT id FROM channeling_relation_imports WHERE project_id = ?)', [id]);
    await db.run('DELETE FROM channeling_relation_imports WHERE project_id = ?', [id]);
  }
  await db.run('DELETE FROM channeling_projects WHERE id = ?', [id]);
}
export function deleteChannelingProject(db: DatabaseLike, id: number): Promise<void> { return withTransaction(db, () => deleteChannelingProjectUnlocked(db, id)); }

async function deleteChannelingRelationUnlocked(db: DatabaseLike, id: number): Promise<void> {
  if (!await db.get('SELECT id FROM channeling_relations WHERE id = ?', [id])) throw new Error('Relation not found');
  if (await db.get("SELECT 1 FROM channeling_tracking_event_links WHERE subject_type = 'relation' AND subject_id = ? LIMIT 1", [id])) throw new Error('Relation has tracking history');
  await db.run('DELETE FROM channeling_relations WHERE id = ?', [id]);
}
export function deleteChannelingRelation(db: DatabaseLike, id: number): Promise<void> { return withTransaction(db, () => deleteChannelingRelationUnlocked(db, id)); }
