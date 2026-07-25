# 注汽业务菜单与注采状态地图升级 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 按注汽业务主线重构菜单，复用现有项目台账提供方案、施工和焖井转抽三个入口，并将油井位图升级为可筛选、可下钻的注采状态地图。

**Architecture:** 新建独立的 `injectionStatusMap` 聚合层，把最新有效项目、历史注汽跟踪、驾驶舱异常和井位坐标合成为只读地图数据；`server.ts` 只暴露路由。前端将现有 `OilWellMap` 改造成状态地图，复用标定、人工分类、缩放和底图能力；项目管理组件通过 `view` 参数复用同一项目台账。

**Tech Stack:** TypeScript、React 19、Express、SQLite、ECharts、Tailwind CSS、node:test。

---

## 文件结构

- Create: `src/lib/injectionStatusMap.ts` — 状态融合、筛选、统计与详情纯函数。
- Create: `tests/injectionStatusMap.test.ts` — 地图聚合、优先级、筛选与无坐标测试。
- Modify: `src/lib/sidebarNavigation.ts` — 业务流程菜单和新增 tab。
- Modify: `tests/sidebarNavigation.test.ts` — 菜单分组、顺序、旧标识兼容测试。
- Modify: `src/lib/oilWellMapMarkers.ts` — 生命周期颜色和状态图例元数据。
- Modify: `tests/oilWellMap.test.ts` — 新状态颜色与无假坐标测试。
- Modify: `server.ts` — 状态地图只读接口。
- Modify: `src/components/OilWellMap.tsx` — 注采状态地图筛选、统计、详情抽屉与无坐标列表。
- Modify: `src/components/InjectionProjectManagement.tsx` — `plan`、`construction`、`soakTransfer` 业务视图。
- Modify: `src/App.tsx` — 新 tab、页面标题、视图映射和地图下钻。
- Create: `tests/injectionStatusMapNavigation.test.ts` — 业务入口、下钻参数与视图映射测试。

### Task 1: 锁定注汽业务菜单

**Files:**
- Modify: `src/lib/sidebarNavigation.ts`
- Modify: `tests/sidebarNavigation.test.ts`

- [ ] **Step 1: 写失败测试**

```ts
test('uses the injection business flow as the measures navigation', () => {
  const measures = sidebarNavigationGroups.find((group) => group.key === 'injection');
  assert.deepEqual(measures?.items.map((item) => item.label), [
    '选井决策', '方案与计划', '施工监控', '焖井转抽', '生产响应', '效果评价',
  ]);
});

test('keeps system overview before cockpit and status map', () => {
  const overview = sidebarNavigationGroups.find((group) => group.key === 'overview');
  assert.deepEqual(overview?.items.map((item) => item.label), [
    '系统概览', '注汽驾驶舱', '注采状态地图', '井温监控',
  ]);
});
```

- [ ] **Step 2: 确认测试失败**

Run:

```bash
node --import tsx --test tests/sidebarNavigation.test.ts
```

Expected: FAIL，因为 `injection` 分组和三个项目业务 tab 尚不存在。

- [ ] **Step 3: 扩展 tab 和导航组**

在 `SidebarTab` 增加：

```ts
| 'injectionPlan'
| 'injectionConstruction'
| 'injectionSoakTransfer'
```

将原 `measures` 分组 key 改为 `injection`，但保留内部 tab：

```ts
{
  key: 'injection',
  label: '注汽管理',
  items: [
    { tab: 'measureWellSelection', label: '选井决策', icon: 'Target' },
    { tab: 'injectionPlan', label: '方案与计划', icon: 'ClipboardList' },
    { tab: 'injectionConstruction', label: '施工监控', icon: 'Activity' },
    { tab: 'injectionSoakTransfer', label: '焖井转抽', icon: 'TrendingUp' },
    { tab: 'measures', label: '生产响应', icon: 'ClipboardList' },
    { tab: 'measureAnalysis', label: '效果评价', icon: 'MessageSquare' },
  ],
}
```

将 `oilWellMap` 的显示文字改为“注采状态地图”。把 `occupancyAnalysis` 移入“专项监测”，把 `runtimeLogs` 放入“系统管理”；保留 `dashboard` 作为首个默认 tab。

