# 注汽选井数据接入与自动计划 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 以“阶段产油”和“注汽日数据”Excel 为唯一选井数据源，自动重建候选井评分，并生成可人工调整、最多 30 口井的月度注汽计划。

**Architecture:** 新建独立的注汽选井数据层，分别保存周期记录、日记录、导入批次与计划快照。解析器将 Excel 转为统一领域对象，评分和计划服务只依赖这些对象；Express 暴露导入、重建、计划和导出接口，现有 React 页面消费这些接口。后续数据库同步只需实现同一导入服务的输入适配器。

**Tech Stack:** TypeScript、Express、SQLite、XLSX、React、Node test。

---

## 文件结构

- Create: `src/lib/injectionSelectionData.ts`：阶段/日数据类型、字段校验、Excel 解析、气体标记提取。
- Create: `src/lib/injectionSelectionStore.ts`：SQLite 建表、来源快照替换、读写周期/日记录、计划持久化。
- Create: `src/lib/injectionSelectionPlanner.ts`：候选井重建、透明评分、锅炉推荐、最多 30 口井的计划生成及导出行。
- Create: `tests/injectionSelectionData.test.ts`：两份工作簿解析、无效行、气体标记测试。
- Create: `tests/injectionSelectionPlanner.test.ts`：评分、锅炉推荐、30 口上限、人工调整测试。
- Create: `tests/injectionSelectionStore.test.ts`：最新来源快照替换和计划持久化测试。
- Modify: `server.ts`：初始化新表、注册上传/重建/计划/导出 API，并使驾驶舱读取新周期表。
- Modify: `src/components/MeasureWellSelection.tsx`：替换旧单文件导入 UI，展示数据状态、候选井、目标月计划与导出。
- Modify: `src/lib/injectionProductionCockpit.ts`：从新周期表聚合油汽比与最后导入时间。
- Modify: `tests/injectionProductionCockpit.test.ts`：验证驾驶舱采用新的周期数据。

### Task 1: 定义并解析两类 Excel 数据

**Files:**
- Create: `tests/injectionSelectionData.test.ts`
- Create: `src/lib/injectionSelectionData.ts`

- [ ] **Step 1: 写入阶段产油解析的失败测试**

```ts
test('parses a stage-oil workbook into normalized cycle rows', () => {
  const result = parseStageOilWorkbook(workbookWithRows([
    ['井号', '周期序号', '开注汽日期', '停注汽日期', '周期注汽量', '温度', '压力', '干度', '生产时间', '阶段产油', '阶段产水', '油汽比'],
    ['高105-1', 3, 45299, 45309, 1803, 349.6, 15.95, 75, 876.11, 750, 9509, 0.42],
  ]));
  assert.deepEqual(result.rows[0], {
    wellNo: '高105-1', cycleNo: 3, startDate: '2024-01-08', endDate: '2024-01-18',
    steamVolume: 1803, temperature: 349.6, pressure: 15.95, dryness: 75,
    productionHours: 876.11, stageOil: 750, stageWater: 9509, oilSteamRatio: 0.42,
  });
});
```

- [ ] **Step 2: 运行测试，确认因模块不存在失败**

Run: `node --import tsx --test tests/injectionSelectionData.test.ts`
Expected: FAIL，提示找不到 `injectionSelectionData.ts`。

- [ ] **Step 3: 写入最小阶段产油解析器**

实现 `parseStageOilWorkbook(workbook)`：读取首工作表、按去空白表头定位上述 12 列、将 Excel 序列日期和常见文本日期标准化为 `YYYY-MM-DD`；井号、周期序号、开注汽日期、周期注汽量、阶段产油为必填；返回 `{ rows, skippedRows }`，错误项包含 Excel 行号和中文原因。不要从旧 `measureWellImport.ts` 复用“区块/井站”必填规则。

- [ ] **Step 4: 扩展失败测试，覆盖日数据和气体识别**

