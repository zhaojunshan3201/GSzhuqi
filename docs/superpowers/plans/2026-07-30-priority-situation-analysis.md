# 重点情况分析与建议 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将“重点情况分析与建议”改造成六类真实生产异常的统一处置工作台，并让跟踪 Excel 与“措施跟踪”共享。

**Architecture:** 在 `src/lib/prioritySituationAnalysis.ts` 中集中实现可测试的业务口径，服务端从现有 SQLite 表读取六类来源并返回单一 DTO。前端新增独立页面组件，只负责筛选、排序、上传和跳转；跟踪表继续复用现有 `/api/measures/import` 与 `measure_tracking`，不建立重复数据表。

**Tech Stack:** React 19、TypeScript、Express、SQLite、ECharts、xlsx、Node test runner、Vite。

---

## 文件结构

- Create: `src/lib/prioritySituationAnalysis.ts` — 六类问题的类型、计算、风险排序和汇总。
- Create: `src/components/PrioritySituationAnalysis.tsx` — 选定方案 1 的页面结构与交互。
- Modify: `server.ts` — 聚合现有表、扩展 `/api/analysis/issues`、提供共享跟踪文件状态。
- Modify: `src/App.tsx` — 加载新 DTO、复用措施导入上传、挂载新组件和详情跳转。
- Modify: `src/index.css` — 仅补充该页面需要的布局和响应式样式。
- Create: `tests/prioritySituationAnalysis.test.ts` — 六类计算的纯函数单元测试。
- Create: `tests/prioritySituationApi.integration.test.ts` — 真实 SQLite 聚合接口测试。
- Create: `tests/prioritySituationAnalysisUi.test.ts` — 页面文案、筛选、空态和乱码防回归测试。
- Modify: `design-qa.md` — 记录方案 1 与浏览器实现的视觉对比结论。

### Task 1: 定义六类问题 DTO 与确定性计算

**Files:**
- Create: `src/lib/prioritySituationAnalysis.ts`
- Test: `tests/prioritySituationAnalysis.test.ts`

- [ ] **Step 1: 写失败的阈值与排序测试**

```ts
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildWaterCutIssues,
  buildInjectionPeriodIssues,
  calculateBlockDeclineRate,
  mergePriorityIssues,
} from '../src/lib/prioritySituationAnalysis.ts';

test('含水绝对偏差必须大于20个百分点并取7天内最近报产', () => {
  const issues = buildWaterCutIssues(
    [{ wellNo: '高3-1', date: '2026-07-10', waterCut: 68 }],
    [
      { wellNo: '高3-1', date: '2026-07-08', waterCut: 47 },
      { wellNo: '高3-1', date: '2026-06-30', waterCut: 10 },
    ],
  );
  assert.equal(issues.length, 1);
  assert.equal(issues[0].deviation, 21);
});

test('注汽同期同时保留大于20%和小于-20%的井', () => {
  const issues = buildInjectionPeriodIssues([
    { wellNo: '好井', currentAverageOil: 12.1, previousAverageOil: 10 },
    { wellNo: '差井', currentAverageOil: 7.9, previousAverageOil: 10 },
    { wellNo: '稳定井', currentAverageOil: 11, previousAverageOil: 10 },
  ]);
  assert.deepEqual(issues.map(item => item.wellNo), ['差井', '好井']);
});

test('区块递减率沿用年度折算口径', () => {
  assert.equal(calculateBlockDeclineRate(3650, 8, 365), 20);
});

test('统一清单按风险、偏差绝对值和日期排序', () => {
  const sorted = mergePriorityIssues([
    { id: 'a', severity: 'medium', deviation: 35, dataDate: '2026-07-29' },
    { id: 'b', severity: 'high', deviation: 21, dataDate: '2026-07-28' },
  ] as any);
  assert.deepEqual(sorted.map(item => item.id), ['b', 'a']);
});
```

- [ ] **Step 2: 运行测试并确认失败**

Run: `npm test -- --test-name-pattern="含水绝对偏差|注汽同期|区块递减率|统一清单"`

Expected: FAIL，提示 `prioritySituationAnalysis.ts` 不存在。

- [ ] **Step 3: 实现最小业务类型和计算**