- [ ] **Step 4: 运行测试并确认通过**

Run:

```bash
node --import tsx --test tests/sidebarNavigation.test.ts
```

Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add src/lib/sidebarNavigation.ts tests/sidebarNavigation.test.ts
git commit -m "feat: organize navigation by injection workflow"
```

### Task 2: 建立可测试的注采状态地图聚合层

**Files:**
- Create: `src/lib/injectionStatusMap.ts`
- Create: `tests/injectionStatusMap.test.ts`
- Modify: `src/lib/oilWellMapMarkers.ts`
- Modify: `tests/oilWellMap.test.ts`

- [ ] **Step 1: 写失败测试，锁定项目优先规则**

使用临时 SQLite 数据库创建最小的 `injection_projects`、`measure_tracking`、`well_map_markers`、`measure_well_cycles` 表：

```ts
test('uses the latest open project lifecycle before tracking status', async () => {
  const result = await buildInjectionStatusMap(db, { today: '2026-07-26' });
  assert.deepEqual(result.wells.find((well) => well.wellNo === 'A-1'), {
    wellNo: 'A-1', block: 'A区', station: null, xPercent: 21, yPercent: 34,
    lifecycleStatus: 'soaking', statusSource: 'project', planMonth: '2026-07',
    projectId: 2, owner: '张工', plannedStartDate: '2026-07-01', plannedEndDate: '2026-07-03',
    actualStartDate: null, actualEndDate: null, plannedTransferDate: '2026-07-10',
    overdueDays: 16, plannedSteam: 1800, actualSteam: null, currentOil: 4.2,
    cumulativeOilGain: 30, oilSteamRatio: 0.25, evaluation: 'B', alertTypes: ['soakingOverdue'],
  });
});

test('falls back to latest tracking when a well has no current project', async () => {
  const result = await buildInjectionStatusMap(db, { today: '2026-07-26' });
  assert.equal(result.wells.find((well) => well.wellNo === 'B-1')?.lifecycleStatus, 'producing');
  assert.equal(result.wells.find((well) => well.wellNo === 'B-1')?.statusSource, 'tracking');
});
```

- [ ] **Step 2: 确认失败**

Run:

```bash
node --import tsx --test tests/injectionStatusMap.test.ts
```

Expected: FAIL，模块不存在。

- [ ] **Step 3: 定义领域类型与聚合函数**

创建以下公开契约：

```ts
export type InjectionMapLifecycleStatus =
  | 'pending' | 'injecting' | 'soaking' | 'pendingTransfer'
  | 'producing' | 'closed' | 'needsData';

export type InjectionMapWell = {
  wellNo: string; block: string; station: string | null;
  xPercent: number | null; yPercent: number | null;
  lifecycleStatus: InjectionMapLifecycleStatus;
  statusSource: 'project' | 'tracking';
  planMonth: string | null; projectId: number | null; owner: string | null;
  plannedStartDate: string | null; plannedEndDate: string | null;
  actualStartDate: string | null; actualEndDate: string | null;
  plannedTransferDate: string | null; overdueDays: number | null;
  plannedSteam: number | null; actualSteam: number | null;
  currentOil: number | null; cumulativeOilGain: number | null;
  oilSteamRatio: number | null; evaluation: string | null; alertTypes: string[];
};

