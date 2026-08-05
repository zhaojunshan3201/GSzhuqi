import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import sqlite3 from 'sqlite3';
import { open } from 'sqlite';

import {
  correctTrackingEvent,
  createTrackingEvent,
  createTrackingEventUnlocked,
  getTrackingEvent,
  initChannelingTrackingTables,
  listTrackingEventLinks,
  listTrackingEvents,
  type TrackingEventInput,
} from '../src/lib/channelingTrackingStore.ts';

async function withStore(run: (db: any, subjects: { projectId: number; relationId: number; wellId: number }) => Promise<void>) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'channeling-tracking-store-'));
  const db = await open({ filename: path.join(directory, 'test.db'), driver: sqlite3.Database });
  try {
    await db.exec(`PRAGMA foreign_keys = ON;
      CREATE TABLE channeling_projects (id INTEGER PRIMARY KEY);
      CREATE TABLE channeling_relations (id INTEGER PRIMARY KEY);
      CREATE TABLE channeling_well_profiles (id INTEGER PRIMARY KEY);`);
    await db.run('INSERT INTO channeling_projects (id) VALUES (1)');
    await db.run('INSERT INTO channeling_relations (id) VALUES (2)');
    await db.run('INSERT INTO channeling_well_profiles (id) VALUES (3)');
    await initChannelingTrackingTables(db);
    await run(db, { projectId: 1, relationId: 2, wellId: 3 });
  } finally {
    await db.close();
    await rm(directory, { recursive: true, force: true });
  }
}

const validInput = (subjectId = 1): TrackingEventInput => ({
  eventType: 'executed',
  occurredOn: '2026-08-05',
  content: ' Complete treatment ',
  evidence: ' Field notes ',
  owner: ' Operator ',
  createdBy: ' admin ',
  links: [{ subjectType: 'project', subjectId }],
});

test('links one event to a project, relation, and well and retrieves it through each subject', async () => {
  await withStore(async (db, subjects) => {
    const links = [
      { subjectType: 'project' as const, subjectId: subjects.projectId },
      { subjectType: 'relation' as const, subjectId: subjects.relationId },
      { subjectType: 'well' as const, subjectId: subjects.wellId },
    ];
    const event = await createTrackingEvent(db, { ...validInput(), links });

    assert.equal(event.content, 'Complete treatment');
    assert.equal(event.evidence, 'Field notes');
    assert.equal(event.owner, 'Operator');
    assert.equal(event.createdBy, 'admin');
    assert.deepEqual(event.links, links);
    for (const link of links) assert.equal((await listTrackingEvents(db, link))[0].id, event.id);
    assert.deepEqual(await listTrackingEventLinks(db, event.id), links);
  });
});

test('deduplicates repeated identical links', async () => {
  await withStore(async (db) => {
    const link = { subjectType: 'project' as const, subjectId: 1 };
    const event = await createTrackingEvent(db, { ...validInput(), links: [link, link, link] });
    assert.deepEqual(event.links, [link]);
    assert.equal((await db.get('SELECT COUNT(*) AS count FROM channeling_tracking_event_links')).count, 1);
  });
});

test('round-trips a metrics snapshot and reports malformed stored JSON', async () => {
  await withStore(async (db) => {
    const metricsSnapshot = { oilRate: 12.5, labels: ['before', 'after'], nested: { stable: true } };
    const event = await createTrackingEvent(db, { ...validInput(), metricsSnapshot });
    assert.deepEqual((await getTrackingEvent(db, event.id)).metricsSnapshot, metricsSnapshot);

    await db.run('UPDATE channeling_tracking_events SET metrics_snapshot_json = ? WHERE id = ?', ['{bad json', event.id]);
    await assert.rejects(() => getTrackingEvent(db, event.id), /Invalid metrics snapshot JSON/);
  });
});

