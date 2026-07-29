# Block Production Generator Normalization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the block production generator list, curve query, and Excel output use the confirmed deterministic block groups and aggregate every matching raw sub-block by date.

**Architecture:** Add a small pure grouping module that normalizes raw block names, builds the deduplicated selector list, and expands selected groups back to exact raw database block values. Wire the server bootstrap and `/api/chart/block` query to these helpers, while leaving raw production and well records unchanged; the existing SQL continues to sum additive measures and calculate water cut from aggregated base quantities.

**Tech Stack:** TypeScript, React, Express, SQLite, Node test runner, Vite

---

## File Structure

- Create `src/lib/blockProductionGrouping.ts`: deterministic grouping, selector-list construction, and selected-group expansion.
- Create `tests/blockProductionGrouping.test.ts`: rule, expansion, and source-wiring regression tests.
- Modify `server.ts`: use the shared helpers for bootstrap lists, cached lists, and exact raw block expansion before SQL aggregation.
- Modify `src/App.tsx`: update the generator's preferred default block from the legacy label to `高246`.

### Task 1: Deterministic grouping module

**Files:**
- Create: `src/lib/blockProductionGrouping.ts`
- Create: `tests/blockProductionGrouping.test.ts`

- [ ] **Step 1: Write the failing grouping tests**

Add tests covering every confirmed rule and an unchanged block:

```ts
import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildProductionBlockGroups,
  expandProductionBlockGroups,
  normalizeProductionBlockGroup,
} from '../src/lib/blockProductionGrouping.ts';

test('normalizes production generator blocks deterministically', () => {
  assert.equal(normalizeProductionBlockGroup('246块L5'), '高246');
  assert.equal(normalizeProductionBlockGroup('246块 L6'), '高246');
  assert.equal(normalizeProductionBlockGroup('3块L7'), '高3');
  assert.equal(normalizeProductionBlockGroup('3618块L4'), '高3618');
  assert.equal(normalizeProductionBlockGroup('3624块(北)L5'), '高3624');
  assert.equal(normalizeProductionBlockGroup('3624块（南）L6'), '高3624');
  assert.equal(normalizeProductionBlockGroup('高21(北)'), '高21');
  assert.equal(normalizeProductionBlockGroup('高21南'), '高21');
  assert.equal(normalizeProductionBlockGroup('高10'), '高10');
});

test('deduplicates selector groups and expands them to exact raw blocks', () => {
  const rawBlocks = [
    '246块L5',
    '246块L6',
    '3624块(北)L5',
    '3624块（南）L6',
    '高10',
  ];

  assert.deepEqual(
    buildProductionBlockGroups(rawBlocks),
    ['高10', '高246', '高3624'],
  );
  assert.deepEqual(
    expandProductionBlockGroups(['高3624'], rawBlocks),
    ['3624块(北)L5', '3624块（南）L6'],
  );
});
```

- [ ] **Step 2: Run the test and verify it fails**

Run:

```powershell
C:\node\node.exe --import tsx --test tests\blockProductionGrouping.test.ts
```

Expected: FAIL because `src/lib/blockProductionGrouping.ts` does not exist.

- [ ] **Step 3: Implement the minimal pure grouping module**

Create these exported functions:

```ts
export function normalizeProductionBlockGroup(block: string | null | undefined): string {
  const value = String(block ?? '').trim();
  if (!value) return '';

  const compact = value
    .replace(/\s+/g, '')
    .replace(/（/g, '(')
    .replace(/）/g, ')');

  if (compact === '高246' || /^246块L/i.test(compact)) return '高246';
  if (compact === '高3' || /^3块L/i.test(compact)) return '高3';
  if (compact === '高3618' || /^3618块L/i.test(compact)) return '高3618';
  if (compact === '高3624' || /^3624块/.test(compact)) return '高3624';
  if (compact === '高21' || /^高21(?:块)?(?:\([南北]\)|[南北])/.test(compact)) return '高21';
  return value;
}

export function buildProductionBlockGroups(blocks: string[]): string[] {
  return Array.from(new Set(blocks.map(normalizeProductionBlockGroup).filter(Boolean)))
    .sort((left, right) => left.localeCompare(right, 'zh-CN'));
}

export function expandProductionBlockGroups(selectedGroups: string[], rawBlocks: string[]): string[] {
  const selected = new Set(selectedGroups.map(normalizeProductionBlockGroup).filter(Boolean));
  return Array.from(new Set(
    rawBlocks
      .map(block => String(block ?? '').trim())
      .filter(block => block && selected.has(normalizeProductionBlockGroup(block))),
  )).sort((left, right) => left.localeCompare(right, 'zh-CN'));
}
```

- [ ] **Step 4: Run the tests and verify they pass**

Run:

```powershell
C:\node\node.exe --import tsx --test tests\blockProductionGrouping.test.ts
```

Expected: 2 tests PASS.

- [ ] **Step 5: Commit the grouping unit**

```powershell
git add src/lib/blockProductionGrouping.ts tests/blockProductionGrouping.test.ts
git commit -m "feat: add deterministic production block grouping"
```

### Task 2: Server list and curve-query integration

**Files:**
- Modify: `server.ts:181-234`
- Modify: `server.ts:540-615`
- Modify: `server.ts:885-925`
- Modify: `server.ts:1294-1384`
- Test: `tests/blockProductionGrouping.test.ts`

