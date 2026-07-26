import assert from 'node:assert/strict';
import test from 'node:test';

import { filterInjectionProjects } from '../src/components/InjectionProjectManagement.tsx';

test('applies plan month and comparison status filters to dashboard project data', () => {
  const projects = [
    { id: 1, unit: '¼×', boiler: '1#', planStatus: 'issued', lifecycleStatus: 'injecting', sourceImportId: 10 },
    { id: 2, unit: '¼×', boiler: '1#', planStatus: 'issued', lifecycleStatus: 'injecting', sourceImportId: 11 },
    { id: 3, unit: '¼×', boiler: '1#', planStatus: 'issued', lifecycleStatus: 'injecting', sourceImportId: 10 },
  ];
  const imports = [{ id: 10, planMonth: '2026-07' }, { id: 11, planMonth: '2026-08' }];
  const comparisonRows = [
    { projectId: 1, comparisonStatus: 'delayed' },
    { projectId: 2, comparisonStatus: 'delayed' },
    { projectId: 3, comparisonStatus: 'on_schedule' },
  ];

  const filtered = filterInjectionProjects(projects, imports, comparisonRows, {
    planMonth: '2026-07', unit: '', boiler: '', planStatus: '', lifecycleStatus: '', comparisonStatus: 'delayed',
  });

  assert.deepEqual(filtered.map((project) => project.id), [1]);
});
