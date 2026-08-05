import type { DatabaseLike } from './channelingProjectStore.ts';
import { withChannelingWriteLock } from './channelingWriteQueue.ts';

export type TrackingSubjectType = 'project' | 'relation' | 'well';
export type TrackingEventType = 'discovered' | 'measure_planned' | 'executed' | 'evaluated' | 'reviewed' | 'closed' | 'recurred' | 'status_changed' | 'relation_confirmed' | 'relation_released' | 'corrected';
export type TrackingLink = { subjectType: TrackingSubjectType; subjectId: number };
export type TrackingEventInput = {
  eventType: TrackingEventType;
  occurredOn: string;
  content: string;
  evidence?: string;
  owner: string;
  createdBy: string;
  links: TrackingLink[];
  metricsSnapshot?: unknown;
  supersedesEventId?: number | null;
};
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

const eventTypes = new Set<TrackingEventType>([
  'discovered', 'measure_planned', 'executed', 'evaluated', 'reviewed', 'closed', 'recurred',
  'status_changed', 'relation_confirmed', 'relation_released', 'corrected',
]);
const subjectTables: Record<TrackingSubjectType, string> = {
  project: 'channeling_projects',
  relation: 'channeling_relations',
  well: 'channeling_well_profiles',
};

export async function initChannelingTrackingTables(db: DatabaseLike): Promise<void> {
  await db.exec(`CREATE TABLE IF NOT EXISTS channeling_tracking_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    event_type TEXT NOT NULL,
    occurred_on TEXT NOT NULL,
    content TEXT NOT NULL,
    evidence TEXT NOT NULL DEFAULT '',
    owner TEXT NOT NULL,
    metrics_snapshot_json TEXT,
    supersedes_event_id INTEGER,
    voided_at TEXT,
    void_reason TEXT,
    created_by TEXT NOT NULL,
    created_at TEXT NOT NULL
  ); CREATE TABLE IF NOT EXISTS channeling_tracking_event_links (
    event_id INTEGER NOT NULL,
    subject_type TEXT NOT NULL,
    subject_id INTEGER NOT NULL,
    UNIQUE(event_id, subject_type, subject_id),
    FOREIGN KEY(event_id) REFERENCES channeling_tracking_events(id)
  ); CREATE INDEX IF NOT EXISTS idx_channeling_tracking_links_subject
    ON channeling_tracking_event_links(subject_type, subject_id, event_id);`);
}

