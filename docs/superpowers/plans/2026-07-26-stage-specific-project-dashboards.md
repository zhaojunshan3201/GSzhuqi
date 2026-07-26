# 阶段专属项目看板实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让方案与计划、施工监控、焖井转抽各自展示符合当前生命周期的非重复看板。

**Architecture:** 在 `injectionProjectViews.ts` 中增加可测试的阶段统计派生函数，输入当前视图项目和计划/实际对比行，输出 KPI、图表和待办数据。`InjectionProjectManagement.tsx` 根据 `view` 选择对应看板与清单；保留计划页原有计划执行内容，移除施工页的重复内容。

**Tech Stack:** React、TypeScript、ECharts、Node test runner、tsx。

---

### Task 1: 阶段看板数据派生

**Files:**
- Modify: `src/lib/injectionProjectViews.ts`
- Modify: `tests/injectionProjectViews.test.ts`

- [ ] **Step 1: 写入失败测试，定义施工及焖井转抽看板口径**

```ts
test('buildConstructionDashboard separates cumulative and unavailable daily steam', () => {
  const dashboard = buildConstructionDashboard([
    project({ id: 1, lifecycleStatus: 'injecting' }),
    project({ id: 2, lifecycleStatus: 'pending' }),
  ], [comparison({ projectId: 1, actualSteam: 120, completionRate: 0.6, comparisonStatus: 'delayed' })]);

  assert.equal(dashboard.kpis.active, 1);
  assert.equal(dashboard.kpis.cumulativeSteam, 120);
  assert.equal(dashboard.kpis.dailySteam, null);
  assert.equal(dashboard.kpis.delayed, 1);
});

test('buildSoakTransferDashboard counts overdue projects and ignores invalid soak dates', () => {
  const dashboard = buildSoakTransferDashboard([
    project({ lifecycleStatus: 'soaking', actualDate: '2026-07-01' }),
    project({ lifecycleStatus: 'pendingTransfer', plannedTransferDate: '2026-07-10' }),
    project({ lifecycleStatus: 'soaking', actualDate: 'invalid' }),
  ], new Date('2026-07-26'));

  assert.equal(dashboard.kpis.soaking, 2);
  assert.equal(dashboard.kpis.pendingTransfer, 1);
  assert.equal(dashboard.kpis.overdue, 1);
  assert.equal(dashboard.kpis.averageSoakDays, 25);
  assert.equal(dashboard.kpis.missingSoakDate, 1);
});
```

- [ ] **Step 2: 运行测试，确认因导出函数不存在而失败**

Run: `node --import tsx --test tests/injectionProjectViews.test.ts`

Expected: FAIL，提示 `buildConstructionDashboard` 或 `buildSoakTransferDashboard` 未导出。

- [ ] **Step 3: 实现最小纯函数与导出类型**

```ts
export function buildConstructionDashboard(projects: ProjectLike[], rows: ComparisonLike[]) {
  const active = projects.filter((project) => project.lifecycleStatus === 'injecting');
  const rowByProjectId = new Map(rows.map((row) => [row.projectId, row]));
  const activeRows = active.map((project) => rowByProjectId.get(project.id)).filter(Boolean);
  return {
    kpis: {
      active: active.length,
      cumulativeSteam: activeRows.reduce((sum, row) => sum + (row!.actualSteam || 0), 0),
      dailySteam: null,
      delayed: activeRows.filter((row) => row!.comparisonStatus === 'delayed').length,
      missingData: active.filter((project) => !rowByProjectId.get(project.id)).length,
    },
  };
}
```

实现 `buildSoakTransferDashboard`：仅接受 `soaking`/`pendingTransfer` 项目；使用严格有效日期计算焖井天数；超期沿用 `isOverdue`；输出状态分布、时长桶和按超期优先排序的待办项目。

- [ ] **Step 4: 运行单测确认通过**

Run: `node --import tsx --test tests/injectionProjectViews.test.ts`

Expected: PASS。

- [ ] **Step 5: 提交数据派生实现**

```bash
git add src/lib/injectionProjectViews.ts tests/injectionProjectViews.test.ts
git commit -m "feat: derive stage-specific project dashboards"
```

### Task 2: 渲染三个阶段专属看板

**Files:**
- Modify: `src/components/InjectionProjectManagement.tsx`
- Modify: `tests/injectionProjectViews.test.ts`

- [ ] **Step 1: 写入失败测试，锁定页面阶段职责**

```ts
test('project management renders a construction dashboard without plan execution title', () => {
  const source = readFileSync('src/components/InjectionProjectManagement.tsx', 'utf8');
  assert.match(source, /施工监控看板/);
  assert.match(source, /焖井转抽看板/);
  assert.match(source, /isPlan \?[^]*计划执行统计看板/);
});
```

- [ ] **Step 2: 运行测试，确认当前页面不含阶段专属标题而失败**

Run: `node --import tsx --test tests/injectionProjectViews.test.ts`

Expected: FAIL，施工及焖井转抽专属标题未出现。

- [ ] **Step 3: 最小化改造组件渲染**

在 `viewComparisonRows` 后调用纯函数。保持计划页现有“计划执行统计看板”、计划/实际对比表和锅炉时间轴不变；将其可见条件改为 `isPlan`。

施工页增加标题“施工监控看板”：渲染施工中井数、累计实际注汽量、当日注汽量（固定显示“数据待补全”）、进度滞后、数据待补全；使用锅炉计划/累计实际注汽量柱状图和待注汽/注汽中状态分布图；施工清单展示计划量、累计实际量、完成率、实际锅炉和异常状态。

焖井转抽页增加标题“焖井转抽看板”：渲染焖井中、待转抽、超期待办、平均焖井天数、转抽完成率；展示焖井时长分布及转抽状态分布；渲染超期优先待办清单。无有效日期或生产数据时使用明确的“数据待补全”单元格。

- [ ] **Step 4: 运行相关测试确认通过**

Run: `node --import tsx --test tests/injectionProjectViews.test.ts`

Expected: PASS。

- [ ] **Step 5: 提交 UI 改造**

```bash
git add src/components/InjectionProjectManagement.tsx tests/injectionProjectViews.test.ts
git commit -m "feat: render stage-specific project dashboards"
```

### Task 3: 集成验证

**Files:**
- Verify only: `src/components/InjectionProjectManagement.tsx`
- Verify only: `src/lib/injectionProjectViews.ts`

- [ ] **Step 1: 运行项目视图及全量测试**

Run: `npm test`

Expected: PASS，已有用例与新增用例全部通过。

- [ ] **Step 2: 运行生产构建**

Run: `npm run build`

Expected: PASS；允许既有包体积提示，不允许 TypeScript 或 Vite 构建错误。

- [ ] **Step 3: 浏览器验收三个页面**

启动隔离工作树服务并确认：方案与计划仍有计划执行统计和时间轴；施工监控包含“施工监控看板”且没有“计划执行统计看板”；焖井转抽包含“焖井转抽看板”和超期待办。空数据时不得白屏且不应把累计注汽量写为当日注汽量。

- [ ] **Step 4: 提交验证记录前确认工作区清洁**

Run: `git status --short`

Expected: 只有忽略的浏览器临时文件；不提交 `.playwright-cli/`、数据库或 Excel 文件。
