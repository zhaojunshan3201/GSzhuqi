import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { formatShanghaiBusinessDate } from '../src/lib/businessDate.ts';
import { buildConstructionDashboard, buildSoakTransferDashboard, filterProjectsForView, getInjectionProjectView, isOverdue } from '../src/lib/injectionProjectViews.ts';

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
    { id: 6, lifecycleStatus: 'soaking', plannedTransferDate: '2026-02-31' },
  ];

  assert.deepEqual(filterProjectsForView(projects, 'plan', '2026-07-26').map((project) => project.id), [1, 2, 4, 3, 5, 6]);
  assert.deepEqual(filterProjectsForView(projects, 'construction', '2026-07-26').map((project) => project.id), [1, 2]);
  assert.deepEqual(filterProjectsForView(projects, 'soakTransfer', '2026-07-26').map((project) => project.id), [3, 4, 6]);
  assert.equal(isOverdue({ lifecycleStatus: 'soaking', plannedTransferDate: '2026-02-31' }, '2026-07-26'), false);
  assert.equal(isOverdue({ lifecycleStatus: 'soaking', plannedTransferDate: '2026-07-20' }, '2026-02-31'), false);
});

test('builds construction dashboard data from pending and injecting projects only', () => {
  const projects = [
    { id: 1, lifecycleStatus: 'pending' },
    { id: 2, lifecycleStatus: 'injecting' },
    { id: 3, lifecycleStatus: 'soaking' },
  ];
  const comparisons = [
    { projectId: 1, comparisonStatus: 'not_started', actualStartDate: null, plannedBoiler: 'B-1', plannedSteam: 10, actualSteam: null },
    { projectId: 2, comparisonStatus: 'delayed', actualStartDate: '2026-07-01', plannedBoiler: 'B-1', actualBoiler: 'A-1', plannedSteam: 20, actualSteam: 18, completionRate: 0.9, wellNo: 'J-2' },
    { projectId: 3, comparisonStatus: 'incomplete', actualStartDate: '2026-07-02', plannedBoiler: 'B-2', plannedSteam: 30, actualSteam: 28 },
  ];

  assert.deepEqual(buildConstructionDashboard(projects, comparisons, '2026-07-26'), {
    projects: [projects[0], projects[1]],
    rows: [comparisons[0], comparisons[1]],
    kpis: { active: 1, cumulativeSteam: 18, dailySteam: null, delayed: 1, missingData: 1 },
    boilerSteamTotals: [{ boiler: 'B-1', plannedSteam: 30, actualSteam: 18 }],
    statusDistribution: [
      { status: 'pending', count: 1 },
      { status: 'injecting', count: 1 },
    ],
  });
  const dashboard = buildConstructionDashboard(projects, comparisons, '2026-07-26');
  assert.equal(dashboard.rows[1].wellNo, 'J-2');
  assert.equal(dashboard.rows[1].actualBoiler, 'A-1');
  assert.equal(dashboard.rows[1].completionRate, 0.9);
});

test('builds soak-transfer dashboard with valid soaking dates only and overdue tasks first', () => {
  const projects = [
    { id: 1, lifecycleStatus: 'soaking', plannedTransferDate: '2026-07-20', soakStartDate: '2026-07-16' },
    { id: 2, lifecycleStatus: 'pendingTransfer', plannedTransferDate: '2026-08-01', soakStartDate: '2026-07-21' },
    { id: 3, lifecycleStatus: 'soaking', plannedTransferDate: '2026-07-21', soakStartDate: '2026-02-31' },
    { id: 4, lifecycleStatus: 'pending', plannedTransferDate: '2026-07-01', soakStartDate: '2026-07-01' },
    { id: 5, lifecycleStatus: 'soaking', plannedTransferDate: '2026-07-19', soakStartDate: null },
  ];

  assert.deepEqual(buildSoakTransferDashboard(projects, '2026-07-26'), {
    projects: [projects[0], projects[2], projects[4], projects[1]],
    kpis: { soaking: 3, pendingTransfer: 1, overdue: 3, averageSoakDays: 7.5, missingSoakDate: 2 },
    durationDistribution: [
      { label: '0-7天', count: 1 },
      { label: '8-14天', count: 1 },
      { label: '15天以上', count: 0 },
    ],
    statusDistribution: [
      { status: 'soaking', count: 3 },
      { status: 'pendingTransfer', count: 1 },
    ],
    todo: [
      { ...projects[0], soakDays: 10 }, { ...projects[2], soakDays: null }, { ...projects[4], soakDays: null }, { ...projects[1], soakDays: 5 },
    ],
  });
});

