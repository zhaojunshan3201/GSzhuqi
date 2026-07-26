import assert from 'node:assert/strict';
import test from 'node:test';

import { formatShanghaiBusinessDate } from '../src/lib/businessDate.ts';

test('uses the Shanghai calendar day across the UTC date boundary', () => {
  assert.equal(formatShanghaiBusinessDate(new Date('2026-07-25T16:30:00.000Z')), '2026-07-26');
});