```ts
test('collects boiler and nitrogen or carbon-dioxide flags from daily records', () => {
  const result = parseDailyInjectionWorkbook(workbookWithRows([
    ['井号', '日期', '锅炉编号1', '生产时间', '流量', '日注汽量', '设计注汽量', '累积注汽量', '压力', '干度', '温度', '备注2', '备注1', '备注'],
    ['高105-1', 45299, '高采活-4', 24, 7, 168, 1800, 259, 16, 75, 351, '注氮气', 'CO2辅助', ''],
  ]));
  assert.equal(result.rows[0].boilerNo, '高采活-4');
  assert.deepEqual(result.rows[0].gasFlags, { nitrogen: true, carbonDioxide: true });
});
```

- [ ] **Step 5: 实现日数据解析与气体关键词提取**

导出 `parseDailyInjectionWorkbook` 和 `detectGasFlags(...remarks)`；读取 `锅炉编号1`，若为空则使用 `锅炉编号2`；组合全部以“备注”开头的列，识别 `氮气`、`N2`、`二氧化碳`、`CO2`（不区分大小写）。日记录的井号、日期为必填，其余字段允许为空。

- [ ] **Step 6: 运行数据解析测试**

Run: `node --import tsx --test tests/injectionSelectionData.test.ts`
Expected: PASS。

- [ ] **Step 7: 提交**

```bash
git add src/lib/injectionSelectionData.ts tests/injectionSelectionData.test.ts
git commit -m "feat: parse injection stage and daily workbooks"
```

### Task 2: 保存来源快照及业务数据

**Files:**
- Create: `tests/injectionSelectionStore.test.ts`
- Create: `src/lib/injectionSelectionStore.ts`
- Modify: `server.ts:1070-1125`

- [ ] **Step 1: 写入来源快照替换的失败测试**

```ts
test('replaces only the current source snapshot and preserves the other source', async () => {
  await replaceSelectionSource(db, 'stage', '阶段产油.xlsx', [stageRow('A', 1)]);
  await replaceSelectionSource(db, 'daily', '注汽日数据.xlsx', [dailyRow('A', '2026-01-01')]);
  await replaceSelectionSource(db, 'stage', '阶段产油-更新.xlsx', [stageRow('B', 1)]);
  assert.deepEqual((await listStageRows(db)).map((row) => row.wellNo), ['B']);
  assert.deepEqual((await listDailyRows(db)).map((row) => row.wellNo), ['A']);
});
```

- [ ] **Step 2: 运行测试，确认失败**

Run: `node --import tsx --test tests/injectionSelectionStore.test.ts`
Expected: FAIL，提示缺少存储模块。

- [ ] **Step 3: 实现表与原子替换**

在 `initInjectionSelectionTables` 创建：

```sql
injection_selection_imports(id, source_type, source_file, imported_at, row_count);
injection_stage_rows(id, import_id, well_no, cycle_no, start_date, end_date, steam_volume, temperature, pressure, dryness, production_hours, stage_oil, stage_water, oil_steam_ratio, raw_json);
injection_daily_rows(id, import_id, well_no, record_date, boiler_no, production_hours, flow, daily_steam, design_steam, cumulative_steam, pressure, dryness, temperature, nitrogen, carbon_dioxide, remarks_json, raw_json);
injection_selection_plans(id, plan_month, generated_at, max_wells, status);
injection_selection_plan_items(id, plan_id, rank_no, well_no, score, suggested_steam, recommended_boiler, nitrogen, carbon_dioxide, source_json, decision, manual_note);
```

为 `stage_rows(well_no, start_date DESC, cycle_no DESC)`、`daily_rows(well_no, record_date)` 和 `plan_items(plan_id, rank_no)` 建索引。`replaceSelectionSource` 必须用事务删除同一 `source_type` 的旧业务行和导入记录，再插入新批次；另一来源不受影响。

- [ ] **Step 4: 在服务启动时初始化表**

