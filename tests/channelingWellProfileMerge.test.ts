import assert from 'node:assert/strict';
import test from 'node:test';
import * as wellTracking from '../src/components/ChannelingWellTracking.tsx';

test('sparse well PATCH data preserves enriched association metadata', () => {
  const merge = (wellTracking as any).mergeChannelingWellProfile;
  assert.equal(typeof merge, 'function');
  const current = { id: 1, wellNo: 'A', normalizedWellNo: 'A', block: '旧', owner: '旧', createdAt: 'c', updatedAt: 'u1', roles: ['injector'], relationCount: 2, projectCount: 1 };
  const updated = { id: 1, wellNo: 'A', normalizedWellNo: 'A', block: '新', owner: '新', createdAt: 'c', updatedAt: 'u2' };
  assert.deepEqual(merge(current, updated), { ...current, ...updated });
});
