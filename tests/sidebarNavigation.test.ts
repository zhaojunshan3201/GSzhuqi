import assert from 'node:assert/strict';
import test from 'node:test';

import { getSidebarGroupKey, sidebarNavigationGroups } from '../src/lib/sidebarNavigation.ts';
import type { SidebarGroupKey, SidebarTab } from '../src/lib/sidebarNavigation.ts';

test('defines the five sidebar groups and seventeen navigation entries', () => {
  const tabs: SidebarTab[] = sidebarNavigationGroups.flatMap((group) => group.items.map((item) => item.tab));

  assert.deepEqual(sidebarNavigationGroups.map((group) => group.key), ['overview', 'analysis', 'focus', 'measures', 'production']);
  assert.equal(tabs.length, 17);
  assert.equal(new Set(tabs).size, 17);
});

test('assigns every configured tab to its sidebar group', () => {
  const expectedGroups: Record<SidebarTab, SidebarGroupKey> = {
    dashboard: 'overview', oilWellMap: 'overview', wellTemperature: 'overview', runtimeLogs: 'overview',
    well: 'analysis', block: 'analysis', comparison: 'analysis', pumpDeepAnalysis: 'analysis', occupancyAnalysis: 'analysis',
    analysis: 'focus', waterLab: 'focus', pumpAnalysis: 'focus',
    measureWellSelection: 'measures', measures: 'measures', measureAnalysis: 'measures',
    productionForecast: 'production', externalTransferTracking: 'production',
  };

  for (const [tab, group] of Object.entries(expectedGroups)) assert.equal(getSidebarGroupKey(tab), group);
});

test('includes runtime logs in the overview group', () => {
  assert.deepEqual(
    sidebarNavigationGroups.find((group) => group.key === 'overview')?.items.map((item) => item.tab),
    ['dashboard', 'oilWellMap', 'wellTemperature', 'runtimeLogs'],
  );
});

test('includes external transfer tracking in production controls', () => {
  assert.deepEqual(
    sidebarNavigationGroups.find((group) => group.key === 'production')?.items.map((item) => item.tab),
    ['productionForecast', 'externalTransferTracking'],
  );
});

test('returns undefined for an unknown tab', () => {
  assert.equal(getSidebarGroupKey('missing-tab'), undefined);
});
