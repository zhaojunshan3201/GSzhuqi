import assert from 'node:assert/strict';
import test from 'node:test';

import { buildCockpitMeasureFilters, filterMeasuresByCockpitAlerts } from '../src/lib/injectionProductionCockpitDrilldown';

test('block drill-down writes the selected block filter', () => {
  assert.deepEqual(buildCockpitMeasureFilters({ block: '一区' }), { block: '一区' });
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