test('wires a single workflow project view from the active tab', () => {
  const source = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8');
  assert.match(source, /getInjectionProjectView\(activeTab\)/);
  assert.match(source, /<InjectionProjectManagement view=\{injectionProjectView\}/);
});

test('filters and summarizes plan-actual comparisons for the construction view only', async () => {
  const { filterComparisonForView, summarizeComparisonForView } = await import('../src/lib/injectionProjectViews.ts');
  const projects = [
    { id: 1, lifecycleStatus: 'pending' },
    { id: 2, lifecycleStatus: 'injecting' },
    { id: 3, lifecycleStatus: 'soaking' },
    { id: 4, lifecycleStatus: 'pendingTransfer' },
    { id: 5, lifecycleStatus: 'producing' },
  ];
  const comparisons = [
    { projectId: 1, comparisonStatus: 'on_schedule', actualStartDate: '2026-07-01', startVarianceDays: 0, endVarianceDays: 0, plannedBoiler: 'B-1', plannedSteam: 10, actualSteam: 9 },
    { projectId: 2, comparisonStatus: 'delayed', actualStartDate: '2026-07-02', startVarianceDays: 3, endVarianceDays: 8, plannedBoiler: 'B-1', plannedSteam: 20, actualSteam: 18 },
    { projectId: 3, comparisonStatus: 'early', actualStartDate: '2026-07-03', startVarianceDays: -3, endVarianceDays: -2, plannedBoiler: 'B-2', plannedSteam: 30, actualSteam: 28 },
    { projectId: 4, comparisonStatus: 'not_started', actualStartDate: null, startVarianceDays: null, endVarianceDays: null, plannedBoiler: 'B-3', plannedSteam: 40, actualSteam: null },
    { projectId: 5, comparisonStatus: 'suspected_other_cycle', actualStartDate: '2026-07-04', startVarianceDays: 80, endVarianceDays: 80, plannedBoiler: 'B-4', plannedSteam: 50, actualSteam: 45 },
  ];

  const constructionRows = filterComparisonForView(comparisons, filterProjectsForView(projects, 'construction', '2026-07-26'));
  assert.deepEqual(constructionRows.map((row) => row.projectId), [1, 2]);

  const result = summarizeComparisonForView(constructionRows);
  assert.deepEqual(result.summary, { planned: 2, executed: 2, onSchedule: 1, early: 0, delayed: 1, notStarted: 0, suspectedOtherCycle: 0 });
  assert.deepEqual(result.charts.startVarianceBuckets, [
    { label: '\u63d0\u524d', count: 0 }, { label: '\u6309\u8ba1\u5212', count: 1 }, { label: '\u6ede\u540e', count: 1 }, { label: '\u4e25\u91cd\u6ede\u540e', count: 0 },
  ]);
  assert.deepEqual(result.charts.boilerSteamTotals, [{ boiler: 'B-1', plannedSteam: 30, actualSteam: 27 }]);
});

// The component normalizes the instant to a Shanghai business date before dashboard calculation.
test('keeps extended todo fields and uses the Shanghai day for overdue dashboard calculations', () => {
  const businessToday = formatShanghaiBusinessDate(new Date('2026-07-25T16:30:00.000Z'));
  const projects = [
    { id: 1, lifecycleStatus: 'soaking', plannedTransferDate: '2026-07-25', soakStartDate: '2026-07-25', wellNo: 'J-1', owner: 'owner-a' },
  ];

  const dashboard = buildSoakTransferDashboard(projects, businessToday);
  const todoProject = dashboard.todo[0];
  assert.equal(todoProject.wellNo, 'J-1');
  assert.equal(todoProject.owner, 'owner-a');
  assert.equal(dashboard.kpis.overdue, 1);
  assert.equal(dashboard.kpis.averageSoakDays, 1);
  assert.equal(isOverdue(projects[0], businessToday), true);
});