```ts
export type PriorityCategory =
  | 'pump'
  | 'waterCut'
  | 'blockDecline'
  | 'soaking'
  | 'injectionPeriod'
  | 'restartTracking';

export type PrioritySeverity = 'high' | 'medium' | 'low';

export interface PriorityIssue {
  id: string;
  category: PriorityCategory;
  severity: PrioritySeverity;
  wellNo?: string;
  block?: string;
  comparison: string;
  deviation: number | null;
  deviationText: string;
  status: string;
  suggestion: string;
  dataDate: string | null;
  targetTab: string;
}

const DAY_MS = 86_400_000;
const dayDistance = (left: string, right: string) =>
  Math.abs(Date.parse(`${left}T00:00:00Z`) - Date.parse(`${right}T00:00:00Z`)) / DAY_MS;

export function buildWaterCutIssues(labRows: any[], productionRows: any[]): PriorityIssue[] {
  return labRows.flatMap(lab => {
    const candidates = productionRows
      .filter(row => row.wellNo === lab.wellNo && dayDistance(row.date, lab.date) <= 7)
      .sort((a, b) => dayDistance(a.date, lab.date) - dayDistance(b.date, lab.date));
    if (!candidates.length) return [];
    const production = candidates[0];
    const deviation = Math.abs(Number(lab.waterCut) - Number(production.waterCut));
    if (!(deviation > 20)) return [];
    return [{
      id: `waterCut:${lab.wellNo}:${lab.date}`,
      category: 'waterCut',
      severity: deviation >= 30 ? 'high' : 'medium',
      wellNo: lab.wellNo,
      block: lab.block || production.block || '',
      comparison: `化验 ${Number(lab.waterCut).toFixed(1)}% / 报产 ${Number(production.waterCut).toFixed(1)}%`,
      deviation,
      deviationText: `${deviation.toFixed(1)} 个百分点`,
      status: '含水偏差',
      suggestion: '核对化验样品与报产口径',
      dataDate: lab.date,
      targetTab: 'waterLab',
    }];
  });
}

export function calculateBlockDeclineRate(previousYearOil: number, monthlyAverageOil: number, yearDays: number) {
  if (!(previousYearOil > 0) || !Number.isFinite(monthlyAverageOil)) return null;
  return Number((((previousYearOil - monthlyAverageOil * yearDays) / previousYearOil) * 100).toFixed(1));
}

export function buildInjectionPeriodIssues(rows: any[]): PriorityIssue[] {
  return rows.flatMap(row => {
    if (!(row.previousAverageOil > 0) || !Number.isFinite(row.currentAverageOil)) return [];
    const change = ((row.currentAverageOil - row.previousAverageOil) / row.previousAverageOil) * 100;
    if (Math.abs(change) <= 20) return [];
    return [{
      id: `injectionPeriod:${row.wellNo}`,
      category: 'injectionPeriod',
      severity: change < -30 ? 'high' : change < -20 ? 'medium' : 'low',
      wellNo: row.wellNo,
      block: row.block || '',
      comparison: `本轮 ${row.currentAverageOil.toFixed(1)}t / 上轮 ${row.previousAverageOil.toFixed(1)}t`,
      deviation: change,
      deviationText: `${change > 0 ? '+' : ''}${change.toFixed(1)}%`,
      status: change > 0 ? '同期变好' : '同期变差',
      suggestion: change > 0 ? '持续跟踪增油效果' : '复核注汽参数和生产恢复',
      dataDate: row.dataDate || null,
      targetTab: 'measures',
    }];
  }).sort((a, b) => Math.abs(Number(b.deviation)) - Math.abs(Number(a.deviation)));
}

const severityRank = { high: 0, medium: 1, low: 2 };
export function mergePriorityIssues(items: PriorityIssue[]) {
  return [...items].sort((a, b) =>
    severityRank[a.severity] - severityRank[b.severity]
    || Math.abs(Number(b.deviation || 0)) - Math.abs(Number(a.deviation || 0))
    || String(b.dataDate || '').localeCompare(String(a.dataDate || '')));
}
```

- [ ] **Step 4: 补齐检泵、焖井和复产汇总纯函数**

在同一文件增加：

