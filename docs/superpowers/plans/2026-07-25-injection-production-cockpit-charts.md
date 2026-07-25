# 注采驾驶舱统计图增强 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 使用驾驶舱现有数据增加运行状态、区块生产效果和异常待办四张可下钻统计图。

**Architecture:** 在现有驾驶舱聚合函数内按最新井记录生成区块状态、区块效果和异常分布，不新增数据源或数据库结构。前端新增独立的纯函数图表配置模块，页面只负责加载数据、渲染 ECharts 和转发下钻事件。

**Tech Stack:** TypeScript、SQLite、React 19、ECharts 6、echarts-for-react、Tailwind CSS、node:test。

---

## 前置条件与文件结构

本计划在基础“注采驾驶舱”实现已合入的前提下执行；开始前必须确认以下文件存在：

- `src/lib/injectionProductionCockpit.ts`：驾驶舱查询与聚合。
- `src/components/InjectionProductionCockpit.tsx`：驾驶舱页面。
- `tests/injectionProductionCockpit.test.ts`：聚合测试。

新增和修改：

- Modify: `src/lib/injectionProductionCockpit.ts` — 增加三个图表聚合结果。
- Create: `src/lib/injectionProductionCockpitCharts.ts` — 图表标签、排序与 ECharts option 纯函数。
- Modify: `src/components/InjectionProductionCockpit.tsx` — 渲染四张图并处理下钻。
- Modify: `src/App.tsx` — 接收区块和异常筛选条件。
- Modify: `tests/injectionProductionCockpit.test.ts` — 后端聚合测试。
- Create: `tests/injectionProductionCockpitCharts.test.ts` — 图表配置与空数据测试。

### Task 1: 锁定并实现区块状态汇总

**Files:**
- Modify: `src/lib/injectionProductionCockpit.ts`
- Test: `tests/injectionProductionCockpit.test.ts`

- [ ] **Step 1: 写失败测试**

在现有临时数据库夹具中加入 A、B 两个区块，并添加：

```ts
test('groups latest well lifecycle counts by block without duplicates', async () => {
  const result = await buildInjectionProductionCockpit(db, { now: '2026-07-25' });
  assert.deepEqual(result.blockStatusSummary, [
    {
      block: 'A区',
      producing: 1,
      injecting: 1,
      soaking: 0,
      pendingTransfer: 0,
      needsData: 0,
    },
    {
      block: 'B区',
      producing: 0,
      injecting: 0,
      soaking: 1,
      pendingTransfer: 1,
      needsData: 1,
    },
  ]);
});
```

- [ ] **Step 2: 运行并确认失败**

Run:

```bash
node --import tsx --test tests/injectionProductionCockpit.test.ts
```

Expected: FAIL，`blockStatusSummary` 为 `undefined`。

- [ ] **Step 3: 扩展公开类型并做最小聚合**

在 `InjectionProductionCockpit` 增加：

```ts
blockStatusSummary: Array<{
  block: string;
  producing: number;
  injecting: number;
  soaking: number;
  pendingTransfer: number;
  needsData: number;
}>;
```

在遍历最新井记录时使用稳定的区块键：

```ts
const blockStatusMap = new Map<string, Record<InjectionLifecycleStatus, number>>();

function getBlockName(value: unknown) {
  const block = String(value || '').trim();
  return block || '未标注区块';
}

const block = getBlockName(row.block);
const blockCounts = blockStatusMap.get(block) || emptyDistribution();
blockCounts[status] += 1;
blockStatusMap.set(block, blockCounts);
```

返回前按中文区块名稳定排序：

```ts
const blockStatusSummary = [...blockStatusMap.entries()]
  .sort(([left], [right]) => left.localeCompare(right, 'zh-CN'))
  .map(([block, counts]) => ({ block, ...counts }));
```

- [ ] **Step 4: 运行测试并确认通过**

Run:

```bash
node --import tsx --test tests/injectionProductionCockpit.test.ts
```

Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add src/lib/injectionProductionCockpit.ts tests/injectionProductionCockpit.test.ts
git commit -m "feat: aggregate cockpit lifecycle status by block"
```

### Task 2: 增加区块效果与异常分布

**Files:**
- Modify: `src/lib/injectionProductionCockpit.ts`
- Test: `tests/injectionProductionCockpit.test.ts`

- [ ] **Step 1: 写失败测试**

```ts
test('aggregates block performance without converting missing values to zero', async () => {
  const result = await buildInjectionProductionCockpit(db, { now: '2026-07-25' });
  assert.deepEqual(result.blockPerformanceSummary, [
    { block: 'A区', dailyOil: 12.5, cumulativeOilGain: 86, oilSteamRatio: 0.42 },
    { block: 'B区', dailyOil: null, cumulativeOilGain: null, oilSteamRatio: null },
  ]);
});

