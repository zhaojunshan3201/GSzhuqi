# 注窜项目日产油汇总两位小数 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让项目概览中的期初日产油合计、最新日产油合计、日产油合计变化固定显示两位小数。

**Architecture:** 保留汇总接口和计算结果的数字类型，仅在 `ChannelingProjectManagement` 的卡片渲染层增加两位小数格式化。其他计数和累计注汽量继续使用原有通用显示逻辑，缺失值继续显示“暂无数据”。

**Tech Stack:** React 19、TypeScript、Node.js test runner、JSDOM

---

### Task 1: 固定三项日产油汇总的显示精度

**Files:**
- Modify: `tests/channelingProjectSummaryInteractions.test.ts`
- Modify: `src/components/ChannelingProjectManagement.tsx`

- [ ] **Step 1: 写入失败的组件回归断言**

将测试汇总数据中的 `totalOilChange` 改为浮点误差值，并将三个字段的断言改为固定两位小数：

```ts
const summary = (id: number) => ({ projectId: id, start: '2026-07-08', end: '2026-08-06', range: { start: '2026-07-08', end: '2026-08-06' }, generatedAt: '2026-08-06T02:03:04.000Z', latestAvailableDate: '2026-08-06', relationCount: 3, activeRelationCount: 2, releasedRelationCount: 1, injectorCount: 2, producerCount: 2, uniqueWellCount: 3, cumulativeSteam: 120.5, initialTotalOil: 6.2, latestTotalOil: 8.2, totalOilChange: 0.29999999999999716, evaluatedCount: 1, latestEvaluationConclusion: '有效' });

assert.match(host.textContent || '', /最新日产油合计\s*8\.20/);
assert.match(host.textContent || '', /期初日产油合计\s*6\.20/);
assert.match(host.textContent || '', /日产油合计变化\s*0\.30/);
```

保留现有缺失值断言，证明 `null` 仍显示“暂无数据”。

- [ ] **Step 2: 运行目标测试并确认按预期失败**

Run:

```powershell
C:\node\npm.cmd test -- tests/channelingProjectSummaryInteractions.test.ts
```

Expected: FAIL，失败信息显示实际文本仍为 `8.2`、`6.2` 或原始浮点误差值，而不是两位小数字符串。

- [ ] **Step 3: 实现最小显示层格式化**

在 `src/components/ChannelingProjectManagement.tsx` 中增加：

```ts
const displayFixedTwoDecimals = (value: unknown) =>
  typeof value === 'number' && Number.isFinite(value) ? value.toFixed(2) : '暂无数据';
```

将卡片元组扩展为带可选格式标记：

```ts
const cards: [string, unknown, boolean?][] = summary ? [
  ['关系数量', summary.relationCount], ['有效关系数量', summary.activeRelationCount], ['已解除关系数量', summary.releasedRelationCount],
  ['注入井数量', summary.injectorCount], ['生产井数量', summary.producerCount], ['去重井数', summary.uniqueWellCount],
  ['累计注汽量', summary.cumulativeSteam],
  ['期初日产油合计', summary.initialTotalOil, true],
  ['最新日产油合计', summary.latestTotalOil, true],
  ['日产油合计变化', summary.totalOilChange, true],
  ['已评价次数', summary.evaluatedCount],
] : [];
```

渲染时只对带标记的三项使用新格式化函数：

```tsx
{cards.map(([label, value, fixedTwoDecimals]) => (
  <div key={label} className="rounded border border-slate-200 p-3">
    <span className="text-sm text-slate-500">{label}</span>
    <b className="mt-1 block">{fixedTwoDecimals ? displayFixedTwoDecimals(value) : displayNumber(value)}</b>
  </div>
))}
```

- [ ] **Step 4: 运行目标测试并确认通过**

Run:

```powershell
C:\node\npm.cmd test -- tests/channelingProjectSummaryInteractions.test.ts
```

Expected: PASS，目标文件全部测试通过。

- [ ] **Step 5: 运行类型检查和相关注窜测试**

Run:

```powershell
C:\node\npm.cmd test -- tests/channelingProjectSummaryInteractions.test.ts tests/channelingWorkspace.test.ts
C:\node\npm.cmd run build
```

Expected: 所有相关测试通过，生产构建成功。

- [ ] **Step 6: 提交实现**

```powershell
git add -- src/components/ChannelingProjectManagement.tsx tests/channelingProjectSummaryInteractions.test.ts docs/superpowers/plans/2026-08-08-channeling-project-oil-summary-decimals.md
git commit -m "fix: format channeling oil summaries"
```
