import assert from 'node:assert/strict';
import test from 'node:test';
import { buildSelectionCyclesFromTrackingRows } from '../src/lib/measureWellSelectionData.ts';
const k = { transfer: '\u8f6c\u62bd\u65f6\u95f4', round: '\u8f6e\u6b21', steam: '\u7d2f\u6ce8\u6c7d\u91cf', pressure: '\u538b\u529b', rate: '\u6ce8\u6c7d\u901f\u5ea6', boiler: '\u9505\u7089\u7f16\u53f7', type: '\u63aa\u65bd\u7c7b\u578b', previousTransfer: '\u4e0a\u8f6e\u8f6c\u62bd\u65f6\u95f4', cycleOil: '\u5468\u671f\u91c7\u6cb9', oilSeeing: '\u89c1\u6cb9\u65e5\u671f' };
test('builds historical cycles from current and previous measure JSON fields and Excel dates', () => {
  const cycles = buildSelectionCyclesFromTrackingRows([{ jh: 'A-1', block: 'Block A', station: 'Station 1', detail_json: JSON.stringify({
    [k.transfer]: 46024, [k.round]: 7, [k.steam]: 1800, [k.pressure]: 16.5, [k.rate]: 12, [k.boiler]: 'B1', [k.type]: 'N2',
    [k.previousTransfer]: 45545, [`${k.round}_1`]: 6, [`${k.steam}_1`]: 1655, [`${k.pressure}_1`]: 14.2, [`${k.rate}_1`]: 11.7, [`${k.boiler}_1`]: 'B2',
    [k.cycleOil]: 626.8, [k.oilSeeing]: 45548,
  }) }]);
  assert.deepEqual(cycles.map((cycle) => ({ round: cycle.round, transferDate: cycle.transferDate })), [{ round: 7, transferDate: '2026-01-02' }, { round: 6, transferDate: '2024-09-10' }]);
  assert.equal(cycles[0].injectN2, true); assert.equal(cycles[1].cycleOil, 626.8); assert.equal(cycles[1].oilSeeingDays, 3);
});
test('deduplicates same well transfer date and round from overlapping tracking records', () => {
  const detail = JSON.stringify({ [k.previousTransfer]: 45545, [`${k.round}_1`]: 6, [`${k.steam}_1`]: 1655, [k.cycleOil]: 626.8 });
  assert.equal(buildSelectionCyclesFromTrackingRows([{ jh: 'A-1', block: 'Block A', detail_json: detail }, { jh: 'A-1', block: 'Block A', detail_json: detail }]).length, 1);
});