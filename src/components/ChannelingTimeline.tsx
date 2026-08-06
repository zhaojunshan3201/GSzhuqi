import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import {
  channelingRequest,
  type ChannelingRole,
  type ManualTrackingEventType,
  type TrackingEvent,
  type TrackingEventType,
  type TrackingSubject,
} from '../lib/channelingTrackingApi.ts';

export type ChannelingTimelineProps = { role: ChannelingRole; subject: TrackingSubject };

export const trackingEventLabels: Record<TrackingEventType, string> = {
  discovered: '发现窜扰',
  measure_planned: '计划措施',
  executed: '措施执行',
  evaluated: '效果评价',
  reviewed: '复查',
  closed: '关闭',
  recurred: '再次发生',
  status_changed: '状态变更',
  relation_confirmed: '关系确认',
  relation_released: '关系解除',
  corrected: '记录更正',
};

const manualEventTypes: ManualTrackingEventType[] = ['discovered', 'measure_planned', 'executed', 'reviewed', 'closed', 'recurred'];
type EventDraft = { eventType: ManualTrackingEventType; occurredOn: string; content: string; evidence: string; owner: string };
type CorrectionDraft = { reason: string; occurredOn: string; content: string; evidence: string; owner: string };
const emptyEventDraft = (): EventDraft => ({ eventType: 'discovered', occurredOn: '', content: '', evidence: '', owner: '' });
const emptyCorrectionDraft = (): CorrectionDraft => ({ reason: '', occurredOn: '', content: '', evidence: '', owner: '' });

