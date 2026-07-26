import assert from 'node:assert/strict';
import test from 'node:test';

import { findSimilarInjectionWells, type InjectionWellProfile } from '../src/lib/similarInjectionWells.ts';

const target: InjectionWellProfile = {
  wellName: 'Target', block: 'A', layer: 'L1', wellType: 'horizontal', process: 'steam',
  production: 20, declineRate: 0.1, steamVolume: 1000, steamRate: 20, pressure: 12,
  channelingRisk: 0.2, cycleOil: 300,
};
const exact: InjectionWellProfile = { ...target, wellName: 'Exact', production: 19, declineRate: 0.12, steamVolume: 980, steamRate: 19, pressure: 12.5, channelingRisk: 0.22, cycleOil: 320 };
const different: InjectionWellProfile = { ...exact, wellName: 'Different', block: 'B', layer: 'L2', wellType: 'vertical', process: 'cyclic-steam' };

test('prioritizes wells matching block, layer, well type, and process', () => {
  const result = findSimilarInjectionWells(target, [different, exact]);
  assert.deepEqual(result.matches.map((match) => match.wellName), ['Exact', 'Different']);
  assert.equal(result.matches[0].scoreBreakdown.block.score, 15);
  assert.equal(result.matches[0].scoreBreakdown.layer.score, 15);
  assert.equal(result.matches[0].scoreBreakdown.process.score, 10);
  assert.equal(result.matches[0].caseEffect.cycleOil, 320);
  assert.equal(result.parameterRanges.steamVolume.min, 980);
});

test('lowers completeness for missing features without inventing a score', () => {
  const incomplete: InjectionWellProfile = { ...exact, wellName: 'Incomplete', pressure: null, cycleOil: null };
  const match = findSimilarInjectionWells(target, [incomplete]).matches[0];
  assert.ok(match.completeness < 1);
  assert.equal(match.scoreBreakdown.injectionScheme.score, null);
  assert.ok(match.score > 0);
  assert.ok(match.confidence < 1);
});

test('returns no more than ten matches and an explainable score composition', () => {
  const candidates = Array.from({ length: 12 }, (_, index) => ({ ...exact, wellName: `W-${index}`, production: 19 - index / 10 }));
  const result = findSimilarInjectionWells(target, candidates);
  assert.equal(result.matches.length, 10);
  assert.equal(result.matches[0].scoreBreakdown.production.max, 15);
  assert.equal(result.matches[0].scoreBreakdown.risk.max, 7.5);
  assert.equal(result.matches[0].scoreBreakdown.outcome.max, 7.5);
});
