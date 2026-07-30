# Priority Decline Rate Algorithm Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the priority-situation “上月递减率” use the same decline formula, production-block grouping, and daily/monthly aggregation semantics as the block production generator.

**Architecture:** Move the scalar annualized decline calculation into `blockProductionGenerator.ts` as the single formula implementation, and make the existing series helper delegate to it. Update the priority API aggregation to normalize blocks with `normalizeProductionBlockGroup`, aggregate raw well rows into rounded block-day totals, enforce complete prior-year coverage, and call the shared formula for the previous natural month.

**Tech Stack:** TypeScript, Node.js test runner, Express, SQLite, React, ECharts.

---

## File Map

- Modify `src/lib/blockProductionGenerator.ts`: own the single scalar decline formula and keep the existing series API.
- Modify `tests/blockProductionGeneratorUi.test.ts`: lock the shared scalar formula, leap-year behavior, invalid inputs, and series delegation.
- Modify `server.ts`: make priority block aggregation use production grouping, rounded daily totals, complete-year validation, and the shared formula.
- Modify `tests/prioritySituationApi.integration.test.ts`: verify alias grouping, generator-equivalent results, and incomplete-year behavior through the real API.
- Modify `src/lib/prioritySituationAnalysis.ts`: remove the duplicate decline formula.
- Modify `tests/prioritySituationAnalysis.test.ts`: remove tests for the deleted duplicate formula.
- Modify `src/components/PrioritySituationAnalysis.tsx`: identify the displayed values as using the block production generator algorithm.
- Modify `tests/prioritySituationAnalysisUi.test.ts`: lock the updated explanatory copy.

### Task 1: Establish the shared scalar decline formula

**Files:**
- Modify: `tests/blockProductionGeneratorUi.test.ts`
- Modify: `src/lib/blockProductionGenerator.ts`

- [ ] **Step 1: Write failing scalar-formula tests**

Add `calculateBlockDeclineRate` to the import and add these tests:

```ts
import {
  calculateBlockDeclineRate,
  calculateDeclineRateSeries,
  getBlockDateRangePreset,
} from '../src/lib/blockProductionGenerator.ts';

test('calculates one annualized block decline value with the target year day count', () => {
  assert.equal(calculateBlockDeclineRate(36_500, 80, 2026), 20);
  assert.equal(
    Number(calculateBlockDeclineRate(36_600, 80, 2024)?.toFixed(1)),
    20,
  );
});

test('rejects invalid annualized block decline inputs', () => {
  assert.equal(calculateBlockDeclineRate(0, 80, 2026), null);
  assert.equal(calculateBlockDeclineRate(36_500, -1, 2026), null);
  assert.equal(calculateBlockDeclineRate(36_500, 80, Number.NaN), null);
});
```

- [ ] **Step 2: Run the new tests and verify RED**

Run:

```powershell
node --import tsx --test tests/blockProductionGeneratorUi.test.ts
```

Expected: FAIL because `calculateBlockDeclineRate` is not exported by `blockProductionGenerator.ts`.

- [ ] **Step 3: Add the single scalar implementation**

Add this function above `calculateDeclineRateSeries`:

```ts
export function calculateBlockDeclineRate(
  previousYearOilTotal: number | null | undefined,
  monthlyAverageOil: number | null | undefined,
  targetYear: number,
): number | null {
  if (
    typeof previousYearOilTotal !== 'number'
    || !Number.isFinite(previousYearOilTotal)
    || previousYearOilTotal <= 0
    || typeof monthlyAverageOil !== 'number'
    || !Number.isFinite(monthlyAverageOil)
    || monthlyAverageOil < 0
    || !Number.isInteger(targetYear)
  ) {
    return null;
  }

  const yearDays = (
    Date.UTC(targetYear + 1, 0, 1) - Date.UTC(targetYear, 0, 1)
  ) / 86_400_000;
  const annualizedOil = monthlyAverageOil * yearDays;
  const rate = ((previousYearOilTotal - annualizedOil) / previousYearOilTotal) * 100;
  return Number.isFinite(rate) ? rate : null;
}
```

Change the body of `calculateDeclineRateSeries` so every data point delegates to it:

```ts
return dates.map((date, index) => {
  const currentYear = Number(date.slice(0, 4));
  return calculateBlockDeclineRate(
    previousYearOilTotals[String(currentYear - 1)],
    monthlyAverageOil[index],
    currentYear,
  );
});
```

Do not round inside the shared function. The block generator already formats chart labels to one decimal, while the priority API rounds its DTO field at the response boundary.

- [ ] **Step 4: Run the generator tests and verify GREEN**

Run:

```powershell
node --import tsx --test tests/blockProductionGeneratorUi.test.ts
```

Expected: all tests PASS, including the existing series result `[0, 20, -20, null]`.

- [ ] **Step 5: Commit the shared algorithm**

```powershell
git add src/lib/blockProductionGenerator.ts tests/blockProductionGeneratorUi.test.ts
git commit -m "refactor: share block decline rate formula"
```

### Task 2: Make priority aggregation match the generator data path

**Files:**
- Modify: `tests/prioritySituationApi.integration.test.ts`
- Modify: `server.ts`

- [ ] **Step 1: Extend the real API fixture with a grouped block alias**

In `seedDatabase`, add a second raw block name that belongs to the same production group as the existing `高3624` fixture. Give it valid prior-year rows for all 12 months and a target-month row. Use the existing production insert helper and these values:

```ts
for (let month = 1; month <= 12; month += 1) {
  await insertProduction(
    `GROUP-${month}`,
    `2025-${String(month).padStart(2, '0')}-15`,
    10,
    '3624块(北)L5',
  );
}
await insertProduction(
  'GROUP-TARGET',
  '2026-06-10',
  2,
  '3624块(北)L5',
);
```

The target row intentionally shares `2026-06-10` with the existing grouped block row. This proves that the priority path first creates a block-day total before calculating the monthly average.

- [ ] **Step 2: Add failing API assertions for shared grouping and formula output**

Import the shared function:

```ts
import { calculateBlockDeclineRate } from '../src/lib/blockProductionGenerator.ts';
```

Replace hard-coded formula-only assertions with generator-equivalence assertions:

```ts
const decline = body.data.blockDeclines.find(
  (row: any) => row.block === '高3624',
);
assert.equal(decline.previousYearOil, 3770);
assert.equal(decline.monthlyAverageOil, 9);
assert.equal(
  decline.declineRate,
  Number(calculateBlockDeclineRate(3770, 9, 2026)?.toFixed(1)),
);
assert.equal(decline.available, true);
assert.equal(
  body.data.blockDeclines.filter((row: any) => row.block === '高3624').length,
  1,
);
```

Keep the existing incomplete-year assertion and strengthen it:

```ts
assert.equal(unavailableDecline.declineRate, null);
assert.equal(unavailableDecline.available, false);
assert.equal(unavailableDecline.unavailableReason, '上年1—12月数据不足');
```

- [ ] **Step 3: Run the integration test and verify RED**

Run:

```powershell
node --import tsx --test tests/prioritySituationApi.integration.test.ts
```

Expected: FAIL because the priority endpoint still uses `normalizeForecastBlock` and the duplicate priority formula/data pipeline.

- [ ] **Step 4: Import the production grouping and shared formula**

Update imports in `server.ts`:

```ts
import {
  buildProductionBlockGroups,
  expandProductionBlockGroups,
  normalizeProductionBlockGroup,
} from './src/lib/blockProductionGrouping.ts';
import {
  calculateBlockDeclineRate,
} from './src/lib/blockProductionGenerator.ts';
```

Remove `calculateBlockDeclineRate` from the `prioritySituationAnalysis.ts` import list. Keep `normalizeForecastBlock` imported because unrelated injection forecast endpoints still use it.

- [ ] **Step 5: Replace priority block aggregation with rounded block-day aggregation**

Refactor `buildPriorityBlockDeclines` to use this structure:

```ts
function buildPriorityBlockDeclines(productionRows: any[], asOfDate: string) {
  const asOf = new Date(`${asOfDate}T00:00:00Z`);
  const target = new Date(Date.UTC(asOf.getUTCFullYear(), asOf.getUTCMonth() - 1, 1));
  const targetYear = target.getUTCFullYear();
  const targetMonth = `${targetYear}-${String(target.getUTCMonth() + 1).padStart(2, '0')}`;
  const previousYear = targetYear - 1;
  const blocks = new Map<string, Map<string, number>>();

  for (const row of productionRows) {
    const block = normalizeProductionBlockGroup(row.block);
    if (!block || !isValidPriorityDate(row.date)) continue;
    const oil = priorityNumber(row.oil);
    if (oil == null || oil < 0) continue;
    const daily = blocks.get(block) || new Map<string, number>();
    daily.set(row.date, (daily.get(row.date) || 0) + oil);
    blocks.set(block, daily);
  }

  return [...blocks.entries()].map(([block, daily]) => {
    const roundedDaily = [...daily.entries()].map(([date, oil]) => ({
      date,
      oil: Number(oil.toFixed(1)),
    }));
    const previousYearRows = roundedDaily.filter(({ date }) =>
      date.startsWith(`${previousYear}-`)
    );
    const previousMonths = new Set(
      previousYearRows.map(({ date }) => date.slice(0, 7)),
    );
    const previousYearOil = previousYearRows.reduce(
      (sum, row) => sum + row.oil,
      0,
    );
    const targetRows = roundedDaily.filter(({ date }) =>
      date.startsWith(`${targetMonth}-`)
    );
    const monthlyAverageOil = targetRows.length
      ? Number((
          targetRows.reduce((sum, row) => sum + row.oil, 0) / targetRows.length
        ).toFixed(1))
      : null;
    const hasCompletePreviousYear =
      previousMonths.size === 12 && previousYearOil > 0;
    const rawDeclineRate = hasCompletePreviousYear && monthlyAverageOil != null
      ? calculateBlockDeclineRate(previousYearOil, monthlyAverageOil, targetYear)
      : null;
    const declineRate = rawDeclineRate == null
      ? null
      : Number(rawDeclineRate.toFixed(1));

    return {
      block,
      targetMonth,
      previousYear,
      previousYearOil: hasCompletePreviousYear
        ? Number(previousYearOil.toFixed(1))
        : null,
      monthlyAverageOil,
      declineRate,
      available: declineRate != null,
      ...(declineRate == null
        ? {
            unavailableReason: !hasCompletePreviousYear
              ? '上年1—12月数据不足'
              : '目标月无有效产量',
          }
        : {}),
    };
  }).sort(
    (left, right) =>
      Number(right.declineRate ?? Number.NEGATIVE_INFINITY)
      - Number(left.declineRate ?? Number.NEGATIVE_INFINITY),
  );
}
```

This reproduces `/api/chart/block` semantics: normalize with the production grouping rules, sum raw wells by block and day, round daily totals to one decimal, average the returned target-month days, and use the prior calendar-year daily total.

- [ ] **Step 6: Run the integration and grouping tests and verify GREEN**

Run:

```powershell
node --import tsx --test tests/prioritySituationApi.integration.test.ts tests/blockProductionGrouping.test.ts
```

Expected: all tests PASS. The API returns one merged `高3624` row and still rejects an incomplete previous year.

- [ ] **Step 7: Commit the priority data-path change**

```powershell
git add server.ts tests/prioritySituationApi.integration.test.ts
git commit -m "fix: align priority decline aggregation"
```

### Task 3: Remove the duplicate formula

**Files:**
- Modify: `src/lib/prioritySituationAnalysis.ts`
- Modify: `tests/prioritySituationAnalysis.test.ts`

- [ ] **Step 1: Add a source-level uniqueness assertion**

In `tests/blockProductionGeneratorUi.test.ts`, read the priority library source and assert that it does not define the formula:

```ts
const priorityAnalysisSource = readFileSync(
  new URL('../src/lib/prioritySituationAnalysis.ts', import.meta.url),
  'utf8',
);

test('keeps the annualized block decline formula only in the block generator library', () => {
  assert.doesNotMatch(
    priorityAnalysisSource,
    /export function calculateBlockDeclineRate/,
  );
});
```

- [ ] **Step 2: Run the uniqueness test and verify RED**

