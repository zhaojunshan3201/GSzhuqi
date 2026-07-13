import assert from 'node:assert/strict';
import test from 'node:test';

import { isWellTemperatureClientError } from '../src/lib/wellTemperatureApi.ts';
import { WellTemperatureParseError } from '../src/lib/wellTemperature.ts';

test('?????????????????', () => {
  assert.equal(isWellTemperatureClientError(new WellTemperatureParseError('invalid workbook')), true);
  assert.equal(isWellTemperatureClientError(new Error('database unavailable')), false);
});
