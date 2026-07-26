import assert from 'node:assert/strict';
import test from 'node:test';

import { getInjectionChartOption, hasInjectionChartData } from '../src/components/InjectionProjectManagement.tsx';

test('injection dashboard charts expose title-aware accessibility metadata', () => {
  const option = getInjectionChartOption('\u65bd\u5de5\u72b6\u6001\u5206\u5e03', ['\u5f85\u6ce8\u6c7d'], [{ name: '\u4e95\u6570', data: [2], color: '#6366f1' }]);

  assert.deepEqual(option.aria, { enabled: true, description: '\u65bd\u5de5\u72b6\u6001\u5206\u5e03\u56fe\u8868' });
  assert.equal(option.graphic, undefined);
});

test('injection dashboard shows a no-data state when every chart series is empty', () => {
  const emptyOption = getInjectionChartOption('\u7116\u4e95\u65f6\u957f\u5206\u5e03', [], [{ name: '\u4e95\u6570', data: [], color: '#6366f1' }]);
  assert.equal(hasInjectionChartData([], [{ name: '\u4e95\u6570', data: [], color: '#6366f1' }]), false);
  assert.equal((emptyOption.graphic as any).style.text, '\u6682\u65e0\u7b26\u5408\u7b5b\u9009\u6761\u4ef6\u7684\u6570\u636e');
  assert.equal(hasInjectionChartData(['\u5f85\u6ce8\u6c7d'], [{ name: '\u4e95\u6570', data: [0], color: '#6366f1' }]), true);
});
