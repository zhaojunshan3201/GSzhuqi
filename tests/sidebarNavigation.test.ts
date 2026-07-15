import assert from 'node:assert/strict';
import test from 'node:test';

import { getSidebarGroupKey, sidebarNavigationGroups } from '../src/lib/sidebarNavigation.ts';

test('defines the five requested groups and all fifteen entries in order', () => {
  assert.deepEqual(sidebarNavigationGroups.map(({ key, label, items }) => ({ key, label, labels: items.map((item) => item.label) })), [
    { key: 'overview', label: '基本情况', labels: ['系统概览', '油井位图', '井温监控'] },
    { key: 'analysis', label: '分析系统', labels: ['单井分析', '区块分析', '对比分析', '检泵分析', '占产分析'] },
    { key: 'focus', label: '重点情况', labels: ['重点监控', '含水化验', '检泵跟踪'] },
    { key: 'measures', label: '措施项目', labels: ['措施选井', '措施跟踪', '措施分析'] },
    { key: 'production', label: '产量掌控', labels: ['产量预测'] },
  ]);
  assert.equal(sidebarNavigationGroups.flatMap((group) => group.items).length, 15);
});

test('finds the group containing each active tab and returns undefined for an unknown tab', () => {
  assert.equal(getSidebarGroupKey('wellTemperature'), 'overview');
  assert.equal(getSidebarGroupKey('pumpDeepAnalysis'), 'analysis');
  assert.equal(getSidebarGroupKey('productionForecast'), 'production');
  assert.equal(getSidebarGroupKey('missing-tab'), undefined);
});
