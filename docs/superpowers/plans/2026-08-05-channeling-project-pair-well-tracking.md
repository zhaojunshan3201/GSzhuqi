# Channeling Project, Pair, and Well Tracking Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build traceable project-, relation-, and well-level channeling tracking with independent well profiles, role-aware automatic metrics, linked timelines, evaluation snapshots, and protected history.

**Architecture:** Keep the existing channeling project store intact and add three focused modules: a well-profile store, an append-only tracking-event store, and a metrics query/calculation module. Register thin Express routes in `server.ts`, then place a `ChannelingWorkspace` around the existing ledger so project, relation, and well views can navigate without adding a router dependency.

**Tech Stack:** TypeScript, React 19, Express 4, SQLite (`sqlite`/`sqlite3`), ECharts, Node test runner, JSDOM, Vite.

---

## File map

- Create `src/lib/channelingWellStore.ts`: normalize well numbers and persist one profile per normalized well.
- Create `src/lib/channelingTrackingStore.ts`: initialize, validate, create, list, and correct linked tracking events.
- Create `src/lib/channelingMetrics.ts`: query role-aware well metrics, relation comparisons, project summaries, and create stable snapshots.
- Create `src/lib/channelingTrackingApi.ts`: shared browser API types and request helper.
- Create `src/components/ChannelingWorkspace.tsx`: navigate between project ledger, relation detail, and well tracking.
- Create `src/components/ChannelingTimeline.tsx`: reusable timeline and administrator event form.
- Create `src/components/ChannelingWellTracking.tsx`: independent well list and role-aware well detail.
- Create `src/components/ChannelingRelationDetail.tsx`: relation facts, aligned charts, evaluation form, and linked timeline.
- Modify `src/lib/channelingProjectStore.ts`: optimistic updates, auto profile creation, auto system events, and protected deletion.
- Modify `src/components/ChannelingProjectManagement.tsx`: project tabs, project summary/timeline, and detail callbacks.
- Modify `src/lib/sidebarNavigation.ts`: add the independent single-well tracking entry.
- Modify `src/App.tsx`: render `ChannelingWorkspace` for both channeling sidebar entries.
- Modify `server.ts`: initialize new tables and register all read/write endpoints.
- Create focused tests listed in each task; extend existing channeling integration and navigation tests.

### Task 1: Independent well profiles

**Files:**
- Create: `src/lib/channelingWellStore.ts`
- Create: `tests/channelingWellStore.test.ts`

- [ ] **Step 1: Write the failing normalization and persistence tests**

```ts
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import sqlite3 from 'sqlite3';
import { open } from 'sqlite';
import { createWellProfile, initChannelingWellTables, listWellProfiles, normalizeWellNo } from '../src/lib/channelingWellStore.ts';

test('normalizes well numbers and reuses one independent profile', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'channeling-well-'));
  const db = await open({ filename: path.join(dir, 'test.db'), driver: sqlite3.Database });
  try {
    await initChannelingWellTables(db);
    assert.equal(normalizeWellNo('  gao3-A  '), 'GAO3-A');
    const first = await createWellProfile(db, { wellNo: ' gao3-A ', block: '高3', owner: '周' });
    const second = await createWellProfile(db, { wellNo: 'GAO3-a', block: '高3', owner: '周' });
    assert.equal(first.id, second.id);
    assert.equal((await listWellProfiles(db, { query: 'gao3' })).length, 1);
  } finally { await db.close(); await rm(dir, { recursive: true, force: true }); }
});
```

- [ ] **Step 2: Run the test and verify the missing module failure**

Run: `node --import tsx --test tests/channelingWellStore.test.ts`

Expected: FAIL with `ERR_MODULE_NOT_FOUND` for `channelingWellStore.ts`.

- [ ] **Step 3: Implement the well-profile store**

```ts
import { withChannelingWriteLock } from './channelingWriteQueue.ts';
import type { DatabaseLike } from './channelingProjectStore.ts';

export type ChannelingWellProfile = { id: number; wellNo: string; normalizedWellNo: string; block: string; owner: string; createdAt: string; updatedAt: string };
export type ChannelingWellProfileInput = { wellNo: string; block?: string; owner?: string };

export function normalizeWellNo(value: unknown): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error('wellNo is required');
  return value.trim().toUpperCase();
}

export async function initChannelingWellTables(db: DatabaseLike) {
  await db.exec(`CREATE TABLE IF NOT EXISTS channeling_well_profiles (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    well_no TEXT NOT NULL,
    normalized_well_no TEXT NOT NULL UNIQUE,
    block TEXT NOT NULL DEFAULT '',
    owner TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  ); CREATE INDEX IF NOT EXISTS idx_channeling_well_profiles_block ON channeling_well_profiles(block);`);
}

const mapProfile = (row: any): ChannelingWellProfile => ({ id: row.id, wellNo: row.well_no, normalizedWellNo: row.normalized_well_no, block: row.block, owner: row.owner, createdAt: row.created_at, updatedAt: row.updated_at });

export async function ensureWellProfileUnlocked(db: DatabaseLike, input: ChannelingWellProfileInput): Promise<ChannelingWellProfile> {
  const normalized = normalizeWellNo(input.wellNo);
  const existing = await db.get('SELECT * FROM channeling_well_profiles WHERE normalized_well_no = ?', [normalized]);
  if (existing) return mapProfile(existing);
  const now = new Date().toISOString();
  const result = await db.run('INSERT INTO channeling_well_profiles (well_no, normalized_well_no, block, owner, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)', [input.wellNo.trim(), normalized, input.block?.trim() || '', input.owner?.trim() || '', now, now]);
  return mapProfile(await db.get('SELECT * FROM channeling_well_profiles WHERE id = ?', [result.lastID]));
}

export function createWellProfile(db: DatabaseLike, input: ChannelingWellProfileInput): Promise<ChannelingWellProfile> {
  return withChannelingWriteLock(db, () => ensureWellProfileUnlocked(db, input));
}

export async function listWellProfiles(db: DatabaseLike, filters: { query?: string; block?: string } = {}): Promise<ChannelingWellProfile[]> {
  const clauses: string[] = []; const params: unknown[] = [];
  if (filters.query?.trim()) { clauses.push('(normalized_well_no LIKE ? OR well_no LIKE ?)'); params.push(`%${normalizeWellNo(filters.query)}%`, `%${filters.query.trim()}%`); }
  if (filters.block?.trim()) { clauses.push('block = ?'); params.push(filters.block.trim()); }
  return (await db.all(`SELECT * FROM channeling_well_profiles${clauses.length ? ` WHERE ${clauses.join(' AND ')}` : ''} ORDER BY updated_at DESC, id DESC`, params)).map(mapProfile);
}
```

- [ ] **Step 4: Add get and optimistic-update tests and implementation**

```ts
export async function getWellProfile(db: DatabaseLike, id: number): Promise<ChannelingWellProfile> {
  const row = await db.get('SELECT * FROM channeling_well_profiles WHERE id = ?', [id]);
  if (!row) throw new Error('Well profile not found');
  return mapProfile(row);
}

export function updateWellProfile(db: DatabaseLike, id: number, input: { block: string; owner: string; updatedAt: string }): Promise<ChannelingWellProfile> {
  return withChannelingWriteLock(db, async () => {
    const now = new Date().toISOString();
    await db.run('UPDATE channeling_well_profiles SET block=?, owner=?, updated_at=? WHERE id=? AND updated_at=?', [input.block.trim(), input.owner.trim(), now, id, input.updatedAt]);
    const updated = await db.get('SELECT * FROM channeling_well_profiles WHERE id=? AND updated_at=?', [id, now]);
    if (!updated) {
      if (!await db.get('SELECT id FROM channeling_well_profiles WHERE id=?', [id])) throw new Error('Well profile not found');
      throw new Error('Well profile changed; refresh and retry');
    }
    return mapProfile(updated);
  });
}
```

