import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { buildInjectionStatusMapQuery, createLatestRequestGate, filterProjectsByInitialId, getDrawerFocusIndex, getStatusMapNavigation, nextProjectLocationId } from '../src/lib/injectionStatusMapNavigation.ts';

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

test('clears a one-time map project location before a remounted project view', () => {
  const located = nextProjectLocationId(null, { type: 'map-project', projectId: 9 });
  const cleared = nextProjectLocationId(located, { type: 'clear' });

  assert.equal(located, 9);
  assert.equal(cleared, null);
  assert.equal(nextProjectLocationId(located, { type: 'workflow-tab' }), null);
  assert.deepEqual(filterProjectsByInitialId([{ id: 2 }, { id: 9 }], cleared?.toString()), [{ id: 2 }, { id: 9 }]);
});

test('prevents an older or aborted map request from updating the active filter result', () => {
  const gate = createLatestRequestGate();
  const older = gate.start();
  const current = gate.start();

  assert.equal(gate.isCurrent(older, { aborted: false }), false);
  assert.equal(gate.isCurrent(current, { aborted: false }), true);
  assert.equal(gate.isCurrent(current, { aborted: true }), false);
});

test('wraps keyboard focus inside the selected-well drawer', () => {
  assert.equal(getDrawerFocusIndex(3, 2, false), 0);
  assert.equal(getDrawerFocusIndex(3, 0, true), 2);
  assert.equal(getDrawerFocusIndex(3, 1, false), 2);
});

test('status map source maps the API contract to status points, unlocated wells, and its responsive drawer', () => {
  const source = readFileSync(new URL('../src/components/OilWellMap.tsx', import.meta.url), 'utf8');
  assert.match(source, /\/api\/injection-status-map/);
  for (const field of ['block', 'lifecycleStatus', 'planMonth', 'alertType', 'overdue', 'keyword']) assert.match(source, new RegExp(field));
  assert.match(source, /const mapWells = mapData\?\.mapWells/);
  assert.match(source, /const unlocatedWells = mapData\?\.unlocatedWells/);
  assert.match(source, /mapWells\.map\(\(well\)/);
  assert.match(source, /unlocatedWells\.map\(\(well\)/);
  assert.match(source, /md:bottom-auto md:top-0 md:h-full/);
  assert.match(source, /role="dialog" aria-modal="true"/);
  assert.match(source, /backgroundColor: statusColor/);
  assert.match(source, /boxShadow: categoryColor/);
});

test('map wiring forwards project clearing and keeps marker deletion independent of status filters', () => {
  const appSource = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8');
  const mapSource = readFileSync(new URL('../src/components/OilWellMap.tsx', import.meta.url), 'utf8');
  const projectSource = readFileSync(new URL('../src/components/InjectionProjectManagement.tsx', import.meta.url), 'utf8');
  assert.match(appSource, /<InjectionProjectManagement initialProjectId=\{injectionPlanProjectId\?\.toString\(\)\} onClearInitialProjectId=/);
  assert.match(appSource, /onClearInitialProjectId=/);
  assert.match(projectSource, /onClearInitialProjectId\?\.\(\)/);
  assert.match(mapSource, /const calibrationMarkers = markers\.filter/);
  assert.match(mapSource, /calibrationMarkers\.map\(\(marker\)/);
  assert.match(mapSource, /removeMarker\(marker\.wellNo\)/);
});
