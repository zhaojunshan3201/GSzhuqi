import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { buildSoakTransferDashboard } from '../src/lib/injectionProjectViews.ts';

test('provides strict soak-day values with each soak-transfer todo item', () => {
  const dashboard = buildSoakTransferDashboard([
    { id: 1, lifecycleStatus: 'soaking', plannedTransferDate: '2026-07-20', soakStartDate: '2026-07-16' },
    { id: 2, lifecycleStatus: 'pendingTransfer', plannedTransferDate: '2026-08-01', soakStartDate: null },
  ], '2026-07-26');

  assert.deepEqual(dashboard.todo.map((item) => [item.id, item.soakDays]), [[1, 10], [2, null]]);
});

test('plan-only dashboard keeps timeline and comparison presentation details', () => {
  const source = readFileSync(new URL('../src/components/InjectionProjectManagement.tsx', import.meta.url), 'utf8');

  assert.match(source, /new Date\(earliest\)\.toISOString\(\)\.slice\(0, 10\)/);
  assert.match(source, /title=\{`\$\{project\.plannedStartDate\}/);
  assert.match(source, /filteredProjects\.filter\(\(project\) => project\.sourceImportId/);
  assert.match(source, /row\.comparisonStatus === 'delayed' \? 'bg-red-50 text-red-900'/);
  assert.match(source, /row\.comparisonStatus === 'suspected_other_cycle' \? 'bg-slate-50 text-slate-600'/);
  assert.match(source, /row\.boilerMatches === false/);
});
