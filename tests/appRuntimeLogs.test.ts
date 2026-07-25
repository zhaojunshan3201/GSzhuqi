import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { getRuntimeSyncStatus } from '../src/App.tsx';

const baseSyncStatus = {
  syncing: false,
  lastSuccessfulSyncAt: null,
  lastLocalDataDate: null,
  lastSyncStatus: 'success',
  lastError: null,
  hasData: true,
};

test('formats runtime sync states without treating missing status as success', () => {
  assert.deepEqual(getRuntimeSyncStatus(null, false), { label: '状态未知', className: 'text-amber-600' });
  assert.deepEqual(getRuntimeSyncStatus({ ...baseSyncStatus, syncing: true }, false), { label: '同步中', className: 'text-blue-600' });
  assert.deepEqual(getRuntimeSyncStatus({ ...baseSyncStatus, lastSyncStatus: 'error' }, false), { label: '同步失败', className: 'text-red-600' });
  assert.deepEqual(getRuntimeSyncStatus(baseSyncStatus, false), { label: '同步正常', className: 'text-emerald-600' });
});

test('renders runtime details outside the header and uses button navigation', () => {
  const appSource = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8');
  const header = appSource.match(/<header className="app-header">([\s\S]*?)<\/header>/)?.[1];

  assert.ok(header);
  assert.doesNotMatch(header, /syncStatus|cacheInfo|cacheSourceText/);
  assert.match(appSource, /activeTab === 'runtimeLogs'/);
  assert.match(appSource, /数据更新日期/);
  assert.match(appSource, /同步状态/);
  assert.match(appSource, /缓存预热/);
  assert.match(appSource, /缓存来源/);
  assert.match(appSource, /同步错误详情/);
  assert.match(appSource, /syncStatus\?\.lastError &&/);
  assert.match(appSource, /\{syncStatus\.lastError\}/);
  assert.match(appSource, /const SidebarItem[\s\S]*?<button[\s\S]*?type="button"/);
});

test('renders runtime logs only through the grouped sidebar navigation', () => {
  const appSource = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8');

  assert.match(appSource, /\{sidebarNavigationGroups\.map\(/);
  assert.doesNotMatch(appSource, /runtimeLogNavigationItem/);
});

test('renders each injection workflow tab with its title and project management view', () => {
  const appSource = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8');

  for (const [tab, title] of [
    ['injectionPlan', '\u65b9\u6848\u4e0e\u8ba1\u5212'],
    ['injectionConstruction', '\u65bd\u5de5\u76d1\u63a7'],
    ['injectionSoakTransfer', '\u7116\u4e95\u8f6c\u62bd'],
  ]) {
    assert.match(appSource, new RegExp(`activeTab === '${tab}' && '${title}'`));
  }

  assert.match(
    appSource,
    /\(activeTab === 'injectionProjectManagement' \|\| activeTab === 'injectionPlan' \|\| activeTab === 'injectionConstruction' \|\| activeTab === 'injectionSoakTransfer'\) && <InjectionProjectManagement initialProjectId=\{injectionPlanProjectId\?\.toString\(\)\} onClearInitialProjectId=/,
  );
});
