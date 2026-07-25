import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { buildInjectionStatusMapQuery, filterProjectsByInitialId, getStatusMapNavigation } from '../src/lib/injectionStatusMapNavigation.ts';

test('opens the injection plan for a well with a project', () => {
  assert.deepEqual(getStatusMapNavigation('project', { wellNo: 'A-1', projectId: 42 }), {
    tab: 'injectionPlan', filters: { projectId: 42 },
  });
});

test('does not navigate to a missing injection project', () => {
  assert.equal(getStatusMapNavigation('project', { wellNo: 'A-1', projectId: null }), null);
});

test('opens production response with the selected well keyword', () => {
  assert.deepEqual(getStatusMapNavigation('production', { wellNo: 'A-1', projectId: null }), {
    tab: 'measures', filters: { keyword: 'A-1' },
  });
});

test('opens evaluation with the selected well keyword', () => {
  assert.deepEqual(getStatusMapNavigation('evaluation', { wellNo: 'A-1', projectId: null }), {
    tab: 'measureAnalysis', filters: { keyword: 'A-1' },
  });
});

test('serializes only active status-map filters for the map request', () => {
  assert.equal(buildInjectionStatusMapQuery({ block: 'A区', lifecycleStatus: 'soaking', overdue: true, keyword: 'A-1' }),
    'block=A%E5%8C%BA&lifecycleStatus=soaking&overdue=true&keyword=A-1');
});

test('keeps only the requested project when the map passes an initial project id', () => {
  assert.deepEqual(filterProjectsByInitialId([{ id: 2 }, { id: 9 }], '9'), [{ id: 9 }]);
  assert.deepEqual(filterProjectsByInitialId([{ id: 2 }, { id: 9 }], undefined), [{ id: 2 }, { id: 9 }]);
});

test('status map source uses the full API contract and preserves prior data on retry', () => {
  const source = readFileSync(new URL('../src/components/OilWellMap.tsx', import.meta.url), 'utf8');
  assert.match(source, /\/api\/injection-status-map/);
  for (const field of ['block', 'lifecycleStatus', 'planMonth', 'alertType', 'overdue', 'keyword']) assert.match(source, new RegExp(field));
  assert.match(source, /setMapData\(data\)/);
  assert.match(source, /地图更新失败，保留最近成功数据/);
  assert.match(source, /setReloadKey/);
  assert.match(source, /const mapWells = mapData\?\.mapWells/);
  assert.match(source, /const unlocatedWells = mapData\?\.unlocatedWells/);
  assert.match(source, /mapWells\.map\(\(well\)/);
  assert.match(source, /unlocatedWells\.map\(\(well\)/);
  assert.match(source, /md:bottom-auto md:top-0 md:h-full/);
  assert.match(source, /backgroundColor: statusColor/);
  assert.match(source, /boxShadow: categoryColor/);
});

test('map drill-down forwards its selected project and keeps marker deletion independent of status filters', () => {
  const appSource = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8');
  const mapSource = readFileSync(new URL('../src/components/OilWellMap.tsx', import.meta.url), 'utf8');
  assert.match(appSource, /<InjectionProjectManagement initialProjectId=\{injectionPlanProjectId\?\.toString\(\)\} \/>/);
  assert.match(appSource, /setInjectionPlanProjectId\(filters\.projectId \?\? null\)/);
  assert.match(mapSource, /const calibrationMarkers = markers\.filter/);
  assert.match(mapSource, /calibrationMarkers\.map\(\(marker\)/);
  assert.match(mapSource, /removeMarker\(marker\.wellNo\)/);
});
