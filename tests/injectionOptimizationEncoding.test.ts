import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const sources = [
  readFileSync(new URL('../src/components/InjectionOptimization.tsx', import.meta.url), 'utf8'),
  readFileSync(new URL('../src/lib/injectionScenarioForecast.ts', import.meta.url), 'utf8'),
];

test('injection optimization forecast copy is valid UTF-8 Chinese without replacement or placeholder characters', () => {
  for (const source of sources) {
    assert.doesNotMatch(source, /\uFFFD/);
    assert.doesNotMatch(source, /\?{3,}/);
  }
  for (const label of [
    '\u6ce8\u6c7d\u751f\u4ea7\u591a\u60c5\u666f\u9884\u6d4b',
    '\u516c\u5f0f\uff1a\u57fa\u7ebf + \u589e\u6cb9\u8d21\u732e \u2212 \u6ce8\u7a9c\u635f\u5931 \u2212 \u5360\u4ea7\u635f\u5931\uff1b\u8986\u76d630\u300190\u3001180\u5929\u3002',
    '\u56db\u60c5\u666f\u65e5\u4ea7\u6cb9\u66f2\u7ebf',
    '\u6570\u636e\u5f85\u8865\u5168\uff1a\u635f\u5931\u6216\u57fa\u7ebf\u7f3a\u5931\uff0c\u4e0d\u80fd\u4ee50\u66ff\u4ee3',
  ]) assert.ok(sources[0].includes(label), `missing forecast label: ${label}`);
  for (const assumption of [
    '\u57fa\u7ebf\u4ea7\u91cf',
    '\u6ce8\u7a9c\u635f\u5931',
    '\u5360\u4ea7\u635f\u5931',
    '\u5f85\u8865\u5168\uff0c\u672a\u6309 0 \u5904\u7406',
  ]) assert.ok(sources[1].includes(assumption), `missing forecast assumption: ${assumption}`);
});
