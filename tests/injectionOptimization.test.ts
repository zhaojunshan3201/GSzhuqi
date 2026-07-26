import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

test('injection optimization page draws an accessible four-scenario chart with an empty state', () => {
  const source = readFileSync(new URL('../src/components/InjectionOptimization.tsx', import.meta.url), 'utf8');
  assert.match(source, /aria: \{ enabled: true/);
  assert.match(source, /数据待补全/);
  assert.match(source, /naturalDecline/);
  assert.match(source, /riskConstrained/);
});

test('wires the injection optimization page exactly once', () => {
  const appSource = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8');
  const importMatches = appSource.match(/import \{ InjectionOptimization \} from '\.\/components\/InjectionOptimization';/g) ?? [];
  const renderMatches = appSource.match(/\{activeTab === 'injectionOptimization' && <InjectionOptimization \/>\}/g) ?? [];

  assert.equal(importMatches.length, 1);
  assert.equal(renderMatches.length, 1);
});