Run:

```powershell
node --import tsx --test tests/blockProductionGeneratorUi.test.ts
```

Expected: FAIL because `prioritySituationAnalysis.ts` still exports its duplicate function.

- [ ] **Step 3: Delete the duplicate implementation and obsolete tests**

Delete `calculateBlockDeclineRate` from `src/lib/prioritySituationAnalysis.ts`.

Remove `calculateBlockDeclineRate` from the imports in `tests/prioritySituationAnalysis.test.ts`, and delete the two tests that directly exercise the old `(previousYearOil, monthlyAverageOil, yearDays)` signature. Formula coverage now belongs to `tests/blockProductionGeneratorUi.test.ts`; API behavior remains covered by the integration test.

- [ ] **Step 4: Run both library test files and verify GREEN**

Run:

```powershell
node --import tsx --test tests/blockProductionGeneratorUi.test.ts tests/prioritySituationAnalysis.test.ts
```

Expected: all tests PASS and no duplicate formula remains.

- [ ] **Step 5: Commit duplicate removal**

```powershell
git add src/lib/prioritySituationAnalysis.ts tests/prioritySituationAnalysis.test.ts tests/blockProductionGeneratorUi.test.ts
git commit -m "refactor: remove duplicate priority decline formula"
```

### Task 4: Clarify the displayed algorithm source

**Files:**
- Modify: `tests/prioritySituationAnalysisUi.test.ts`
- Modify: `src/components/PrioritySituationAnalysis.tsx`

- [ ] **Step 1: Write a failing UI copy assertion**

Extend the workspace source test:

```ts
assert.match(source, /区块生产动态生成器递减率口径/);
```

- [ ] **Step 2: Run the UI test and verify RED**

Run:

```powershell
node --import tsx --test tests/prioritySituationAnalysisUi.test.ts
```

Expected: FAIL because the component still says `区块年度折算递减率`.

- [ ] **Step 3: Replace only the subtitle**

In `PrioritySituationAnalysis.tsx`, change:

```tsx
<p className="mt-1 text-sm text-slate-500">区块年度折算递减率</p>
```

to:

```tsx
<p className="mt-1 text-sm text-slate-500">区块生产动态生成器递减率口径</p>
```

Keep the title, chart orientation, sorting, red/green colors, tooltip, and empty state unchanged.

- [ ] **Step 4: Run the UI test and verify GREEN**

Run:

```powershell
node --import tsx --test tests/prioritySituationAnalysisUi.test.ts
```

Expected: all tests PASS.

- [ ] **Step 5: Commit the copy change**

```powershell
git add src/components/PrioritySituationAnalysis.tsx tests/prioritySituationAnalysisUi.test.ts
git commit -m "fix: label shared priority decline rate"
```

### Task 5: Verify the completed change

**Files:**
- No production changes expected.

- [ ] **Step 1: Run all directly affected tests**

```powershell
node --import tsx --test tests/blockProductionGeneratorUi.test.ts tests/blockProductionGrouping.test.ts tests/prioritySituationAnalysis.test.ts tests/prioritySituationAnalysisUi.test.ts tests/prioritySituationApi.integration.test.ts
```

Expected: all tests PASS.

- [ ] **Step 2: Run the production build**

```powershell
npm run build
```

Expected: Vite build exits with code 0.

- [ ] **Step 3: Run the full test suite**

```powershell
npm test
```

Expected for this dirty main workspace: no new decline-rate failures. If the existing injection operation report or injection optimization tests still fail, record them separately rather than changing unrelated code.

- [ ] **Step 4: Run TypeScript diagnostics**

```powershell
npm run lint
```

Expected for this dirty main workspace: no new diagnostics in the files changed by this plan. Preserve and report unrelated pre-existing diagnostics.

- [ ] **Step 5: Review the final diff**

```powershell
git diff --check HEAD~4..HEAD
git log -4 --oneline
git status --short
```

Expected:

- no whitespace errors in the four implementation commits;
- only the intended algorithm, aggregation, duplicate-removal, UI-copy, and test changes are committed;
- the user’s pre-existing uncommitted files remain present and uncommitted.