export async function buildInjectionStatusMap(
  db: DatabaseLike,
  options: { today: string },
): Promise<{ wells: InjectionMapWell[] }>;
```

每口井选择项目的 SQL 规则为未关闭项目优先、再按 `updated_at DESC, id DESC`；不存在未关闭项目时选择最新关闭项目。历史跟踪使用按 `jh` 的 `ROW_NUMBER() OVER (PARTITION BY jh ORDER BY current_round_transfer_time DESC, id DESC)`。项目映射：`pending`、`injecting`、`soaking`、`pendingTransfer`、`producing`、`closed` 保持原值；未知跟踪状态映射为 `needsData`。

- [ ] **Step 4: 增加筛选和统计纯函数测试**

```ts
test('filters map wells without creating fake coordinate markers', () => {
  const result = filterInjectionMapWells(wells, {
    block: 'A区', lifecycleStatus: 'soaking', planMonth: '2026-07',
    alertType: 'soakingOverdue', overdue: true, keyword: 'A-',
  });
  assert.deepEqual(result.mapWells.map((well) => well.wellNo), ['A-1']);
  assert.deepEqual(result.unlocatedWells.map((well) => well.wellNo), ['A-2']);
  assert.deepEqual(summarizeInjectionMap(result.mapWells, result.unlocatedWells), {
    total: 1, injecting: 0, soaking: 1, pendingTransfer: 0, producing: 0, alerts: 1, unlocated: 1,
  });
});
```

`filterInjectionMapWells` 先按所有条件过滤，再按 `xPercent`、`yPercent` 均为有限数且在 0–100 区间分为 `mapWells` 和 `unlocatedWells`。不创建坐标。

- [ ] **Step 5: 扩展颜色并测试**

```ts
assert.equal(resolveInjectionLifecycleColor('pending'), '#64748b');
assert.equal(resolveInjectionLifecycleColor('closed'), '#475569');
```

保持既有 `injecting`、`soaking`、`pendingTransfer`、`producing`、`needsData` 颜色不变。

- [ ] **Step 6: 运行测试**

Run:

```bash
node --import tsx --test tests/injectionStatusMap.test.ts tests/oilWellMap.test.ts
```

Expected: PASS。

- [ ] **Step 7: 提交**

```bash
git add src/lib/injectionStatusMap.ts src/lib/oilWellMapMarkers.ts tests/injectionStatusMap.test.ts tests/oilWellMap.test.ts
git commit -m "feat: aggregate injection status map data"
```

### Task 3: 暴露状态地图接口

**Files:**
- Modify: `server.ts`
- Modify: `tests/injectionStatusMap.test.ts`

- [ ] **Step 1: 写接口负载测试**

```ts
test('returns stable map filters and summary payload', () => {
  const payload = buildInjectionStatusMapResponse(result, {
    block: 'A区', lifecycleStatus: 'soaking', planMonth: '', alertType: '', overdue: 'true', keyword: '',
  });
  assert.deepEqual(Object.keys(payload).sort(), ['filters', 'mapWells', 'summary', 'unlocatedWells']);
  assert.equal(payload.summary.soaking, 1);
});
```

- [ ] **Step 2: 确认失败**

Run:

```bash
node --import tsx --test tests/injectionStatusMap.test.ts
```

Expected: FAIL，因为 `buildInjectionStatusMapResponse` 尚未导出。

- [ ] **Step 3: 实现响应构建与路由**

在聚合库导出 `buildInjectionStatusMapResponse`，只接受以下 query：

```ts
type InjectionStatusMapFilters = {
  block?: string;
  lifecycleStatus?: InjectionMapLifecycleStatus;
  planMonth?: string;
  alertType?: string;
  overdue?: 'true';
  keyword?: string;
};
```

在 `server.ts` 新增：

```ts
app.get('/api/injection-status-map', async (req, res) => {
  try {
    const result = await buildInjectionStatusMap(localDb, {
      today: new Date().toISOString().slice(0, 10),
    });
    res.json({ success: true, data: buildInjectionStatusMapResponse(result, req.query) });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error?.message || '注采状态地图数据加载失败' });
  }
});
```

保留 `/api/injection-production/cockpit/map-wells`，不改变驾驶舱已有调用。

- [ ] **Step 4: 运行专项测试**

Run:

```bash
node --import tsx --test tests/injectionStatusMap.test.ts tests/injectionProductionCockpit.test.ts
```

Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add server.ts src/lib/injectionStatusMap.ts tests/injectionStatusMap.test.ts
git commit -m "feat: expose injection status map API"
```

### Task 4: 升级地图页面

**Files:**
- Modify: `src/components/OilWellMap.tsx`
- Modify: `src/App.tsx`
- Modify: `tests/injectionStatusMapNavigation.test.ts`

- [ ] **Step 1: 写失败测试，锁定地图下钻参数**