export function ChannelingTimeline({ role, subject }: ChannelingTimelineProps) {
  const subjectKey = `${subject.subjectType}:${subject.subjectId}`;
  const subjectIdentity = useRef({ key: subjectKey, generation: 0 });
  if (subjectIdentity.current.key !== subjectKey) {
    subjectIdentity.current = { key: subjectKey, generation: subjectIdentity.current.generation + 1 };
  }
  const [events, setEvents] = useState<TrackingEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [draft, setDraft] = useState<EventDraft>(emptyEventDraft);
  const [formError, setFormError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [correctingId, setCorrectingId] = useState<number | null>(null);
  const [correction, setCorrection] = useState<CorrectionDraft>(emptyCorrectionDraft);
  const [correctionError, setCorrectionError] = useState('');
  const [correctionSubmitting, setCorrectionSubmitting] = useState(false);
  const submittingRef = useRef(false);
  const correctionSubmittingRef = useRef(false);
  const addMutationToken = useRef(0);
  const correctionMutationToken = useRef(0);
  const requestGeneration = useRef(0);
  const activeController = useRef<AbortController | null>(null);

  const loadEvents = useCallback(async () => {
    const generation = ++requestGeneration.current;
    activeController.current?.abort();
    const controller = new AbortController();
    activeController.current = controller;
    setLoading(true);
    setLoadError('');
    try {
      const query = new URLSearchParams({ subjectType: subject.subjectType, subjectId: String(subject.subjectId) });
      const data = await channelingRequest<TrackingEvent[]>(`/api/channeling-tracking-events?${query}`, { signal: controller.signal });
      if (generation === requestGeneration.current) setEvents(data);
    } catch (error) {
      if (generation === requestGeneration.current && !controller.signal.aborted) {
        setEvents([]);
        setLoadError(error instanceof Error ? error.message : '跟踪记录加载失败');
      }
    } finally {
      if (generation === requestGeneration.current) setLoading(false);
    }
  }, [subject.subjectId, subject.subjectType]);

  useEffect(() => {
    addMutationToken.current++;
    correctionMutationToken.current++;
    submittingRef.current = false;
    correctionSubmittingRef.current = false;
    setSubmitting(false);
    setCorrectionSubmitting(false);
    setDraft(emptyEventDraft());
    setFormError('');
    setEvents([]);
    setCorrectingId(null);
    setCorrection(emptyCorrectionDraft());
    setCorrectionError('');
    void loadEvents();
    return () => {
      requestGeneration.current++;
      activeController.current?.abort();
    };
  }, [loadEvents]);

  const submitEvent = async (formEvent: FormEvent) => {
    formEvent.preventDefault();
    if (submittingRef.current) return;
    const subjectGeneration = subjectIdentity.current.generation;
    const mutationToken = ++addMutationToken.current;
    submittingRef.current = true;
    setSubmitting(true);
    setFormError('');
    try {
      await channelingRequest<TrackingEvent>('/api/channeling-tracking-events', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          eventType: draft.eventType,
          occurredOn: draft.occurredOn,
          content: draft.content.trim(),
          evidence: draft.evidence.trim(),
          owner: draft.owner.trim(),
          links: [subject],
        }),
      });
      if (subjectIdentity.current.generation !== subjectGeneration || addMutationToken.current !== mutationToken) return;
      setDraft(emptyEventDraft());
      await loadEvents();
    } catch (error) {
      if (subjectIdentity.current.generation === subjectGeneration && addMutationToken.current === mutationToken) {
        setFormError(error instanceof Error ? error.message : '新增跟踪记录失败');
      }
    } finally {
      if (subjectIdentity.current.generation === subjectGeneration && addMutationToken.current === mutationToken) {
        submittingRef.current = false;
        setSubmitting(false);
      }
    }
  };

  const startCorrection = (item: TrackingEvent) => {
    setCorrectingId(item.id);
    setCorrection({ reason: '', occurredOn: item.occurredOn, content: item.content, evidence: item.evidence, owner: item.owner });
    setCorrectionError('');
  };

  const submitCorrection = async (formEvent: FormEvent, eventId: number) => {
    formEvent.preventDefault();
    if (correctionSubmittingRef.current) return;
    if (![correction.reason, correction.occurredOn, correction.content, correction.evidence, correction.owner].every((value) => value.trim())) {
      setCorrectionError('请完整填写更正原因、日期、内容、证据和负责人');
      return;
    }
    const subjectGeneration = subjectIdentity.current.generation;
    const mutationToken = ++correctionMutationToken.current;
    correctionSubmittingRef.current = true;
    setCorrectionSubmitting(true);
    setCorrectionError('');
    try {
      await channelingRequest<TrackingEvent>(`/api/channeling-tracking-events/${eventId}/corrections`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          reason: correction.reason.trim(),
          occurredOn: correction.occurredOn,
          content: correction.content.trim(),
          evidence: correction.evidence.trim(),
          owner: correction.owner.trim(),
        }),
      });
      if (subjectIdentity.current.generation !== subjectGeneration || correctionMutationToken.current !== mutationToken) return;
      setCorrectingId(null);
      setCorrection(emptyCorrectionDraft());
      await loadEvents();
    } catch (error) {
      if (subjectIdentity.current.generation === subjectGeneration && correctionMutationToken.current === mutationToken) {
        setCorrectionError(error instanceof Error ? error.message : '更正跟踪记录失败');
      }
    } finally {
      if (subjectIdentity.current.generation === subjectGeneration && correctionMutationToken.current === mutationToken) {
        correctionSubmittingRef.current = false;
        setCorrectionSubmitting(false);
      }
    }
  };

  return <section className="space-y-4" aria-label="跟踪记录时间线">
    {role === 'admin' && <form data-event-form onSubmit={submitEvent} className="grid gap-3 rounded-lg border border-slate-200 bg-slate-50 p-4 md:grid-cols-2">
      <h3 className="font-semibold text-slate-800 md:col-span-2">新增跟踪记录</h3>
      <label className="text-sm text-slate-700">记录类型
        <select name="eventType" value={draft.eventType} onChange={(e) => setDraft((current) => ({ ...current, eventType: e.target.value as ManualTrackingEventType }))} className="mt-1 block w-full rounded border p-2">
          {manualEventTypes.map((type) => <option key={type} value={type}>{trackingEventLabels[type]}</option>)}
        </select>
      </label>
      <label className="text-sm text-slate-700">发生日期
        <input name="occurredOn" type="date" required value={draft.occurredOn} onInput={(e) => { const value = e.currentTarget.value; setDraft((current) => ({ ...current, occurredOn: value })); }} className="mt-1 block w-full rounded border p-2" />
      </label>
      <label className="text-sm text-slate-700 md:col-span-2">记录内容
        <textarea name="content" required value={draft.content} onInput={(e) => { const value = e.currentTarget.value; setDraft((current) => ({ ...current, content: value })); }} className="mt-1 block w-full rounded border p-2" />
      </label>
      <label className="text-sm text-slate-700">证据
        <input name="evidence" value={draft.evidence} onInput={(e) => { const value = e.currentTarget.value; setDraft((current) => ({ ...current, evidence: value })); }} className="mt-1 block w-full rounded border p-2" />
      </label>
      <label className="text-sm text-slate-700">负责人
        <input name="owner" required value={draft.owner} onInput={(e) => { const value = e.currentTarget.value; setDraft((current) => ({ ...current, owner: value })); }} className="mt-1 block w-full rounded border p-2" />
      </label>
      {formError && <p role="alert" className="text-sm text-red-700 md:col-span-2">{formError}</p>}
      <button type="submit" disabled={submitting} className="rounded bg-emerald-600 px-4 py-2 text-white disabled:opacity-50 md:col-span-2">{submitting ? '保存中…' : '新增记录'}</button>
    </form>}

    {loading && <p role="status" className="text-sm text-slate-500">正在加载跟踪记录…</p>}
    {!loading && loadError && <div role="alert" className="rounded border border-red-200 bg-red-50 p-3 text-sm text-red-700">{loadError} <button type="button" onClick={() => void loadEvents()} className="ml-3 underline">重试</button></div>}
    {!loading && !loadError && events.length === 0 && <p className="rounded border border-dashed p-6 text-center text-sm text-slate-500">暂无跟踪记录</p>}
    {!loading && !loadError && events.length > 0 && <ol className="space-y-3">
      {events.map((item) => <li key={item.id} className="rounded-lg border border-slate-200 bg-white p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div><strong>{trackingEventLabels[item.eventType]}</strong><span className="ml-3 text-sm text-slate-500">{item.occurredOn}</span></div>
          {role === 'admin' && !item.voidedAt && <button type="button" aria-label={`更正记录 ${item.id}`} onClick={() => startCorrection(item)} className="text-sm text-emerald-700 underline">更正</button>}
        </div>
        <p className="mt-2 whitespace-pre-wrap text-slate-800">{item.content}</p>
        <dl className="mt-2 grid gap-x-4 text-sm text-slate-600 sm:grid-cols-3">
          <div><dt className="inline">证据：</dt><dd className="inline">{item.evidence || '未提供'}</dd></div>
          <div><dt className="inline">负责人：</dt><dd className="inline">{item.owner}</dd></div>
          <div><dt className="inline">创建人：</dt><dd className="inline">{item.createdBy}</dd></div>
        </dl>
        {item.supersedesEventId !== null && <p className="mt-2 text-sm text-amber-700">更正自记录 #{item.supersedesEventId}</p>}
        {item.voidedAt && <p className="mt-2 text-sm text-red-700">已作废：{item.voidReason || '已更正'}</p>}
        {correctingId === item.id && <form data-correction-for={item.id} onSubmit={(e) => void submitCorrection(e, item.id)} className="mt-4 grid gap-2 rounded bg-amber-50 p-3 md:grid-cols-2">
          <label className="text-sm">更正原因<input name="reason" required value={correction.reason} onInput={(e) => { const value = e.currentTarget.value; setCorrection((current) => ({ ...current, reason: value })); }} className="mt-1 block w-full rounded border p-2" /></label>
          <label className="text-sm">发生日期<input name="occurredOn" type="date" required value={correction.occurredOn} onInput={(e) => { const value = e.currentTarget.value; setCorrection((current) => ({ ...current, occurredOn: value })); }} className="mt-1 block w-full rounded border p-2" /></label>
          <label className="text-sm md:col-span-2">更正内容<textarea name="content" required value={correction.content} onInput={(e) => { const value = e.currentTarget.value; setCorrection((current) => ({ ...current, content: value })); }} className="mt-1 block w-full rounded border p-2" /></label>
          <label className="text-sm">证据<input name="evidence" required value={correction.evidence} onInput={(e) => { const value = e.currentTarget.value; setCorrection((current) => ({ ...current, evidence: value })); }} className="mt-1 block w-full rounded border p-2" /></label>
          <label className="text-sm">负责人<input name="owner" required value={correction.owner} onInput={(e) => { const value = e.currentTarget.value; setCorrection((current) => ({ ...current, owner: value })); }} className="mt-1 block w-full rounded border p-2" /></label>
          {correctionError && <p role="alert" className="text-sm text-red-700 md:col-span-2">{correctionError}</p>}
          <div className="flex gap-2 md:col-span-2">
            <button type="submit" disabled={correctionSubmitting} className="rounded bg-amber-600 px-3 py-2 text-white disabled:opacity-50">{correctionSubmitting ? '更正中…' : '提交更正'}</button>
            <button type="button" disabled={correctionSubmitting} onClick={() => setCorrectingId(null)} className="rounded border px-3 py-2">取消</button>
          </div>
        </form>}
      </li>)}
    </ol>}
  </section>;
}