function required(value: unknown, field: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${field} is required`);
  return value.trim();
}

function calendarDate(value: unknown): string {
  const date = typeof value === 'string' ? value : '';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)
    || date.startsWith('0000-')
    || Number.isNaN(Date.parse(`${date}T00:00:00Z`))
    || new Date(`${date}T00:00:00Z`).toISOString().slice(0, 10) !== date) {
    throw new Error('occurredOn must be a calendar date');
  }
  return date;
}

function validateLinks(links: TrackingLink[]): void {
  if (!Array.isArray(links) || links.length === 0) throw new Error('links are required');
  for (const link of links) {
    if (!link || !Object.hasOwn(subjectTables, link.subjectType)
      || !Number.isInteger(link.subjectId) || link.subjectId <= 0) throw new Error('link is invalid');
  }
}

function dedupeLinks(links: TrackingLink[]): TrackingLink[] {
  return [...new Map(links.map((link) => [`${link.subjectType}:${link.subjectId}`, link])).values()];
}

function validateTrackingEvent(input: TrackingEventInput): void {
  if (!eventTypes.has(input.eventType)) throw new Error('eventType is invalid');
  calendarDate(input.occurredOn);
  required(input.content, 'content');
  required(input.owner, 'owner');
  required(input.createdBy, 'createdBy');
  validateLinks(input.links);
}

async function validateTrackingSubjects(db: DatabaseLike, links: TrackingLink[]): Promise<void> {
  for (const link of dedupeLinks(links)) {
    const table = subjectTables[link.subjectType];
    if (!await db.get(`SELECT id FROM ${table} WHERE id = ?`, [link.subjectId])) {
      throw new Error(`${link.subjectType} not found`);
    }
  }
}

export async function createTrackingEventUnlocked(db: DatabaseLike, input: TrackingEventInput): Promise<TrackingEvent> {
  validateTrackingEvent(input);
  const links = dedupeLinks(input.links);
  await validateTrackingSubjects(db, links);
  const now = new Date().toISOString();
  const metricsSnapshotJson = input.metricsSnapshot === undefined ? null : JSON.stringify(input.metricsSnapshot);
  const result = await db.run(
    'INSERT INTO channeling_tracking_events (event_type, occurred_on, content, evidence, owner, metrics_snapshot_json, supersedes_event_id, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
    [input.eventType, input.occurredOn, input.content.trim(), input.evidence?.trim() || '', input.owner.trim(), metricsSnapshotJson, input.supersedesEventId ?? null, input.createdBy.trim(), now],
  );
  const eventId = Number(result.lastID);
  for (const link of links) {
    await db.run(
      'INSERT INTO channeling_tracking_event_links (event_id, subject_type, subject_id) VALUES (?, ?, ?)',
      [eventId, link.subjectType, link.subjectId],
    );
  }
  return getTrackingEvent(db, eventId);
}

export function createTrackingEvent(db: DatabaseLike, input: TrackingEventInput): Promise<TrackingEvent> {
  return withChannelingWriteLock(db, async () => {
    await db.exec('BEGIN IMMEDIATE');
    try {
      const event = await createTrackingEventUnlocked(db, input);
      await db.exec('COMMIT');
      return event;
    } catch (error) {
      await db.exec('ROLLBACK');
      throw error;
    }
  });
}

export async function listTrackingEventLinks(db: DatabaseLike, eventId: number): Promise<TrackingLink[]> {
  return await db.all(
    'SELECT subject_type AS subjectType, subject_id AS subjectId FROM channeling_tracking_event_links WHERE event_id = ? ORDER BY subject_type, subject_id',
    [eventId],
  ) as TrackingLink[];
}

function parseMetricsSnapshot(value: unknown): unknown | null {
  if (value === null || value === undefined) return null;
  try {
    return JSON.parse(String(value));
  } catch {
    throw new Error('Invalid metrics snapshot JSON');
  }
}

export async function getTrackingEvent(db: DatabaseLike, id: number): Promise<TrackingEvent> {
  const row = await db.get('SELECT * FROM channeling_tracking_events WHERE id = ?', [id]);
  if (!row) throw new Error('Tracking event not found');
  return {
    id: row.id,
    eventType: row.event_type,
    occurredOn: row.occurred_on,
    content: row.content,
    evidence: row.evidence,
    owner: row.owner,
    metricsSnapshot: parseMetricsSnapshot(row.metrics_snapshot_json),
    supersedesEventId: row.supersedes_event_id,
    voidedAt: row.voided_at,
    voidReason: row.void_reason,
    createdBy: row.created_by,
    createdAt: row.created_at,
    links: await listTrackingEventLinks(db, id),
  };
}

export async function listTrackingEvents(db: DatabaseLike, subject: TrackingLink): Promise<TrackingEvent[]> {
  validateLinks([subject]);
  const rows = await db.all(
    `SELECT e.id FROM channeling_tracking_events e
      JOIN channeling_tracking_event_links l ON l.event_id = e.id
      WHERE l.subject_type = ? AND l.subject_id = ?
      ORDER BY e.occurred_on DESC, e.created_at DESC, e.id DESC`,
    [subject.subjectType, subject.subjectId],
  );
  return Promise.all(rows.map((row) => getTrackingEvent(db, row.id)));
}

type TrackingCorrectionInput = Omit<TrackingEventInput, 'eventType' | 'links' | 'metricsSnapshot' | 'supersedesEventId'> & { reason: string };

export function correctTrackingEvent(db: DatabaseLike, id: number, input: TrackingCorrectionInput): Promise<TrackingEvent> {
  return withChannelingWriteLock(db, async () => {
    await db.exec('BEGIN IMMEDIATE');
    try {
      const reason = required(input.reason, 'reason');
      const original = await getTrackingEvent(db, id);
      if (original.voidedAt) throw new Error('Tracking event already corrected');
      const corrected = await createTrackingEventUnlocked(db, {
        ...input,
        eventType: 'corrected',
        links: original.links,
        supersedesEventId: id,
      });
      await db.run(
        'UPDATE channeling_tracking_events SET voided_at = ?, void_reason = ? WHERE id = ? AND voided_at IS NULL',
        [new Date().toISOString(), reason, id],
      );
      await db.exec('COMMIT');
      return corrected;
    } catch (error) {
      await db.exec('ROLLBACK');
      throw error;
    }
  });
}