Run: `node --import tsx --test tests/channelingWellStore.test.ts`

Expected: PASS for normalization, duplicate reuse, filtering, missing profile, and stale update cases.

- [ ] **Step 5: Commit the focused store change**

```bash
git add src/lib/channelingWellStore.ts tests/channelingWellStore.test.ts
git commit -m "feat: add independent channeling well profiles"
```

### Task 2: Linked append-only tracking events

**Files:**
- Create: `src/lib/channelingTrackingStore.ts`
- Create: `tests/channelingTrackingStore.test.ts`

- [ ] **Step 1: Write failing event-link and correction tests**

```ts
test('links one event to project relation and wells and corrects without overwriting', async () => {
  const event = await createTrackingEvent(db, {
    eventType: 'executed', occurredOn: '2026-08-05', content: '完成调剖', evidence: '现场记录', owner: '周', createdBy: 'admin',
    links: [{ subjectType: 'project', subjectId: project.id }, { subjectType: 'relation', subjectId: relation.id }, { subjectType: 'well', subjectId: injector.id }],
  });
  assert.equal((await listTrackingEvents(db, { subjectType: 'well', subjectId: injector.id }))[0].id, event.id);
  const correction = await correctTrackingEvent(db, event.id, { occurredOn: '2026-08-06', content: '完成调剖并复测', evidence: '复测记录', owner: '周', createdBy: 'admin', reason: '补充复测结果' });
  assert.equal(correction.supersedesEventId, event.id);
  assert.ok((await getTrackingEvent(db, event.id)).voidedAt);
});
```

- [ ] **Step 2: Run the event test and verify failure**

Run: `node --import tsx --test tests/channelingTrackingStore.test.ts`

Expected: FAIL because tracking store exports do not exist.

- [ ] **Step 3: Implement tables, types, validation, creation, and listing**

```ts
export type TrackingSubjectType = 'project' | 'relation' | 'well';
export type TrackingEventType = 'discovered' | 'measure_planned' | 'executed' | 'evaluated' | 'reviewed' | 'closed' | 'recurred' | 'status_changed' | 'relation_confirmed' | 'relation_released' | 'corrected';
export type TrackingLink = { subjectType: TrackingSubjectType; subjectId: number };
export type TrackingEventInput = { eventType: TrackingEventType; occurredOn: string; content: string; evidence?: string; owner: string; createdBy: string; links: TrackingLink[]; metricsSnapshot?: unknown; supersedesEventId?: number | null };
export type TrackingEvent = { id: number; eventType: TrackingEventType; occurredOn: string; content: string; evidence: string; owner: string; metricsSnapshot: unknown | null; supersedesEventId: number | null; voidedAt: string | null; voidReason: string | null; createdBy: string; createdAt: string; links: TrackingLink[] };

export async function initChannelingTrackingTables(db: DatabaseLike) {
  await db.exec(`CREATE TABLE IF NOT EXISTS channeling_tracking_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT, event_type TEXT NOT NULL, occurred_on TEXT NOT NULL,
    content TEXT NOT NULL, evidence TEXT NOT NULL DEFAULT '', owner TEXT NOT NULL,
    metrics_snapshot_json TEXT, supersedes_event_id INTEGER, voided_at TEXT, void_reason TEXT,
    created_by TEXT NOT NULL, created_at TEXT NOT NULL
  ); CREATE TABLE IF NOT EXISTS channeling_tracking_event_links (
    event_id INTEGER NOT NULL, subject_type TEXT NOT NULL, subject_id INTEGER NOT NULL,
    UNIQUE(event_id, subject_type, subject_id),
    FOREIGN KEY(event_id) REFERENCES channeling_tracking_events(id)
  ); CREATE INDEX IF NOT EXISTS idx_channeling_tracking_links_subject ON channeling_tracking_event_links(subject_type, subject_id, event_id);`);
}

function validateLinks(links: TrackingLink[]) {
  if (!Array.isArray(links) || links.length === 0) throw new Error('links are required');
  for (const link of links) if (!['project', 'relation', 'well'].includes(link.subjectType) || !Number.isInteger(link.subjectId) || link.subjectId <= 0) throw new Error('link is invalid');
}

const eventTypes = new Set<TrackingEventType>(['discovered', 'measure_planned', 'executed', 'evaluated', 'reviewed', 'closed', 'recurred', 'status_changed', 'relation_confirmed', 'relation_released', 'corrected']);
const dedupeLinks = (links: TrackingLink[]) => [...new Map(links.map((link) => [`${link.subjectType}:${link.subjectId}`, link])).values()];
function validateTrackingEvent(input: TrackingEventInput) { if (!eventTypes.has(input.eventType)) throw new Error('eventType is invalid'); if (!/^\d{4}-\d{2}-\d{2}$/.test(input.occurredOn)) throw new Error('occurredOn must be a calendar date'); if (!input.content?.trim()) throw new Error('content is required'); if (!input.owner?.trim()) throw new Error('owner is required'); validateLinks(input.links); }
async function validateTrackingSubjects(db: DatabaseLike, links: TrackingLink[]) { for (const link of dedupeLinks(links)) { const table = link.subjectType === 'project' ? 'channeling_projects' : link.subjectType === 'relation' ? 'channeling_relations' : 'channeling_well_profiles'; if (!await db.get(`SELECT id FROM ${table} WHERE id=?`, [link.subjectId])) throw new Error(`${link.subjectType} not found`); } }

export async function createTrackingEventUnlocked(db: DatabaseLike, input: TrackingEventInput): Promise<TrackingEvent> {
  validateTrackingEvent(input); await validateTrackingSubjects(db, input.links);
  const now = new Date().toISOString();
  const result = await db.run('INSERT INTO channeling_tracking_events (event_type, occurred_on, content, evidence, owner, metrics_snapshot_json, supersedes_event_id, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)', [input.eventType, input.occurredOn, input.content.trim(), input.evidence?.trim() || '', input.owner.trim(), input.metricsSnapshot === undefined ? null : JSON.stringify(input.metricsSnapshot), input.supersedesEventId ?? null, input.createdBy, now]);
  for (const link of dedupeLinks(input.links)) await db.run('INSERT INTO channeling_tracking_event_links VALUES (?, ?, ?)', [result.lastID, link.subjectType, link.subjectId]);
  return getTrackingEvent(db, Number(result.lastID));
}

export function createTrackingEvent(db: DatabaseLike, input: TrackingEventInput): Promise<TrackingEvent> {
  return withChannelingWriteLock(db, async () => { await db.exec('BEGIN IMMEDIATE'); try { const event = await createTrackingEventUnlocked(db, input); await db.exec('COMMIT'); return event; } catch (error) { await db.exec('ROLLBACK'); throw error; } });
}

export async function listTrackingEventLinks(db: DatabaseLike, eventId: number): Promise<TrackingLink[]> { return (await db.all('SELECT subject_type AS subjectType, subject_id AS subjectId FROM channeling_tracking_event_links WHERE event_id=? ORDER BY subject_type, subject_id', [eventId])) as TrackingLink[]; }
export async function getTrackingEvent(db: DatabaseLike, id: number): Promise<TrackingEvent> { const row = await db.get('SELECT * FROM channeling_tracking_events WHERE id=?', [id]); if (!row) throw new Error('Tracking event not found'); return { id: row.id, eventType: row.event_type, occurredOn: row.occurred_on, content: row.content, evidence: row.evidence, owner: row.owner, metricsSnapshot: row.metrics_snapshot_json ? JSON.parse(row.metrics_snapshot_json) : null, supersedesEventId: row.supersedes_event_id, voidedAt: row.voided_at, voidReason: row.void_reason, createdBy: row.created_by, createdAt: row.created_at, links: await listTrackingEventLinks(db, id) }; }
export async function listTrackingEvents(db: DatabaseLike, subject: TrackingLink): Promise<TrackingEvent[]> { validateLinks([subject]); const rows = await db.all('SELECT e.id FROM channeling_tracking_events e JOIN channeling_tracking_event_links l ON l.event_id=e.id WHERE l.subject_type=? AND l.subject_id=? ORDER BY e.occurred_on DESC, e.created_at DESC, e.id DESC', [subject.subjectType, subject.subjectId]); return Promise.all(rows.map((row) => getTrackingEvent(db, row.id))); }
```