```ts
test('maps status-map detail actions to existing tabs', () => {
  assert.deepEqual(getStatusMapNavigation('project', { projectId: 7, wellNo: 'A-1' }), {
    tab: 'injectionPlan', filters: { projectId: '7' },
  });
  assert.deepEqual(getStatusMapNavigation('production', { projectId: 7, wellNo: 'A-1' }), {
    tab: 'measures', filters: { keyword: 'A-1' },
  });
  assert.deepEqual(getStatusMapNavigation('evaluation', { projectId: 7, wellNo: 'A-1' }), {
    tab: 'measureAnalysis', filters: { keyword: 'A-1' },
  });
});
```

- [ ] **Step 2: 确认失败**

Run:

```bash
node --import tsx --test tests/injectionStatusMapNavigation.test.ts
```

Expected: FAIL，因为导航映射函数不存在。

- [ ] **Step 3: 改造 `OilWellMap` 为状态地图**

组件 props 改为：

```tsx
export function OilWellMap({
  isAdmin,
  onNavigate,
}: {
  isAdmin: boolean;
  onNavigate: (tab: SidebarTab, filters?: Record<string, string>) => void;
}) { /* ... */ }
```

替换旧的 `injectionStatuses` 请求为 `/api/injection-status-map`。增加受控筛选状态、重试按钮和以下 UI：

```tsx
<select value={filters.lifecycleStatus} onChange={...}>...</select>
<select value={filters.planMonth} onChange={...}>...</select>
<select value={filters.alertType} onChange={...}>...</select>
<label><input type="checkbox" checked={filters.overdue} onChange={...} />仅看逾期</label>
<input value={filters.keyword} placeholder="搜索井号" onChange={...} />
```

将最近一次成功响应保存在 `mapData`；后续请求失败时不清空 `mapData`，显示“状态地图数据加载失败”和“重试”按钮。首次请求失败时显示空错误态。局部字段为 `null` 时仍渲染井点和 `--`。

标题和说明改为“注采状态地图”。顶部状态条显示接口 `summary`。标点颜色按 `lifecycleStatus`，人工分类颜色只在没有生命周期数据时使用。点击标点打开详情抽屉；桌面使用 `fixed right-0 top-0 h-dvh w-full max-w-md`，移动端使用 `fixed inset-x-0 bottom-0 max-h-[80dvh]`。

无坐标井显示在独立列表，点击后选中并提示管理员使用现有标定模式补坐标。

- [ ] **Step 4: 实现项目、生产、评价下钻**

在新建的 `src/lib/injectionStatusMapNavigation.ts` 导出 `getStatusMapNavigation`。`App.tsx` 接收地图导航：

```tsx
<OilWellMap
  isAdmin={user?.role === 'admin'}
  onNavigate={(tab, filters = {}) => {
    if (tab === 'measures' || tab === 'measureAnalysis') setMeasureTrackingKeyword(filters.keyword || '');
    if (tab === 'injectionPlan') setInjectionProjectFilter({ projectId: filters.projectId || '' });
    setActiveTab(tab);
  }}
/>
```

若现有项目组件没有 `projectId` 筛选，新增可选 `initialProjectId?: string` prop，仅用于高亮/筛选项目，不改变列表默认行为。

- [ ] **Step 5: 运行专项测试与构建**

Run:

```bash
node --import tsx --test tests/injectionStatusMapNavigation.test.ts tests/oilWellMap.test.ts
npm run build
```

Expected: PASS。

- [ ] **Step 6: 提交**

```bash
git add src/components/OilWellMap.tsx src/App.tsx src/lib/injectionStatusMapNavigation.ts tests/injectionStatusMapNavigation.test.ts
git commit -m "feat: upgrade to injection status map"
```

### Task 5: 复用项目台账提供三个业务视图

**Files:**
- Modify: `src/components/InjectionProjectManagement.tsx`
- Modify: `src/App.tsx`
- Modify: `tests/injectionStatusMapNavigation.test.ts`

- [ ] **Step 1: 写失败测试**

```ts
test('maps each injection business tab to its project view', () => {
  assert.equal(getInjectionProjectView('injectionPlan'), 'plan');
  assert.equal(getInjectionProjectView('injectionConstruction'), 'construction');
  assert.equal(getInjectionProjectView('injectionSoakTransfer'), 'soakTransfer');
});
```

