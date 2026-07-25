import assert from 'node:assert/strict';
import test from 'node:test';

import {
  applyCockpitMeasureFilters,
  filterMeasuresByCockpitAlerts,
  getCockpitAlertDrilldown,
  getCockpitBlockDrilldown,
} from '../src/lib/injectionProductionCockpitDrilldown';

test('maps valid ECharts block clicks and ignores invalid params', () => {
  assert.deepEqual(getCockpitBlockDrilldown({ name: '一区' }), { block: '一区' });
  assert.equal(getCockpitBlockDrilldown({ name: '' }), null);
  assert.equal(getCockpitBlockDrilldown(null), null);
});

test('maps Chinese alert labels and ignores unknown ECharts params', () => {
  assert.deepEqual(getCockpitAlertDrilldown({ name: '数据待补全' }), { alertType: 'needsData' });
  assert.deepEqual(getCockpitAlertDrilldown({ name: '未评价' }), { alertType: 'notEvaluated' });
  assert.deepEqual(getCockpitAlertDrilldown({ name: '低效井' }), { alertType: 'lowEfficiency' });
  assert.deepEqual(getCockpitAlertDrilldown({ name: '焖井逾期' }), { alertType: 'soakingOverdue' });
  assert.deepEqual(getCockpitAlertDrilldown({ name: '待转抽逾期' }), { alertType: 'transferOverdue' });
  assert.equal(getCockpitAlertDrilldown({ name: '未知' }), null);
});

test('applies keyword and block before retaining the cockpit alert type', () => {
  assert.deepEqual(applyCockpitMeasureFilters(
    { keyword: '旧井', block: '旧区', station: '一站' },
    { keyword: 'W-1', block: '一区', alertType: 'lowEfficiency' },
  ), {
    query: { keyword: 'W-1', block: '一区', station: '一站' },
    alertType: 'lowEfficiency',
  });
});

test('alert type filters measures by well numbers from cockpit alerts', () => {
  const alerts = [
    { type: 'lowEfficiency', wellNo: 'W-1' },
    { type: 'needsData', wellNo: 'W-2' },
    { type: 'lowEfficiency', wellNo: 'W-3' },
  ] as const;
  const rows = [{ jh: 'W-1' }, { jh: 'W-2' }, { jh: 'W-3' }, { jh: 'W-4' }];
  assert.deepEqual(filterMeasuresByCockpitAlerts(rows, alerts, 'lowEfficiency'), [{ jh: 'W-1' }, { jh: 'W-3' }]);
});