- [ ] **Step 4: Implement correction as a transaction that preserves the original**

```ts
export function correctTrackingEvent(db: DatabaseLike, id: number, input: Omit<TrackingEventInput, 'eventType' | 'links' | 'metricsSnapshot' | 'supersedesEventId'> & { reason: string }): Promise<TrackingEvent> {
  return withChannelingWriteLock(db, async () => {
    const original = await getTrackingEvent(db, id);
    if (original.voidedAt) throw new Error('Tracking event already corrected');
    const links = await listTrackingEventLinks(db, id);
    const corrected = await createTrackingEventUnlocked(db, { ...input, eventType: 'corrected', links, supersedesEventId: id });
    await db.run('UPDATE channeling_tracking_events SET voided_at=?, void_reason=? WHERE id=? AND voided_at IS NULL', [new Date().toISOString(), input.reason.trim(), id]);
    return corrected;
  });
}
```

Run: `node --import tsx --test tests/channelingTrackingStore.test.ts`

Expected: PASS, including missing subject, duplicate link, invalid date, stable ordering, and already-corrected rejection.

- [ ] **Step 5: Commit the tracking store**

```bash
git add src/lib/channelingTrackingStore.ts tests/channelingTrackingStore.test.ts
git commit -m "feat: add linked channeling tracking events"
```

### Task 3: Role-aware metric calculations and snapshots

**Files:**
- Create: `src/lib/channelingMetrics.ts`
- Create: `tests/channelingMetrics.test.ts`

- [ ] **Step 1: Write failing tests for missing data, role detection, and date comparisons**

```ts
test('builds role-aware metrics without converting missing days to zero', async () => {
  await seedProduction(db, [['采A', '2026-07-01', 10, 20, 50], ['采A', '2026-07-03', 20, 30, 40]]);
  await seedStage(db, [['注A', 1, '2026-07-01', '2026-07-02', 100, 260, 12, 70, 24]]);
  const producer = await getWellMetrics(db, '采a', '2026-07-01', '2026-07-03');
  assert.deepEqual(producer.roles, ['producer']);
  assert.equal(producer.production?.oil.average, 15);
  assert.equal(producer.production?.oil.validDays, 2);
  const injector = await getWellMetrics(db, '注a', '2026-07-01', '2026-07-03');
  assert.deepEqual(injector.roles, ['injector']);
  assert.equal(injector.injection?.cumulativeSteam, 100);
  assert.equal(injector.injection?.stages[0].temperature, 260);
});

test('compares actual valid observations and reports missing fields', () => {
  const snapshot = compareProductionWindows([{ date: '2026-07-01', oil: 10 }, { date: '2026-08-01', oil: 15 }], { beforeStart: '2026-07-01', splitDate: '2026-07-31', afterEnd: '2026-08-30' });
  assert.deepEqual(snapshot.oil, { beforeAverage: 10, afterAverage: 15, change: 5, changeRate: 0.5, beforeValidDays: 1, afterValidDays: 1 });
});
```

- [ ] **Step 2: Run the test and verify failure**

Run: `node --import tsx --test tests/channelingMetrics.test.ts`

Expected: FAIL because `channelingMetrics.ts` is missing.

- [ ] **Step 3: Implement deterministic helpers and well queries**

```ts
export const normalizeMetricWellNo = (value: string) => value.trim().toUpperCase();
export type ComparisonRange = { beforeStart: string; splitDate: string; afterEnd: string };
export type MetricPoint = { average: number | null; validDays: number };
export type WellMetrics = { wellNo: string; normalizedWellNo: string; roles: Array<'injector' | 'producer'>; queriedAt: string; range: { start: string; end: string }; production: null | { rows: any[]; oil: MetricPoint; liquid: MetricPoint; waterCut: MetricPoint }; injection: null | { stages: any[]; cumulativeSteam: number | null; cycleCount: number } };
const numeric = (value: unknown): number | null => typeof value === 'number' && Number.isFinite(value) ? value : null;
const average = (values: Array<number | null>) => { const valid = values.filter((value): value is number => value !== null); return { average: valid.length ? valid.reduce((sum, value) => sum + value, 0) / valid.length : null, validDays: valid.length }; };
const validateRange = (start: string, end: string) => { if (!/^\d{4}-\d{2}-\d{2}$/.test(start) || !/^\d{4}-\d{2}-\d{2}$/.test(end) || end < start) throw new Error('date range is invalid'); };
const summarizeProduction = (rows: any[]) => ({ rows, oil: average(rows.map((row) => numeric(row.oil))), liquid: average(rows.map((row) => numeric(row.liquid))), waterCut: average(rows.map((row) => numeric(row.waterCut))) });
const summarizeInjection = (stages: any[]) => { const values = stages.map((row) => numeric(row.steamVolume)).filter((value): value is number => value !== null); return { stages, cumulativeSteam: values.length ? values.reduce((sum, value) => sum + value, 0) : null, cycleCount: stages.length }; };

export function compareProductionWindows(rows: any[], range: ComparisonRange) {
  validateRange(range.beforeStart, range.splitDate); validateRange(range.splitDate, range.afterEnd);
  const summarize = (field: 'oil' | 'liquid' | 'waterCut') => {
    const before = average(rows.filter((row) => row.date >= range.beforeStart && row.date <= range.splitDate).map((row) => numeric(row[field])));
    const after = average(rows.filter((row) => row.date > range.splitDate && row.date <= range.afterEnd).map((row) => numeric(row[field])));
    const change = before.average === null || after.average === null ? null : after.average - before.average;
    return { beforeAverage: before.average, afterAverage: after.average, change, changeRate: change === null || before.average === 0 || before.average === null ? null : change / before.average, beforeValidDays: before.validDays, afterValidDays: after.validDays };
  };
  return { oil: summarize('oil'), liquid: summarize('liquid'), waterCut: summarize('waterCut') };
}

function summarizeProjectMetrics(relations: any[], injectorMetrics: WellMetrics[], producerMetrics: WellMetrics[], range: { projectId: number; start: string; end: string }) {
  const steam = injectorMetrics.map((item) => item.injection?.cumulativeSteam).filter((value): value is number => value !== null && value !== undefined);
  const latestOil = producerMetrics.map((item) => item.production?.rows.at(-1)?.oil).map(numeric).filter((value): value is number => value !== null);
  const unique = new Set(relations.flatMap((row) => [normalizeMetricWellNo(row.injection_well), normalizeMetricWellNo(row.production_well)]));
  return { ...range, generatedAt: new Date().toISOString(), relationCount: relations.length, activeRelationCount: relations.filter((row) => row.status !== 'released').length, releasedRelationCount: relations.filter((row) => row.status === 'released').length, injectorCount: injectorMetrics.length, producerCount: producerMetrics.length, uniqueWellCount: unique.size, cumulativeSteam: steam.length ? steam.reduce((sum, value) => sum + value, 0) : null, latestTotalOil: latestOil.length ? latestOil.reduce((sum, value) => sum + value, 0) : null };
}

export async function getWellMetrics(db: DatabaseLike, wellNo: string, start: string, end: string): Promise<WellMetrics> {
  validateRange(start, end);
  const normalized = normalizeMetricWellNo(wellNo);
  const [productionRows, stageRows] = await Promise.all([
    db.all(`SELECT rq AS date, oil, liquid, water_cut AS waterCut FROM production WHERE UPPER(TRIM(jh)) = ? AND rq BETWEEN ? AND ? ORDER BY rq`, [normalized, start, end]),
    db.all(`SELECT cycle_no AS cycleNo, start_date AS startDate, end_date AS endDate, steam_volume AS steamVolume, temperature, pressure, dryness, production_hours AS productionHours FROM injection_stage_rows WHERE UPPER(TRIM(well_no)) = ? AND start_date <= ? AND COALESCE(end_date, start_date) >= ? ORDER BY start_date`, [normalized, end, start]),
  ]);
  const roles = [...(stageRows.length ? ['injector'] as const : []), ...(productionRows.length ? ['producer'] as const : [])];
  return { wellNo, normalizedWellNo: normalized, roles, queriedAt: new Date().toISOString(), range: { start, end }, production: productionRows.length ? summarizeProduction(productionRows) : null, injection: stageRows.length ? summarizeInjection(stageRows) : null };
}
```