在 `startServer` 的现有数据库初始化序列中调用 `await initInjectionSelectionTables(localDb)`，不删除现有 `measure_well_*` 表，保证旧功能在迁移期间可继续使用。

- [ ] **Step 5: 运行存储测试**

Run: `node --import tsx --test tests/injectionSelectionStore.test.ts`
Expected: PASS。

- [ ] **Step 6: 提交**

```bash
git add src/lib/injectionSelectionStore.ts tests/injectionSelectionStore.test.ts server.ts
git commit -m "feat: store injection selection source snapshots"
```

### Task 3: 重建候选井、评分及锅炉推荐

**Files:**
- Create: `tests/injectionSelectionPlanner.test.ts`
- Create: `src/lib/injectionSelectionPlanner.ts`

- [ ] **Step 1: 写入油汽比优先与排除不完整井的失败测试**

```ts
test('ranks eligible wells by oil-steam ratio and excludes incomplete latest cycles', () => {
  const candidates = buildSelectionCandidates([
    stage('A', 2, '2026-01-02', 1000, 600),
    stage('B', 2, '2026-01-02', 1000, 200),
    stage('C', 2, '2026-01-02', null, 300),
  ], []);
  assert.deepEqual(candidates.map((item) => item.wellNo), ['A', 'B']);
  assert.equal(candidates[0].scoreBreakdown.oilSteamRatio.score, 60);
  assert.match(candidates.excluded.find((item) => item.wellNo === 'C')!.reason, /周期注汽量/);
});
```

- [ ] **Step 2: 运行测试，确认失败**

Run: `node --import tsx --test tests/injectionSelectionPlanner.test.ts`
Expected: FAIL，提示缺少 `injectionSelectionPlanner.ts`。

- [ ] **Step 3: 实现可解释评分**

实现 `buildSelectionCandidates(stageRows, dailyRows)`：每井取最新有效周期，候选必须具备周期注汽量与阶段产油；若源表油汽比缺失则使用 `阶段产油 / 周期注汽量` 计算。评分固定为：油汽比 60 分、最近阶段产油 20 分、多周期油汽比稳定性 10 分、日数据完整性 10 分；所有相对指标在本次候选池内归一化。返回候选、排除井和每项分数/原始值，供 UI 和计划审计使用。

- [ ] **Step 4: 写入锅炉和气体标记的失败测试**

```ts
test('recommends the boiler with the best historical oil-steam result and aggregates gas flags', () => {
  const plan = createMonthlyPlan('2026-08', candidates, [
    daily('A', '2026-01-01', '炉-差', { nitrogen: true, carbonDioxide: false }),
    daily('A', '2026-01-02', '炉-优', { nitrogen: false, carbonDioxide: true }),
  ], boilerEffects([['炉-差', 0.2], ['炉-优', 0.8]]));
  assert.equal(plan.items[0].recommendedBoiler, '炉-优');
  assert.equal(plan.items[0].nitrogen, true);
  assert.equal(plan.items[0].carbonDioxide, true);
});
```

- [ ] **Step 5: 实现锅炉效果、计划与建议注汽量**

实现 `buildBoilerEffects(stageRows, dailyRows)`：以阶段开注至停注期间同井日记录的锅炉为关联，按锅炉的历史周期油汽比均值排序。`createMonthlyPlan(month, candidates, dailyRows, boilerEffects)` 取前 30 口；建议注汽量为该井最近三次有效周期注汽量的均值（不足三次则取有效历史均值）；合并该井全部日记录的气体标记；没有锅炉效果时填 `待人工指定`。

- [ ] **Step 6: 写入 30 口上限和人工调整的失败测试**

```ts
test('limits an automatic plan to 30 wells and retains a manual exclusion', () => {
  const plan = createMonthlyPlan('2026-08', Array.from({ length: 31 }, (_, i) => candidate(`W${i}`, 100 - i)), [], new Map());
  const adjusted = applyPlanDecision(plan, 'W0', 'excluded', '现场停井');
  assert.equal(plan.items.length, 30);
  assert.equal(adjusted.items[0].decision, 'excluded');
  assert.equal(adjusted.items[0].manualNote, '现场停井');
});
```

