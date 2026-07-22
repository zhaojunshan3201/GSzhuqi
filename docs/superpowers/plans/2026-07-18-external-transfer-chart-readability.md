# 外输跟踪图表可读性优化 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在不更改外输数据导入、筛选或计算的前提下，让长日期范围易读，并通过颜色与线型区分各指标。

**Architecture:** 新增纯函数模块 `src/lib/externalTransferChart.ts`，集中生成 ECharts 配置并输出可测试的日期标签间隔。现有组件只保留上传、筛选和布局职责。

**Tech Stack:** React 19、TypeScript、ECharts 6、node:test。

---

## Files

- Create: `src/lib/externalTransferChart.ts` — 日期间隔与 ECharts 图表配置。
- Create: `tests/externalTransferChart.test.ts` — 配置和间隔测试。
- Modify: `src/components/ExternalTransferTracking.tsx` — 引用共享图表配置。

### Task 1: 写日期标签间隔的失败测试

**Files:**
- Create: `tests/externalTransferChart.test.ts`
- Create: `src/lib/externalTransferChart.ts`

- [ ] **Step 1: 添加测试**

```ts
import assert from 'node:assert/strict';
import test from 'node:test';
import { getDateLabelInterval } from '../src/lib/externalTransferChart.ts';

test('shows all labels for a short date range', () => {
  assert.equal(getDateLabelInterval(12), 0);
});

test('limits long date ranges to about twelve labels', () => {
  assert.equal(getDateLabelInterval(197), 17);
});

test('never creates a negative interval', () => {
  assert.equal(getDateLabelInterval(0), 0);
});
```

- [ ] **Step 2: 运行失败测试**

Run: `npm test -- tests/externalTransferChart.test.ts`

Expected: 因目标模块尚不存在而失败。

- [ ] **Step 3: 最小实现**

创建 `src/lib/externalTransferChart.ts`：

```ts
export function getDateLabelInterval(pointCount: number): number {
  return Math.max(0, Math.ceil(pointCount / 12) - 1);
}
```

- [ ] **Step 4: 验证测试通过**

Run: `npm test -- tests/externalTransferChart.test.ts`

Expected: 3 tests passed。

- [ ] **Step 5: 提交**

```bash
git add src/lib/externalTransferChart.ts tests/externalTransferChart.test.ts
git commit -m "feat: add adaptive external transfer date labels"
```

### Task 2: 写图表视觉系统的失败测试并实现

**Files:**
- Modify: `tests/externalTransferChart.test.ts`
- Modify: `src/lib/externalTransferChart.ts`

- [ ] **Step 1: 添加失败测试**

```ts
import { getExternalTransferChartOption } from '../src/lib/externalTransferChart.ts';

const daily = Array.from({ length: 20 }, (_, index) => ({
  date: `2026-01-${String(index + 1).padStart(2, '0')}`,
  liquid: index + 1,
  transfer: index + 2,
}));

test('keeps labels horizontal and distinguishes line series', () => {
  const option = getExternalTransferChartOption('测试', daily as any, [
    { name: '日液量总量', metric: 'liquid' },
    { name: '外输', metric: 'transfer' },
  ]);
  assert.deepEqual(option.xAxis.axisLabel, { interval: 1, rotate: 0, hideOverlap: true });
  assert.equal(option.series[0].lineStyle.type, 'solid');
  assert.equal(option.series[1].lineStyle.type, 'dashed');
  assert.notEqual(option.series[0].itemStyle.color, option.series[1].itemStyle.color);
  assert.equal(option.dataZoom[1].bottom, 14);
});

test('uses rounded bars and a matching secondary axis color', () => {
  const option = getExternalTransferChartOption('测试', daily as any, [
    { name: '日产油总量', metric: 'liquid', type: 'bar' },
    { name: '井数', metric: 'transfer', yAxisIndex: 1 },
  ], true);
  assert.deepEqual(option.series[0].itemStyle.borderRadius, [4, 4, 0, 0]);
  assert.equal(option.yAxis[1].axisLabel.color, option.series[1].itemStyle.color);
});
```

- [ ] **Step 2: 运行失败测试**

Run: `npm test -- tests/externalTransferChart.test.ts`

