import assert from 'node:assert/strict';
import test from 'node:test';

import { decodeUploadedFileName } from '../src/lib/uploadFileName.ts';

test('decodes a UTF-8 Chinese filename reported by multer as latin1', () => {
  const original = '7月份注汽运行计划表7.17.xlsx';
  const multerName = Buffer.from(original, 'utf8').toString('latin1');

  assert.equal(decodeUploadedFileName(multerName), original);
});

test('keeps an ASCII filename unchanged', () => {
  assert.equal(decodeUploadedFileName('monthly-plan.xlsx'), 'monthly-plan.xlsx');
});
