import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const sources = [
  readFileSync(new URL('../src/components/InjectionOptimization.tsx', import.meta.url), 'utf8'),
  readFileSync(new URL('../src/lib/injectionOperationRecommendationCharts.ts', import.meta.url), 'utf8'),
];

function decodeUnicodeEscapes(source: string) {
  return source.replace(/\\u([0-9a-fA-F]{4})/g, (_, hex) => String.fromCharCode(Number.parseInt(hex, 16)));
}

function chinese(codePoints: string) {
  return codePoints.split(' ').map((codePoint) => String.fromCharCode(Number.parseInt(codePoint, 16))).join('');
}

test('injection optimization chart copy is valid UTF-8 or Unicode escapes without replacement or placeholder characters', () => {
  for (const source of sources) {
    assert.doesNotMatch(source, /\uFFFD/);
    assert.doesNotMatch(source, /\?{3,}/);
  }

  const [component, recommendationCharts] = sources.map(decodeUnicodeEscapes);
  for (const label of [
    chinese('6536 76ca 98ce 9669 96f7 8fbe'),
    chinese('6536 76ca 635f 5931 7011 5e03'),
    chinese('8fd0 884c 53c2 6570 5bf9 6bd4'),
    chinese('98ce 9669 7a33 5b9a 6027'),
  ]) assert.ok(component.includes(label), `missing chart title: ${label}`);
  for (const label of [
    chinese('63a8 8350 65b9 6848 6536 76ca 98ce 9669 96f7 8fbe 56fe'),
    chinese('6bdb 589e 6cb9 6536 76ca'),
    chinese('6ce8 7a9c 98ce 9669'),
    chinese('5907 9009 65b9 6848'),
  ]) assert.ok(recommendationCharts.includes(label), `missing recommendation chart copy: ${label}`);
});
