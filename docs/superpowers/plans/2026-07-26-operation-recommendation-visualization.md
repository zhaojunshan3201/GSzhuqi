# 最优运行推荐可视化实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 为 Top 3 运行推荐提供对比表、雷达、瀑布、参数柱状和风险稳定性散点图。

**Architecture:** 从已存在的推荐结果派生纯 ECharts option；组件仅渲染表格和图，不重新计算收益或风险。未知值保留 null，统一空态与 aria。

### Task 1: 图表数据与 Option 纯函数

**Files:**
- Create: `src/lib/injectionOperationRecommendationCharts.ts`
- Create: `tests/injectionOperationRecommendationCharts.test.ts`

- [ ] 写失败测试：五类图表的 series、未知值 null、最佳方案突出和 aria 文案。
- [ ] 运行目标测试确认失败。
- [ ] 实现雷达、瀑布、参数柱状、散点 option 与方案对比行数据。
- [ ] 运行 `npm test`，提交 `feat: chart operation recommendations`。

### Task 2: 优化页面图表与表格

**Files:**
- Modify: `src/components/InjectionOptimization.tsx`
- Test: `tests/injectionOperationRecommendationCharts.test.ts`

- [ ] 写失败测试：对比表及五图容器/空态存在。
- [ ] 运行测试确认失败。
- [ ] 引入 ReactECharts，渲染横向对比表、雷达、瀑布、参数柱状、散点；突出最优方案。
- [ ] 运行 `npm test && npm run build`，提交 `feat: visualize operation recommendation comparisons`。

### Task 3: 验收

- [ ] 浏览器检查大屏和移动端图表、tooltip、无数据空态与无障碍描述。
- [ ] 不提交数据库、截图或临时文件。
