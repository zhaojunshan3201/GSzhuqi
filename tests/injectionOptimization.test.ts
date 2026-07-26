import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

test('injection optimization page draws an accessible four-scenario chart with an empty state', () => {
  const source = readFileSync(new URL('../src/components/InjectionOptimization.tsx', import.meta.url), 'utf8');
  assert.match(source, /aria: \{ enabled: true/);
  assert.match(source, /\\u6570\\u636e\\u5f85\\u8865\\u5168/);
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

test('isolates forecast and recommendation failures so one failed request does not blank the other result', () => {
  const source = readFileSync(new URL('../src/components/InjectionOptimization.tsx', import.meta.url), 'utf8');

  assert.match(source, /scenarioError/);
  assert.match(source, /recommendationError/);
  assert.match(source, /loadScenarioForecast/);
  assert.match(source, /loadRecommendations/);
  assert.match(source, /\\u751f\\u4ea7\\u6e90 Well \\u63a5\\u53e3\\u6682\\u4e0d\\u53ef\\u7528/);
  assert.match(source, /\\u91cd\\u8bd5\\u9884\\u6d4b/);
  assert.match(source, /\\u91cd\\u8bd5\\u63a8\\u8350/);
  assert.doesNotMatch(source, /setData\(null\)|setRecommendations\(null\)/);
  assert.doesNotMatch(source, /\{error \?/);
});

test('disables HMR for the Vite middleware server instead of reconnecting to a stale port', () => {
  const source = readFileSync(new URL('../server.ts', import.meta.url), 'utf8');
  assert.match(source, /server:\s*\{\s*middlewareMode:\s*true,\s*hmr:\s*false\s*\}/);
});