- [ ] **Step 7: 实现计划调整和导出行**

实现 `applyPlanDecision`，仅允许 `included`、`locked`、`excluded`；实现 `toPlanExportRows`，输出目标月份、顺序、井号、建议注汽量、评分、油汽比、阶段产油、推荐锅炉、氮气、二氧化碳、评分依据、人工决定和备注。

- [ ] **Step 8: 运行计划测试**

Run: `node --import tsx --test tests/injectionSelectionPlanner.test.ts`
Expected: PASS。

- [ ] **Step 9: 提交**

```bash
git add src/lib/injectionSelectionPlanner.ts tests/injectionSelectionPlanner.test.ts
git commit -m "feat: generate ranked monthly injection plans"
```

### Task 4: 暴露上传、重建、计划和导出 API

**Files:**
- Modify: `server.ts:3304-3322, 5220-5255`
- Modify: `tests/injectionSelectionStore.test.ts`

- [ ] **Step 1: 写入 API 所依赖服务调用的失败测试**

在存储测试中创建两份数据快照并断言 `savePlan` 后 `getPlan('2026-08')` 返回 30 条以内、保存的人工决定和 `source_json`。

- [ ] **Step 2: 运行测试，确认计划持久化尚未实现**

Run: `node --import tsx --test tests/injectionSelectionStore.test.ts`
Expected: FAIL，提示缺少 `savePlan` 或 `getPlan`。

- [ ] **Step 3: 完成计划持久化**

在 store 中实现 `savePlan` 和 `getPlan`。同一目标月份重新生成时创建新的计划快照并将旧计划状态置为 `superseded`；查询默认返回最新 `active` 计划。计划项目保存完整 `source_json`，使导出和人工审核可追溯。

- [ ] **Step 4: 注册 API 路由**

保留旧 `/api/measure-well-selection/import` 兼容路由，并新增：

```text
POST /api/injection-selection/import/stage
POST /api/injection-selection/import/daily
GET  /api/injection-selection/data-status
POST /api/injection-selection/rebuild
POST /api/injection-selection/plans
GET  /api/injection-selection/plans?month=YYYY-MM
PATCH /api/injection-selection/plans/:planId/items/:itemId
GET  /api/injection-selection/plans/:planId.xlsx
```

两个上传路由只接受 `.xlsx`，使用 Task 1 解析器和 `replaceSelectionSource`；重建路由读取当前快照并返回候选/排除明细；生成计划路由验证 `month` 是 `YYYY-MM`，保存计划；调整路由仅接受 `decision`、`manualNote`、`suggestedSteam`、`recommendedBoiler`；导出路由使用 `XLSX.utils.json_to_sheet(toPlanExportRows(plan))` 返回下载文件。

- [ ] **Step 5: 运行存储与计划测试**

Run: `node --import tsx --test tests/injectionSelectionStore.test.ts tests/injectionSelectionPlanner.test.ts`
Expected: PASS。

- [ ] **Step 6: 提交**

```bash
git add server.ts src/lib/injectionSelectionStore.ts tests/injectionSelectionStore.test.ts
git commit -m "feat: expose injection selection plan APIs"
```

### Task 5: 将驾驶舱油汽比切换到新周期数据

**Files:**
- Modify: `tests/injectionProductionCockpit.test.ts`
- Modify: `src/lib/injectionProductionCockpit.ts`

- [ ] **Step 1: 写入失败测试**

在驾驶舱数据层测试的 SQLite fixture 中新增 `injection_stage_rows`，插入 `steam_volume = 1000, stage_oil = 500` 的井周期，断言 `metrics.oilSteamRatio === 0.5`；不要插入旧 `measure_well_cycles` 记录。

- [ ] **Step 2: 运行测试，确认仍在查询旧表而失败**

