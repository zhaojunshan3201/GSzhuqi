import { getProjectSummary, validateMetricRange } from './channelingMetrics.ts';
import type { DatabaseLike } from './channelingProjectStore.ts';
import { createTrackingEventUnlocked, type TrackingEvent } from './channelingTrackingStore.ts';
import { withChannelingWriteLock } from './channelingWriteQueue.ts';

export type ProjectEvaluationInput = {
  projectId: number;
  start: string;
  end: string;
  occurredOn: string;
  content: string;
  evidence?: string;
  owner: string;
  createdBy: string;
};

function requiredText(value: unknown, field: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${field} is required`);
  return value.trim();
}

function optionalText(value: unknown, field: string): string {
  if (value === undefined) return '';
  if (typeof value !== 'string') throw new Error(`${field} is invalid`);
  return value.trim();
}

function calendarDate(value: unknown, field: string): string {
  const date = requiredText(value, field);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(`${date}T00:00:00Z`)) || new Date(`${date}T00:00:00Z`).toISOString().slice(0, 10) !== date) throw new Error(`${field} is invalid`);
  return date;
}

export async function createProjectEvaluation(db: DatabaseLike, input: ProjectEvaluationInput): Promise<TrackingEvent> {
  if (!Number.isSafeInteger(input.projectId) || input.projectId <= 0) throw new Error('projectId is invalid');
  const start = calendarDate(input.start, 'start');
  const end = calendarDate(input.end, 'end');
  validateMetricRange(start, end);
  const occurredOn = calendarDate(input.occurredOn, 'occurredOn');
  const content = requiredText(input.content, 'content');
  const evidence = optionalText(input.evidence, 'evidence');
  const owner = requiredText(input.owner, 'owner');
  const createdBy = requiredText(input.createdBy, 'createdBy');

  return withChannelingWriteLock(db, async () => {
    await db.exec('BEGIN IMMEDIATE');
    try {
      const metricsSnapshot = await getProjectSummary(db, input.projectId, start, end);
      const event = await createTrackingEventUnlocked(db, {
        eventType: 'evaluated', occurredOn, content, evidence, owner, createdBy, metricsSnapshot,
        links: [{ subjectType: 'project', subjectId: input.projectId }],
      });
      await db.exec('COMMIT');
      return event;
    } catch (error) {
      await db.exec('ROLLBACK');
      throw error;
    }
  });
}