test('returns every alert category in stable display order', async () => {
  const result = await buildInjectionProductionCockpit(db, { now: '2026-07-25' });
  assert.deepEqual(result.alertDistribution.map((item) => item.type), [
    'needsData',
    'notEvaluated',
    'lowEfficiency',
    'soakingOverdue',
    'transferOverdue',
  ]);
  assert.equal(
    result.alertDistribution.reduce((sum, item) => sum + item.count, 0),
    result.alerts.length,
  );
});
```

- [ ] **Step 2: 运行并确认失败**

Run:

```bash
node --import tsx --test tests/injectionProductionCockpit.test.ts
```

Expected: FAIL，两个新增属性尚不存在。

- [ ] **Step 3: 扩展类型**

```ts
blockPerformanceSummary: Array<{
  block: string;
  dailyOil: number | null;
  cumulativeOilGain: number | null;
  oilSteamRatio: number | null;
}>;
alertDistribution: Array<{
  type: 'needsData' | 'notEvaluated' | 'lowEfficiency' | 'soakingOverdue' | 'transferOverdue';
  count: number;
}>;
```

- [ ] **Step 4: 按区块聚合有效数值**

生产井的 `current_oil`、`cumulative_oil_gain` 在现有最新记录遍历中按区块累加，同时记录是否至少存在一个有效值。将周期油汽数据查询改为按井号关联区块的聚合查询：

```ts
const cycleRows = await db.all(`
  SELECT TRIM(mt.block) AS block,
         SUM(c.actual_steam) AS steam,
         SUM(c.cycle_oil) AS oil
  FROM measure_well_cycles c
  JOIN (
    SELECT * FROM (
      SELECT mt.*, ROW_NUMBER() OVER (
        PARTITION BY jh ORDER BY current_round_transfer_time DESC, id DESC
      ) AS row_number
      FROM measure_tracking mt
    ) WHERE row_number = 1
  ) mt ON TRIM(mt.jh) = TRIM(c.well_name)
  GROUP BY TRIM(mt.block)
`);
```

仅当 `steam > 0` 且 `oil` 有效时返回油汽比，否则返回 `null`。测试中使用四舍五入到两位小数的值，避免浮点噪声：

```ts
const ratio = steam > 0 && Number.isFinite(oil)
  ? Math.round((oil / steam) * 100) / 100
  : null;
```

- [ ] **Step 5: 由最终告警数组生成分布**

```ts
const alertTypes = [
  'needsData',
  'notEvaluated',
  'lowEfficiency',
  'soakingOverdue',
  'transferOverdue',
] as const;

const alertDistribution = alertTypes.map((type) => ({
  type,
  count: alerts.filter((alert) => alert.type === type).length,
}));
```

- [ ] **Step 6: 运行测试并确认通过**

Run:

```bash
node --import tsx --test tests/injectionProductionCockpit.test.ts
```

Expected: PASS。

- [ ] **Step 7: 提交**

```bash
git add src/lib/injectionProductionCockpit.ts tests/injectionProductionCockpit.test.ts
git commit -m "feat: aggregate cockpit performance and alerts"
```

### Task 3: 建立可测试的 ECharts 配置

**Files:**
- Create: `src/lib/injectionProductionCockpitCharts.ts`
- Create: `tests/injectionProductionCockpitCharts.test.ts`

- [ ] **Step 1: 写失败测试**

```ts
import {
  buildAlertDistributionOption,
  buildBlockPerformanceOption,
  buildBlockStatusOption,
  buildStatusDistributionOption,
} from '../src/lib/injectionProductionCockpitCharts';

test('sorts alerts descending and keeps zero categories', () => {
  const option = buildAlertDistributionOption([
    { type: 'needsData', count: 2 },
    { type: 'notEvaluated', count: 0 },
    { type: 'lowEfficiency', count: 4 },
    { type: 'soakingOverdue', count: 1 },
    { type: 'transferOverdue', count: 3 },
  ]);
  assert.deepEqual(option.yAxis.data, ['低效井', '待转抽逾期', '数据缺失', '焖井逾期', '未评价']);
  assert.deepEqual(option.series[0].data, [4, 3, 2, 1, 0]);
});

