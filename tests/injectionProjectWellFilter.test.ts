import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { filterInjectionProjects } from '../src/components/InjectionProjectManagement.tsx';

test('applies the initial well focus to the current soak-transfer projects', () => {
  const projects = [
    { id: 1, wellNo: '高1-1', unit: '甲', boiler: '1#', planStatus: 'issued', lifecycleStatus: 'soaking', sourceImportId: 10 },
    { id: 2, wellNo: '高1-2', unit: '甲', boiler: '1#', planStatus: 'issued', lifecycleStatus: 'pendingTransfer', sourceImportId: 10 },
  ];

  const filtered = filterInjectionProjects(
    projects,
    [{ id: 10, planMonth: '2026-07' }],
    [],
    { planMonth: '', unit: '', boiler: '', planStatus: '', lifecycleStatus: '', comparisonStatus: '' },
    undefined,
    '高1-2',
  );

  assert.deepEqual(filtered.map((project) => project.id), [2]);
  assert.deepEqual(
    filterInjectionProjects(
      projects,
      [{ id: 10, planMonth: '2026-07' }],
      [],
      { planMonth: '', unit: '', boiler: '', planStatus: '', lifecycleStatus: '', comparisonStatus: '' },
      undefined,
      '1-2',
    ).map((project) => project.id),
    [2],
  );
});

test('limits the priority well focus to the soak-transfer view', () => {
  const source = readFileSync('src/components/InjectionProjectManagement.tsx', 'utf8');
  assert.match(source, /filterInjectionProjects\([\s\S]*?isSoakTransfer \? wellNoFilter : ''\)/);
});
