# 注汽计划执行对比 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (- [ ]) syntax for tracking.

**Goal:** 在注汽项目管理中按井号把月度计划与最新措施跟踪实际记录对比，显示时间、锅炉、注汽量和工艺偏差。

**Architecture:** 新建只读 comparison service，从 injection_projects 读取当前计划，从 measure_tracking 的 detail_json 读取实际字段。服务端标准化井号、选取最新开注记录并计算状态，Express 提供查询接口，页面只负责筛选和展示。

**Tech Stack:** TypeScript、SQLite、Express、React、Node test、Tailwind。

---

### Task 1: 对比服务

**Files:**
- Create: src/lib/injectionPlanActualComparison.ts
- Create: tests/injectionPlanActualComparison.test.ts

- [ ] **Step 1: 写失败测试。**

~~~ts
test('uses the latest actual injection start for a matching well', async () => {
  const result = await buildInjectionPlanActualComparison(db, { planMonth: '2026-07' });
  assert.equal(result.rows[0].actualStartDate, '2026-08-08');
  assert.equal(result.rows[0].startVarianceDays, 2);
  assert.equal(result.rows[0].comparisonStatus, 'delayed');
});
~~~

测试数据在 injection_projects 中创建计划井，高3-4-17CH3，计划开停 2026-08-06/2026-08-20，计划锅炉活6、计划量2500；在 measure_tracking 的 detail_json 创建同井两条开注记录，断言取较新的开注日期。另写测试覆盖提前、执行中、未执行、数据不完整、锅炉不一致、完成率和中文井号前后空格标准化。

- [ ] **Step 2: 运行失败测试。**

Run: node --import tsx --test tests/injectionPlanActualComparison.test.ts

Expected: FAIL，找不到 comparison service。

- [ ] **Step 3: 实现最小服务。**

~~~ts
export type PlanActualComparisonRow = {
  projectId: number; planMonth: string | null; wellNo: string;
  plannedStartDate: string | null; actualStartDate: string | null; startVarianceDays: number | null;
  plannedEndDate: string | null; actualEndDate: string | null; endVarianceDays: number | null;
  plannedBoiler: string | null; actualBoiler: string | null; boilerMatches: boolean | null;
  plannedSteam: number | null; actualSteam: number | null; steamVariance: number | null; completionRate: number | null;
  plannedProcess: string | null; actualProcess: string | null;
  comparisonStatus: 'not_started' | 'in_progress' | 'on_schedule' | 'early' | 'delayed' | 'incomplete';
};
export async function buildInjectionPlanActualComparison(db: DatabaseLike, filters: { planMonth?: string; unit?: string; boiler?: string; status?: string }) {}
~~~

从 detail_json 读取开注时间、停注时间、锅炉编号、累注汽量、措施类型；与列值兼容。开注时间最新的一条作为实际记录。实际减计划的日期差为正滞后、负提前。无实际开注为 not_started；有开注无停注为 in_progress；缺少必要字段为 incomplete；任何开/停偏差正值为 delayed，否则任何负值为 early，否则 on_schedule。

- [ ] **Step 4: 运行服务测试。**

Run: node --import tsx --test tests/injectionPlanActualComparison.test.ts

Expected: PASS。

- [ ] **Step 5: 提交。**

~~~powershell
git add src/lib/injectionPlanActualComparison.ts tests/injectionPlanActualComparison.test.ts
git commit -m "feat: compare injection plans with actual tracking"
~~~

### Task 2: 查询接口

**Files:**
- Modify: server.ts

- [ ] **Step 1: 增加接口。**

~~~ts
app.get('/api/injection-projects/plan-actual-comparison', async (req, res) => {
  const data = await buildInjectionPlanActualComparison(localDb, {
    planMonth: typeof req.query.planMonth === 'string' ? req.query.planMonth : undefined,
    unit: typeof req.query.unit === 'string' ? req.query.unit : undefined,
    boiler: typeof req.query.boiler === 'string' ? req.query.boiler : undefined,
    status: typeof req.query.status === 'string' ? req.query.status : undefined,
  });
  res.json({ success: true, data });
});
~~~

接口错误返回 500 和中文错误消息；不写入计划或跟踪数据。

- [ ] **Step 2: 验证构建。**

Run: npm run build

Expected: PASS。

- [ ] **Step 3: 提交。**

~~~powershell
git add server.ts
git commit -m "feat: expose injection plan actual comparison API"
~~~

### Task 3: 注汽项目管理对比视图

**Files:**
- Modify: src/components/InjectionProjectManagement.tsx

- [ ] **Step 1: 加载和筛选对比数据。**

定义 ComparisonRow 类型；在页面加载项目时请求 comparison API；计划月份、单位、锅炉、偏差状态筛选传给 API 或在前端使用同一筛选值。

- [ ] **Step 2: 增加统计和对比表格。**

~~~tsx
<section className="app-card overflow-hidden">
  <div className="app-card-header"><h3 className="font-bold">计划执行对比</h3></div>
  <table>
    {/* 井号、计划/实际开停、偏差天数、计划/实际锅炉、计划/实际注汽量、完成率、工艺、状态 */}
  </table>
</section>
~~~

状态显示中文：未执行、执行中、按计划、提前、滞后、数据不完整。滞后行使用醒目的警示色并默认在表格顶端；显示锅炉不一致和注汽量偏差。

- [ ] **Step 3: 构建。**

Run: npm run build

Expected: PASS。

- [ ] **Step 4: 手工验收。**

启动服务后打开 http://localhost:3001，进入注汽项目管理；确认“计划执行对比”中可按月份、单位、锅炉、状态筛选，且同井多条跟踪记录显示最新开注时间。

- [ ] **Step 5: 提交。**

~~~powershell
git add src/components/InjectionProjectManagement.tsx
git commit -m "feat: add plan actual comparison view"
~~~

### Task 4: 全量验证

- [ ] **Step 1: 运行测试。**

Run: npm test

Expected: 全部通过。

- [ ] **Step 2: 构建和变更范围检查。**

Run: npm run build; git diff main...HEAD --check; git status --short

Expected: 构建通过、无空白错误、不提交 tracking-2026c.xlsx 或 production.db。

