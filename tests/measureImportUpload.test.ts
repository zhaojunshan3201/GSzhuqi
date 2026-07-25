import assert from 'node:assert/strict';
import test from 'node:test';

import { isHtmlMeasureImportFile, isMeasureImportWorkbookFile } from '../src/lib/measureImportUpload.ts';

test('accepts only xlsx and xls measure import filenames', () => {
  assert.equal(isMeasureImportWorkbookFile('monthly.xlsx'), true);
  assert.equal(isMeasureImportWorkbookFile('MONTHLY.XLS'), true);
  assert.equal(isMeasureImportWorkbookFile('monthly.csv'), false);
  assert.equal(isMeasureImportWorkbookFile('monthly.xlsx.html'), false);
  assert.equal(isMeasureImportWorkbookFile('monthly'), false);
});


test('detects HTML content masquerading as an Excel workbook', () => {
  assert.equal(isHtmlMeasureImportFile(Buffer.from('<!doctype html><html><body>not a workbook</body></html>')), true);
  assert.equal(isHtmlMeasureImportFile(Buffer.from([0x50, 0x4b, 0x03, 0x04])), false);
});