- [ ] **Step 4: Implement relation comparison and deduplicated project summary**

```ts
export async function getRelationMetrics(db: DatabaseLike, relationId: number, range: ComparisonRange) {
  const relation = await db.get('SELECT * FROM channeling_relations WHERE id=?', [relationId]);
  if (!relation) throw new Error('Relation not found');
  const [injector, producerRows] = await Promise.all([
    getWellMetrics(db, relation.injection_well, range.beforeStart, range.afterEnd),
    db.all('SELECT rq AS date, oil, liquid, water_cut AS waterCut FROM production WHERE UPPER(TRIM(jh))=? AND rq BETWEEN ? AND ? ORDER BY rq', [normalizeMetricWellNo(relation.production_well), range.beforeStart, range.afterEnd]),
  ]);
  return { relationId, injectionWell: relation.injection_well, productionWell: relation.production_well, range, injector, producerSeries: producerRows, comparison: compareProductionWindows(producerRows, range), generatedAt: new Date().toISOString() };
}

export async function getProjectSummary(db: DatabaseLike, projectId: number, start: string, end: string) {
  const relations = await db.all('SELECT * FROM channeling_relations WHERE project_id=?', [projectId]);
  if (!await db.get('SELECT id FROM channeling_projects WHERE id=?', [projectId])) throw new Error('Project not found');
  const injectors = [...new Map(relations.map((row: any) => [normalizeMetricWellNo(row.injection_well), row.injection_well])).values()];
  const producers = [...new Map(relations.map((row: any) => [normalizeMetricWellNo(row.production_well), row.production_well])).values()];
  return summarizeProjectMetrics(relations, await Promise.all(injectors.map((wellNo) => getWellMetrics(db, wellNo, start, end))), await Promise.all(producers.map((wellNo) => getWellMetrics(db, wellNo, start, end))), { projectId, start, end });
}
```

Run: `node --import tsx --test tests/channelingMetrics.test.ts`

Expected: PASS for role detection, temperature/pressure/dryness, valid-day averaging, zero denominators, deduplication, missing values, and invalid ranges.

- [ ] **Step 5: Commit metric calculation code**

```bash
git add src/lib/channelingMetrics.ts tests/channelingMetrics.test.ts
git commit -m "feat: calculate channeling well and project metrics"
```

### Task 4: Well, metric, and tracking HTTP endpoints

**Files:**
- Modify: `server.ts:64,1807,4900-5045`
- Create: `tests/channelingTrackingApi.integration.test.ts`

- [ ] **Step 1: Write an HTTP integration test for the new read/write contracts**

```ts
const created = await request('/api/channeling-wells', { method: 'POST', headers: authorized, body: JSON.stringify({ wellNo: ' 注A ', block: 'A区', owner: '周' }) });
assert.equal(created.status, 201);
const profile = (await created.json() as any).data;
assert.equal((await request('/api/channeling-wells', { method: 'POST', body: JSON.stringify({ wellNo: '注B' }) })).status, 401);
assert.equal((await request(`/api/channeling-wells/${profile.id}/metrics?start=2026-07-01&end=2026-07-31`)).status, 200);
const eventResponse = await request('/api/channeling-tracking-events', { method: 'POST', headers: authorized, body: JSON.stringify({ eventType: 'discovered', occurredOn: '2026-08-05', content: '发现异常响应', evidence: '', owner: '周', links: [{ subjectType: 'well', subjectId: profile.id }] }) });
assert.equal(eventResponse.status, 201);
assert.equal((await request(`/api/channeling-tracking-events?subjectType=well&subjectId=${profile.id}`)).status, 200);
```

- [ ] **Step 2: Run the integration test and verify 404 failures**

Run: `node --import tsx --test tests/channelingTrackingApi.integration.test.ts`

Expected: FAIL because `/api/channeling-wells` and `/api/channeling-tracking-events` return 404.

- [ ] **Step 3: Initialize new stores during database startup**

```ts
import { createWellProfile, getWellProfile, initChannelingWellTables, listWellProfiles, updateWellProfile } from './src/lib/channelingWellStore.ts';
import { correctTrackingEvent, createTrackingEvent, initChannelingTrackingTables, listTrackingEvents } from './src/lib/channelingTrackingStore.ts';
import { getProjectSummary, getRelationMetrics, getWellMetrics } from './src/lib/channelingMetrics.ts';

await initChannelingProjectTables(localDb);
await initChannelingWellTables(localDb);
await initChannelingTrackingTables(localDb);

const positiveId = (value: string) => { const id = Number(value); if (!Number.isInteger(id) || id <= 0) throw new Error('id is invalid'); return id; };
const singleQuery = (value: unknown) => value === undefined ? undefined : typeof value === 'string' ? value : (() => { throw new Error('query value is invalid'); })();
const requiredRange = (query: express.Request['query']) => { const start = singleQuery(query.start); const end = singleQuery(query.end); if (!start || !end) throw new Error('start and end are required'); return { start, end }; };
const requiredComparisonRange = (query: express.Request['query']) => { const beforeStart = singleQuery(query.beforeStart); const splitDate = singleQuery(query.splitDate); const afterEnd = singleQuery(query.afterEnd); if (!beforeStart || !splitDate || !afterEnd || !(beforeStart <= splitDate && splitDate <= afterEnd)) throw new Error('comparison range is invalid'); return { beforeStart, splitDate, afterEnd }; };
const requiredSubject = (query: express.Request['query']) => { const subjectType = singleQuery(query.subjectType); const subjectId = Number(singleQuery(query.subjectId)); if (!['project', 'relation', 'well'].includes(subjectType || '') || !Number.isInteger(subjectId) || subjectId <= 0) throw new Error('tracking subject is invalid'); return { subjectType: subjectType as TrackingSubjectType, subjectId }; };
```

