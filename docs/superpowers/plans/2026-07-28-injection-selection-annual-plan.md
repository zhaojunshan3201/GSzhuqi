# 注汽选井约束与年末滚动计划 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为注汽选井增加已执行/已导入计划排除、实际或预测底产、注汽间隔约束，并支持下个月及至年末两种计划生成方式。

**Architecture:** 在纯规划模块中计算井的资格、底产证据和月度/年末建议；服务器从措施跟踪、已确认导入计划、生产日报及既有选井来源组装输入；前端增加两种生成模式，并展示每口井的可解释证据。年末生成按月份顺序计算，未实际执行的新建议井不在同一次生成中安排第二次。

**Tech Stack:** TypeScript、Express、SQLite、React、Node.js test runner。

---

## 文件结构

- Create: `src/lib/injectionSelectionAnnualPlan.ts`：资格判断、同期递减预测、逐月排期纯函数。
- Create: `tests/injectionSelectionAnnualPlan.test.ts`：纯函数回归测试。
- Modify: `src/lib/injectionSelectionPlanner.ts`：让既有月度计划接受通过资格判断后的候选数据，保留现有评分排序。
- Modify: `server.ts`：读取实际注汽、已确认导入井、生产日报，注册月度/年末计划接口。
- Modify: `tests/injectionSelectionApi.integration.test.ts`：临时数据库 HTTP 验证。
- Modify: `src/components/MeasureWellSelection.tsx`：模式切换、计划证据和按月展示。
- Modify: `tests/measureWellSelectionView.test.ts`：页面文案、模式与证据渲染测试。

### Task 1: 年末资格和预测纯函数

**Files:**
- Create: `src/lib/injectionSelectionAnnualPlan.ts`
- Create: `tests/injectionSelectionAnnualPlan.test.ts`

- [ ] **Step 1: 写入失败测试**

```ts
test('uses the latest actual oil for the next-month plan and rejects oil above 1.5', () => {
  const result = evaluateSelectionEligibility({ mode: 'next-month', planDate: '2026-08-01', wellNo: 'A-1', latestActualOil: 1.6, cycles: [], production: [], importedWellNos: new Set(), actualStarts: [] });
  assert.equal(result.eligible, false);
  assert.match(result.reason, /最新底产.*1.5/);
});

test('predicts year-end oil from aligned cycles and enforces the half-interval rule', () => {
  const result = evaluateSelectionEligibility({ mode: 'year-end', planDate: '2026-10-01', wellNo: 'A-1', latestActualOil: 2, actualStarts: ['2025-01-01', '2025-09-08'], importedWellNos: new Set(), cycles, production });
  assert.equal(result.eligible, true);
  assert.equal(result.oilSource, 'predicted');
  assert.ok(result.oilValue! <= 1.5);
});
```

- [ ] **Step 2: 验证 RED**

Run: `node --import tsx --test tests/injectionSelectionAnnualPlan.test.ts`

Expected: FAIL，模块尚不存在。

- [ ] **Step 3: 实现最小纯函数**

```ts
export type PlanMode = 'next-month' | 'year-end';
export type EligibilityEvidence = { eligible: boolean; reason: string; oilValue: number | null; oilSource: 'actual' | 'predicted' | null; minimumEligibleDate: string | null };
export function evaluateSelectionEligibility(input: EligibilityInput): EligibilityEvidence;
export function buildYearEndPlans(input: YearEndPlanInput): Array<{ month: string; planDate: string; items: PlannedCandidate[]; excluded: ExcludedCandidate[] }>;
```

实现顺序：先拒绝 `importedWellNos`；再计算实际注汽的相邻 `startDate` 间隔及最小允许日期；下个月读取最新有限、非负实际日产油；年末将停注汽后天数对齐，按重叠日的本轮/上轮油量比值中位数预测目标日油量。任一预测输入缺失返回中文原因。年末按月份升序，每月先资格筛选、再沿用评分降序取 30 口；同一次生成中把首次建议井加入保留集合，后续月份不再安排它。

- [ ] **Step 4: 验证 GREEN**

Run: `node --import tsx --test tests/injectionSelectionAnnualPlan.test.ts`

Expected: PASS，覆盖导入井、实际底产、预测底产、间隔不足、候选不足、最多 30 口和同井保留。

- [ ] **Step 5: 提交**

```powershell
git add src/lib/injectionSelectionAnnualPlan.ts tests/injectionSelectionAnnualPlan.test.ts
git commit -m "feat: evaluate annual injection selection eligibility"
```