test('lists events by date, creation time, and id in descending order', async () => {
  await withStore(async (db) => {
    const oldestDate = await createTrackingEvent(db, { ...validInput(), occurredOn: '2026-08-04', content: 'old date' });
    const olderCreated = await createTrackingEvent(db, { ...validInput(), content: 'older created' });
    const newerId = await createTrackingEvent(db, { ...validInput(), content: 'newer id' });
    const newestCreated = await createTrackingEvent(db, { ...validInput(), content: 'newest created' });
    await db.run('UPDATE channeling_tracking_events SET created_at = ? WHERE id IN (?, ?)', ['2026-08-05T01:00:00.000Z', olderCreated.id, newerId.id]);
    await db.run('UPDATE channeling_tracking_events SET created_at = ? WHERE id = ?', ['2026-08-05T02:00:00.000Z', newestCreated.id]);

    assert.deepEqual(
      (await listTrackingEvents(db, { subjectType: 'project', subjectId: 1 })).map((event) => event.id),
      [newestCreated.id, newerId.id, olderCreated.id, oldestDate.id],
    );
  });
});

test('rejects invalid event fields and links', async () => {
  await withStore(async (db) => {
    const invalidInputs: Array<[Partial<TrackingEventInput>, RegExp]> = [
      [{ eventType: 'unknown' as any }, /eventType is invalid/],
      [{ occurredOn: '2026-02-29' }, /occurredOn must be a calendar date/],
      [{ occurredOn: '2026-2-01' }, /occurredOn must be a calendar date/],
      [{ occurredOn: '0000-01-01' }, /occurredOn must be a calendar date/],
      [{ content: '   ' }, /content is required/],
      [{ owner: '   ' }, /owner is required/],
      [{ createdBy: '   ' }, /createdBy is required/],
      [{ links: [] }, /links are required/],
      [{ links: [{ subjectType: 'other' as any, subjectId: 1 }] }, /link is invalid/],
      [{ links: [{ subjectType: 'project', subjectId: 0 }] }, /link is invalid/],
      [{ links: [{ subjectType: 'project', subjectId: 1.5 }] }, /link is invalid/],
    ];
    for (const [changes, message] of invalidInputs) {
      await assert.rejects(() => createTrackingEvent(db, { ...validInput(), ...changes }), message);
    }
    await assert.rejects(
      () => listTrackingEvents(db, { subjectType: 'project', subjectId: -1 }),
      /link is invalid/,
    );
  });
});

test('reserves corrected events and supersedes links for the correction workflow', async () => {
  await withStore(async (db) => {
    const correctedPayload = { ...validInput(), eventType: 'corrected', supersedesEventId: 404 } as any;
    await assert.rejects(
      () => createTrackingEvent(db, correctedPayload),
      /eventType corrected is reserved for corrections/,
    );
    await assert.rejects(
      () => createTrackingEventUnlocked(db, correctedPayload),
      /eventType corrected is reserved for corrections/,
    );
    await assert.rejects(
      () => createTrackingEvent(db, { ...validInput(), supersedesEventId: 1 } as any),
      /supersedesEventId is reserved for corrections/,
    );
    await assert.rejects(
      () => createTrackingEventUnlocked(db, { ...validInput(), supersedesEventId: undefined } as any),
      /supersedesEventId is reserved for corrections/,
    );
    assert.equal((await db.get('SELECT COUNT(*) AS count FROM channeling_tracking_events')).count, 0);
  });
});

test('rejects inherited correction metadata without persisting a normal event', async () => {
  await withStore(async (db) => {
    const input = Object.assign(Object.create({ supersedesEventId: 999 }), validInput()) as TrackingEventInput;

    await assert.rejects(
      () => createTrackingEvent(db, input),
      /supersedesEventId is reserved for corrections/,
    );
    assert.equal((await db.get('SELECT COUNT(*) AS count FROM channeling_tracking_events')).count, 0);
  });
});

test('normalizes null evidence and rejects non-string evidence before opening a transaction', async () => {
  await withStore(async (db) => {
    const withoutEvidence = await createTrackingEvent(db, { ...validInput(), evidence: null });
    assert.equal(withoutEvidence.evidence, '');

    const exec = db.exec.bind(db);
    let transactionStarts = 0;
    db.exec = async (sql: string) => {
      if (sql === 'BEGIN IMMEDIATE') transactionStarts += 1;
      return exec(sql);
    };
    for (const evidence of [12, { note: 'invalid' }, ['invalid']]) {
      await assert.rejects(
        () => createTrackingEvent(db, { ...validInput(), evidence } as any),
        /evidence is invalid/,
      );
    }
    assert.equal(transactionStarts, 0);
  });
});

