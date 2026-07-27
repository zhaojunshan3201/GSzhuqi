# 措施选井评分显示修复 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 清除措施选井页面导入提示和评分依据中的乱码问号，并直接说明四项分值及满分规则。

**Architecture:** 新增一个无 UI 依赖的格式化模块，统一处理历史导入错误兼容、数据源中文名称和评分依据文本。前端只负责调用格式化函数，后端新导入记录直接保存正确中文格式；评分算法保持不变。

**Tech Stack:** TypeScript、React 19、Node.js test runner、Express、Vite

---

## 文件结构

- Create: `src/lib/injectionSelectionFormatting.ts` — 措施选井导入提示和评分依据的纯格式化函数。
- Create: `tests/injectionSelectionFormatting.test.ts` — 旧乱码兼容与评分文本回归测试。
- Modify: `src/components/MeasureWellSelection.tsx` — 使用格式化函数并显示 100 分制规则。
- Modify: `server.ts` — 后续导入直接保存“第 N 行：原因”的正常中文。

### Task 1: 建立格式化函数与回归测试

**Files:**
- Create: `tests/injectionSelectionFormatting.test.ts`
- Create: `src/lib/injectionSelectionFormatting.ts`

- [ ] **Step 1: 写入失败测试**

创建 `tests/injectionSelectionFormatting.test.ts`：

```ts
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  formatSelectionImportError,
  formatSelectionScoreBreakdown,
  selectionSourceLabel,
} from '../src/lib/injectionSelectionFormatting.ts';

test('converts a persisted legacy selection import error to readable Chinese', () => {
  assert.equal(
    formatSelectionImportError('? 1178 ??阶段产油不能为空'),
    '第 1178 行：阶段产油不能为空',
  );
  assert.equal(
    formatSelectionImportError('第 8 行：井号不能为空'),
    '第 8 行：井号不能为空',
  );
});

test('labels selection sources in Chinese', () => {
  assert.equal(selectionSourceLabel('stage'), '阶段产油');
  assert.equal(selectionSourceLabel('daily'), '注汽日数据');
});

test('formats score components with separators and component maxima', () => {
  assert.equal(
    formatSelectionScoreBreakdown({
      oilSteamRatio: { score: 53.27, value: 0.12, maxScore: 60 },
      stageOil: { score: 9.06, value: 120, maxScore: 20 },
      stability: { score: 10, value: 1, maxScore: 10 },
      dailyCompleteness: { score: 9.58, value: 0.958, maxScore: 10 },
    }),
    '油汽比 53.27/60；阶段产油 9.06/20；稳定性 10/10；日数据完整性 9.58/10',
  );
});
```

- [ ] **Step 2: 运行测试并确认因缺少模块而失败**

Run:

```powershell
node --import tsx --test tests/injectionSelectionFormatting.test.ts
```

Expected: FAIL，错误包含 `ERR_MODULE_NOT_FOUND`。

- [ ] **Step 3: 实现最小格式化模块**

创建 `src/lib/injectionSelectionFormatting.ts`：

```ts
export type SelectionSourceType = 'stage' | 'daily';

export type SelectionScoreBreakdown = {
  oilSteamRatio: { score: number; value: number | null; maxScore: number };
  stageOil: { score: number; value: number | null; maxScore: number };
  stability: { score: number; value: number | null; maxScore: number };
  dailyCompleteness: { score: number; value: number | null; maxScore: number };
};

export function selectionSourceLabel(source: SelectionSourceType): string {
  return source === 'stage' ? '阶段产油' : '注汽日数据';
}

export function formatSelectionImportError(message: string): string {
  const legacy = /^\?\s*(\d+)\s*\?\?(.*)$/.exec(message.trim());
  return legacy ? `第 ${legacy[1]} 行：${legacy[2].trim()}` : message;
}

export function formatSelectionScoreBreakdown(parts: SelectionScoreBreakdown): string {
  return [
    `油汽比 ${parts.oilSteamRatio.score}/${parts.oilSteamRatio.maxScore}`,
    `阶段产油 ${parts.stageOil.score}/${parts.stageOil.maxScore}`,
    `稳定性 ${parts.stability.score}/${parts.stability.maxScore}`,
    `日数据完整性 ${parts.dailyCompleteness.score}/${parts.dailyCompleteness.maxScore}`,
  ].join('；');
}
```

- [ ] **Step 4: 运行格式化测试并确认通过**

Run:

```powershell
node --import tsx --test tests/injectionSelectionFormatting.test.ts
```

Expected: 3 tests PASS，0 failures。

- [ ] **Step 5: 提交格式化模块**

```powershell
git add src/lib/injectionSelectionFormatting.ts tests/injectionSelectionFormatting.test.ts
git commit -m "fix: format injection selection score details"
```

### Task 2: 接入前端和后端提示

**Files:**
- Modify: `src/components/MeasureWellSelection.tsx:1-120`
- Modify: `server.ts:3459-3463`
- Modify: `tests/measureWellSelectionView.test.ts`
- Modify: `tests/injectionSelectionApi.integration.test.ts`

- [ ] **Step 1: 增加前端和 API 失败测试**

在 `tests/measureWellSelectionView.test.ts` 增加：

