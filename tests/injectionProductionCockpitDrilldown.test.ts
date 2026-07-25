import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';

import {
  applyCockpitMeasureFilters,
  filterMeasuresByCockpitWellNos,
  formatCockpitMetric,
  getCockpitAlertDrilldown,
  getCockpitBlockDrilldown,
} from '../src/lib/injectionProductionCockpitDrilldown';

test('maps valid ECharts block clicks and ignores invalid params', () => {
  assert.deepEqual(getCockpitBlockDrilldown({ name: '一区' }), { block: '一区' });
  assert.deepEqual(getCockpitBlockDrilldown({
    componentType: 'series',
    seriesType: 'bar',
    data: { name: '二区', value: 12 },
  }), { block: '二区' });
  assert.deepEqual(getCockpitBlockDrilldown({ axisValue: '三区' }), { block: '三区' });
  assert.deepEqual(getCockpitBlockDrilldown({
    name: '   ',
    data: { name: '  四区  ' },
    axisValue: '五区',
  }), { block: '四区' });
  assert.equal(getCockpitBlockDrilldown({ name: '' }), null);
  assert.equal(getCockpitBlockDrilldown(null), null);
});

test('maps Chinese alert labels and ignores unknown ECharts params', () => {
  assert.deepEqual(
    getCockpitAlertDrilldown(
      { name: '数据待补全' },
      [{ type: 'needsData', wellNo: 'W-1' }, { type: 'needsData', wellNo: 'W-1' }],
    ),
    { alertType: 'needsData', alertWellNos: ['W-1'] },
  );
  assert.deepEqual(getCockpitAlertDrilldown({ name: '未评价' }, []), { alertType: 'notEvaluated', alertWellNos: [] });
  assert.deepEqual(getCockpitAlertDrilldown({ name: '低效井' }, []), { alertType: 'lowEfficiency', alertWellNos: [] });
  assert.deepEqual(getCockpitAlertDrilldown({ name: '焖井逾期' }, []), { alertType: 'soakingOverdue', alertWellNos: [] });
  assert.deepEqual(getCockpitAlertDrilldown({ name: '待转抽逾期' }, []), { alertType: 'transferOverdue', alertWellNos: [] });
  assert.equal(getCockpitAlertDrilldown({ name: '未知' }, []), null);
});

test('applies keyword and block before retaining the cockpit alert type', () => {
  assert.deepEqual(applyCockpitMeasureFilters(
    {
      keyword: '旧井',
      block: '旧区',
      station: '一站',
      start: '2026-01-01',
      end: '2026-02-01',
      status: '生产',
      year: '2026',
    },
    { keyword: 'W-1', block: '一区', alertType: 'lowEfficiency' },
  ), {
    query: {
      keyword: 'W-1',
      block: '一区',
      station: '',
      start: '',
      end: '',
      status: '',
      year: '',
    },
    alertType: 'lowEfficiency',
  });
});

test('cockpit alert well numbers filter measures without recalculating alerts', () => {
  const rows = [{ jh: 'W-1', id: 1 }, { jh: 'W-1', id: 2 }, { jh: 'W-2', id: 3 }];
  assert.equal(filterMeasuresByCockpitWellNos(rows, ['W-1']).length, 2);
});

test('formats cockpit metrics without floating point noise', () => {
  assert.equal(formatCockpitMetric(66661.19999999995, 'dailyOil'), '66,661.2');
  assert.equal(formatCockpitMetric(1234.567, 'cumulativeOilGain'), '1,234.57');
  assert.equal(formatCockpitMetric(0.123456, 'oilSteamRatio'), '0.123');
});


test('App sidebar is an off-canvas drawer below md and navigation closes it', () => {
  const source = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8');
  assert.match(source, /fixed inset-y-0 left-0/);
  assert.match(source, /md:static md:translate-x-0/);
  assert.match(source, /setMobileSidebarOpen\(false\)/);
  assert.match(source, /mobileSidebarOpen \? closeMobileSidebar\(\) : setMobileSidebarOpen\(true\)/);
  assert.match(source, /aria-expanded=\{mobileSidebarOpen\}/);
  assert.match(source, /aria-controls="app-sidebar"/);
  assert.match(source, /id="app-sidebar"/);
  assert.match(source, /inert=\{isMobileViewport && !mobileSidebarOpen/);
  assert.match(source, /_setActiveTab\(tab\);\s*closeMobileSidebar\(\{ restoreFocus: false \}\)/);
  assert.match(source, /event\.key === 'Escape'/);
  assert.match(source, /id="app-main"/);
  assert.match(source, /inert=\{isMobileViewport && mobileSidebarOpen/);
  assert.match(source, /aria-hidden=\{isMobileViewport && mobileSidebarOpen/);
  assert.match(source, /onClick=\{\(\) => closeMobileSidebar\(\)\}/);
  assert.match(source, /closeMobileSidebar\(\{ restoreFocus: false \}\)/);
  assert.match(source, /requestAnimationFrame\([\s\S]*?appMainRef\.current\?\.focus\(\)/);
});
