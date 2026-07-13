+# 措施选井模块 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (- [ ]) syntax for tracking.

**Goal:** 在“措施跟踪”上方新增措施选井，用历史注汽周期和生产数据评分、分级，并在同页查看近三轮曲线和参数。

**Architecture:** 使用独立的周期和评分快照表，不改写 production、measure_tracking 原始数据。纯函数负责区块内评分；Express 提供导入、重算、列表和详情；React 同页分栏切换井号。

**Tech Stack:** React、TypeScript、Express、SQLite、XLSX、ECharts、Node test runner。

---

## 文件结构

- Create: src/lib/measureWellSelection.ts — 评分、分级、曲线对齐。
- Create: src/lib/measureWellSelectionStore.ts — SQLite 表和查询。
- Create: src/components/MeasureWellSelection.tsx — 左列表、右曲线和参数表。
- Create: tests/measureWellSelection.test.ts — 评分和曲线纯函数测试。
- Create: tests/measureWellSelectionStore.test.ts — 去重及快照存储测试。
- Modify: server.ts — 数据表初始化、导入及 API。
- Modify: src/App.tsx — 导航和模块渲染。

### Task 1: 评分模型

**Files:**
- Create: tests/measureWellSelection.test.ts
- Create: src/lib/measureWellSelection.ts

- [ ] **Step 1: 编写失败测试**

~~~ts
import assert from 'node:assert/strict';
import test from 'node:test';
import { evaluateWells, alignOilCurve } from '../src/lib/measureWellSelection.ts';

test('高效井在同区块评分中排在前面', () => {
  const result = evaluateWells([
    { wellName: 'A', block: '高3', round: 1, transferDate: '2024-01-01', actualSteam: 1000, cycleOil: 300, peakOil: 5, oilSeeingDays: 2, pressure: 14, rate: 18, designSteam: 1000 },
    { wellName: 'A', block: '高3', round: 2, transferDate: '2025-01-01', actualSteam: 1000, cycleOil: 400, peakOil: 6, oilSeeingDays: 1, pressure: 14, rate: 18, designSteam: 1000 },
    { wellName: 'A', block: '高3', round: 3, transferDate: '2026-01-01', actualSteam: 1000, cycleOil: 500, peakOil: 7, oilSeeingDays: 1, pressure: 14, rate: 18, designSteam: 1000 },
    { wellName: 'B', block: '高3', round: 3, transferDate: '2026-01-01', actualSteam: 1000, cycleOil: 100, peakOil: 2, oilSeeingDays: 9, pressure: 18, rate: 7, designSteam: 1000 },
  ]);
  assert.equal(result[0].wellName, 'A');
  assert.equal(result[0].grade, 'recommended');
  assert.equal(result[0].scoreBreakdown.oilSteamRatio.max, 40);
});

test('按转抽日将生产曲线对齐为第零天', () => {
  assert.deepEqual(alignOilCurve('2026-01-10', [
    { date: '2026-01-09', oil: 1 }, { date: '2026-01-10', oil: 2 }, { date: '2026-01-12', oil: 5 },
  ]), [{ day: 0, oil: 2 }, { day: 2, oil: 5 }]);
});
~~~

- [ ] **Step 2: 运行并确认失败**

Run: npm test -- tests/measureWellSelection.test.ts

Expected: ERR_MODULE_NOT_FOUND，指向 src/lib/measureWellSelection.ts。

- [ ] **Step 3: 实现最小评分模块**

~~~ts
export const SCORE_WEIGHTS = { oilSteamRatio: 40, cycleOil: 20, peakOil: 15, oilSeeing: 10, injectionStability: 10, completeness: 5 } as const;
export type SelectionGrade = 'recommended' | 'candidate' | 'not_recommended' | 'incomplete';
export function alignOilCurve(transferDate: string, points: OilPoint[]) { /* 保留转抽日及之后点，返回 day 和 oil */ }
export function evaluateWells(cycles: SelectionCycle[]) { /* 按井和区块聚合，返回排序、明细、分级 */ }
~~~