- [ ] **Step 4: Register thin routes with existing administrator authentication**

```ts
app.get('/api/channeling-wells', async (req, res) => {
  try { res.json({ success: true, data: await listWellProfiles(localDb, { query: singleQuery(req.query.query), block: singleQuery(req.query.block) }) }); }
  catch (error: any) { res.status(channelingErrorStatus(error)).json({ success: false, message: error.message }); }
});
app.post('/api/channeling-wells', async (req, res) => {
  if (!requireChannelingAdmin(req, res)) return;
  try { res.status(201).json({ success: true, data: await createWellProfile(localDb, req.body) }); }
  catch (error: any) { res.status(channelingErrorStatus(error)).json({ success: false, message: error.message }); }
});
app.get('/api/channeling-wells/:id/metrics', async (req, res) => {
  try { const profile = await getWellProfile(localDb, positiveId(req.params.id)); const range = requiredRange(req.query); res.json({ success: true, data: await getWellMetrics(localDb, profile.wellNo, range.start, range.end) }); }
  catch (error: any) { res.status(channelingErrorStatus(error)).json({ success: false, message: error.message }); }
});
app.get('/api/channeling-tracking-events', async (req, res) => {
  try { res.json({ success: true, data: await listTrackingEvents(localDb, requiredSubject(req.query)) }); }
  catch (error: any) { res.status(channelingErrorStatus(error)).json({ success: false, message: error.message }); }
});
app.post('/api/channeling-tracking-events', async (req, res) => {
  if (!requireChannelingAdmin(req, res)) return;
  try { res.status(201).json({ success: true, data: await createTrackingEvent(localDb, { ...req.body, createdBy: authenticatedUser(req)!.username }) }); }
  catch (error: any) { res.status(channelingErrorStatus(error)).json({ success: false, message: error.message }); }
});
```

- [ ] **Step 5: Add project summary, relation detail/evaluation, correction, and well relation routes**

```ts
app.get('/api/channeling-projects/:id/summary', async (req, res) => { try { const range = requiredRange(req.query); res.json({ success: true, data: await getProjectSummary(localDb, positiveId(req.params.id), range.start, range.end) }); } catch (error: any) { res.status(channelingErrorStatus(error)).json({ success: false, message: error.message }); } });
app.get('/api/channeling-relations/:id/detail', async (req, res) => { try { res.json({ success: true, data: await getRelationMetrics(localDb, positiveId(req.params.id), requiredComparisonRange(req.query)) }); } catch (error: any) { res.status(channelingErrorStatus(error)).json({ success: false, message: error.message }); } });
app.post('/api/channeling-relations/:id/evaluations', async (req, res) => { if (!requireChannelingAdmin(req, res)) return; try { res.status(201).json({ success: true, data: await createRelationEvaluation(localDb, positiveId(req.params.id), req.body, authenticatedUser(req)!.username) }); } catch (error: any) { res.status(channelingErrorStatus(error)).json({ success: false, message: error.message }); } });
app.post('/api/channeling-tracking-events/:id/corrections', async (req, res) => { if (!requireChannelingAdmin(req, res)) return; try { res.status(201).json({ success: true, data: await correctTrackingEvent(localDb, positiveId(req.params.id), { ...req.body, createdBy: authenticatedUser(req)!.username }) }); } catch (error: any) { res.status(channelingErrorStatus(error)).json({ success: false, message: error.message }); } });
```

Define the evaluation helper next to the routes so the snapshot and event are created from the same validated input:

```ts
async function createRelationEvaluation(db: DatabaseLike, relationId: number, body: any, createdBy: string) {
  const range = requiredComparisonRange(body.range || {});
  const detail = await getRelationMetrics(db, relationId, range);
  const relation = await db.get('SELECT project_id, injection_well, production_well, owner FROM channeling_relations WHERE id=?', [relationId]);
  const wells = await db.all('SELECT id FROM channeling_well_profiles WHERE normalized_well_no IN (?, ?)', [normalizeWellNo(relation.injection_well), normalizeWellNo(relation.production_well)]);
  return createTrackingEvent(db, { eventType: 'evaluated', occurredOn: body.occurredOn, content: body.conclusion, evidence: body.evidence || '', owner: body.owner || relation.owner, createdBy, metricsSnapshot: detail, links: [{ subjectType: 'project', subjectId: relation.project_id }, { subjectType: 'relation', subjectId: relationId }, ...wells.map((well: any) => ({ subjectType: 'well' as const, subjectId: well.id }))] });
}
```

Run: `node --import tsx --test tests/channelingTrackingApi.integration.test.ts`

Expected: PASS for guest reads, unauthorized and ordinary-user writes, administrator writes, validation, missing objects, duplicate profiles, and metric responses.

- [ ] **Step 6: Commit server contracts**

```bash
git add server.ts tests/channelingTrackingApi.integration.test.ts
git commit -m "feat: expose channeling tracking APIs"
```

### Task 5: Automatic events and protected deletion

**Files:**
- Modify: `src/lib/channelingProjectStore.ts:64-100`
- Modify: `tests/channelingProjectStore.test.ts`
- Modify: `server.ts:4918-5040`
- Modify: `tests/channelingProjectApi.integration.test.ts`

- [ ] **Step 1: Write failing store tests for auto profiles and deletion protection**

```ts
test('creates profiles for relation wells and protects tracked history', async () => {
  const project = await createChannelingProject(db, projectInput());
  const relation = await createChannelingRelation(db, relationInput(project.id));
  assert.deepEqual((await listWellProfiles(db)).map((row) => row.normalizedWellNo).sort(), ['注A-1', '采A-2'].map((value) => value.toUpperCase()).sort());
  await createTrackingEvent(db, { eventType: 'discovered', occurredOn: '2026-08-05', content: '异常', owner: '周', createdBy: 'admin', links: [{ subjectType: 'relation', subjectId: relation.id }] });
  await assert.rejects(() => deleteChannelingRelation(db, relation.id), /tracking history/);
  await assert.rejects(() => deleteChannelingProject(db, project.id), /relations or tracking history/);
});
```

- [ ] **Step 2: Run focused tests and verify current hard deletion fails the expectation**

Run: `node --import tsx --test tests/channelingProjectStore.test.ts`

Expected: FAIL because relations do not create profiles and hard deletion is still allowed.

- [ ] **Step 3: Create/reuse well profiles when relations are inserted**

```ts
const created = relation(await db.get('SELECT r.*, p.block FROM channeling_relations r JOIN channeling_projects p ON p.id = r.project_id WHERE r.id = ?', [result.lastID]));
await ensureWellProfileUnlocked(db, { wellNo: created.injectionWell, block: created.block, owner: created.owner });
await ensureWellProfileUnlocked(db, { wellNo: created.productionWell, block: created.block, owner: created.owner });
return created;
```

- [ ] **Step 4: Protect deletion and emit automatic status events**

```ts
async function assertNoTrackingLinks(db: DatabaseLike, subjectType: TrackingSubjectType, subjectId: number) {
  if (await db.get('SELECT 1 FROM channeling_tracking_event_links WHERE subject_type=? AND subject_id=? LIMIT 1', [subjectType, subjectId])) throw new Error(`${subjectType} has tracking history`);
}

async function deleteChannelingRelationUnlocked(db: DatabaseLike, id: number) {
  if (!await db.get('SELECT id FROM channeling_relations WHERE id=?', [id])) throw new Error('Relation not found');
  await assertNoTrackingLinks(db, 'relation', id);
  await db.run('DELETE FROM channeling_relations WHERE id=?', [id]);
}

async function deleteChannelingProjectUnlocked(db: DatabaseLike, id: number) {
  if (!await db.get('SELECT id FROM channeling_projects WHERE id=?', [id])) throw new Error('Project not found');
  if (await db.get('SELECT 1 FROM channeling_relations WHERE project_id=? LIMIT 1', [id])) throw new Error('Project has relations or tracking history');
  await assertNoTrackingLinks(db, 'project', id);
  await db.run('DELETE FROM channeling_projects WHERE id=?', [id]);
}
```