### Task 2: 服务器数据组装与接口

**Files:**
- Modify: `server.ts`
- Modify: `tests/injectionSelectionApi.integration.test.ts`

- [ ] **Step 1: 写入失败 HTTP 测试**

```ts
const response = await fetch(`http://127.0.0.1:${port}/api/injection-selection/plans/generate?mode=year-end`);
assert.equal(response.status, 200);
const body = await response.json() as any;
assert.equal(body.data.mode, 'year-end');
assert.ok(body.data.months.every((month: any) => month.items.length <= 30));
assert.ok(body.data.months.flatMap((month: any) => month.excluded).some((row: any) => /已确认导入/.test(row.reason)));
```

- [ ] **Step 2: 验证 RED**

Run: `node --import tsx --test tests/injectionSelectionApi.integration.test.ts`

Expected: FAIL，接口不存在。

- [ ] **Step 3: 注册接口与只读查询**

在 `server.ts` 注汽选井路由附近新增 `POST /api/injection-selection/plans/generate`。请求体为 `{ mode: 'next-month' | 'year-end' }`，其他值返回 400。读取：

```sql
SELECT DISTINCT well_no FROM injection_plan_import_rows r
JOIN injection_plan_imports i ON i.id = r.import_id
WHERE i.status = 'confirmed' AND r.row_class = 'valid' AND well_no IS NOT NULL AND TRIM(well_no) != '';

SELECT jh, current_round_transfer_time, detail_json, batch_year
FROM measure_tracking
WHERE batch_year = ?;

SELECT jh AS wellNo, rq AS date, oil FROM production
WHERE jh IS NOT NULL AND rq IS NOT NULL
ORDER BY jh, rq;
```

用既有 `listStageRows`、`listDailyRows`、`buildSelectionCandidates` 和新纯函数组装响应。下个月模式保持当前 `savePlan` 语义；年末模式返回建议结果，不覆盖已有月度计划。异常返回 `{ success:false, message }` 和 500。

- [ ] **Step 4: 验证 GREEN**

Run: `node --import tsx --test tests/injectionSelectionApi.integration.test.ts`

Expected: PASS，临时 SQLite 数据库验证确认导入井排除、实际/预测底产来源、间隔规则和年末逐月响应。

- [ ] **Step 5: 提交**

```powershell
git add server.ts tests/injectionSelectionApi.integration.test.ts
git commit -m "feat: generate constrained injection selection plans"
```

### Task 3: 选井页面模式和证据展示

**Files:**
- Modify: `src/components/MeasureWellSelection.tsx`
- Modify: `tests/measureWellSelectionView.test.ts`

- [ ] **Step 1: 写入失败视图测试**

```ts
assert.match(component, /生成下个月计划/);
assert.match(component, /生成至年末计划/);
assert.match(component, /最新实际底产/);
assert.match(component, /预测底产/);
assert.match(component, /最小可注汽日期/);
```

- [ ] **Step 2: 验证 RED**

Run: `node --import tsx --test tests/measureWellSelectionView.test.ts`

Expected: FAIL，模式和证据未渲染。

- [ ] **Step 3: 实现最小页面状态**

增加 `planMode` 状态，默认 `next-month`。两个按钮分别请求新接口；下个月响应继续显示/编辑单月计划，年末响应按 `month` 分组显示只读建议表。表格新增“底产”“底产来源”“最小可注汽日期”“资格说明”列；排除井显示中文原因。不得以 0 替代 `null`，预测底产明确标记为“预测”。

- [ ] **Step 4: 验证 GREEN**

Run: `node --import tsx --test tests/measureWellSelectionView.test.ts`

Expected: PASS，ReactDOMServer 渲染覆盖两个模式、实际/预测标签、分月表和缺失原因。

- [ ] **Step 5: 提交**

```powershell
git add src/components/MeasureWellSelection.tsx tests/measureWellSelectionView.test.ts
git commit -m "feat: show monthly and year-end injection plans"
```

### Task 4: 全量验证

**Files:** Verify only.

- [ ] **Step 1: 运行全量测试**

Run: `node --import tsx --test --test-concurrency=1 tests/*.test.ts`

Expected: 所有测试通过。

- [ ] **Step 2: 运行生产构建**

Run: `npm run build`

Expected: exit code 0。

- [ ] **Step 3: 检查范围**

Run: `git diff --check && git status --short`

Expected: 无空白错误，且仅包含本计划指定文件。