test('rejects missing linked objects and missing events', async () => {
  await withStore(async (db) => {
    for (const subjectType of ['project', 'relation', 'well'] as const) {
      await assert.rejects(
        () => createTrackingEvent(db, { ...validInput(), links: [{ subjectType, subjectId: 404 }] }),
        new RegExp(`${subjectType} not found`),
      );
    }
    await assert.rejects(() => getTrackingEvent(db, 404), /Tracking event not found/);
  });
});

test('rolls back the event and all links when a link insert fails', async () => {
  await withStore(async (db) => {
    const run = db.run.bind(db);
    let linkInserts = 0;
    db.run = async (sql: string, params?: unknown[]) => {
      if (sql.startsWith('INSERT INTO channeling_tracking_event_links') && ++linkInserts === 2) throw new Error('injected link failure');
      return run(sql, params);
    };
    await assert.rejects(
      () => createTrackingEvent(db, {
        ...validInput(),
        links: [{ subjectType: 'project', subjectId: 1 }, { subjectType: 'relation', subjectId: 2 }],
      }),
      /injected link failure/,
    );
    assert.equal((await db.get('SELECT COUNT(*) AS count FROM channeling_tracking_events')).count, 0);
    assert.equal((await db.get('SELECT COUNT(*) AS count FROM channeling_tracking_event_links')).count, 0);
  });
});

test('correction appends a new event, copies links, and voids without overwriting the original', async () => {
  await withStore(async (db) => {
    const original = await createTrackingEvent(db, {
      ...validInput(),
      metricsSnapshot: { original: true },
      links: [{ subjectType: 'project', subjectId: 1 }, { subjectType: 'well', subjectId: 3 }],
    });
    const corrected = await correctTrackingEvent(db, original.id, {
      occurredOn: '2026-08-06', content: ' Corrected treatment ', evidence: ' New evidence ', owner: ' New owner ', createdBy: ' editor ', reason: ' Wrong detail ',
    });

    assert.equal(corrected.eventType, 'corrected');
    assert.equal(corrected.supersedesEventId, original.id);
    assert.deepEqual(corrected.links, original.links);
    assert.equal(corrected.metricsSnapshot, null);
    const preserved = await getTrackingEvent(db, original.id);
    assert.equal(preserved.content, 'Complete treatment');
    assert.deepEqual(preserved.metricsSnapshot, { original: true });
    assert.ok(preserved.voidedAt);
    assert.equal(preserved.voidReason, 'Wrong detail');
    assert.equal((await db.get('SELECT COUNT(*) AS count FROM channeling_tracking_events')).count, 2);
  });
});

test('rejects corrections without a reason, for a missing event, or for an already corrected event', async () => {
  await withStore(async (db) => {
    const original = await createTrackingEvent(db, validInput());
    const correction = { occurredOn: '2026-08-06', content: 'corrected', owner: 'owner', createdBy: 'admin', reason: 'fix' };
    await assert.rejects(() => correctTrackingEvent(db, original.id, { ...correction, reason: '   ' }), /reason is required/);
    await assert.rejects(() => correctTrackingEvent(db, 404, correction), /Tracking event not found/);
    await correctTrackingEvent(db, original.id, correction);
    await assert.rejects(() => correctTrackingEvent(db, original.id, correction), /Tracking event already corrected/);
  });
});

test('rolls back a correction event if voiding the original fails', async () => {
  await withStore(async (db) => {
    const original = await createTrackingEvent(db, validInput());
    const run = db.run.bind(db);
    db.run = async (sql: string, params?: unknown[]) => {
      if (sql.startsWith('UPDATE channeling_tracking_events SET voided_at')) throw new Error('injected void failure');
      return run(sql, params);
    };
    await assert.rejects(
      () => correctTrackingEvent(db, original.id, { occurredOn: '2026-08-06', content: 'corrected', owner: 'owner', createdBy: 'admin', reason: 'fix' }),
      /injected void failure/,
    );
    assert.equal((await db.get('SELECT COUNT(*) AS count FROM channeling_tracking_events')).count, 1);
    assert.equal((await getTrackingEvent(db, original.id)).voidedAt, null);
  });
});
