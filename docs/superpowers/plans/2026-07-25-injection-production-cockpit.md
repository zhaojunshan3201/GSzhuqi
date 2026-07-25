# 注采一体化驾驶舱一期 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 使用现有 SQLite 与 Excel 数据，新增可下钻的注采驾驶舱、统一数据健康、状态地图和异常待办。

**Architecture:** 新建独立聚合库读取既有 `production`、`measure_tracking`、`measure_well_cycles`、`measure_well_imports` 与井位表；`server.ts` 仅提供只读路由。React 独立页面消费聚合接口，地图复用既有井位图。不得接入 Oracle、实时施工/锅炉数据，也不得更改 Excel 模板。

**Tech Stack:** TypeScript、Express、SQLite、React 19、Tailwind CSS、node:test。

---

## 文件结构

- Create: `src/lib/injectionProductionCockpit.ts` — 聚合、状态映射、数据健康、告警规则。
- Create: `src/components/InjectionProductionCockpit.tsx` — 驾驶舱页面。
- Create: `tests/injectionProductionCockpit.test.ts` — 数据层单元测试。
- Modify: `server.ts` — 索引和两个只读 API。
- Modify: `src/lib/sidebarNavigation.ts`、`src/App.tsx` — 导航、标题、下钻。
- Modify: `src/components/OilWellMap.tsx`、`src/lib/oilWellMapMarkers.ts` — 状态覆盖层。
- Modify: `tests/sidebarNavigation.test.ts`、`tests/oilWellMap.test.ts` — 前端纯逻辑测试。

### Task 1: 建立可测试的驾驶舱数据模型

**Files:**
- Create: `src/lib/injectionProductionCockpit.ts`
- Create: `tests/injectionProductionCockpit.test.ts`

- [ ] **Step 1: 写失败测试，锁定最新记录与生命周期状态**

```ts
test('uses the latest injection row for each well', async () => {
  const result = await buildInjectionProductionCockpit(db, { now: '2026-07-25' });
  assert.equal(result.statusDistribution.injecting, 1);
  assert.equal(result.statusDistribution.producing, 1);
  assert.deepEqual(result.mapWells.map((well) => [well.wellNo, well.status]), [
    ['A-1', 'injecting'], ['B-1', 'producing'],
  ]);
});
```

测试使用临时 SQLite 数据库，建立 `production`、`measure_tracking`、`measure_well_cycles`、`measure_well_imports` 和 `well_map_markers` 最小表；给 A-1 写入两条不同转抽日期记录。

- [ ] **Step 2: 运行并确认测试失败**

Run: `node --import tsx --test tests/injectionProductionCockpit.test.ts`

Expected: FAIL，模块 `../src/lib/injectionProductionCockpit.ts` 不存在。

- [ ] **Step 3: 实现最小公开契约**

在 `src/lib/injectionProductionCockpit.ts` 新增：

```ts
export type InjectionLifecycleStatus =
  | 'injecting' | 'soaking' | 'pendingTransfer' | 'producing' | 'needsData';

export type InjectionProductionCockpit = {
  generatedAt: string;
  dataFreshness: Array<{ source: 'production' | 'injectionTracking' | 'selection'; status: 'normal' | 'stale' | 'failed' | 'missing'; updatedAt: string | null; message: string }>;
  metrics: { producingWells: number; injectingWells: number; soakingWells: number; pendingTransferWells: number; dailyOil: number | null; cumulativeOilGain: number | null; oilSteamRatio: number | null };
  statusDistribution: Record<InjectionLifecycleStatus, number>;
  alerts: Array<{ id: string; type: 'needsData' | 'notEvaluated' | 'lowEfficiency' | 'soakingOverdue' | 'transferOverdue'; wellNo: string; block: string; message: string; target: 'measures' | 'oilWellMap' }>;
  mapWells: Array<{ wellNo: string; block: string; status: InjectionLifecycleStatus; evaluation: string | null }>;
};

export async function buildInjectionProductionCockpit(
  db: DatabaseLike,
  options: { now: string; syncStatus?: SyncStatusInput },
): Promise<InjectionProductionCockpit>;
```

SQL 必须按 `jh` 取 `current_round_transfer_time DESC, id DESC` 的最新记录。状态映射固定为：正注→`injecting`、焖井→`soaking`、转注→`pendingTransfer`、生产→`producing`、空值或未知→`needsData`。

- [ ] **Step 4: 运行测试并确认通过**

Run: `node --import tsx --test tests/injectionProductionCockpit.test.ts`

Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add src/lib/injectionProductionCockpit.ts tests/injectionProductionCockpit.test.ts
git commit -m "feat: add injection-production cockpit aggregation"
```

### Task 2: 增加指标、数据健康和异常待办

**Files:**
- Modify: `src/lib/injectionProductionCockpit.ts`
- Modify: `tests/injectionProductionCockpit.test.ts`

- [ ] **Step 1: 写失败测试**

```ts
test('returns null and a needs-data alert instead of a fake zero', async () => {
  const result = await buildInjectionProductionCockpit(db, { now: '2026-07-25' });
  assert.equal(result.metrics.dailyOil, null);
  assert.equal(result.alerts.some((alert) => alert.type === 'needsData'), true);
});

