# 已选井效果参考 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在月度注汽计划之前，为当前计划中的已选井展示停注汽后第 10 至 310 天的近三轮日产油、三轮指标和当前候选井同类井。

**Architecture:** 纯计算模块从阶段周期、生产日报和当前候选井生成参考数据；Express 接口确认井属于当前计划的纳入或锁定项后返回参考数据；React 选择一口计划井并显示三个面板。

**Tech Stack:** TypeScript、Express、SQLite、React、ECharts、Node.js test runner

---

## 文件结构

- Create: `src/lib/injectionSelectionReference.ts`：周期窗口、曲线和相似度纯计算。
- Create: `tests/injectionSelectionReference.test.ts`：计算回归测试。
- Modify: `server.ts`：计划井只读参考接口。
- Modify: `tests/injectionSelectionApi.integration.test.ts`：接口行为测试。
- Modify: `src/components/MeasureWellSelection.tsx`：选择器和三个展示面板。
- Modify: `tests/measureWellSelectionView.test.ts`：页面顺序和真实渲染测试。

### Task 1: 参考数据纯计算

**Files:**
- Create: `src/lib/injectionSelectionReference.ts`
- Create: `tests/injectionSelectionReference.test.ts`

- [ ] **Step 1: 写入失败测试**

创建测试，使用 `A-1` 的四个周期、日报点和候选井。断言最近三轮按停注汽日期降序；只保留停注汽后第 10 至 310 天；缺失日期没有零值点；没有停注汽日期或窗口日报时返回中文缺失原因；同类井排除 `A-1`、仅取前 10 口并按相似度降序。

```ts
const result = buildSelectedWellReference({ wellNo: 'A-1', stageRows, production, candidates });
assert.deepEqual(result.cycles.map((item) => item.cycleNo), [4, 3, 2]);
assert.deepEqual(result.cycles[0].points, [{ day: 10, oil: 1 }]);
assert.equal(result.cycles[0].metrics.stageOil, 40);
assert.equal(result.similarWells.length, 10);
assert.ok(result.similarWells.every((item) => item.wellNo !== 'A-1'));
```

- [ ] **Step 2: 确认 RED**

Run: `node --import tsx --test tests/injectionSelectionReference.test.ts`

Expected: FAIL，模块尚不存在。

- [ ] **Step 3: 实现最小计算模块**

导出：

```ts
export type ProductionOilPoint = { wellNo: string; date: string; oil: number | null };
export type SelectedWellReference = {
  wellNo: string;
  cycles: Array<{ cycleNo: number; stopInjectionDate: string; metrics: { stageOil: number; oilSteamRatio: number; steamVolume: number }; points: Array<{ day: number; oil: number }> }>;
  similarWells: Array<{ wellNo: string; similarity: number; score: number; oilSteamRatio: number; stageOil: number }>;
  missingReasons: string[];
};
export function buildSelectedWellReference(input: { wellNo: string; stageRows: readonly StageOilRow[]; production: readonly ProductionOilPoint[]; candidates: readonly SelectionCandidate[] }): SelectedWellReference;
```

规则：有效周期必须有 `endDate`、正周期注汽量和非负阶段产油；取最近三轮。将生产日期与 `endDate` 的自然日差限定为 `10..310`，仅保留有限非负油量，绝不补零。相似度只比较候选井的油汽比、阶段产油、稳定性和日数据完整性四项的归一化差异，输出 `round((1 - averageDistance) * 100)`，按相似度、评分、井号排序后取 10 口。

- [ ] **Step 4: 确认 GREEN**

Run: `node --import tsx --test tests/injectionSelectionReference.test.ts`

Expected: PASS，全部测试通过。

- [ ] **Step 5: 提交**

```powershell
git add src/lib/injectionSelectionReference.ts tests/injectionSelectionReference.test.ts
git commit -m "feat: build selected well reference data"
```

### Task 2: 计划井参考接口

**Files:**
- Modify: `server.ts`
- Modify: `tests/injectionSelectionApi.integration.test.ts`

- [ ] **Step 1: 写入失败 HTTP 测试**

在现有临时服务器测试中插入阶段周期、日报和计划，调用：

