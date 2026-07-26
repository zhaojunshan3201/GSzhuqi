export type MapRelation = {
  id: number;
  injectionWell: string;
  productionWell: string;
  impactLevel: 'high' | 'medium' | 'low';
  status: 'confirmed' | 'suspected' | 'released';
  confidence: number;
};

export function getMapRelationStyle(relation: Pick<MapRelation, 'impactLevel' | 'status'>) {
  if (relation.status === 'released') return { stroke: '#94a3b8', strokeDasharray: '4 4', strokeWidth: 2 };
  if (relation.status === 'suspected') return { stroke: '#7c3aed', strokeDasharray: '7 5', strokeWidth: 2 };
  return relation.impactLevel === 'high'
    ? { stroke: '#dc2626', strokeDasharray: undefined, strokeWidth: 3 }
    : { stroke: '#f97316', strokeDasharray: undefined, strokeWidth: 2 };
}

export function filterMapRelations<T extends MapRelation>(relations: readonly T[], filters: { statuses?: MapRelation['status'][]; impactLevel?: MapRelation['impactLevel'] | ''; keyword?: string }) {
  const keyword = filters.keyword?.trim().toLowerCase();
  return relations.filter((relation) =>
    (!filters.statuses?.length || filters.statuses.includes(relation.status)) &&
    (!filters.impactLevel || relation.impactLevel === filters.impactLevel) &&
    (!keyword || `${relation.injectionWell} ${relation.productionWell}`.toLowerCase().includes(keyword)),
  );
}
