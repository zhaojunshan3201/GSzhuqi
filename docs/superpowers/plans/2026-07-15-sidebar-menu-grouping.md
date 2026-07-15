# Sidebar Menu Grouping Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将侧边栏的 15 个现有页面入口改为五个自动跟随当前页面展开状态的手风琴分类。

**Architecture:** 在 `src/lib/sidebarNavigation.ts` 中维护唯一的分类菜单配置，并导出根据 `activeTab` 查找分类的纯函数。`App.tsx` 继续保有页面状态与图标映射，仅以配置数据渲染手风琴分类和既有 `SidebarItem`，避免更改页面切换逻辑。

**Tech Stack:** React 19、TypeScript、Tailwind CSS、Node.js 内置测试运行器（`node:test`）。

---

## File structure

- Create: `src/lib/sidebarNavigation.ts` — 五个菜单分类、15 个栏目及栏目到分类的查询函数。
- Create: `tests/sidebarNavigation.test.ts` — 分类顺序、栏目归属和查询行为的单元测试。
- Modify: `src/App.tsx:1-32, 2129, 5814-5936` — 导入配置，维护展开分类状态，并把扁平侧栏替换为手风琴渲染。

### Task 1: Define and test the navigation configuration

**Files:**
- Create: `tests/sidebarNavigation.test.ts`
- Create: `src/lib/sidebarNavigation.ts`

- [ ] **Step 1: Write the failing configuration test**

Create `tests/sidebarNavigation.test.ts`:

```ts
import assert from 'node:assert/strict';
import test from 'node:test';
import { getSidebarGroupKey, sidebarNavigationGroups } from '../src/lib/sidebarNavigation.ts';

test('defines the five requested groups and all fifteen entries in order', () => {
  assert.deepEqual(sidebarNavigationGroups.map(({ key, label, items }) => ({ key, label, labels: items.map((item) => item.label) })), [
    { key: 'overview', label: '基本情况', labels: ['系统概览', '油井位图', '井温监控'] },
    { key: 'analysis', label: '分析系统', labels: ['单井分析', '区块分析', '对比分析', '检泵分析', '占产分析'] },
    { key: 'focus', label: '重点情况', labels: ['重点监控', '含水化验', '检泵跟踪'] },
    { key: 'measures', label: '措施项目', labels: ['措施选井', '措施跟踪', '措施分析'] },
    { key: 'production', label: '产量掌控', labels: ['产量预测'] },
  ]);
  assert.equal(sidebarNavigationGroups.flatMap((group) => group.items).length, 15);
});

test('finds the group containing each active tab and returns undefined for an unknown tab', () => {
  assert.equal(getSidebarGroupKey('wellTemperature'), 'overview');
  assert.equal(getSidebarGroupKey('pumpDeepAnalysis'), 'analysis');
  assert.equal(getSidebarGroupKey('productionForecast'), 'production');
  assert.equal(getSidebarGroupKey('missing-tab'), undefined);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --import tsx --test tests/sidebarNavigation.test.ts`

Expected: FAIL because `src/lib/sidebarNavigation.ts` does not exist.

- [ ] **Step 3: Implement the minimal configuration**

Create `src/lib/sidebarNavigation.ts`:

```ts
export type SidebarGroupKey = 'overview' | 'analysis' | 'focus' | 'measures' | 'production';
type SidebarIcon = 'LayoutDashboard' | 'MapPinned' | 'Thermometer' | 'Database' | 'Activity' | 'TrendingUp' | 'ClipboardList' | 'FileSpreadsheet' | 'AlertTriangle' | 'Droplets' | 'Filter' | 'Target' | 'MessageSquare';
export interface SidebarNavigationItem { tab: string; label: string; icon: SidebarIcon; }
export interface SidebarNavigationGroup { key: SidebarGroupKey; label: string; items: SidebarNavigationItem[]; }
export const sidebarNavigationGroups: SidebarNavigationGroup[] = [
  { key: 'overview', label: '基本情况', items: [{ tab: 'dashboard', label: '系统概览', icon: 'LayoutDashboard' }, { tab: 'oilWellMap', label: '油井位图', icon: 'MapPinned' }, { tab: 'wellTemperature', label: '井温监控', icon: 'Thermometer' }] },
  { key: 'analysis', label: '分析系统', items: [{ tab: 'well', label: '单井分析', icon: 'Database' }, { tab: 'block', label: '区块分析', icon: 'Activity' }, { tab: 'comparison', label: '对比分析', icon: 'TrendingUp' }, { tab: 'pumpDeepAnalysis', label: '检泵分析', icon: 'ClipboardList' }, { tab: 'occupancyAnalysis', label: '占产分析', icon: 'FileSpreadsheet' }] },
  { key: 'focus', label: '重点情况', items: [{ tab: 'analysis', label: '重点监控', icon: 'AlertTriangle' }, { tab: 'waterLab', label: '含水化验', icon: 'Droplets' }, { tab: 'pumpAnalysis', label: '检泵跟踪', icon: 'Filter' }] },
  { key: 'measures', label: '措施项目', items: [{ tab: 'measureWellSelection', label: '措施选井', icon: 'Target' }, { tab: 'measures', label: '措施跟踪', icon: 'ClipboardList' }, { tab: 'measureAnalysis', label: '措施分析', icon: 'MessageSquare' }] },
  { key: 'production', label: '产量掌控', items: [{ tab: 'productionForecast', label: '产量预测', icon: 'TrendingUp' }] },
];
export const getSidebarGroupKey = (tab: string) => sidebarNavigationGroups.find((group) => group.items.some((item) => item.tab === tab))?.key;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --import tsx --test tests/sidebarNavigation.test.ts`