Expected: 因 `getExternalTransferChartOption` 未导出而失败。

- [ ] **Step 3: 实现配置函数**

在 `src/lib/externalTransferChart.ts` 导出 `ExternalTransferChartSeries<T>` 与 `getExternalTransferChartOption`。配置必须包含：

```ts
grid: { top: 78, right: dualAxis ? 58 : 24, bottom: 82, left: 54 },
dataZoom: [{ type: 'inside' }, { type: 'slider', height: 16, bottom: 14 }],
xAxis: { type: 'category', data: daily.map((item) => item.date),
  axisLabel: { interval: getDateLabelInterval(daily.length), rotate: 0, hideOverlap: true } },
```

按系列顺序使用 `#2563eb`、`#84cc16`、`#f59e0b`、`#8b5cf6`。折线使用 `symbol: 'circle'`、`symbolSize: 5`、`lineStyle: { width: 2.5, type: index === 0 ? 'solid' : 'dashed' }`；柱状使用 `itemStyle: { color, borderRadius: [4, 4, 0, 0] }`。双轴图右轴名称、标签和轴线颜色等于第二系列颜色。

- [ ] **Step 4: 验证测试通过**

Run: `npm test -- tests/externalTransferChart.test.ts`

Expected: 5 tests passed。

- [ ] **Step 5: 提交**

```bash
git add src/lib/externalTransferChart.ts tests/externalTransferChart.test.ts
git commit -m "feat: style external transfer chart series"
```

### Task 3: 将页面接入共享配置

**Files:**
- Modify: `src/components/ExternalTransferTracking.tsx`
- Modify: `tests/externalTransferChart.test.ts`

- [ ] **Step 1: 添加失败的组件接入断言**

```ts
import { readFile } from 'node:fs/promises';

test('external transfer page uses the shared chart helper', async () => {
  const source = await readFile(new URL('../src/components/ExternalTransferTracking.tsx', import.meta.url), 'utf8');
  assert.match(source, /getExternalTransferChartOption/);
  assert.doesNotMatch(source, /function chartOption/);
});
```

- [ ] **Step 2: 运行失败测试**

Run: `npm test -- tests/externalTransferChart.test.ts`

Expected: 当前组件仍定义 `function chartOption`，断言失败。

- [ ] **Step 3: 最小接入改动**

在组件中导入：

```ts
import { getExternalTransferChartOption, type ExternalTransferChartSeries } from '../lib/externalTransferChart';
```

将本地 `SeriesConfig` 改为 `type SeriesConfig = ExternalTransferChartSeries<Metric>`，删除本地 `chartOption`，并将六个 `chartOption(` 调用逐一替换为 `getExternalTransferChartOption(`。不得修改标题、指标、上传、筛选或页面布局。

- [ ] **Step 4: 验证接入与类型**

Run: `npm test -- tests/externalTransferChart.test.ts && npm run lint`

Expected: 图表测试全部通过，TypeScript 无错误。

- [ ] **Step 5: 提交**

```bash
git add src/components/ExternalTransferTracking.tsx tests/externalTransferChart.test.ts
git commit -m "refactor: share external transfer chart options"
```

### Task 4: 全量验证与可视化检查

**Files:** none

- [ ] **Step 1: 全量自动化验证**

Run: `npm test && npm run build`

Expected: 所有测试通过，Vite 构建成功。

- [ ] **Step 2: 使用现有 Excel 检查页面**

以不初始化 Oracle 的方式启动本地页面，上传已有的外输 Excel，在桌面宽度检查六张图：横轴标签不与缩放条重叠；首末日期可读；多系列图有不同颜色和线型；双轴右侧文字颜色匹配右轴系列。

- [ ] **Step 3: 检查提交范围**

Run: `git status --short`

Expected: 不添加数据库、工作簿或构建产物；仅保留用户原有的未提交变更和本任务文件。

## Self-review

- 覆盖性：任务 1–3 覆盖自适应标签、水平标签、缩放条留白、稳定配色、线型、柱状样式与双轴颜色；任务 4 覆盖自动化和视觉检查。
- 一致性：组件使用 `ExternalTransferChartSeries<Metric>`，而 `Metric` 保持现有 `ExternalTransferDaily` 的字段约束。