```ts
const response = await fetch(`http://127.0.0.1:${port}/api/injection-selection/plans/${plan.id}/reference?wellNo=A-1`);
assert.equal(response.status, 200);
const body = await response.json() as any;
assert.equal(body.data.wellNo, 'A-1');
assert.equal(body.data.cycles[0].points[0].day, 10);
assert.equal((await fetch(`http://127.0.0.1:${port}/api/injection-selection/plans/${plan.id}/reference?wellNo=not-in-plan`)).status, 404);
```

- [ ] **Step 2: 确认 RED**

Run: `node --import tsx --test tests/injectionSelectionApi.integration.test.ts`

Expected: FAIL，参考接口不存在。

- [ ] **Step 3: 注册只读接口**

在计划导出路由之前注册 `GET /api/injection-selection/plans/:planId/reference`。校验正整数计划 ID 和 `wellNo`；使用 `getPlanById` 查找该计划中 `included` 或 `locked` 的同名井，未找到返回 404；读取 `listStageRows`、`listDailyRows` 和 `production` 表中该井的 `jh AS wellNo, rq AS date, oil`；使用 `buildSelectionCandidates` 和 `buildSelectedWellReference` 返回 `{ success: true, data }`。参数错误返回 400，异常返回 500。

- [ ] **Step 4: 确认 GREEN**

Run: `node --import tsx --test tests/injectionSelectionApi.integration.test.ts`

Expected: PASS，计划井有参考数据，非计划井返回 404。

- [ ] **Step 5: 提交**

```powershell
git add server.ts tests/injectionSelectionApi.integration.test.ts
git commit -m "feat: expose selected well reference API"
```

### Task 3: 在计划表前展示参考区域

**Files:**
- Modify: `src/components/MeasureWellSelection.tsx`
- Modify: `tests/measureWellSelectionView.test.ts`

- [ ] **Step 1: 写入失败视图测试**

测试源码和 ReactDOMServer 渲染。断言页面含“已选井效果参考”“停注汽后天数”“近三轮关键指标”“当前候选井同类井”，并且“已选井效果参考”在“候选井与月度注汽计划”之前。使用一个参考数据对象渲染，断言 `第10天`、阶段产油、油汽比、周期注汽量、相似度；使用空点渲染，断言“停注汽后第10至310天缺少生产日报日产油数据”。

- [ ] **Step 2: 确认 RED**

Run: `node --import tsx --test tests/measureWellSelectionView.test.ts`

Expected: FAIL，区域和展示组件不存在。

- [ ] **Step 3: 实现状态与面板**

新增 `SelectedWellReference` 前端类型、`selectedPlanWells`、`selectedPlanWell` 和 `selectedReference`。`selectedPlanWells` 只包含 `included`、`locked` 项，默认第一口井。计划 ID 或选择井变化时请求：

```ts
requestJson<SelectedWellReference>(`/api/injection-selection/plans/${plan.id}/reference?${new URLSearchParams({ wellNo: selectedPlanWell })}`)
```

在月度计划 section 之前渲染 `SelectedWellReferencePanel`。该实际复用的无状态组件必须包含：

```tsx
<select aria-label="已选井" value={selectedWell} onChange={(event) => onSelectWell(event.target.value)} />
<ReactECharts option={{ xAxis: { name: '停注汽后天数' }, yAxis: { name: '日产油' }, series }} />
```

曲线 series 名称为 `第 N 轮（停注汽 YYYY-MM-DD）`。面板下方显示三轮指标表（轮次、停注汽日期、阶段产油、油汽比、周期注汽量）和同类井表（井号、相似度、评分、油汽比、阶段产油）。所有空状态均使用接口缺失原因或明确中文，不将缺失值变为 0。

- [ ] **Step 4: 确认 GREEN**

Run: `node --import tsx --test tests/measureWellSelectionView.test.ts`

Expected: PASS，真实渲染覆盖有数据与无数据状态。

- [ ] **Step 5: 提交**

```powershell
git add src/components/MeasureWellSelection.tsx tests/measureWellSelectionView.test.ts
git commit -m "feat: show selected well reference before plan"
```

### Task 4: 完整验证

**Files:** Verify only.

- [ ] **Step 1: 运行完整测试**

Run: `npm test`

Expected: 0 failures。

- [ ] **Step 2: 运行生产构建**

Run: `npm run build`

Expected: exit code 0，输出 `built`。

- [ ] **Step 3: 浏览器验证**

在 `http://localhost:3000` 生成计划后，确认参考区域位于计划表前；下拉框仅包含纳入/锁定井；曲线只显示停注汽后第 10 至 310 天有效点；三轮指标和前 10 口当前候选井同类井正确显示；无日报时出现中文原因而非零值曲线。

- [ ] **Step 4: 提交与范围检查**

```powershell
git diff --check
git status --short
git add src/lib/injectionSelectionReference.ts server.ts src/components/MeasureWellSelection.tsx tests/injectionSelectionReference.test.ts tests/injectionSelectionApi.integration.test.ts tests/measureWellSelectionView.test.ts
git commit -m "feat: add selected well production reference"
```

Expected: 无空白错误；只修改本计划规定的生产代码和测试。