- [ ] **Step 1: Add failing server-wiring regression checks**

Append:

```ts
import { readFileSync } from 'node:fs';

test('uses production grouping for bootstrap and block chart source expansion', () => {
  const source = readFileSync(new URL('../server.ts', import.meta.url), 'utf8');

  assert.match(source, /buildProductionBlockGroups\(blocks\)/);
  assert.match(source, /expandProductionBlockGroups\(normalizedBlocks,\s*rawBlocks\)/);
  assert.match(source, /buildProductionBlockGroups\(cached\.payload\.chartBlocks\)/);
});
```

- [ ] **Step 2: Run the test and verify the new check fails**

Run:

```powershell
C:\node\node.exe --import tsx --test tests\blockProductionGrouping.test.ts
```

Expected: FAIL because `server.ts` does not yet call the shared grouping helpers.

- [ ] **Step 3: Replace the legacy static chart grouping with the shared helpers**

Import the helpers near the other local imports:

```ts
import {
  buildProductionBlockGroups,
  expandProductionBlockGroups,
  normalizeProductionBlockGroup,
} from './src/lib/blockProductionGrouping';
```

Make the existing chart normalization wrappers delegate to the shared rules:

```ts
function normalizeChartBlock(block: string) {
  return normalizeProductionBlockGroup(block);
}

function buildChartBlocksList(blocks: string[]) {
  return buildProductionBlockGroups(blocks);
}
```

Remove the legacy `CHART_BLOCK_GROUPS`, chart-only reverse map, and static source expansion functions that become unused. Keep unrelated raw-block logic unchanged.

- [ ] **Step 4: Expand selected groups against live raw block values**

At the start of `getBlockChartRows`, fetch the exact database block values and expand the selected groups:

```ts
const rawBlocks = await getBlocksList();
const sourceBlocks = expandProductionBlockGroups(normalizedBlocks, rawBlocks);
```

Continue using the existing summary and production SQL with `sourceBlocks`, so:

- `liquid`, `oil`, `diluent`, and `gas` remain summed by `rq`;
- `water_cut` remains calculated with `SQLITE_SUMMARY_WATER_CUT_SQL`;
- multiple matching raw blocks produce one daily row;
- no production rows are renamed or rewritten.

- [ ] **Step 5: Re-normalize stale cached selector lists**

In `getDashboardBootstrapData`, replace direct reuse of cached chart labels with:

```ts
const normalizedChartBlocks = Array.isArray(cached.payload?.chartBlocks)
  ? buildProductionBlockGroups(cached.payload.chartBlocks)
  : buildProductionBlockGroups(cachedBlocks);
```

This prevents old cached labels from reappearing after deployment.

- [ ] **Step 6: Run grouping tests**

Run:

```powershell
C:\node\node.exe --import tsx --test tests\blockProductionGrouping.test.ts
```

Expected: 3 tests PASS.

- [ ] **Step 7: Commit server integration**

```powershell
git add server.ts tests/blockProductionGrouping.test.ts
git commit -m "feat: aggregate block curves by unified group"
```

### Task 3: Generator default selection and end-to-end verification

**Files:**
- Modify: `src/App.tsx:4703`
- Test: `tests/blockProductionGrouping.test.ts`

- [ ] **Step 1: Add a failing frontend regression check**

Append:

```ts
test('uses the unified 高246 label as the generator default', () => {
  const source = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8');
  assert.match(source, /chartBlocks\.includes\('高246'\)/);
  assert.doesNotMatch(source, /chartBlocks\.includes\('高246块'\)/);
});
```

- [ ] **Step 2: Run the test and verify it fails**

Run:

```powershell
C:\node\node.exe --import tsx --test tests\blockProductionGrouping.test.ts
```

Expected: FAIL because the current preferred default is the legacy `高246块` label.

- [ ] **Step 3: Update the default selector label**

Change:

```ts
const defaultBlock = chartBlocks.includes('高246') ? '高246' : chartBlocks[0];
```

No other UI behavior or layout changes are required. Excel export already uses `selectedChartBlocks` and the returned chart data, so it will automatically use the unified label and aggregated values.

- [ ] **Step 4: Run focused and related tests**

Run:

```powershell
C:\node\node.exe --import tsx --test tests\blockProductionGrouping.test.ts tests\wellAnalysisBlock.test.ts tests\sidebarNavigation.test.ts
```

Expected: all tests PASS.

- [ ] **Step 5: Build the production bundle**

Run:

```powershell
C:\node\node.exe C:\node\node_modules\npm\bin\npm-cli.js run build
```

Expected: Vite build exits with code 0.

- [ ] **Step 6: Verify the running endpoint**

Restart the local server if required, sign in through the existing application session, then verify:

1. The selector contains `高246`, `高3`, `高3618`, `高3624`, and `高21` only once each when their raw blocks exist.
2. Selecting `高3624` returns a non-error curve request.
3. The generated Excel uses `高3624` and the same daily values shown in the chart.
4. An unchanged block such as `高10` still appears under its original name.

- [ ] **Step 7: Commit the frontend and verification change**

```powershell
git add src/App.tsx tests/blockProductionGrouping.test.ts
git commit -m "fix: use unified block labels in production generator"
```