test('creates agreed overdue and low-efficiency alerts', async () => {
  const result = await buildInjectionProductionCockpit(db, { now: '2026-07-25' });
  assert.deepEqual(result.alerts.map((alert) => alert.type).sort(), [
    'lowEfficiency', 'soakingOverdue', 'transferOverdue',
  ]);
});
```

- [ ] **Step 2: 运行并确认失败**

Run: `node --import tsx --test tests/injectionProductionCockpit.test.ts`

Expected: FAIL，因为尚未计算指标和告警。

- [ ] **Step 3: 最小实现规则**

```ts
const SOAKING_OVERDUE_DAYS = 30;
const TRANSFER_OVERDUE_DAYS = 7;
const needsData = !row.current_status || !row.current_round_transfer_time ||
  (status === 'producing' && (row.current_oil == null || !row.evaluation));
```

- 只用最新记录统计生产、正注、焖井、待转抽井数。
- `dailyOil` 合计生产井非空 `current_oil`；没有可用值返回 `null`。
- `cumulativeOilGain` 合计生产井非空 `cumulative_oil_gain`；没有可用值返回 `null`。
- `oilSteamRatio = SUM(cycle_oil) / SUM(actual_steam)`；分子或分母无效返回 `null`。
- D 类生成 `lowEfficiency`；生产井无评价生成 `notEvaluated`；已有 `needsData` 时不得重复生成 `notEvaluated`。
- 焖井超过 30 天生成 `soakingOverdue`；转注超过 7 天生成 `transferOverdue`；无日期只生成 `needsData`。
- 数据健康读取生产最大 `rq`、注汽最大转抽日期、选井最大 `imported_at`；同步状态 `error` 时生产源只能是 `failed`。

- [ ] **Step 4: 运行测试并确认通过**

Run: `node --import tsx --test tests/injectionProductionCockpit.test.ts`

Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add src/lib/injectionProductionCockpit.ts tests/injectionProductionCockpit.test.ts
git commit -m "feat: add cockpit health and alert rules"
```

### Task 3: 接入只读 API

**Files:**
- Modify: `server.ts:25-31, 980-993, 3385-3402`
- Modify: `tests/injectionProductionCockpit.test.ts`

- [ ] **Step 1: 写失败测试，锁定返回负载**

```ts
assert.deepEqual(Object.keys(result).sort(), [
  'alerts', 'dataFreshness', 'generatedAt', 'mapWells', 'metrics', 'statusDistribution',
]);
assert.equal(result.dataFreshness.find((item) => item.source === 'production')?.status, 'failed');
```

- [ ] **Step 2: 运行并确认失败**

Run: `node --import tsx --test tests/injectionProductionCockpit.test.ts`

Expected: FAIL，因为同步状态尚未注入聚合结果。

- [ ] **Step 3: 新增路由和索引**

在索引初始化区添加 `measure_tracking(jh, current_round_transfer_time, id)`。在 `/api/sync/status` 附近添加：

```ts
app.get('/api/injection-production/cockpit', async (_req, res) => {
  try {
    res.json(await buildInjectionProductionCockpit(localDb, {
      now: new Date().toISOString().slice(0, 10),
      syncStatus: await getSyncStatus(),
    }));
  } catch (error: any) {
    res.status(500).json({ message: error?.message || '注采驾驶舱数据加载失败' });
  }
});

app.get('/api/injection-production/cockpit/map-wells', async (req, res) => {
  const cockpit = await buildInjectionProductionCockpit(localDb, {
    now: new Date().toISOString().slice(0, 10), syncStatus: await getSyncStatus(),
  });
  const block = typeof req.query.block === 'string' ? req.query.block : '';
  res.json({ success: true, data: cockpit.mapWells.filter((well) => !block || well.block === block) });
});
```

- [ ] **Step 4: 运行测试**

