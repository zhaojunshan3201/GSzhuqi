# 注汽计划执行统计看板 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (- [ ]) syntax for tracking.

**Goal:** 将计划执行对比改为两个月窗口内的统计看板、图表和偏差明细。

**Architecture:** 扩展现有 injectionPlanActualComparison 服务，在服务端过滤两个月窗口、识别疑似非本轮并汇总图表数据；项目管理页面展示统计卡、ECharts 图表和可切换的偏差明细。

**Tech Stack:** TypeScript、SQLite、Express、React、ECharts、Node test。

---

### Task 1: 统计服务与范围规则

**Files:**
- Modify: src/lib/injectionPlanActualComparison.ts
- Modify: tests/injectionPlanActualComparison.test.ts

- [ ] **Step 1: 写失败测试。**

~~~ts
test('excludes plans outside the current and previous month window', async () => {
  const result = await buildInjectionPlanActualComparison(db, { planMonth: '2026-07' });
  assert.deepEqual(result.rows.map((row) => row.wellNo), ['A-1', 'A-2']);
});
test('marks a 61 day actual deviation as suspected another cycle', async () => {
  assert.equal(result.rows[0].comparisonStatus, 'suspected_other_cycle');
  assert.equal(result.summary.suspectedOtherCycle, 1);
});
~~~

- [ ] **Step 2: 运行测试，确认规则尚未实现。**

Run: node --import tsx --test tests/injectionPlanActualComparison.test.ts

Expected: FAIL，范围或状态断言不匹配。

- [ ] **Step 3: 实现范围、状态和汇总。**

在服务中基于请求计划月份计算该月及前一个自然月窗口；超过窗口的计划不返回。任一实际开停日期与计划对应日期绝对差超过60天时使用 suspected_other_cycle，不计入提前/滞后/按计划。输出 summary（planned, executed, onSchedule, early, delayed, notStarted, suspectedOtherCycle）和 charts（startVarianceBuckets, endVarianceBuckets, boilerSteamTotals）。把计划工艺 monthly-import 映射为 月度注汽计划，实际工艺空值映射为 --。

- [ ] **Step 4: 补充汇总和锅炉图表测试。**

~~~ts
assert.deepEqual(result.charts.boilerSteamTotals, [
  { boiler: '活6', plannedSteam: 2500, actualSteam: 2000 },
]);
~~~

- [ ] **Step 5: 运行服务测试并提交。**

Run: node --import tsx --test tests/injectionPlanActualComparison.test.ts

Expected: PASS。

~~~powershell
git add src/lib/injectionPlanActualComparison.ts tests/injectionPlanActualComparison.test.ts
git commit -m "feat: summarize injection execution deviations"
~~~

### Task 2: 看板接口与界面

**Files:**
- Modify: server.ts
- Modify: src/components/InjectionProjectManagement.tsx

- [ ] **Step 1: 保持查询接口返回扩展后的 summary 和 charts。**

现有 GET /api/injection-projects/plan-actual-comparison 保持 query 参数，返回 comparison service 的 rows、summary、charts；无写入操作。

- [ ] **Step 2: 添加统计卡和三个图表。**

使用 echarts-for-react 在计划执行对比区域顶部显示计划井数、已执行、按计划、提前、滞后、未执行、疑似非本轮；增加开注偏差分布柱状图、停注偏差分布柱状图和锅炉计划量/实际量分组柱状图。

- [ ] **Step 3: 调整偏差明细。**

默认只显示 early、delayed、not_started、suspected_other_cycle；增加 全部/仅偏差 切换。状态中文显示：未执行、执行中、按计划、提前、滞后、疑似非本轮、数据不完整。疑似非本轮用中性提示色，滞后用红色。

- [ ] **Step 4: 构建验证并提交。**

Run: npm run build

Expected: PASS。

~~~powershell
git add server.ts src/components/InjectionProjectManagement.tsx
git commit -m "feat: add injection execution dashboard"
~~~

### Task 3: 全量验证

- [ ] **Step 1: 运行测试。**

Run: npm test

Expected: PASS。

- [ ] **Step 2: 检查变更。**

Run: git diff main...HEAD --check; git status --short

Expected: 无空白错误，不包含 tracking-2026c.xlsx 或 production.db。