Expected: PASS with 2 passing tests.

- [ ] **Step 5: Commit the configuration**

```bash
git add src/lib/sidebarNavigation.ts tests/sidebarNavigation.test.ts
git commit -m "feat: define grouped sidebar navigation"
```

### Task 2: Render the grouped accordion sidebar

**Files:**
- Modify: `src/App.tsx:1-32, 2129, 5814-5936`
- Test: `tests/sidebarNavigation.test.ts`

- [ ] **Step 1: Extend the test for every configured tab**

Append to `tests/sidebarNavigation.test.ts`:

```ts
test('maps every configured item to its containing group', () => {
  for (const group of sidebarNavigationGroups) {
    for (const item of group.items) assert.equal(getSidebarGroupKey(item.tab), group.key);
  }
});
```

- [ ] **Step 2: Run test to establish the pre-UI baseline**

Run: `node --import tsx --test tests/sidebarNavigation.test.ts && git grep -n "sidebarNavigationGroups" -- src/App.tsx`

Expected: 3 passing pure-configuration tests, then no `App.tsx` result because the UI has not consumed the configuration yet.

- [ ] **Step 3: Replace flat menu JSX with accordion rendering**

In `src/App.tsx`, import `getSidebarGroupKey`, `sidebarNavigationGroups`, and `SidebarGroupKey` from `./lib/sidebarNavigation`. Add `expandedSidebarGroup` state initialized to the dashboard group, plus an effect that sets it to `getSidebarGroupKey(activeTab)` whenever `activeTab` changes. Define a local `sidebarIcons` map from every configuration icon name to its already imported Lucide component.

Replace the 15 flat `SidebarItem` blocks under `<nav className="mt-4 flex-1">` with a map over `sidebarNavigationGroups`. For each group: render a button showing `group.label` and `ChevronRight`; rotate the chevron when `expandedSidebarGroup === group.key`; on click set that key as expanded; when expanded, map its items to the existing `SidebarItem`, using the icon map, existing active comparison, and `setActiveTab(item.tab as typeof activeTab)`. Keep user information, logout, and status markup unchanged.

- [ ] **Step 4: Verify UI integration and the tests**

Run: `node --import tsx --test tests/sidebarNavigation.test.ts && git grep -n "sidebarNavigationGroups" -- src/App.tsx`

Expected: 3 passing tests and at least one `src/App.tsx` result showing the grouped configuration is rendered.

- [ ] **Step 5: Commit accordion rendering**

```bash
git add src/App.tsx tests/sidebarNavigation.test.ts
git commit -m "feat: group sidebar menu into accordions"
```

### Task 3: Run full regression verification

**Files:**
- Verify: `src/App.tsx`
- Verify: `src/lib/sidebarNavigation.ts`
- Verify: `tests/sidebarNavigation.test.ts`

- [ ] **Step 1: Run the full test suite**

Run: `npm test`

Expected: exit code 0 with all existing tests and `sidebarNavigation.test.ts` passing.

- [ ] **Step 2: Run TypeScript validation**

Run: `npm run lint`

Expected: exit code 0 and no TypeScript diagnostics.

- [ ] **Step 3: Build the frontend bundle**

Run: `npm run build`

Expected: exit code 0 and Vite emits the production bundle to `dist/`.

- [ ] **Step 4: Inspect the final change scope**

Run: `git diff HEAD~2..HEAD -- src/App.tsx src/lib/sidebarNavigation.ts tests/sidebarNavigation.test.ts`

Expected: the diff contains only menu configuration, accordion rendering, and tests.
