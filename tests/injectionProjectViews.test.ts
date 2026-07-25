import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { filterProjectsForView, getInjectionProjectView } from '../src/lib/injectionProjectViews.ts';

test('maps injection workflow tabs to project views', () => {
  assert.equal(getInjectionProjectView('injectionPlan'), 'plan');
  assert.equal(getInjectionProjectView('injectionConstruction'), 'construction');
  assert.equal(getInjectionProjectView('injectionSoakTransfer'), 'soakTransfer');
  assert.equal(getInjectionProjectView('injectionProjectManagement'), 'plan');
});

test('filters projects by their workflow view and prioritizes overdue transfer work', () => {
  const projects = [
    { id: 1, lifecycleStatus: 'pending', plannedTransferDate: '2026-08-01' },
    { id: 2, lifecycleStatus: 'injecting', plannedTransferDate: '2026-08-01' },
    { id: 4, lifecycleStatus: 'pendingTransfer', plannedTransferDate: '2026-08-01' },
    { id: 3, lifecycleStatus: 'soaking', plannedTransferDate: '2026-07-20' },
    { id: 5, lifecycleStatus: 'producing', plannedTransferDate: '2026-07-01' },
  ];

  assert.deepEqual(filterProjectsForView(projects, 'plan', '2026-07-26').map((project) => project.id), [1, 2, 4, 3, 5]);
  assert.deepEqual(filterProjectsForView(projects, 'construction', '2026-07-26').map((project) => project.id), [1, 2]);
  assert.deepEqual(filterProjectsForView(projects, 'soakTransfer', '2026-07-26').map((project) => project.id), [3, 4]);
});

test('wires a single workflow project view from the active tab', () => {
  const source = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8');
  assert.match(source, /getInjectionProjectView\(activeTab\)/);
  assert.match(source, /<InjectionProjectManagement view=\{injectionProjectView\}/);
});