Run: `node --import tsx --test tests/injectionProductionCockpit.test.ts tests/wellTemperatureApi.test.ts`

Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add server.ts src/lib/injectionProductionCockpit.ts tests/injectionProductionCockpit.test.ts
git commit -m "feat: expose injection-production cockpit API"
```

### Task 4: 新增导航和驾驶舱页面

**Files:**
- Create: `src/components/InjectionProductionCockpit.tsx`
- Modify: `src/lib/sidebarNavigation.ts`
- Modify: `src/App.tsx:1-120, 6004-6046`
- Modify: `tests/sidebarNavigation.test.ts`

- [ ] **Step 1: 写失败测试**

```ts
test('places 注采驾驶舱 after 系统概览', () => {
  const overview = sidebarNavigationGroups.find((group) => group.key === 'overview');
  assert.deepEqual(overview?.items.slice(0, 2).map((item) => item.label), ['系统概览', '注采驾驶舱']);
});
```

- [ ] **Step 2: 运行并确认失败**

Run: `node --import tsx --test tests/sidebarNavigation.test.ts`

Expected: FAIL，导航尚未包含“注采驾驶舱”。

- [ ] **Step 3: 实现页面与下钻**

在 `SidebarTab` 加入 `injectionProductionCockpit`，并在 `overview` 的“系统概览”后加入：

```ts
{ tab: 'injectionProductionCockpit', label: '注采驾驶舱', icon: 'LayoutDashboard' },
```

组件请求 `/api/injection-production/cockpit`，必须分别显示 loading、错误和内容。按以下顺序渲染：数据健康条、七张指标卡、状态分布与待办、状态地图入口。`null` 指标只能显示“数据待补全”。

组件使用：

```tsx
export function InjectionProductionCockpit({ onNavigate }: {
  onNavigate: (tab: 'measures' | 'oilWellMap', filters?: Record<string, string>) => void;
}) { /* fetch and render */ }
```

待办调用 `onNavigate(alert.target, alert.target === 'measures' ? { keyword: alert.wellNo } : undefined)`；`App.tsx` 接收 `keyword` 并预填现有注汽跟踪关键字状态。

- [ ] **Step 4: 验证**

Run: `node --import tsx --test tests/sidebarNavigation.test.ts && npm run lint`

Expected: 导航测试 PASS；lint 若有既有错误，记录基线并确认本次触及文件无新增错误。

- [ ] **Step 5: 提交**

```bash
git add src/components/InjectionProductionCockpit.tsx src/lib/sidebarNavigation.ts src/App.tsx tests/sidebarNavigation.test.ts
git commit -m "feat: add injection-production cockpit page"
```

### Task 5: 在井位图叠加注汽状态

**Files:**
- Modify: `src/components/OilWellMap.tsx`
- Modify: `src/lib/oilWellMapMarkers.ts`
- Modify: `tests/oilWellMap.test.ts`

- [ ] **Step 1: 写失败测试**

```ts
test('maps each injection lifecycle to a stable color', () => {
  assert.equal(resolveInjectionLifecycleColor('injecting'), '#2563eb');
  assert.equal(resolveInjectionLifecycleColor('soaking'), '#f59e0b');
  assert.equal(resolveInjectionLifecycleColor('pendingTransfer'), '#8b5cf6');
  assert.equal(resolveInjectionLifecycleColor('producing'), '#16a34a');
  assert.equal(resolveInjectionLifecycleColor('needsData'), '#94a3b8');
});
```

- [ ] **Step 2: 运行并确认失败**

Run: `node --import tsx --test tests/oilWellMap.test.ts`

Expected: FAIL，函数不存在。

- [ ] **Step 3: 实现覆盖层**

导出 `resolveInjectionLifecycleColor`。在 `OilWellMap.tsx` 按区块请求 `/api/injection-production/cockpit/map-wells?block=...`；增加默认开启的“显示注采状态”开关。井有坐标且有生命周期状态时，状态色覆盖人工分类色；无状态井仍使用人工分类色。显示正注、焖井、待转抽、转抽生产、数据待补全图例；无坐标井显示数量和井号，不创建假坐标。

- [ ] **Step 4: 验证通过**

Run: `node --import tsx --test tests/oilWellMap.test.ts`

Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add src/components/OilWellMap.tsx src/lib/oilWellMapMarkers.ts tests/oilWellMap.test.ts
git commit -m "feat: overlay injection lifecycle on well map"
```

### Task 6: 全量验证与浏览器验收

**Files:**
- Modify: `docs/superpowers/specs/2026-07-25-injection-production-cockpit-design.md`（只在已确认的实现差异发生时）

- [ ] **Step 1: 执行自动化测试**

Run: `npm test`

Expected: PASS。

- [ ] **Step 2: 构建和类型检查**

Run: `npm run build && npm run lint`

Expected: build PASS；lint 若被开始前已有错误阻断，完整记录基线并确认无新增错误。

- [ ] **Step 3: 浏览器验收**

Run: `npm run dev`

依次确认：驾驶舱有七项指标/健康状态/待办；同步失败时不显示正常；待办可预填井号进入注汽跟踪；地图有状态色、图例、无坐标提示；注汽选井、注汽跟踪、注汽效果评价仍可访问。

- [ ] **Step 4: 提交验证后修复**

```bash
git add server.ts src lib tests docs
git commit -m "test: verify injection-production cockpit"
```

## 自检

- 所有一期需求都有对应任务。
- 数据源严格限于 SQLite 与 Excel。
- 每个新行为均先写失败测试。
- 缺失数据只显示“数据待补全”，不伪造成零。
