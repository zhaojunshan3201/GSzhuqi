import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { buildOperationReportUrl, reportKindLabels } from '../src/components/InjectionOperationReports.tsx';
import { getSidebarGroupKey, sidebarNavigationGroups } from '../src/lib/sidebarNavigation.ts';

const reportLabels = { daily: '\u6ce8\u6c7d\u8fd0\u884c\u65e5\u62a5', weekly: '\u6ce8\u6c7d\u8fd0\u884c\u5468\u62a5', retrospective: '\u6ce8\u6c7d\u9879\u76ee\u590d\u76d8' };

test('builds report and Excel URLs with report filters', () => {
  assert.equal(buildOperationReportUrl('weekly', '2026-07-25', '\u4e00\u533a'), '/api/injection-operation-reports?type=weekly&date=2026-07-25&block=%E4%B8%80%E5%8C%BA');
  assert.equal(buildOperationReportUrl('retrospective', '2026-07-25', '', true), '/api/injection-operation-reports.xlsx?type=retrospective&date=2026-07-25');
});

test('exposes daily, weekly, and retrospective report choices from the injection navigation', () => {
  assert.deepEqual(reportKindLabels, reportLabels);
  const injection = sidebarNavigationGroups.find((group) => group.key === 'injection');
  assert.ok(injection?.items.some((item) => item.tab === 'injectionOperationReports' && item.label === '\u8fd0\u884c\u62a5\u544a'));
  assert.equal(getSidebarGroupKey('injectionOperationReports'), 'injection');
});

test('renders the report filters, source explanation, empty state, and download action', () => {
  const component = readFileSync(new URL('../src/components/InjectionOperationReports.tsx', import.meta.url), 'utf8');
  const app = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8');

  for (const label of ['\u65e5\u671f', '\u533a\u5757', '\u9879\u76ee', '\u6570\u636e\u6765\u6e90\u8bf4\u660e', '\u6570\u636e\u5f85\u8865\u5168', '\u4e0b\u8f7d Excel']) assert.match(component, new RegExp(label));
  assert.match(app, /InjectionOperationReports/);
  assert.match(app, /activeTab === 'injectionOperationReports'/);
});