- [ ] **Step 2: 确认失败**

Run:

```bash
node --import tsx --test tests/injectionStatusMapNavigation.test.ts
```

Expected: FAIL，因为 tab 与项目视图尚未映射。

- [ ] **Step 3: 增加项目管理视图契约**

```ts
export type InjectionProjectView = 'plan' | 'construction' | 'soakTransfer';

export function InjectionProjectManagement({
  view = 'plan',
  initialProjectId = '',
}: {
  view?: InjectionProjectView;
  initialProjectId?: string;
}) { /* ... */ }
```

视图过滤规则：

```ts
const projectsForView = filteredProjects.filter((project) => {
  if (view === 'construction') return project.lifecycleStatus === 'pending' || project.lifecycleStatus === 'injecting';
  if (view === 'soakTransfer') return project.lifecycleStatus === 'soaking' || project.lifecycleStatus === 'pendingTransfer';
  return true;
});
```

`construction` 隐藏手工建项和月度导入，只保留状态、计划实际对比与项目表；`soakTransfer` 顶部显示逾期待办，并将待转抽、焖井中项目置顶；`plan` 保留所有现有计划导入和新建功能。

- [ ] **Step 4: 在 App 中映射入口**

```tsx
const projectView = getInjectionProjectView(activeTab);
{projectView && <InjectionProjectManagement view={projectView} initialProjectId={injectionProjectFilter.projectId} />}
```

页面标题分别显示“方案与计划”“施工监控”“焖井转抽”。

- [ ] **Step 5: 运行测试**

Run:

```bash
node --import tsx --test tests/injectionStatusMapNavigation.test.ts tests/injectionProjectStore.test.ts
```

Expected: PASS。

- [ ] **Step 6: 提交**

```bash
git add src/components/InjectionProjectManagement.tsx src/App.tsx src/lib/injectionStatusMapNavigation.ts tests/injectionStatusMapNavigation.test.ts
git commit -m "feat: add injection project workflow views"
```

### Task 6: 全量验证与浏览器验收

**Files:**
- Modify only files from Tasks 1–5 if verification finds a defect.

- [ ] **Step 1: 运行自动化测试**

```bash
npm test
```

Expected: PASS。

- [ ] **Step 2: 类型检查与构建**

```bash
npm run lint
npm run build
```

Expected: build PASS。若 `lint` 被既有错误阻断，记录完整基线并确认本次触及文件无新增错误。

- [ ] **Step 3: 浏览器验收**

Run:

```bash
npm run dev
```

依次确认：

1. 默认首页仍为系统概览。
2. 菜单分组和文字与确认的信息架构一致。
3. 三个项目入口复用同一项目台账且视图过滤正确。
4. 地图筛选影响标点、图例、统计和无坐标列表。
5. 项目状态优先于历史跟踪状态，详情显示来源。
6. 井点详情的项目、生产、评价下钻正确。
7. 管理员标定和人工分类仍能使用。
8. 1280px 桌面端右侧详情抽屉正常；390px 移动端为底部面板且无横向溢出。

- [ ] **Step 4: 最终差异检查**

```bash
git diff --check
git status --short
```

Expected: 无空白错误；不暂存或提交 `production.db`、Excel、浏览器输出或其他用户原有未提交文件。

- [ ] **Step 5: 提交验证修复（仅当产生修复时）**

```bash
git add src/lib/injectionStatusMap.ts src/lib/injectionStatusMapNavigation.ts src/lib/oilWellMapMarkers.ts src/components/OilWellMap.tsx src/components/InjectionProjectManagement.tsx src/lib/sidebarNavigation.ts src/App.tsx tests
git commit -m "test: verify injection navigation and status map"
```

## 计划自检

- 菜单、项目视图、地图数据融合、筛选、详情、下钻和移动端验收均有对应任务。
- 项目和历史跟踪的优先级、无坐标规则和缺失值语义在聚合层统一处理。
- 不引入实时施工采集、审批、预测、推荐、报告或角色化工作台。
- 每个新增行为先写失败测试，再写最小实现。
