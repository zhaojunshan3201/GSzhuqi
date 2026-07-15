import assert from 'node:assert/strict';
import test from 'node:test';

import { getSidebarGroupKey, sidebarNavigationGroups } from '../src/lib/sidebarNavigation.ts';
import type { SidebarGroupKey, SidebarTab } from '../src/lib/sidebarNavigation.ts';

test('defines the five requested groups and all fifteen entries in order', () => {
  const configuredTabs: SidebarTab[] = sidebarNavigationGroups.flatMap((group) => group.items.map((item) => item.tab));

  assert.deepEqual(sidebarNavigationGroups.map(({ key, label, items }) => ({
    key,
    label,
    items: items.map(({ tab, label: itemLabel }) => ({ tab, label: itemLabel })),
  })), [
    { key: 'overview', label: '基本情况', items: [{ tab: 'dashboard', label: '系统概览' }, { tab: 'oilWellMap', label: '油井位图' }, { tab: 'wellTemperature', label: '井温监控' }] },
    { key: 'analysis', label: '分析系统', items: [{ tab: 'well', label: '单井分析' }, { tab: 'block', label: '区块分析' }, { tab: 'comparison', label: '对比分析' }, { tab: 'pumpDeepAnalysis', label: '检泵分析' }, { tab: 'occupancyAnalysis', label: '占产分析' }] },
    { key: 'focus', label: '重点情况', items: [{ tab: 'analysis', label: '重点监控' }, { tab: 'waterLab', label: '含水化验' }, { tab: 'pumpAnalysis', label: '检泵跟踪' }] },
    { key: 'measures', label: '措施项目', items: [{ tab: 'measureWellSelection', label: '措施选井' }, { tab: 'measures', label: '措施跟踪' }, { tab: 'measureAnalysis', label: '措施分析' }] },
    { key: 'production', label: '产量掌控', items: [{ tab: 'productionForecast', label: '产量预测' }] },
  ]);
  assert.equal(configuredTabs.length, 15);
  assert.equal(sidebarNavigationGroups.flatMap((group) => group.items).length, 15);
});

test('assigns every configured tab to its sidebar group', () => {
  const expectedGroups: Record<SidebarTab, SidebarGroupKey> = {
    dashboard: 'overview',
    oilWellMap: 'overview',
    wellTemperature: 'overview',
    well: 'analysis',
    block: 'analysis',
    comparison: 'analysis',
    pumpDeepAnalysis: 'analysis',
    occupancyAnalysis: 'analysis',
    analysis: 'focus',
    waterLab: 'focus',
    pumpAnalysis: 'focus',
    measureWellSelection: 'measures',
    measures: 'measures',
    measureAnalysis: 'measures',
    productionForecast: 'production',
  };

  for (const [tab, group] of Object.entries(expectedGroups)) {
    assert.equal(getSidebarGroupKey(tab), group);
  }
});

test('returns undefined for an unknown tab', () => {
  assert.equal(getSidebarGroupKey('missing-tab'), undefined);
});
