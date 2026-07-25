import assert from 'node:assert/strict';
import test from 'node:test';

import { buildInjectionStatusMapQuery, getStatusMapNavigation } from '../src/lib/injectionStatusMapNavigation.ts';

test('opens the injection plan for a well with a project', () => {
  assert.deepEqual(getStatusMapNavigation('project', { wellNo: 'A-1', projectId: 42 }), {
    tab: 'injectionPlan', filters: { projectId: 42 },
  });
});

test('does not navigate to a missing injection project', () => {
  assert.equal(getStatusMapNavigation('project', { wellNo: 'A-1', projectId: null }), null);
});

test('opens production response with the selected well keyword', () => {
  assert.deepEqual(getStatusMapNavigation('production', { wellNo: 'A-1', projectId: null }), {
    tab: 'measures', filters: { keyword: 'A-1' },
  });
});

test('opens evaluation with the selected well keyword', () => {
  assert.deepEqual(getStatusMapNavigation('evaluation', { wellNo: 'A-1', projectId: null }), {
    tab: 'measureAnalysis', filters: { keyword: 'A-1' },
  });
});

test('serializes only active status-map filters for the map request', () => {
  assert.equal(buildInjectionStatusMapQuery({ block: 'A区', lifecycleStatus: 'soaking', overdue: true, keyword: 'A-1' }),
    'block=A%E5%8C%BA&lifecycleStatus=soaking&overdue=true&keyword=A-1');
});