实现 percentileScore(value, values, reverse)。仅正实际注汽量和非负周期产油计算油汽比；近三轮占油汽比基础的 70%；建议阈值为 75、备选阈值为 60；无有效油汽比的井标记 incomplete。

- [ ] **Step 4: 添加边界测试并验证**

新增 actualSteam 为 null 时返回 incomplete 且缺失原因包含“实际注汽量”；同分按井号排序；曲线缺失不写入零值。

Run: npm test -- tests/measureWellSelection.test.ts

Expected: all cases pass.

- [ ] **Step 5: 提交**

~~~bash
git add src/lib/measureWellSelection.ts tests/measureWellSelection.test.ts
git commit -m "feat: add measure well scoring model"
~~~

### Task 2: 周期数据与评分快照

**Files:**
- Create: src/lib/measureWellSelectionStore.ts
- Create: tests/measureWellSelectionStore.test.ts
- Modify: server.ts

- [ ] **Step 1: 写入失败的去重测试**

~~~ts
test('同井同轮周期写入更新而非重复', async () => {
  const db = await openTestDb();
  await initMeasureWellSelectionTables(db);
  await upsertSelectionCycles(db, [{ wellName: '高3-4-053', transferDate: '2026-01-01', round: 3, actualSteam: 2000, cycleOil: 662.4 }]);
  await upsertSelectionCycles(db, [{ wellName: '高3-4-053', transferDate: '2026-01-01', round: 3, actualSteam: 2100, cycleOil: 662.4 }]);
  assert.equal((await db.get('SELECT COUNT(*) AS count FROM measure_well_cycles')).count, 1);
});
~~~

- [ ] **Step 2: 运行并确认失败**

Run: npm test -- tests/measureWellSelectionStore.test.ts

Expected: ERR_MODULE_NOT_FOUND。

- [ ] **Step 3: 实现 SQLite 存储**

创建 measure_well_cycles（原始周期及上轮参数）、measure_well_scores（计算快照）、measure_well_imports（导入批次）。周期表使用 UNIQUE(well_name, transfer_date, round_no)，评分表保存 score_json 和 calculated_at。

~~~ts
export async function initMeasureWellSelectionTables(db: Database) { /* 三个 CREATE TABLE IF NOT EXISTS */ }
export async function upsertSelectionCycles(db: Database, cycles: StoredSelectionCycle[]) { /* INSERT ON CONFLICT DO UPDATE */ }
export async function replaceSelectionScores(db: Database, rows: EvaluatedWell[]) { /* transaction 写当前快照 */ }
export async function listSelectionWells(db: Database, filter: SelectionFilter) { /* 分级、区块和站点筛选 */ }
export async function getSelectionWellDetail(db: Database, wellName: string) { /* 近三轮和评分 */ }
~~~

- [ ] **Step 4: 初始化与验证**

在 server.ts 的既有 SQLite 初始化流程中调用 initMeasureWellSelectionTables(localDb)，不要在请求内建表。

Run: npm test -- tests/measureWellSelectionStore.test.ts && npm run lint

Expected: tests pass; TypeScript reports no errors.

- [ ] **Step 5: 提交**

~~~bash
git add server.ts src/lib/measureWellSelectionStore.ts tests/measureWellSelectionStore.test.ts
git commit -m "feat: persist measure well selection data"
~~~

### Task 3: 导入、重算和 API

**Files:**
- Modify: server.ts
- Modify: tests/measureWellSelection.test.ts

- [ ] **Step 1: 增加失败的 API 合约测试**

向测试库写入三轮周期和对应 production 日数据，断言列表接口返回建议井，详情接口返回三个 cycles、每轮 curve 和 scoreBreakdown。

~~~ts
const response = await fetch(baseUrl + '/api/measure-well-selection/wells?block=高3&grade=recommended');
assert.equal(response.status, 200);
assert.equal((await response.json()).items[0].wellName, '高3-4-053');
~~~

- [ ] **Step 2: 运行并确认路由为 404**

