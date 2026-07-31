# Priority Decline Chart Value Labels Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Display one-decimal percentage values at the outside end of every bar in the priority-situation “上月递减率” chart.

**Architecture:** Keep the existing ECharts option local to `PrioritySituationAnalysis.tsx`. Add a shared series label formatter, assign each data item a left/right label position from the sign of its decline rate, and reserve horizontal chart space without changing API data or sorting.

**Tech Stack:** TypeScript, React, ECharts, Node.js test runner, Vite.

---

## File Map

- Modify `tests/prioritySituationAnalysisUi.test.ts`: lock visible labels, sign-based position, and one-decimal percentage formatting.
- Modify `src/components/PrioritySituationAnalysis.tsx`: configure the decline bar series labels and chart spacing.

### Task 1: Add outside-end percentage labels

**Files:**
- Modify: `tests/prioritySituationAnalysisUi.test.ts`
- Modify: `src/components/PrioritySituationAnalysis.tsx`

- [ ] **Step 1: Write failing source assertions**

Add these assertions to the existing `priority situation workspace includes categories, shared upload and supporting sections` test after the shared-algorithm copy assertion:

```ts
  assert.match(source, /label:\s*\{\s*show:\s*true/);
  assert.match(
    source,
    /position:\s*Number\(item\.declineRate\)\s*>=\s*0\s*\?\s*'right'\s*:\s*'left'/,
  );
  assert.match(
    source,
    /Number\(params\.value\)\.toFixed\(1\).*%/,
  );
```

- [ ] **Step 2: Run the UI test and verify RED**

Run:

```powershell
node --import tsx --test tests/prioritySituationAnalysisUi.test.ts
```

Expected: FAIL because the bar series does not yet enable labels, position them from the sign, or format them as one-decimal percentages.

- [ ] **Step 3: Add the minimal ECharts label configuration**

Replace the `chartOption` return object with the same existing axes and tooltip plus the following grid and series configuration:

```ts
    return {
      grid: { left: 88, right: 56, top: 18, bottom: 22 },
      tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' } },
      xAxis: {
        type: 'value',
        boundaryGap: ['12%', '12%'],
        axisLabel: { formatter: '{value}%' },
      },
      yAxis: { type: 'category', data: rows.map((item) => item.block), axisTick: { show: false } },
      series: [{
        type: 'bar',
        label: {
          show: true,
          color: '#334155',
          formatter: (params: { value: number }) => `${Number(params.value).toFixed(1)}%`,
        },
        data: rows.map((item) => ({
          value: item.declineRate,
          label: {
            position: Number(item.declineRate) >= 0 ? 'right' : 'left',
          },
          itemStyle: {
            color: Number(item.declineRate) > 0 ? '#dc2626' : '#16a34a',
          },
        })),
        barMaxWidth: 24,
      }],
    };
```

Do not change row filtering, the ten-row limit, reverse ordering, bar colors, tooltip behavior, or the chart card copy.

- [ ] **Step 4: Run the UI test and verify GREEN**

Run:

```powershell
node --import tsx --test tests/prioritySituationAnalysisUi.test.ts
```

Expected: all tests PASS.

- [ ] **Step 5: Commit the chart labels**

```powershell
git add src/components/PrioritySituationAnalysis.tsx tests/prioritySituationAnalysisUi.test.ts
git commit -m "feat: show priority decline chart values"
```

### Task 2: Verify the completed change

**Files:**
- No production changes expected.

- [ ] **Step 1: Run directly affected tests**

```powershell
node --import tsx --test tests/prioritySituationAnalysisUi.test.ts tests/prioritySituationAnalysis.test.ts tests/blockProductionDeclineRate.test.ts
```

Expected: all tests PASS.

- [ ] **Step 2: Run the full test suite**

```powershell
npm test
```

Expected: all tests PASS with the repository's serialized test-file execution.

- [ ] **Step 3: Run the production build**

```powershell
npm run build
```

Expected: Vite exits with code 0. The existing large-chunk warning is non-blocking.

- [ ] **Step 4: Review scope and whitespace**

```powershell
git diff --check HEAD~1..HEAD
git show --stat --oneline HEAD
git status --short
```

Expected: the implementation commit contains only the component and UI-test changes; the user's pre-existing uncommitted workspace files remain present and uncommitted.