```ts
test('renders readable import errors and an explicit 100-point score explanation', () => {
  const component = readFileSync(new URL('../src/components/MeasureWellSelection.tsx', import.meta.url), 'utf8');
  assert.match(component, /formatSelectionImportError/);
  assert.match(component, /formatSelectionScoreBreakdown/);
  assert.match(component, /总分为四项之和，满分 100 分/);
  assert.doesNotMatch(component, /导入错误\?/);
  assert.doesNotMatch(component, /score \?\? '-'\}\?/);
});
```

在 `tests/injectionSelectionApi.integration.test.ts` 的现有测试中，在服务启动后读取 `server.ts` 并确认不再持久化旧问号模板：

```ts
const serverSource = await import('node:fs/promises').then(({ readFile }) => readFile('server.ts', 'utf8'));
assert.doesNotMatch(serverSource, /`\? \$\{row\.rowNumber\} \?\?\$\{row\.reason\}`/);
assert.match(serverSource, /`第 \$\{row\.rowNumber\} 行：\$\{row\.reason\}`/);
```

- [ ] **Step 2: 运行相关测试并确认失败**

Run:

```powershell
node --import tsx --test tests/measureWellSelectionView.test.ts tests/injectionSelectionApi.integration.test.ts
```

Expected: FAIL，前端尚未调用格式化函数，后端仍含旧问号模板。

- [ ] **Step 3: 接入前端格式化和评分说明**

在 `src/components/MeasureWellSelection.tsx` 导入：

```ts
import {
  formatSelectionImportError,
  formatSelectionScoreBreakdown,
  selectionSourceLabel,
} from '../lib/injectionSelectionFormatting';
```

将 `PlanItem` 的定义补全为包含实际接口已经返回的评分明细：

```ts
type PlanItem = {
  id: number;
  rankNo: number;
  wellNo: string;
  score: number;
  suggestedSteam: number | null;
  recommendedBoiler: string | null;
  nitrogen: boolean;
  carbonDioxide: boolean;
  oilSteamRatio: number;
  stageOil: number;
  scoreBreakdown: Candidate['scoreBreakdown'];
  decision: PlanDecision;
  manualNote: string | null;
};
```

将导入状态文本替换为：

```tsx
{sources.map((source) => (
  <div key={`status-${source.sourceType}`}>
    {(source.skippedRowCount ?? 0) > 0 && (
      <span>{`${selectionSourceLabel(source.sourceType)}：跳过 ${source.skippedRowCount} 行`}</span>
    )}
    {source.errorMessages?.length ? (
      <span className="ml-3 text-red-700">
        {`导入错误：${source.errorMessages.map(formatSelectionImportError).join('；')}`}
      </span>
    ) : null}
  </div>
))}
```

在候选井表格说明中加入：

```tsx
<p className="mt-1 text-sm text-slate-500">
  评分依据：油汽比 60 分、阶段产油 20 分、稳定性 10 分、日数据完整性 10 分；总分为四项之和，满分 100 分。
</p>
```

将评分依据单元格替换为：

```tsx
<td className="px-3 py-3 text-xs text-slate-600">
  {formatSelectionScoreBreakdown(item.scoreBreakdown)}
</td>
```

- [ ] **Step 4: 修复后端后续导入的持久化格式**

在 `server.ts` 中将阶段产油和注汽日数据的两处错误映射统一改为：

```ts
errorMessages: parsed.skippedRows.map((row) => `第 ${row.rowNumber} 行：${row.reason}`)
```

数据库中已有的旧消息不做破坏性迁移，由前端格式化函数兼容展示。

- [ ] **Step 5: 运行相关测试并确认通过**

Run:

```powershell
node --import tsx --test tests/injectionSelectionFormatting.test.ts tests/measureWellSelectionView.test.ts tests/injectionSelectionApi.integration.test.ts
```

Expected: 所有相关测试 PASS，0 failures。

- [ ] **Step 6: 提交前后端接入**

```powershell
git add src/components/MeasureWellSelection.tsx server.ts tests/measureWellSelectionView.test.ts tests/injectionSelectionApi.integration.test.ts
git commit -m "fix: clarify injection selection scoring"
```

### Task 3: 完整验证

**Files:**
- Verify only; no planned production changes.

- [ ] **Step 1: 运行完整测试**

Run:

```powershell
npm test
```

Expected: 0 failures。

- [ ] **Step 2: 运行生产构建**

Run:

```powershell
npm run build
```

Expected: exit code 0，Vite 输出 `built`。

- [ ] **Step 3: 检查变更范围**

Run:

```powershell
git diff --check
git status --short
```

Expected: 无空白错误；只包含本计划文件、格式化模块、措施选井组件、后端提示和相关测试，以及工作区中执行前已经存在的用户改动。

- [ ] **Step 4: 浏览器验证**

打开 `http://localhost:3000`，进入“注汽管理 → 选井决策”，确认：

1. 导入提示显示 `阶段产油：跳过 1 行；导入错误：第 1178 行：阶段产油不能为空`。
2. 页面不显示无意义的 `?` 或 `??`。
3. 评分依据显示四项 `得分/满分`，用中文分号分隔。
4. 页面显示“总分为四项之和，满分 100 分”。
5. 候选井重建仍可成功，页面无红色错误提示。

- [ ] **Step 5: 最终提交（仅在仍有未提交的计划内变更时）**

```powershell
git add src/lib/injectionSelectionFormatting.ts src/components/MeasureWellSelection.tsx server.ts tests/injectionSelectionFormatting.test.ts tests/measureWellSelectionView.test.ts tests/injectionSelectionApi.integration.test.ts
git commit -m "fix: remove injection selection placeholder characters"
```
