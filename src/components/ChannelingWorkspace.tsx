import { useEffect, useState } from 'react';
import type { ChannelingRole } from '../lib/channelingTrackingApi.ts';
import { ChannelingProjectManagement } from './ChannelingProjectManagement.tsx';
import { ChannelingRelationDetail } from './ChannelingRelationDetail.tsx';
import { ChannelingWellTracking } from './ChannelingWellTracking.tsx';

export type ChannelingLocation = { kind: 'projects' } | { kind: 'relation'; relationId: number } | { kind: 'wells'; wellId?: number };
export type ChannelingWorkspaceProps = { role: string; initialView: 'projects' | 'wells' };
const startLocation = (view: ChannelingWorkspaceProps['initialView']): ChannelingLocation => view === 'projects' ? { kind: 'projects' } : { kind: 'wells' };

export function ChannelingWorkspace({ role, initialView }: ChannelingWorkspaceProps) {
  const channelingRole: ChannelingRole = role === 'admin' ? 'admin' : 'guest';
  const [location, setLocation] = useState<ChannelingLocation>(() => startLocation(initialView));
  const [history, setHistory] = useState<ChannelingLocation[]>([]);
  useEffect(() => { setLocation(startLocation(initialView)); setHistory([]); }, [initialView]);
  const navigate = (next: ChannelingLocation) => { setHistory((items) => [...items, location]); setLocation(next); };
  const back = () => { const previous = history[history.length - 1] || startLocation(initialView); setHistory((items) => items.slice(0, -1)); setLocation(previous); };
  if (location.kind === 'relation') return <ChannelingRelationDetail role={channelingRole} relationId={location.relationId} onOpenWell={(wellId) => navigate({ kind: 'wells', wellId })} onBack={back} />;
  if (location.kind === 'wells') return <ChannelingWellTracking role={channelingRole} selectedWellId={location.wellId} onOpenRelation={(relationId) => navigate({ kind: 'relation', relationId })} onBack={history.length ? back : undefined} />;
  return <ChannelingProjectManagement role={channelingRole} onOpenRelation={(relationId) => navigate({ kind: 'relation', relationId })} />;
}