```ts
export function calculatePumpRecoveryRate(currentOil: number | null, beforeOil: number | null) {
  if (currentOil == null || beforeOil == null || beforeOil <= 0) return null;
  return Number(((currentOil / beforeOil) * 100).toFixed(1));
}

export function calculateSoakingDays(stopDate: string, asOfDate: string) {
  return Math.max(0, Math.floor((Date.parse(`${asOfDate}T00:00:00Z`) - Date.parse(`${stopDate}T00:00:00Z`)) / DAY_MS));
}

export function summarizeRestartTracking(rows: Array<{
  year: number; category: string; currentOil: number | null; producing: boolean;
}>) {
  return rows.reduce<Record<string, { year: number; category: string; wells: number; producingWells: number; totalOil: number; missingWells: number }>>(
    (summary, row) => {
      const key = `${row.year}:${row.category}`;
      const item = summary[key] ||= { year: row.year, category: row.category, wells: 0, producingWells: 0, totalOil: 0, missingWells: 0 };
      item.wells += 1;
      item.producingWells += row.producing ? 1 : 0;
      item.totalOil += row.currentOil ?? 0;
      item.missingWells += row.currentOil == null ? 1 : 0;
      return summary;
    },
    {},
  );
}
```

- [ ] **Step 5: 运行单元测试**

Run: `node --import tsx --test tests/prioritySituationAnalysis.test.ts`

Expected: PASS。

- [ ] **Step 6: 提交**

```bash
git add src/lib/prioritySituationAnalysis.ts tests/prioritySituationAnalysis.test.ts
git commit -m "feat: add priority situation calculations"
```

### Task 2: 服务端聚合六类真实数据

**Files:**
- Modify: `server.ts`
- Test: `tests/prioritySituationApi.integration.test.ts`

- [ ] **Step 1: 写带临时 SQLite 的失败集成测试**

测试库至少建立并写入：

- `production`
- `water_lab_records`
- `pump_tracking_uploads`
- `measure_tracking`
- `soak_transfer_report_rows`

测试请求：

```ts
const response = await fetch(`http://127.0.0.1:${port}/api/analysis/issues?asOf=2026-07-30`);
assert.equal(response.status, 200);
const body = await response.json() as any;
assert.equal(body.data.summary.waterCut, 1);
assert.equal(body.data.summary.soaking, 1);
assert.equal(body.data.waterCutIssues[0].deviation, 25);
assert.equal(body.data.soakingIssues[0].soakingDays, 25);
assert.equal(body.data.sourceStatus.tracking.fileName, '措施跟踪2026C.xlsx');
```

- [ ] **Step 2: 运行测试并确认失败**

Run: `node --import tsx --test tests/prioritySituationApi.integration.test.ts`

Expected: FAIL，因为旧接口没有六类 DTO。

- [ ] **Step 3: 在服务端实现数据查询**

在 `getIssueAnalysisData(asOfDate)` 中并行读取：

```ts
const [
  labRows,
  productionRows,
  pumpUpload,
  trackingRows,
  soakingRows,
] = await Promise.all([
  localDb.all(`SELECT jh AS wellNo, record_date AS date, water_cut AS waterCut, block FROM water_lab_records`),
  localDb.all(`SELECT jh AS wellNo, rq AS date, oil, water_cut AS waterCut, block FROM production WHERE rq >= date(?, '-370 days') AND rq <= ?`, [asOfDate, asOfDate]),
  localDb.get(`SELECT source_file, rows_json, created_at FROM pump_tracking_uploads ORDER BY id DESC LIMIT 1`),
  localDb.all(`SELECT * FROM measure_tracking WHERE batch_year IN (?, ?)`, [String(year), String(year - 1)]),
  localDb.all(`SELECT * FROM soak_transfer_report_rows ORDER BY stop_date`),
]);
```

要求：

- 检泵 Excel 继续使用现有字段识别逻辑，近 5 天产油从 `production` 计算。
- 区块按 `normalizeForecastBlock` 归类；上月平均日产油和上年总产油按区块查询。
- 正焖井排除已转抽/结束记录。
- 注汽同期使用 `measure_tracking.detail_json` 中的上轮日期与当前轮日期；两段采用相同有效生产天数。
- 缺少某来源时返回空数组和 `available: false`，接口整体仍返回 200。
- 跟踪文件状态从 `measure_tracking.source_batch` 和 `MAX(updated_at)` 返回。

- [ ] **Step 4: 返回稳定 DTO**

```ts
return {
  asOfDate,
  updatedAt: new Date().toISOString(),
  summary: {
    pump: pumpIssues.length,
    waterCut: waterCutIssues.length,
    blockDecline: blockDeclineIssues.length,
    soaking: soakingIssues.length,
    injectionPeriod: injectionPeriodIssues.length,
    restartTracking: restartIssues.length,
  },
  issues: mergePriorityIssues([
    ...pumpIssues,
    ...waterCutIssues,
    ...blockDeclineIssues,
    ...soakingIssues,
    ...injectionPeriodIssues,
    ...restartIssues,
  ]),
  blockDeclines,
  soakingWells,
  restartSummary,
  sourceStatus,
};
```

- [ ] **Step 5: 支持确定性的 `asOf` 参数**

```ts
const asOf = typeof req.query.asOf === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(req.query.asOf)
  ? req.query.asOf
  : await getLocalLatestDate() || new Date().toISOString().slice(0, 10);
