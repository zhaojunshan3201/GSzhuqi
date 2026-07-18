import assert from 'node:assert/strict';
import test from 'node:test';
import { getDateLabelInterval } from '../src/lib/externalTransferChart';

test('getDateLabelInterval limits long date axes to roughly twelve labels', () => {
  assert.equal(getDateLabelInterval(12), 0);
  assert.equal(getDateLabelInterval(197), 16);
  assert.equal(getDateLabelInterval(0), 0);
});
