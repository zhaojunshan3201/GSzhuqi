# 智能注汽优化二期实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在现有数据上交付可解释的注窜治理、同类井匹配、四情景预测与最优运行推荐。

**Architecture:** 新增纯计算模块分别处理治理待办、相似度、预测和优化评分；API 只负责读取持久化数据并返回可追溯结果；前端在注窜台账和选井/方案页面展示结果与人工调整。

**Tech Stack:** TypeScript、SQLite、Express、React、ECharts、Node test runner。

---

### Task 1: 注窜治理闭环

**Files:**
- Modify: `src/lib/channelingProjectStore.ts`
- Modify: `server.ts`
- Modify: `src/components/ChannelingProjectManagement.tsx`
- Test: `tests/channelingGovernance.test.ts`

- [ ] 写失败测试：创建治理措施、按风险/超期排序待办、关闭项目必须有关闭依据。
- [ ] 运行：`node --import tsx --test tests/channelingGovernance.test.ts`，确认失败。
- [ ] 实现治理措施、处理状态、负责人、计划/实际日期、前后指标和关闭依据；新增 API 与台账待办视图。
- [ ] 运行目标测试和 `npm test`，提交 `feat: close channeling governance loop`。

### Task 2: 同类井可解释匹配

**Files:**
- Create: `src/lib/similarInjectionWells.ts`
- Create: `tests/similarInjectionWells.test.ts`
- Modify: `server.ts`
- Modify: `src/components/MeasureWellSelection.tsx`

- [ ] 写失败测试：相同区块/层系/工艺的井优先；缺失特征降低数据完整度但不伪造分数；返回评分构成。
- [ ] 运行目标测试确认失败。
- [ ] 实现加权相似度、Top 10、参数范围、案例效果、完整度与置信度；新增查询 API 和选井详情展示。
- [ ] 运行目标测试和 `npm test`，提交 `feat: match similar injection wells`。

### Task 3: 多情景预测

**Files:**
- Create: `src/lib/injectionScenarioForecast.ts`
- Create: `tests/injectionScenarioForecast.test.ts`
- Modify: `server.ts`
- Create: `src/components/InjectionOptimization.tsx`

- [ ] 写失败测试：自然递减、当前计划、稳产优化、风险约束四情景均遵守 `baseline + gain - channelingLoss - occupancyLoss`；未知损失返回 null/低置信度。
- [ ] 运行目标测试确认失败。
- [ ] 实现规则/案例优先、可用曲线拟合优先的预测器，输出 30/90/180 天曲线、假设、来源、完整度、置信度和滚动偏差。
- [ ] 新增 API、四曲线图和空态；运行测试与构建，提交 `feat: forecast injection production scenarios`。

### Task 4: 最优运行与可解释推荐

**Files:**
- Create: `src/lib/injectionOperationOptimizer.ts`
- Create: `tests/injectionOperationOptimizer.test.ts`
- Modify: `server.ts`
- Modify: `src/components/InjectionOptimization.tsx`

- [ ] 写失败测试：资源超限方案被淘汰；低波动、高净增油、低风险方案排序更高；推荐包含依据和可编辑参数。
- [ ] 运行目标测试确认失败。
- [ ] 实现三方案生成、锅炉/窗口/风险约束、多目标评分、规则与案例依据、人工调整及原因审计。
- [ ] 运行 `npm test && npm run build`，提交 `feat: recommend optimal injection operations`。

### Task 5: 二期验收

- [ ] 运行全量测试、构建和浏览器验收；确认缺失数据不伪造、治理闭环可操作、同类井可解释、预测四情景和三套方案可见。
- [ ] 不提交数据库、Excel、截图或浏览器临时文件。