After a successful project status change, relation confirmation, or relation release, call `createSystemTrackingEventUnlocked` inside the same write transaction with `eventType` equal to `status_changed`, `relation_confirmed`, or `relation_released` and links to the project, relation, and existing well profiles.

- [ ] **Step 5: Map history conflicts to HTTP 409 and verify APIs**

```ts
function channelingErrorStatus(error: any) {
  const message = String(error?.message || '');
  if (/changed; refresh|tracking history|relations or tracking history|already corrected/.test(message)) return 409;
  if (/not found/i.test(message)) return 404;
  if (/required|invalid|calendar date|must not/.test(message)) return 400;
  return 500;
}
```

Run: `node --import tsx --test tests/channelingProjectStore.test.ts tests/channelingProjectApi.integration.test.ts`

Expected: PASS; tracked relations/projects return 409, empty objects still delete, release preserves history, and automatic events appear once.

- [ ] **Step 6: Commit history protection**

```bash
git add src/lib/channelingProjectStore.ts tests/channelingProjectStore.test.ts server.ts tests/channelingProjectApi.integration.test.ts
git commit -m "feat: protect channeling tracking history"
```

### Task 6: Shared workspace, API client, and timeline component

**Files:**
- Create: `src/lib/channelingTrackingApi.ts`
- Create: `src/components/ChannelingWorkspace.tsx`
- Create: `src/components/ChannelingTimeline.tsx`
- Create: `tests/channelingWorkspace.test.ts`
- Create: `tests/channelingTimelineInteractions.test.ts`

- [ ] **Step 1: Write failing workspace navigation and timeline form tests**

```ts
test('opens relation and well details and returns to the project ledger', async () => {
  render(<ChannelingWorkspace role="admin" initialView="projects" />);
  click(textButton('查看详情/跟踪记录'));
  assert.match(host.textContent || '', /井对详情/);
  click(textButton('高3-莲H608'));
  assert.match(host.textContent || '', /单井档案/);
  click(textButton('返回项目台账'));
  assert.match(host.textContent || '', /注窜项目台账/);
});

test('administrator appends an event while guest remains read only', async () => {
  render(<ChannelingTimeline role="admin" subject={{ subjectType: 'well', subjectId: 7 }} />);
  assert.ok(host.querySelector('form[aria-label="新增跟踪记录"]'));
  render(<ChannelingTimeline role="guest" subject={{ subjectType: 'well', subjectId: 7 }} />);
  assert.equal(host.querySelector('form[aria-label="新增跟踪记录"]'), null);
});
```

- [ ] **Step 2: Run UI tests and verify missing component failures**

Run: `node --import tsx --test tests/channelingWorkspace.test.ts tests/channelingTimelineInteractions.test.ts`

Expected: FAIL because the three new modules do not exist.

- [ ] **Step 3: Implement the typed browser request helper**

```ts
export async function channelingRequest<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  const payload = response.status === 204 ? null : await response.json();
  if (!response.ok || payload?.success === false) throw new Error(payload?.message || `请求失败（${response.status}）`);
  return payload?.data as T;
}

export type ChannelingLocation = { kind: 'projects' } | { kind: 'relation'; relationId: number } | { kind: 'wells'; wellId?: number };
```

- [ ] **Step 4: Implement workspace navigation without introducing a router**

```tsx
export function ChannelingWorkspace({ role, initialView }: { role: string; initialView: 'projects' | 'wells' }) {
  const [location, setLocation] = useState<ChannelingLocation>(initialView === 'projects' ? { kind: 'projects' } : { kind: 'wells' });
  if (location.kind === 'relation') return <ChannelingRelationDetail role={role} relationId={location.relationId} onOpenWell={(wellId) => setLocation({ kind: 'wells', wellId })} onBack={() => setLocation({ kind: 'projects' })} />;
  if (location.kind === 'wells') return <ChannelingWellTracking role={role} selectedWellId={location.wellId} onOpenRelation={(relationId) => setLocation({ kind: 'relation', relationId })} onBack={() => setLocation({ kind: 'projects' })} />;
  return <ChannelingProjectManagement role={role} onOpenRelation={(relationId) => setLocation({ kind: 'relation', relationId })} onOpenWell={(wellId) => setLocation({ kind: 'wells', wellId })} />;
}
```

- [ ] **Step 5: Implement timeline loading, empty/error states, and administrator form**

```tsx
export function ChannelingTimeline({ role, subject }: { role: string; subject: TrackingLink }) {
  const [events, setEvents] = useState<TrackingEvent[]>([]); const [error, setError] = useState(''); const [saving, setSaving] = useState(false);
  const load = () => channelingRequest<TrackingEvent[]>(`/api/channeling-tracking-events?subjectType=${subject.subjectType}&subjectId=${subject.subjectId}`).then(setEvents).catch((value) => setError(value.message));
  useEffect(() => { void load(); }, [subject.subjectType, subject.subjectId]);
  const submit = async (event: FormEvent<HTMLFormElement>) => { event.preventDefault(); setSaving(true); const form = new FormData(event.currentTarget); try { await channelingRequest('/api/channeling-tracking-events', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ eventType: form.get('eventType'), occurredOn: form.get('occurredOn'), content: form.get('content'), evidence: form.get('evidence'), owner: form.get('owner'), links: [subject] }) }); event.currentTarget.reset(); await load(); } catch (value: any) { setError(value.message); } finally { setSaving(false); } };
  return <section><h4>跟踪时间线</h4>{error && <p role="alert">{error}</p>}{role === 'admin' && <form aria-label="新增跟踪记录" onSubmit={submit}><label>类型<select name="eventType" required><option value="discovered">发现问题</option><option value="measure_planned">制定措施</option><option value="executed">执行记录</option><option value="evaluated">效果评价</option><option value="reviewed">复查</option><option value="closed">关闭</option><option value="recurred">复发</option></select></label><label>发生日期<input name="occurredOn" type="date" required /></label><label>内容<textarea name="content" required /></label><label>证据说明<input name="evidence" /></label><label>负责人<input name="owner" required /></label><button disabled={saving}>{saving ? '保存中…' : '新增跟踪记录'}</button></form>}<ol>{events.map((item) => <li key={item.id}>{item.occurredOn} · {eventTypeLabels[item.eventType]} · {item.content}{item.voidedAt && ' · 已更正'}</li>)}</ol></section>;
}
```

Run: `node --import tsx --test tests/channelingWorkspace.test.ts tests/channelingTimelineInteractions.test.ts`

Expected: PASS for navigation, guest/admin rendering, save failure preserving inputs, retry, empty state, and stable event order.

- [ ] **Step 6: Commit shared UI foundations**

```bash
git add src/lib/channelingTrackingApi.ts src/components/ChannelingWorkspace.tsx src/components/ChannelingTimeline.tsx tests/channelingWorkspace.test.ts tests/channelingTimelineInteractions.test.ts
git commit -m "feat: add channeling tracking workspace"
```

