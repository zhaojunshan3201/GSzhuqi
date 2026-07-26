# 最优运行推荐与自动报告实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 生成 Top 3 可解释注汽运行方案，并提供日报、周报和项目复盘页面及 Excel 导出。

**Architecture:** 纯优化模块消费预测与同类井结果；报告聚合模块消费项目、预测和推荐结果，并由 API/React 页面导出。所有未知输入保留 null 和低置信度。

---

### Task 1: Top 3 最优运行推荐

**Files:**
- Create: `src/lib/injectionOperationOptimizer.ts`
- Create: `tests/injectionOperationOptimizer.test.ts`
- Modify: `server.ts`
- Modify: `src/components/InjectionOptimization.tsx`

- [ ] 写失败测试：资源超限方案淘汰；高净收益、低波动、低风险方案优先；未知损失降低置信度不填零。
- [ ] 运行目标测试确认失败。
- [ ] 实现注井顺序、错峰、注汽量/压力/排量、焖井/转抽、锅炉约束、成本收益与解释依据，输出 Top 3；支持人工调整原因。
- [ ] 运行 `npm test && npm run build`，提交 `feat: recommend optimal injection operations`。

### Task 2: 报告聚合与 Excel 导出

**Files:**
- Create: `src/lib/injectionOperationReports.ts`
- Create: `tests/injectionOperationReports.test.ts`
- Modify: `server.ts`

- [ ] 写失败测试：日报/周报/复盘分别包含规定摘要；缺失数据有待补全；导出拥有摘要、明细、趋势、推荐方案四工作表。
- [ ] 运行目标测试确认失败。
- [ ] 实现报告聚合、API 和 `.xlsx` 生成，保留来源和筛选条件。
- [ ] 运行目标测试和全量测试，提交 `feat: generate injection operation reports`。

### Task 3: 系统内报告页面

**Files:**
- Create: `src/components/InjectionOperationReports.tsx`
- Modify: `src/lib/sidebarNavigation.ts`
- Modify: `src/App.tsx`
- Test: `tests/injectionOperationReportsUi.test.ts`

- [ ] 写失败测试：导航入口、三类报告、导出按钮和空态文案存在。
- [ ] 运行目标测试确认失败。
- [ ] 实现日期/区块/项目筛选、日报/周报/复盘切换、来源说明和下载按钮。
- [ ] 运行 `npm test && npm run build`，提交 `feat: display injection operation reports`。

### Task 4: 验收

- [ ] 浏览器比较三方案、记录人工调整、生成并下载三种报告。
- [ ] 全量测试、构建、数据缺失和权限验收；不提交数据库、Excel、截图。