test('keeps missing performance values as null', () => {
  const option = buildBlockPerformanceOption([
    { block: 'A区', dailyOil: null, cumulativeOilGain: 20, oilSteamRatio: null },
  ]);
  assert.equal(option.series[0].data[0], null);
  assert.equal(option.series[2].data[0], null);
});
```

- [ ] **Step 2: 运行并确认失败**

Run:

```bash
node --import tsx --test tests/injectionProductionCockpitCharts.test.ts
```

Expected: FAIL，模块不存在。

- [ ] **Step 3: 实现四个纯函数**

创建并导出：

```ts
export function buildStatusDistributionOption(
  distribution: Record<InjectionLifecycleStatus, number>,
): EChartsOption;

export function buildBlockStatusOption(
  rows: InjectionProductionCockpit['blockStatusSummary'],
): EChartsOption;

export function buildBlockPerformanceOption(
  rows: InjectionProductionCockpit['blockPerformanceSummary'],
): EChartsOption;

export function buildAlertDistributionOption(
  rows: InjectionProductionCockpit['alertDistribution'],
): EChartsOption;
```

固定标签和颜色：

```ts
export const lifecycleMeta = {
  producing: { label: '生产', color: '#10b981' },
  injecting: { label: '正注', color: '#3b82f6' },
  soaking: { label: '焖井', color: '#f59e0b' },
  pendingTransfer: { label: '待转抽', color: '#8b5cf6' },
  needsData: { label: '数据待补全', color: '#94a3b8' },
} as const;
```

区块状态使用堆叠柱形；效果图使用两个柱形系列和右侧油汽比折线；异常图按数量降序、同数时按固定类型顺序排序。所有 tooltip 明确单位，`null` 原样传给 ECharts。

- [ ] **Step 4: 补充空数据测试**

```ts
test('reports whether a chart has displayable data', () => {
  assert.equal(hasChartValues([]), false);
  assert.equal(hasChartValues([0, null, undefined]), false);
  assert.equal(hasChartValues([0, 2, null]), true);
});
```

实现：

```ts
export function hasChartValues(values: Array<number | null | undefined>) {
  return values.some((value) => typeof value === 'number' && Number.isFinite(value) && value > 0);
}
```

- [ ] **Step 5: 运行测试和类型检查**

Run:

```bash
node --import tsx --test tests/injectionProductionCockpitCharts.test.ts
npm run lint
```

Expected: 图表测试 PASS；TypeScript 无本次新增错误。

- [ ] **Step 6: 提交**

```bash
git add src/lib/injectionProductionCockpitCharts.ts tests/injectionProductionCockpitCharts.test.ts
git commit -m "feat: add cockpit chart option builders"
```

### Task 4: 在驾驶舱渲染四张统计图

**Files:**
- Modify: `src/components/InjectionProductionCockpit.tsx`
- Modify: `src/App.tsx`
- Test: `tests/injectionProductionCockpitCharts.test.ts`

- [ ] **Step 1: 扩展页面类型和导航契约**

页面直接复用 `InjectionProductionCockpit` 类型，并将导航参数改为：

```ts
type CockpitNavigateFilters = {
  keyword?: string;
  block?: string;
  alertType?: InjectionProductionCockpit['alertDistribution'][number]['type'];
};

export function InjectionProductionCockpit({
  onNavigate,
}: {
  onNavigate: (
    tab: 'measures' | 'oilWellMap',
    filters?: CockpitNavigateFilters,
  ) => void;
}) { /* existing loading and error states */ }
```

- [ ] **Step 2: 增加统一图表卡组件**

```tsx
function ChartCard({
  title,
  empty,
  option,
  onEvents,
  className = '',
}: {
  title: string;
  empty: boolean;
  option: EChartsOption;
  onEvents?: Record<string, (params: any) => void>;
  className?: string;
}) {
  return (
    <section className={`app-card min-w-0 p-5 ${className}`}>
      <h3 className="font-bold text-slate-900">{title}</h3>
      {empty ? (
        <div className="grid h-72 place-items-center text-sm text-slate-400">数据待补全</div>
      ) : (
        <ReactECharts option={option} style={{ height: 288 }} onEvents={onEvents} />
      )}
    </section>
  );
}
```

- [ ] **Step 3: 按一屏均衡布局渲染**

```tsx
<section className="grid min-w-0 gap-4 lg:grid-cols-2 xl:grid-cols-7">
  <ChartCard
    className="xl:col-span-2"
    title="运行状态分布"
    option={statusOption}
    empty={!hasChartValues(Object.values(data.statusDistribution))}
  />
  <ChartCard
    className="xl:col-span-3"
    title="各区块生产效果"
    option={performanceOption}
    empty={!hasChartValues(performanceValues)}
    onEvents={{ click: handleBlockClick }}
  />
  <ChartCard
    className="xl:col-span-2"
    title="异常待办分布"
    option={alertOption}
    empty={!hasChartValues(data.alertDistribution.map((item) => item.count))}
    onEvents={{ click: handleAlertClick }}
  />
  <ChartCard
    className="lg:col-span-2 xl:col-span-7"
    title="各区块注采状态"
    option={blockStatusOption}
    empty={!hasChartValues(blockStatusValues)}
    onEvents={{ click: handleBlockClick }}
  />