### Task 7: Independent single-well tracking UI and sidebar entry

**Files:**
- Create: `src/components/ChannelingWellTracking.tsx`
- Create: `tests/channelingWellTrackingInteractions.test.ts`
- Modify: `src/lib/sidebarNavigation.ts:1-109`
- Modify: `tests/sidebarNavigation.test.ts`
- Modify: `src/App.tsx:42,6270`

- [ ] **Step 1: Write failing UI and navigation tests**

```ts
test('adds an independent well tracking entry under injection management', () => {
  const injection = sidebarNavigationGroups.find((group) => group.key === 'injection');
  assert.ok(injection?.items.some((item) => item.tab === 'channelingWellTracking' && item.label === '单井跟踪台账'));
});

test('shows injector producer and dual-role metric sections from API roles', async () => {
  mockWellMetrics({ roles: ['injector', 'producer'], injection: injectionFixture, production: productionFixture });
  render(<ChannelingWellTracking role="admin" selectedWellId={1} onOpenRelation={() => undefined} onBack={() => undefined} />);
  assert.match(host.textContent || '', /注汽指标/);
  assert.match(host.textContent || '', /生产指标/);
  assert.match(host.textContent || '', /温度/);
  assert.match(host.textContent || '', /含水/);
});
```

- [ ] **Step 2: Run tests and verify missing tab/component failure**

Run: `node --import tsx --test tests/sidebarNavigation.test.ts tests/channelingWellTrackingInteractions.test.ts`

Expected: FAIL because the sidebar tab and component are absent.

- [ ] **Step 3: Add the sidebar tab and App rendering**

```ts
// SidebarTab union
| 'channelingWellTracking'

// injection group item, immediately after channelingProjectManagement
{ tab: 'channelingWellTracking', label: '单井跟踪台账', icon: 'Database' }
```

```tsx
{activeTab === 'channelingProjectManagement' && <ChannelingWorkspace role={user?.role || 'guest'} initialView="projects" />}
{activeTab === 'channelingWellTracking' && <ChannelingWorkspace role={user?.role || 'guest'} initialView="wells" />}
```

- [ ] **Step 4: Implement well list, independent creation, role metrics, relations, and timeline tabs**

```tsx
export function ChannelingWellTracking({ role, selectedWellId, onOpenRelation, onBack }: Props) {
  const [profiles, setProfiles] = useState<ChannelingWellProfile[]>([]); const [selectedId, setSelectedId] = useState<number | null>(selectedWellId ?? null); const [tab, setTab] = useState<'overview' | 'metrics' | 'relations' | 'timeline'>('overview');
  // load profiles; when selected, load profile, metrics, and relation summaries independently
  return <div className="page-stack"><button onClick={onBack}>返回项目台账</button><section className="grid gap-4 lg:grid-cols-[320px_1fr]"><aside className="app-card p-4"><h3>单井跟踪台账</h3>{role === 'admin' && <WellProfileForm onCreated={(profile) => { setProfiles((rows) => [profile, ...rows.filter((row) => row.id !== profile.id)]); setSelectedId(profile.id); }} />}{profiles.map((profile) => <button key={profile.id} onClick={() => setSelectedId(profile.id)}>{profile.wellNo} · {profile.block || '区块未提供'}</button>)}</aside><main className="app-card p-5">{selectedId ? <WellDetail wellId={selectedId} tab={tab} onTabChange={setTab} onOpenRelation={onOpenRelation} role={role} /> : <p>请选择单井或新建档案。</p>}</main></section></div>;
}
```

`WellDetail` must render metric modules from API roles: injector fields include cycle, steam, temperature, pressure, dryness, and production hours; producer fields include latest oil/liquid/water cut plus 7/30-day averages. Each module owns its loading/error/empty state and displays `queriedAt`.

Run: `node --import tsx --test tests/sidebarNavigation.test.ts tests/channelingWellTrackingInteractions.test.ts`

Expected: PASS for independent creation/reuse, search, role modules, missing-data text, last query time, relation callbacks, and guest read-only behavior.

- [ ] **Step 5: Run typecheck and commit**

Run: `npm run lint`

Expected: PASS with no TypeScript errors.

```bash
git add src/components/ChannelingWellTracking.tsx tests/channelingWellTrackingInteractions.test.ts src/lib/sidebarNavigation.ts tests/sidebarNavigation.test.ts src/App.tsx
git commit -m "feat: add independent channeling well tracking UI"
```

### Task 8: Relation detail, aligned charts, and evaluation snapshots

**Files:**
- Create: `src/components/ChannelingRelationDetail.tsx`
- Create: `tests/channelingRelationDetailInteractions.test.ts`
- Modify: `src/components/ChannelingProjectManagement.tsx:10,184-208`
- Modify: `tests/channelingProjectManagementInteractions.test.ts`

- [ ] **Step 1: Write failing relation-detail tests**

```ts
test('shows aligned injection and production data and opens both well profiles', async () => {
  mockRelationDetail(detailFixture);
  render(<ChannelingRelationDetail role="admin" relationId={9} onOpenWell={recordWell} onBack={() => undefined} />);
  assert.match(host.textContent || '', /注汽周期与注汽量/);
  assert.match(host.textContent || '', /日产油.*日产液.*含水/s);
  click(textButton('高3-莲H608'));
  click(textButton('高3-6-0173C'));
  assert.deepEqual(openedWellIds, [injectorProfileId, producerProfileId]);
});

test('submits an adjustable evaluation range and refreshes timeline', async () => {
  fillEvaluationDates('2026-06-01', '2026-06-30', '2026-07-30');
  click(textButton('保存效果评价'));
  assert.deepEqual(lastEvaluationBody.range, { beforeStart: '2026-06-01', splitDate: '2026-06-30', afterEnd: '2026-07-30' });
  assert.match(host.textContent || '', /评价已保存/);
});
```

- [ ] **Step 2: Run relation UI tests and verify failure**

Run: `node --import tsx --test tests/channelingRelationDetailInteractions.test.ts tests/channelingProjectManagementInteractions.test.ts`

Expected: FAIL because the relation detail component and ledger callback are absent.

- [ ] **Step 3: Add explicit callbacks to every relation row**

```tsx
type Props = { role: string; onOpenRelation: (relationId: number) => void; onOpenWell: (wellId: number) => void };

<button className="action-button" onClick={() => onOpenRelation(row.id)}>查看详情/跟踪记录</button>
```

Keep confirmation, release, and deletion actions unchanged except that delete is disabled with explanatory text when the relation API reports tracking history.

- [ ] **Step 4: Implement detail tabs, ECharts option, and evaluation form**

```tsx
const chartOption = {
  tooltip: { trigger: 'axis' },
  legend: { data: ['注汽量', '日产油', '日产液', '含水'] },
  xAxis: { type: 'time' },
  yAxis: [{ type: 'value', name: '注汽量/产量' }, { type: 'value', name: '含水(%)', min: 0, max: 100 }],
  series: [
    { name: '注汽量', type: 'bar', data: detail.injector.injection?.stages.map((row) => [row.startDate, row.steamVolume]) || [] },
    { name: '日产油', type: 'line', data: detail.producerSeries.map((row) => [row.date, row.oil]) },
    { name: '日产液', type: 'line', data: detail.producerSeries.map((row) => [row.date, row.liquid]) },
    { name: '含水', type: 'line', yAxisIndex: 1, data: detail.producerSeries.map((row) => [row.date, row.waterCut]) },
  ],
};
```