const data = await getIssueAnalysisData(asOf);
```

- [ ] **Step 6: 运行集成测试**

Run: `node --import tsx --test tests/prioritySituationApi.integration.test.ts`

Expected: PASS，且子进程退出后临时目录被删除。

- [ ] **Step 7: 提交**

```bash
git add server.ts tests/prioritySituationApi.integration.test.ts
git commit -m "feat: aggregate priority situation data"
```

### Task 3: 复用措施跟踪上传并暴露共享文件状态

**Files:**
- Modify: `server.ts`
- Modify: `tests/prioritySituationApi.integration.test.ts`

- [ ] **Step 1: 写上传共享性失败测试**

```ts
const form = new FormData();
form.set('file', new Blob([workbookBytes]), '重点跟踪.xlsx');
const upload = await fetch(`http://127.0.0.1:${port}/api/measures/import?year=2026`, { method: 'POST', body: form });
assert.equal(upload.status, 200);

const analysis = await (await fetch(`http://127.0.0.1:${port}/api/analysis/issues?asOf=2026-07-30`)).json() as any;
assert.equal(analysis.data.sourceStatus.tracking.fileName, '重点跟踪.xlsx');

const measures = await (await fetch(`http://127.0.0.1:${port}/api/measures?year=2026`)).json() as any;
assert.ok(measures.data.rows.some((row: any) => row.jh === '高3-试1'));
```

- [ ] **Step 2: 运行测试并确认失败**

Run: `node --import tsx --test tests/prioritySituationApi.integration.test.ts --test-name-pattern="上传共享"`

Expected: FAIL，分析接口尚未返回同一 `source_batch`。

- [ ] **Step 3: 使用同一导入接口和表**

不新增上传端点和数据表。确保现有 `/api/measures/import` 将原始文件名写入 `measure_tracking.source_batch`；分析接口只读取：

```sql
SELECT source_batch AS fileName, MAX(updated_at) AS updatedAt
FROM measure_tracking
WHERE source_batch IS NOT NULL AND source_batch != ''
GROUP BY source_batch
ORDER BY updatedAt DESC
LIMIT 1
```

- [ ] **Step 4: 对必需字段失败返回明确消息**

复用现有预览解析器的缺失字段结果。错误响应必须包含具体字段，例如：

```json
{
  "success": false,
  "message": "跟踪表缺少必需字段：井号、措施类型/类别、年份或日期"
}
```

- [ ] **Step 5: 运行测试**

Run: `node --import tsx --test tests/prioritySituationApi.integration.test.ts`

Expected: PASS。

- [ ] **Step 6: 提交**

```bash
git add server.ts tests/prioritySituationApi.integration.test.ts
git commit -m "feat: share measure tracking upload with priority analysis"
```

### Task 4: 构建方案 1 页面组件

**Files:**
- Create: `src/components/PrioritySituationAnalysis.tsx`
- Create: `tests/prioritySituationAnalysisUi.test.ts`

- [ ] **Step 1: 写组件结构和乱码失败测试**

```ts
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = readFileSync('src/components/PrioritySituationAnalysis.tsx', 'utf8');