Run: npm test -- tests/measureWellSelection.test.ts

Expected: endpoint assertion fails with HTTP 404。

- [ ] **Step 3: 实现路由**

~~~text
POST /api/measure-well-selection/import/preview
POST /api/measure-well-selection/import
POST /api/measure-well-selection/recalculate
GET  /api/measure-well-selection/filters
GET  /api/measure-well-selection/summary
GET  /api/measure-well-selection/wells
GET  /api/measure-well-selection/wells/:wellName
~~~

复用现有 XLSX 和 multer，映射已确认的中文表头。导入响应返回 importedCount、updatedCount、skippedRows、unrecognizedHeaders。重算用 production.jh = well_name 且 production.rq >= transfer_date 读取日油、调用 evaluateWells、保存快照。详情仅按转抽时间倒序返回三轮。

- [ ] **Step 4: 验证与提交**

Run: npm test

Expected: all test files pass.

~~~bash
git add server.ts tests/measureWellSelection.test.ts
git commit -m "feat: expose measure well selection APIs"
~~~

### Task 4: 同页选井界面

**Files:**
- Create: src/components/MeasureWellSelection.tsx
- Modify: src/App.tsx
- Modify: tests/measureWellSelection.test.ts

- [ ] **Step 1: 写入失败的选中井状态测试**

~~~ts
assert.equal(selectWellId(['高3-4-053', '高3-3-072'], '高3-3-072'), '高3-3-072');
assert.equal(selectWellId(['高3-4-053'], '不存在'), '高3-4-053');
~~~

Run: npm test -- tests/measureWellSelection.test.ts

Expected: selectWellId is not exported.

- [ ] **Step 2: 创建分栏组件**

组件 props 为 type MeasureWellSelectionProps = { apiBaseUrl: string }。加载统计、筛选和列表；首口井赋给 selectedWellName。点击行只执行 setSelectedWellName(wellName) 及详情请求，不更新路由或 window.location。右侧 ECharts 使用每轮的 day、oil 点画线，空曲线显示“数据缺失”；下方表格显示三轮全部已确认字段。

- [ ] **Step 3: 接入 App.tsx**

将 'measureWellSelection' 加入 activeTab 联合类型。直接在现有“措施跟踪” SidebarItem 前加入：

~~~tsx
<SidebarItem icon={Target} label="措施选井" active={activeTab === 'measureWellSelection'} onClick={() => setActiveTab('measureWellSelection')} />
~~~

主内容区加入：

~~~tsx
{activeTab === 'measureWellSelection' && <MeasureWellSelection apiBaseUrl="" />}
~~~

导入 Lucide Target 图标，不改动任何已有 tab 条件。

- [ ] **Step 4: 构建、人工验收和提交**

Run: npm run lint && npm run build

Expected: both commands exit 0.

Run: npm run dev

Expected: “措施选井”紧邻并位于“措施跟踪”上方；连续点击三个井号时 URL 不变，右侧曲线、参数表和高亮原位更新。

~~~bash
git add src/App.tsx src/components/MeasureWellSelection.tsx tests/measureWellSelection.test.ts
git commit -m "feat: add measure well selection workspace"
~~~

### Task 5: 最终回归

- [ ] **Step 1: 执行完整自动验证**

Run: npm test && npm run lint && npm run build

Expected: tests pass, type check has no errors, and Vite build succeeds.

- [ ] **Step 2: 按需求核验**

确认入口位于措施跟踪上方；历史油汽比和上轮参数参与评分；有前 20 与四种分级；列表不跳页；右上有三轮采油曲线；右下有三轮注汽参数；缺失数据、导入反馈和去重均可见。

- [ ] **Step 3: 仅提交本任务产生的修复**

~~~bash
git add server.ts src/App.tsx src/components/MeasureWellSelection.tsx src/lib/measureWellSelection.ts src/lib/measureWellSelectionStore.ts tests/measureWellSelection.test.ts tests/measureWellSelectionStore.test.ts
git commit -m "fix: verify measure well selection workflow"
~~~
