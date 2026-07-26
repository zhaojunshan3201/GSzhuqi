import assert from 'node:assert/strict';
import test from 'node:test';
import { filterMapRelations, getMapRelationStyle } from '../src/lib/channelingMapRelations.ts';

const rows = [
  { id: 1, injectionWell: 'I1', productionWell: 'P1', impactLevel: 'high', status: 'confirmed', confidence: 0.9 },
  { id: 2, injectionWell: 'I2', productionWell: 'P2', impactLevel: 'low', status: 'confirmed', confidence: 0.8 },
  { id: 3, injectionWell: 'I3', productionWell: 'P3', impactLevel: 'medium', status: 'suspected', confidence: 0.6 },
  { id: 4, injectionWell: 'I4', productionWell: 'P4', impactLevel: 'low', status: 'released', confidence: 0.3 },
] as const;

test('returns required relation line styles by confirmation status and impact', () => {
  assert.deepEqual(getMapRelationStyle(rows[0]), { stroke: '#dc2626', strokeDasharray: undefined, strokeWidth: 3 });
  assert.deepEqual(getMapRelationStyle(rows[1]), { stroke: '#f97316', strokeDasharray: undefined, strokeWidth: 2 });
  assert.deepEqual(getMapRelationStyle(rows[2]), { stroke: '#7c3aed', strokeDasharray: '7 5', strokeWidth: 2 });
  assert.deepEqual(getMapRelationStyle(rows[3]), { stroke: '#94a3b8', strokeDasharray: '4 4', strokeWidth: 2 });
});

test('filters relations by status, impact and keyword', () => {
  assert.deepEqual(filterMapRelations(rows, { statuses: ['confirmed'], impactLevel: 'high', keyword: 'p1' }).map((row) => row.id), [1]);
});