```tsx
<form aria-label="效果评价" onSubmit={saveEvaluation}>
  <input name="beforeStart" type="date" required />
  <input name="splitDate" type="date" required />
  <input name="afterEnd" type="date" required />
  <textarea name="conclusion" required />
  <input name="evidence" />
  <input name="owner" required />
  <button disabled={saving}>保存效果评价</button>
</form>
```

Render `ChannelingTimeline` with `{ subjectType: 'relation', subjectId: relationId }`. Validation must stop the request when dates are not ordered and retain inputs after an API error.

Run: `node --import tsx --test tests/channelingRelationDetailInteractions.test.ts tests/channelingProjectManagementInteractions.test.ts`

Expected: PASS for detail opening, well navigation, aligned series, adjustable dates, saved snapshot summary, missing data, retry, and guest read-only mode.

- [ ] **Step 5: Commit relation tracking UI**

```bash
git add src/components/ChannelingRelationDetail.tsx tests/channelingRelationDetailInteractions.test.ts src/components/ChannelingProjectManagement.tsx tests/channelingProjectManagementInteractions.test.ts
git commit -m "feat: add channeling relation tracking detail"
```

### Task 9: Project summary tabs and project timeline

**Files:**
- Modify: `src/components/ChannelingProjectManagement.tsx:191-208`
- Create: `tests/channelingProjectSummaryInteractions.test.ts`
- Modify: `tests/channelingLedgerAccess.test.ts`

- [ ] **Step 1: Write failing project tab and deduplicated-summary rendering tests**

```ts
test('renders project overview relations and timeline tabs', async () => {
  mockProjectSummary({ relationCount: 3, injectorCount: 2, producerCount: 2, uniqueWellCount: 4, cumulativeSteam: 480, latestTotalOil: 31, evaluatedCount: 1 });
  render(<ChannelingProjectManagement role="admin" onOpenRelation={() => undefined} onOpenWell={() => undefined} />);
  assert.match(host.textContent || '', /项目概览/);
  assert.match(host.textContent || '', /涉及单井数.*4/s);
  click(textButton('跟踪时间线'));
  assert.ok(host.querySelector('[aria-label="新增跟踪记录"]'));
});
```

- [ ] **Step 2: Run test and verify current single-panel layout fails**

Run: `node --import tsx --test tests/channelingProjectSummaryInteractions.test.ts tests/channelingLedgerAccess.test.ts`

Expected: FAIL because the project tabs and summary request do not exist.

- [ ] **Step 3: Add project tabs and independent summary state**

```tsx
const [detailTab, setDetailTab] = useState<'overview' | 'relations' | 'timeline'>('overview');
const [summary, setSummary] = useState<ProjectSummary | null>(null);
const [summaryError, setSummaryError] = useState('');
const [summaryRange, setSummaryRange] = useState(defaultLast30DayRange());

useEffect(() => {
  if (!selected || detailTab !== 'overview') return;
  setSummaryError('');
  void channelingRequest<ProjectSummary>(`/api/channeling-projects/${selected.id}/summary?start=${summaryRange.start}&end=${summaryRange.end}`).then(setSummary).catch((error) => setSummaryError(error.message));
}, [selected?.id, detailTab, summaryRange.start, summaryRange.end]);
```

Overview metric cards must show relation counts, deduplicated well counts, cumulative steam, latest total oil, and evaluation count. A summary failure must not hide the existing governance form. Relations tab contains the existing filter/form/list section. Timeline tab renders `ChannelingTimeline` with the selected project subject.

- [ ] **Step 4: Preserve existing project actions and test failure isolation**

Extend the JSDOM fetch fixtures so existing import, confirmation, release, and filter tests still receive their expected calls. Add a rejected summary response and assert the project form plus timeline tab remain usable.

Run: `node --import tsx --test tests/channelingProjectSummaryInteractions.test.ts tests/channelingProjectManagementInteractions.test.ts tests/channelingLedgerAccess.test.ts`

Expected: PASS with no regressions in Excel import or relation filtering.

- [ ] **Step 5: Commit project-level tracking UI**

```bash
git add src/components/ChannelingProjectManagement.tsx tests/channelingProjectSummaryInteractions.test.ts tests/channelingProjectManagementInteractions.test.ts tests/channelingLedgerAccess.test.ts
git commit -m "feat: add project channeling summary and timeline"
```

### Task 10: End-to-end permission, encoding, and regression verification

**Files:**
- Modify: `tests/channelingGuestAdminAccess.test.ts`
- Modify: `tests/channelingUiTextEncoding.test.ts`
- Modify: `tests/channelingTrackingApi.integration.test.ts`

- [ ] **Step 1: Add final permission and Chinese-text assertions**

```ts
assert.match(wellTrackingSource, /单井跟踪台账/);
assert.match(relationDetailSource, /查看详情\/跟踪记录/);
assert.match(timelineSource, /发现问题|制定措施|执行记录|效果评价|复查|复发/);
assert.doesNotMatch(guestRenderedText, /新增跟踪记录|保存效果评价|新建单井档案/);
assert.match(adminRenderedText, /新增跟踪记录/);
```

- [ ] **Step 2: Exercise the complete HTTP history-protection scenario**

In `channelingTrackingApi.integration.test.ts`, create a project, relation, two profiles, a relation-linked evaluation, and a project-linked event. Assert:

```ts
assert.equal((await request(`/api/channeling-relations/${relation.id}`, { method: 'DELETE', headers: authorized })).status, 409);
assert.equal((await request(`/api/channeling-relations/${relation.id}`, { method: 'PATCH', headers: authorized, body: JSON.stringify({ status: 'released' }) })).status, 200);
assert.equal((await request(`/api/channeling-tracking-events?subjectType=relation&subjectId=${relation.id}`)).status, 200);
assert.equal((await request(`/api/channeling-projects/${project.id}`, { method: 'DELETE', headers: authorized })).status, 409);
assert.equal((await request(`/api/channeling-wells/${injectorProfile.id}`)).status, 200);
```

- [ ] **Step 3: Run all focused channeling tests**

Run: `node --import tsx --test tests/channelingWellStore.test.ts tests/channelingTrackingStore.test.ts tests/channelingMetrics.test.ts tests/channelingTrackingApi.integration.test.ts tests/channelingProjectStore.test.ts tests/channelingProjectApi.integration.test.ts tests/channelingWorkspace.test.ts tests/channelingTimelineInteractions.test.ts tests/channelingWellTrackingInteractions.test.ts tests/channelingRelationDetailInteractions.test.ts tests/channelingProjectSummaryInteractions.test.ts tests/channelingProjectManagementInteractions.test.ts tests/channelingGuestAdminAccess.test.ts tests/channelingUiTextEncoding.test.ts tests/channelingLedgerAccess.test.ts tests/sidebarNavigation.test.ts`

Expected: all focused tests PASS with zero failures.

- [ ] **Step 4: Run the repository gates**

Run: `npm run lint`

Expected: TypeScript exits 0.

Run: `npm test`

Expected: full test suite exits 0.

Run: `npm run build`

Expected: Vite production build exits 0.

- [ ] **Step 5: Review the final diff for scope and generated artifacts**

Run: `git status --short`

Expected: only files named in this plan are staged for this feature; existing unrelated user changes and ignored `.superpowers/` files remain untouched.

Run: `git diff --check`

Expected: no whitespace errors.

- [ ] **Step 6: Commit final verification updates**

```bash
git add tests/channelingGuestAdminAccess.test.ts tests/channelingUiTextEncoding.test.ts tests/channelingTrackingApi.integration.test.ts
git commit -m "test: verify channeling tracking workflow"
```
