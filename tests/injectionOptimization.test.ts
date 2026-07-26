import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

test('injection optimization page draws an accessible four-scenario chart with an empty state', () => {
  const source = readFileSync(new URL('../src/components/InjectionOptimization.tsx', import.meta.url), 'utf8');
  assert.match(source, /aria: \{ enabled: true/);
  assert.match(source, /Êý¾Ý´ý²¹È«/);
  assert.match(source, /naturalDecline/);
  assert.match(source, /riskConstrained/);
});