</section>
```

点击处理只读取 ECharts 参数中的区块或异常类型映射：

```ts
const handleBlockClick = (params: { name?: string }) => {
  if (params.name) onNavigate('measures', { block: params.name });
};

const handleAlertClick = (params: { name?: string }) => {
  const alertType = alertLabelToType[params.name || ''];
  if (alertType) onNavigate('measures', { alertType });
};
```

- [ ] **Step 4: 在 App 中接收筛选**

沿用现有关键字下钻状态，增加区块和异常筛选状态；进入 `measures` 前先写入筛选，再切换标签：

```ts
const navigateFromCockpit = (
  tab: 'measures' | 'oilWellMap',
  filters: CockpitNavigateFilters = {},
) => {
  if (filters.keyword !== undefined) setMeasureTrackingKeyword(filters.keyword);
  if (filters.block !== undefined) setMeasureTrackingBlock(filters.block);
  if (filters.alertType !== undefined) setMeasureTrackingAlertType(filters.alertType);
  setActiveTab(tab);
};
```

异常类型过滤必须复用驾驶舱已经生成的告警井号集合，不在前端重新解释逾期规则。

- [ ] **Step 5: 验证组件构建**

Run:

```bash
npm run build
npm run lint
```

Expected: Vite build PASS；TypeScript 无本次新增错误。

- [ ] **Step 6: 提交**

```bash
git add src/components/InjectionProductionCockpit.tsx src/App.tsx
git commit -m "feat: render cockpit operational charts"
```

### Task 5: 全量验证和浏览器验收

**Files:**
- Modify only if verification exposes a defect in files touched by Tasks 1–4.

- [ ] **Step 1: 运行聚合和图表专项测试**

```bash
node --import tsx --test \
  tests/injectionProductionCockpit.test.ts \
  tests/injectionProductionCockpitCharts.test.ts
```

Expected: PASS。

- [ ] **Step 2: 运行全量测试与构建**

```bash
npm test
npm run lint
npm run build
```

Expected: 全部 PASS；若仓库存在与本次无关的基线错误，记录完整错误并用专项测试和触及文件检查证明没有新增错误。

- [ ] **Step 3: 启动开发服务**

```bash
npm run dev
```

打开“注采驾驶舱”，依次确认：

1. 四张图均来自接口真实数据。
2. 状态环图合计等于各状态指标卡合计。
3. 区块效果的有效数值与接口响应一致，缺失项不显示为零。
4. 异常图数量合计等于待办列表数量。
5. 点击区块和异常后进入注汽跟踪，并带入正确筛选。
6. 1280px 桌面为均衡首屏布局，768px 为两列，390px 为单列且无横向滚动。

- [ ] **Step 4: 检查最终差异**

```bash
git diff --check
git status --short
```

Expected: 无空白错误；只包含计划内文件和用户原有的未提交文件。

- [ ] **Step 5: 提交验证修复（仅在确有修复时）**

```bash
git add src/lib/injectionProductionCockpit.ts \
  src/lib/injectionProductionCockpitCharts.ts \
  src/components/InjectionProductionCockpit.tsx \
  src/App.tsx \
  tests/injectionProductionCockpit.test.ts \
  tests/injectionProductionCockpitCharts.test.ts
git commit -m "test: verify cockpit chart enhancements"
```

## 计划自检

- 四张图分别覆盖运行状态、区块状态、生产效果和异常待办。
- 数据来自现有驾驶舱数据源，没有数据库迁移或导入模板修改。
- 后端负责业务口径，前端只负责展示和下钻。
- 缺失数值始终保持 `null`，不会被渲染成虚假零值。
- 每个新增行为都有先失败、后通过的自动化测试。
