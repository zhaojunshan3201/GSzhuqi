import assert from 'node:assert/strict';
import test from 'node:test';

import {
  applyCockpitMeasureFilters,
  filterMeasuresByCockpitWellNos,
  getCockpitAlertDrilldown,
  getCockpitBlockDrilldown,
} from '../src/lib/injectionProductionCockpitDrilldown';

test('maps valid ECharts block clicks and ignores invalid params', () => {
  assert.deepEqual(getCockpitBlockDrilldown({ name: '一区' }), { block: '一区' });
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
  const rows = [{ jh: 'W-1' }, { jh: 'W-2' }, { jh: 'W-3' }, { jh: 'W-4' }];
  assert.deepEqual(filterMeasuresByCockpitWellNos(rows, ['W-1', 'W-3']), [{ jh: 'W-1' }, { jh: 'W-3' }]);
});