Run: `node --import tsx --test tests/injectionProductionCockpit.test.ts`
Expected: FAIL，油汽比为 `null` 或不等于 `0.5`。

- [ ] **Step 3: 最小修改驾驶舱查询**

将 `injectionProductionCockpit.ts` 的周期查询替换为：

```sql
SELECT well_no, steam_volume, stage_oil
FROM injection_stage_rows
WHERE steam_volume > 0 AND stage_oil IS NOT NULL
```

用 `stage_oil / steam_volume` 计算总体与区块油汽比；更新数据新鲜度查询为 `injection_selection_imports` 中 `source_type = 'stage'` 的最大 `imported_at`。其余生命周期、日产油与告警逻辑保持不变。

- [ ] **Step 4: 运行驾驶舱测试**

Run: `node --import tsx --test tests/injectionProductionCockpit.test.ts tests/injectionProductionCockpitCharts.test.ts`
Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add src/lib/injectionProductionCockpit.ts tests/injectionProductionCockpit.test.ts
git commit -m "feat: use stage data for cockpit oil-steam ratio"
```

### Task 6: 重构选井页面为数据更新和计划工作台

**Files:**
- Modify: `src/components/MeasureWellSelection.tsx`
- Modify: `src/App.tsx`（仅当现有标签名称需要更新）

- [ ] **Step 1: 写入页面结构的静态失败测试**

在现有前端源文件测试或新建 `tests/measureWellSelectionView.test.ts` 中断言组件源码包含两个上传接口、计划生成接口和 Excel 导出 URL：

```ts
assert.match(source, /\/api\/injection-selection\/import\/stage/);
assert.match(source, /\/api\/injection-selection\/import\/daily/);
assert.match(source, /\/api\/injection-selection\/plans/);
assert.match(source, /\.xlsx/);
```

- [ ] **Step 2: 运行测试，确认旧页面未包含新接口而失败**

Run: `node --import tsx --test tests/measureWellSelectionView.test.ts`
Expected: FAIL。

- [ ] **Step 3: 实现数据更新区与计划加载**

删除旧的单一“导入 Excel”调用，新增“导入阶段产油”“导入注汽日数据”两个文件选择器。首屏调用 `GET /api/injection-selection/data-status`，显示文件名、导入时间、有效行数、错误行数；两份来源均已导入时显示“重建候选井”按钮。保留现有同类井和历史曲线区域，不修改其接口。

- [ ] **Step 4: 实现目标月计划表和人工调整**

默认目标月为当前日期的下一个自然月；调用重建 API 显示候选井和数据质量排除原因；调用计划生成 API 显示至多 30 条计划。表格列固定为：序号、井号、评分、油汽比、阶段产油、建议注汽量、推荐锅炉、氮气、二氧化碳、依据、决定、备注。允许编辑建议注汽量、推荐锅炉、决定和备注；失焦后 PATCH 保存。添加“导出计划 Excel”链接。

- [ ] **Step 5: 运行页面结构测试和类型检查**

Run: `node --import tsx --test tests/measureWellSelectionView.test.ts && npm run lint`
Expected: PASS。

- [ ] **Step 6: 构建前端并进行最终回归**

Run: `npm test && npm run build`
Expected: 所有测试和 Vite 构建均通过。

- [ ] **Step 7: 提交**

```bash
git add src/components/MeasureWellSelection.tsx src/App.tsx tests/measureWellSelectionView.test.ts
git commit -m "feat: add injection selection planning workspace"
```

## 计划自检

- 输入：阶段产油与日注汽数据均有专用解析、校验、快照和 UI 上传任务。
- 业务：油汽比优先、锅炉效果、氮气/二氧化碳标记、默认下月、最多 30 口、人工调整和 Excel 导出均有对应任务。
- 集成：驾驶舱改用新周期数据；未来数据库同步仅需复用 Task 1/2 的对象和存储接口。
- 验证：每个新增模块均先写失败测试，再实现最小代码并运行目标测试；最后执行全量测试、类型检查和构建。
