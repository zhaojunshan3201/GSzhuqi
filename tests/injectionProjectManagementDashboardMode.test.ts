import assert from 'node:assert/strict';
import test from 'node:test';

import { getInjectionDashboardRenderMode } from '../src/components/InjectionProjectManagement.tsx';

test('selects exclusive dashboard sections for each injection workflow view', () => {
  assert.deepEqual(getInjectionDashboardRenderMode('plan'), {
    planExecution: true,
    planComparison: true,
    planTimeline: true,
    construction: false,
    soakTransfer: false,
  });
  assert.deepEqual(getInjectionDashboardRenderMode('construction'), {
    planExecution: false,
    planComparison: false,
    planTimeline: false,
    construction: true,
    soakTransfer: false,
  });
  assert.deepEqual(getInjectionDashboardRenderMode('soakTransfer'), {
    planExecution: false,
    planComparison: false,
    planTimeline: false,
    construction: false,
    soakTransfer: true,
  });
});
