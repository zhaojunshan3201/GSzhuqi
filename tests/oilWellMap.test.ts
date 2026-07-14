import assert from 'node:assert/strict';
import test from 'node:test';
import XLSX from 'xlsx';

import { parseProducingWellsWorkbook, validateWellMapMarkerInput } from '../src/lib/oilWellMap.ts';
import { getVisibleProductionMarkers } from '../src/lib/oilWellMapMarkers.ts';

function workbookBuffer(rows: unknown[][]): Buffer {
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(rows), 'Sheet1');
  return XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });
}

test('returns only wells with SCSJ above zero on the latest date', () => {
  const result = parseProducingWellsWorkbook(workbookBuffer([
    ['JH', 'RQ', 'SCSJ'],
    ['高246-1', 46000, 4],
    ['高246-2', 46001, 0],
    ['高246-3', 46001, 0.5],
    ['高246-3', 46001, 1],
  ]));

  assert.deepEqual(result, { date: '2025-12-10', wells: ['高246-3'] });
});

test('accepts only marker coordinates within the map percentage range', () => {
  assert.equal(validateWellMapMarkerInput({ block: '', xPercent: 10, yPercent: 20 }), null);
  assert.equal(validateWellMapMarkerInput({ block: '高246块', xPercent: -1, yPercent: 20 }), null);
  assert.equal(validateWellMapMarkerInput({ block: '高246块', xPercent: 10, yPercent: 101 }), null);
  assert.deepEqual(validateWellMapMarkerInput({ block: '高246块', xPercent: 10.25, yPercent: 20.5 }), {
    block: '高246块', xPercent: 10.25, yPercent: 20.5,
  });
});

test('shows only producing markers in the selected block', () => {
  assert.deepEqual(getVisibleProductionMarkers('高246块', ['高246-1'], [
    { wellNo: '高246-1', block: '高246块', xPercent: 12, yPercent: 34 },
    { wellNo: '高3-1', block: '高3块', xPercent: 20, yPercent: 40 },
  ]), [{ wellNo: '高246-1', block: '高246块', xPercent: 12, yPercent: 34 }]);
});
