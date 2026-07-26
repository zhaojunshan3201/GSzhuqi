# 注汽管理菜单尾部顺序与图标调整 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将注汽管理菜单的尾部入口按效果评价、注汽优化预测、运行报告、注窜项目台账显示，并为注窜项目台账显示分支关联图标。

**Architecture:** 菜单顺序由 `src/lib/sidebarNavigation.ts` 的注汽分组唯一配置控制；图标名称由该配置传递给 `src/App.tsx` 的 `sidebarIconMap`。测试扩展现有导航配置断言，覆盖排序和注窜入口的图标，从而不改动页面、路由和权限。

**Tech Stack:** TypeScript、React、lucide-react、Node test runner、tsx。

---

## File structure

- Modify: `src/lib/sidebarNavigation.ts` — 定义 `GitBranch` 图标名称，并重排注汽分组的现有菜单项。
- Modify: `src/App.tsx` — 导入 `GitBranch` 并注册到 `sidebarIconMap`，让菜单配置能渲染该图标。
- Modify: `tests/sidebarNavigation.test.ts` — 断言目标菜单顺序和注窜项目台账图标。

### Task 1: 导航配置测试

**Files:**
- Modify: `tests/sidebarNavigation.test.ts`

- [ ] **Step 1: 写入失败的顺序和图标断言**

将注汽分组的期望页签顺序改为：

```ts
tabs: [
  'measureWellSelection',
  'injectionPlan',
  'injectionConstruction',
  'injectionSoakTransfer',
  'measures',
  'measureAnalysis',
  'injectionOptimization',
  'injectionOperationReports',
  'channelingProjectManagement',
],
```

并增加：

```ts
test('uses a relationship icon for the channeling project ledger', () => {
  const injectionGroup = sidebarNavigationGroups.find((group) => group.key === 'injection');
  const channelingItem = injectionGroup?.items.find((item) => item.tab === 'channelingProjectManagement');

  assert.equal(channelingItem?.icon, 'GitBranch');
});
```

- [ ] **Step 2: 运行测试以验证失败**

Run: `node --import tsx --test tests/sidebarNavigation.test.ts`

Expected: FAIL，顺序仍以 `channelingProjectManagement` 开头，且图标仍为 `Target`。

- [ ] **Step 3: 提交失败测试**

```bash
git add tests/sidebarNavigation.test.ts
git commit -m "test: define injection menu tail order"
```

### Task 2: 最小菜单与图标实现

**Files:**
- Modify: `src/lib/sidebarNavigation.ts`
- Modify: `src/App.tsx`

- [ ] **Step 1: 扩展图标类型与菜单配置**

在 `SidebarIcon` 联合类型加入：

```ts
| 'GitBranch';
```

将 `key: 'injection'` 的 `items` 重排为：

```ts
{ tab: 'measureWellSelection', label: '选井决策', icon: 'Target' },
{ tab: 'injectionPlan', label: '方案与计划', icon: 'ClipboardList' },
{ tab: 'injectionConstruction', label: '施工监控', icon: 'Activity' },
{ tab: 'injectionSoakTransfer', label: '焖井转抽', icon: 'TrendingUp' },
{ tab: 'measures', label: '生产响应', icon: 'ClipboardList' },
{ tab: 'measureAnalysis', label: '效果评价', icon: 'MessageSquare' },
{ tab: 'injectionOptimization', label: '注汽优化预测', icon: 'TrendingUp' },
{ tab: 'injectionOperationReports', label: '运行报告', icon: 'FileSpreadsheet' },
{ tab: 'channelingProjectManagement', label: '注窜项目台账', icon: 'GitBranch' },
```

保留文件中既有字符串编码形式；仅移动这九个已有对象并替换注窜项目台账的图标值。

- [ ] **Step 2: 注册 Lucide 图标**

在 `src/App.tsx` 的 `lucide-react` 导入中加入 `GitBranch`，并在 `sidebarIconMap` 中加入：

```ts
GitBranch,
```

- [ ] **Step 3: 运行目标测试以验证通过**

Run: `node --import tsx --test tests/sidebarNavigation.test.ts`

Expected: PASS，全部导航配置断言通过。

- [ ] **Step 4: 运行类型检查**

Run: `npm run lint`

Expected: exit code 0。

- [ ] **Step 5: 提交实现**

```bash
git add src/lib/sidebarNavigation.ts src/App.tsx
git commit -m "feat: reorder injection management menu"
```

### Task 3: 完整回归验证

**Files:**
- Modify: none

- [ ] **Step 1: 运行完整测试集**

Run: `npm test`

Expected: 所有测试通过。

- [ ] **Step 2: 构建前端**

Run: `npm run build`

Expected: Vite build 成功且无 TypeScript 或图标映射错误。

- [ ] **Step 3: 审核变更范围**

Run: `git diff main...HEAD -- src/lib/sidebarNavigation.ts src/App.tsx tests/sidebarNavigation.test.ts`

Expected: 仅包含菜单对象重排、`GitBranch` 类型/导入/映射和测试断言。
