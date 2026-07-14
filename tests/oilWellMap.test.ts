import assert from 'node:assert/strict';
import test from 'node:test';
import XLSX from 'xlsx';

import { parseProducingWellsWorkbook, validateWellMapMarkerInput } from '../src/lib/oilWellMap.ts';
import { fitWellMapToViewport, fitWellMapToWidth, getMarkerAnchorStyle, getVisibleProductionMarkers, resolveMarkerColor } from '../src/lib/oilWellMapMarkers.ts';

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

test('rejects a daily workbook without JH, RQ, and SCSJ columns', () => {
  assert.throws(
    () => parseProducingWellsWorkbook(workbookBuffer([['井号', '日期', '生产时间'], ['高246-1', 46001, 1]])),
    /JH、RQ、SCSJ/,
  );
});

test('fits a tall map into the visible viewport without cropping', () => {
  assert.deepEqual(fitWellMapToViewport(5437, 4320, 1380, 538), { width: 677, height: 538 });
});

test('fills the content width while preserving the complete map aspect ratio', () => {
  assert.deepEqual(fitWellMapToWidth(5437, 4320, 1380), { width: 1380, height: 1096 });
});

test('anchors the red dot itself at the saved map coordinate', () => {
  assert.deepEqual(getMarkerAnchorStyle(40.5, 35.25), {
    left: '40.5%', top: '35.25%', transform: 'translate(-50%, -50%)',
  });
});

test('uses the highest priority visible category color', () => {
  assert.equal(resolveMarkerColor('高246-1', [
    { id: 1, name: '高含水井', color: '#f59e0b', priority: 20, visible: true },
    { id: 2, name: '主窜井', color: '#7c3aed', priority: 10, visible: true },
  ], [{ categoryId: 1, wellNo: '高246-1' }, { categoryId: 2, wellNo: '高246-1' }]), '#7c3aed');
});

test('falls back to the next visible category or default red', () => {
  assert.equal(resolveMarkerColor('高246-1', [
    { id: 1, name: '主窜井', color: '#7c3aed', priority: 10, visible: false },
    { id: 2, name: '高含水井', color: '#f59e0b', priority: 20, visible: true },
  ], [{ categoryId: 1, wellNo: '高246-1' }, { categoryId: 2, wellNo: '高246-1' }]), '#f59e0b');
});