test('重点情况页面包含六类筛选、共享上传和两块辅助内容', () => {
  for (const label of ['检泵异常', '含水偏差', '区块递减', '正焖井', '注汽同期变化', '复产井跟踪']) {
    assert.match(source, new RegExp(label));
  }
  assert.match(source, /上传跟踪表/);
  assert.match(source, /重点异常处置清单/);
  assert.match(source, /上月递减率/);
  assert.match(source, /当前正焖井/);
});

test('重点情况组件不包含转义括号或常见乱码', () => {
  assert.doesNotMatch(source, /\\\\uff0[89]|锛|鍚|浜曞彿/);
});
```

- [ ] **Step 2: 运行测试并确认失败**

Run: `node --import tsx --test tests/prioritySituationAnalysisUi.test.ts`

Expected: FAIL，组件不存在。

- [ ] **Step 3: 实现组件公开接口**

```ts
interface PrioritySituationAnalysisProps {
  data: PrioritySituationData | null;
  loading: boolean;
  error: string;
  uploading: boolean;
  onRefresh: () => void;
  onUpload: (file: File) => void;
  onOpenIssue: (issue: PriorityIssue) => void;
}
```

组件实现：

- 顶部数据截止时间、刷新、上传和共享文件状态。
- 六个汇总按钮，`all` 为默认筛选。
- 统一表格，使用真实 DTO，不补模拟数据。
- 偏差正负使用语义色；“同期变好”为绿色，负向异常为红/橙。
- 空态显示具体缺少的数据来源。
- 底部 ECharts 横向条形图和正焖井表。
- 1440px 宽度下主表至少展示 8 列；小于 1024px 时允许表格容器内部横向滚动，但页面本身不横向溢出。

- [ ] **Step 4: 运行组件测试**

Run: `node --import tsx --test tests/prioritySituationAnalysisUi.test.ts`

Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add src/components/PrioritySituationAnalysis.tsx tests/prioritySituationAnalysisUi.test.ts
git commit -m "feat: add priority situation workspace"
```

### Task 5: 接入 App、上传和详情跳转

**Files:**
- Modify: `src/App.tsx`
- Modify: `src/index.css`
- Modify: `tests/prioritySituationAnalysisUi.test.ts`

- [ ] **Step 1: 写 App 接入失败测试**

```ts
const appSource = readFileSync('src/App.tsx', 'utf8');
assert.match(appSource, /PrioritySituationAnalysis/);
assert.match(appSource, /\/api\/analysis\/issues/);
assert.match(appSource, /\/api\/measures\/import/);
assert.doesNotMatch(appSource, /含水分布诊断[\s\S]{0,500}getPieOption/);
```

- [ ] **Step 2: 运行测试并确认失败**

Run: `node --import tsx --test tests/prioritySituationAnalysisUi.test.ts`

Expected: FAIL，旧页面仍存在。

- [ ] **Step 3: 替换旧 analysis JSX**

```tsx
{activeTab === 'analysis' && (
  <PrioritySituationAnalysis
    data={analysisData}
    loading={analysisLoading}
    error={analysisError}
    uploading={measureImporting}
    onRefresh={loadAnalysisChart}
    onUpload={handlePriorityTrackingUpload}
    onOpenIssue={handlePriorityIssueOpen}
  />
)}
```

删除旧的三个摘要卡、大饼图、高含水 Top10 和空的“重点措施建议”，只删除本次替换产生的无用引用和函数。

- [ ] **Step 4: 复用 `/api/measures/import` 上传**

`handlePriorityTrackingUpload(file)`：

1. 校验 `.xls/.xlsx`。
2. 用 `FormData` 调用 `/api/measures/import`。
3. 成功后并行刷新 `loadMeasures()` 与 `loadAnalysisChart()`。
4. 失败时把服务端具体缺失字段显示在分析页，不清空旧数据。

- [ ] **Step 5: 实现详情跳转映射**

```ts
const targetMap: Record<PriorityCategory, string> = {
  pump: 'pumpAnalysis',
  waterCut: 'waterLab',
  blockDecline: 'blockProduction',
  soaking: 'injectionSoakTransfer',
  injectionPeriod: 'measures',
  restartTracking: 'measures',
};
```

