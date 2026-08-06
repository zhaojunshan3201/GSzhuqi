import assert from 'node:assert/strict';
import test from 'node:test';

import { getSidebarGroupKey, sidebarNavigationGroups } from '../src/lib/sidebarNavigation.ts';
import type { SidebarGroupKey, SidebarTab } from '../src/lib/sidebarNavigation.ts';

const expectedNavigation: Array<{
  key: SidebarGroupKey;
  label: string;
  tabs: SidebarTab[];
  labels: string[];
}> = [
  {
    key: 'overview',
    label: '基本情况',
    tabs: ['dashboard', 'injectionProductionCockpit', 'oilWellMap', 'wellTemperature'],
    labels: ['系统概览', '注汽驾驶舱', '注采状态地图', '井温监控'],
  },
  {
    key: 'injection',
    label: '注汽管理',
    tabs: ['measureWellSelection', 'injectionPlan', 'injectionConstruction', 'injectionSoakTransfer', 'measures', 'measureAnalysis', 'injectionOptimization', 'injectionOperationReports', 'channelingProjectManagement', 'channelingWellTracking'],
    labels: ['选井决策', '方案与计划', '施工监控', '焖井转抽', '生产响应', '效果评价', '注汽优化预测', '运行报告', '注窜项目台账', '单井跟踪台账'],
  },
  {
    key: 'analysis',
    label: '生产分析',
    tabs: ['well', 'block', 'comparison', 'productionForecast', 'externalTransferTracking'],
    labels: ['单井分析', '区块分析', '对比分析', '产量预测', '外输跟踪'],
  },
  {
    key: 'monitoring',
    label: '专项监测',
    tabs: ['waterLab', 'pumpAnalysis', 'pumpDeepAnalysis', 'occupancyAnalysis'],
    labels: ['含水化验', '检泵跟踪', '检泵分析', '占产分析'],
  },
  {
    key: 'system',
    label: '系统管理',
    tabs: ['runtimeLogs'],
    labels: ['运行日志'],
  },
];

test('organizes sidebar groups in the injection workflow order', () => {
  assert.deepEqual(
    sidebarNavigationGroups.map((group) => ({
      key: group.key,
      label: group.label,
      tabs: group.items.map((item) => item.tab),
      labels: group.items.map((item) => item.label),
    })),
    expectedNavigation,
  );
});

test('uses GitBranch for the channeling project management icon', () => {
  const injectionGroup = sidebarNavigationGroups.find((group) => group.key === 'injection');
  const channelingProjectManagement = injectionGroup?.items.find(
    (item) => item.tab === 'channelingProjectManagement',
  );

  assert.equal(channelingProjectManagement?.icon, 'GitBranch');
});

test('places the independent well ledger immediately after the channeling project ledger', () => {
  const items = sidebarNavigationGroups.find((group) => group.key === 'injection')!.items;
  const projectIndex = items.findIndex((item) => item.tab === 'channelingProjectManagement');
  assert.equal(items[projectIndex + 1]?.tab, 'channelingWellTracking');
  assert.equal(items[projectIndex + 1]?.label, '单井跟踪台账');
  assert.equal(items[projectIndex + 1]?.icon, 'Database');
});

test('assigns every visible injection workflow tab to its sidebar group', () => {
  for (const group of expectedNavigation) {
    for (const tab of group.tabs) assert.equal(getSidebarGroupKey(tab), group.key);
  }
});

test('does not assign hidden legacy tabs or unknown tabs to a sidebar group', () => {
  assert.equal(getSidebarGroupKey('injectionProjectManagement'), undefined);
  assert.equal(getSidebarGroupKey('analysis'), undefined);
  assert.equal(getSidebarGroupKey('missing-tab'), undefined);
});
