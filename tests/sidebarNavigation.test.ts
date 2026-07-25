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
    tabs: ['measureWellSelection', 'injectionPlan', 'injectionConstruction', 'injectionSoakTransfer', 'measures', 'measureAnalysis'],
    labels: ['选井决策', '方案与计划', '施工监控', '焖井转抽', '生产响应', '效果评价'],
  },
  {
    key: 'analysis',
    label: '生产分析',
    tabs: ['well', 'block', 'comparison', 'productionForecast', 'externalTransferTracking'],
    labels: ['单井', '区块', '对比', '产量预测', '外输'],
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