井号存在时同步设置已有的井号搜索/选择状态；区块问题跳转时同步选中对应统一区块。

- [ ] **Step 6: 添加最小样式**

仅增加 `.priority-*` 命名样式，复用项目已有颜色、圆角、阴影、按钮和表格规则。不要修改全局卡片体系。

- [ ] **Step 7: 运行测试与类型检查**

Run:

```bash
node --import tsx --test tests/prioritySituationAnalysisUi.test.ts
npm run lint
```

Expected: 全部 PASS。

- [ ] **Step 8: 提交**

```bash
git add src/App.tsx src/index.css tests/prioritySituationAnalysisUi.test.ts
git commit -m "feat: connect priority analysis workspace"
```

### Task 6: 回归测试与生产构建

**Files:**
- Modify only if a failing test identifies a regression.

- [ ] **Step 1: 运行重点功能测试**

Run:

```bash
node --import tsx --test \
  tests/prioritySituationAnalysis.test.ts \
  tests/prioritySituationApi.integration.test.ts \
  tests/prioritySituationAnalysisUi.test.ts \
  tests/measureImportUpload.test.ts \
  tests/soakTransferReport.test.ts \
  tests/blockProductionGeneratorUi.test.ts
```

Expected: PASS。

- [ ] **Step 2: 运行完整测试**

Run: `npm test`

Expected: PASS；如存在与本改动无关的既有失败，记录完整用例名，不修改无关模块。

- [ ] **Step 3: 运行类型检查和构建**

Run:

```bash
npm run lint
npm run build
```

Expected: 两条命令退出码均为 0。

### Task 7: 浏览器交互与设计 QA

**Files:**
- Modify: `design-qa.md`
- Create: `priority-situation-implementation.png`
- Create: `priority-situation-design-qa-comparison.png`

- [ ] **Step 1: 使用现有本地服务**

打开 `http://127.0.0.1:5001/`，进入“重点情况”。使用 Codex Desktop 的 in-app Browser，不切换到 Chrome 或 Playwright CLI。

- [ ] **Step 2: 在 1440×1024 验证主路径**

依次验证：

1. 六个分类按钮可筛选并恢复“全部”。
2. 上传按钮能选择 Excel；测试上传后文件名和更新时间更新。
3. “查看详情”跳转到对应已有页面。
4. 刷新后保留共享跟踪数据。
5. 数据缺失模块显示明确空态。
6. 页面无横向溢出、重叠、乱码。

- [ ] **Step 3: 检查控制台**

记录页面加载、筛选、上传和跳转过程中控制台 error/warning；新增错误必须修复。

- [ ] **Step 4: 捕获实现截图**

保存 1440×1024 同状态截图到：

`priority-situation-implementation.png`

- [ ] **Step 5: 创建同图对比证据**

将选定视觉源：

`C:\Users\31541\.codex\generated_images\019fa911-eb61-7eb0-9d6d-582de7e5aa65\call_v08TOEWFcPu2Srj8WWPhy0ob.png`

与实现截图按相同高度左右拼接为：

`priority-situation-design-qa-comparison.png`

- [ ] **Step 6: 执行设计 QA**

检查字体、间距、颜色、图标、表格密度、中文文案、主要区域比例和交互状态。任何 P0/P1/P2 必须修复并重新截图、重新比较。

- [ ] **Step 7: 更新 QA 报告**

`design-qa.md` 必须包含：

- source visual truth path
- implementation screenshot path
- viewport 与像素尺寸
- full-view comparison evidence
- focused table/header comparison evidence
- primary interactions tested
- console errors checked
- comparison history
- 最后一行精确为 `final result: passed`

- [ ] **Step 8: 最终验证**

Run:

```bash
npm run lint
npm run build
node --import tsx --test tests/prioritySituationAnalysis.test.ts tests/prioritySituationApi.integration.test.ts tests/prioritySituationAnalysisUi.test.ts
```

Expected: 全部 PASS。

- [ ] **Step 9: 提交 QA 证据**

```bash
git add design-qa.md priority-situation-implementation.png priority-situation-design-qa-comparison.png
git commit -m "docs: verify priority situation redesign"
```
