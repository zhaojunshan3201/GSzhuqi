# 注汽项目流程闭环二期 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 建立注汽方案、状态流转、焖井转抽待办，并与现有驾驶舱和注汽跟踪联动。

**Architecture:** 使用两个 SQLite 表保存项目当前状态与不可变流转日志；独立 `injectionProjectStore` 负责所有业务规则，Express 只路由，React 使用独立页面。既有 `measure_tracking` 不迁移、不删除。

**Tech Stack:** TypeScript、Express、SQLite、React、node:test。

---

### Task 1: 项目数据表与状态流转规则

**Files:**
- Create: `src/lib/injectionProjectStore.ts`
- Create: `tests/injectionProjectStore.test.ts`
- Modify: `server.ts`

- [ ] **Step 1: 写失败测试**

```ts
test('allows only the agreed lifecycle sequence', async () => {
  const project = await createInjectionProject(db, draft());
  await transitionInjectionProject(db, project.id, 'injecting', '2026-07-01');
  await assert.rejects(() => transitionInjectionProject(db, project.id, 'producing', '2026-07-02'), /无效/);
  await transitionInjectionProject(db, project.id, 'soaking', '2026-07-02');
});
```

- [ ] **Step 2: 运行并确认失败**

Run: `node --import tsx --test tests/injectionProjectStore.test.ts`

Expected: FAIL，模块不存在。

- [ ] **Step 3: 实现表、类型和最小规则**

创建 `injection_projects` 与 `injection_project_transitions`，并导出：

```ts
export type LifecycleStatus = 'pending' | 'injecting' | 'soaking' | 'pendingTransfer' | 'producing' | 'closed';
export type PlanStatus = 'draft' | 'issued' | 'cancelled' | 'closed';
export async function createInjectionProject(db: DatabaseLike, input: ProjectInput): Promise<InjectionProject>;
export async function transitionInjectionProject(db: DatabaseLike, id: number, target: LifecycleStatus, actualDate: string, remark?: string): Promise<InjectionProject>;
```

转换仅允许：`pending→injecting→soaking→pendingTransfer→producing→closed`。项目必须为 `issued` 才能从 pending 进入 injecting；每次成功转换插入一条日志。

- [ ] **Step 4: 运行测试并确认通过**

Run: `node --import tsx --test tests/injectionProjectStore.test.ts`

Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add src/lib/injectionProjectStore.ts tests/injectionProjectStore.test.ts server.ts
git commit -m "feat: add injection project lifecycle store"
```

### Task 2: 方案计划 CRUD 与项目 API

**Files:**
- Modify: `src/lib/injectionProjectStore.ts`
- Modify: `server.ts`
- Modify: `tests/injectionProjectStore.test.ts`

- [ ] **Step 1: 写失败测试**

```ts
test('issues a valid plan and rejects an incomplete plan', async () => {
  await assert.rejects(() => createInjectionProject(db, { ...draft(), wellNo: '' }), /井号/);
  const project = await createInjectionProject(db, draft());
  assert.equal((await updatePlanStatus(db, project.id, 'issued')).planStatus, 'issued');
});
```

- [ ] **Step 2: 运行并确认失败**

Run: `node --import tsx --test tests/injectionProjectStore.test.ts`

Expected: FAIL，计划状态更新与字段校验未实现。

- [ ] **Step 3: 实现接口**

添加：

```text
GET    /api/injection-projects
POST   /api/injection-projects
PUT    /api/injection-projects/:id
POST   /api/injection-projects/:id/plan-status
POST   /api/injection-projects/:id/transitions
GET    /api/injection-projects/pending
```

必填字段：井号、区块、工艺、计划转抽日、负责人。无效输入返回 400；不存在返回 404；无效流转返回 409。`pending` 接口返回焖井和待转抽项目，并计算逾期天数。

- [ ] **Step 4: 运行测试并确认通过**

Run: `node --import tsx --test tests/injectionProjectStore.test.ts`

Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add src/lib/injectionProjectStore.ts tests/injectionProjectStore.test.ts server.ts
git commit -m "feat: expose injection project APIs"
```

### Task 3: 注汽项目管理页面

**Files:**
- Create: `src/components/InjectionProjectManagement.tsx`
- Modify: `src/lib/sidebarNavigation.ts`
- Modify: `src/App.tsx`
- Modify: `tests/sidebarNavigation.test.ts`

- [ ] **Step 1: 写失败测试**

```ts
test('includes 注汽项目管理 in the 注汽项目 navigation group', () => {
  const group = sidebarNavigationGroups.find((item) => item.key === 'measures');
  assert.equal(group?.items[0].label, '注汽项目管理');
});
```

- [ ] **Step 2: 运行并确认失败**

Run: `node --import tsx --test tests/sidebarNavigation.test.ts`

Expected: FAIL，导航项不存在。

- [ ] **Step 3: 实现页面**

页面包含方案列表、按区块/状态筛选、新建/编辑方案弹窗、计划状态按钮、项目状态流转按钮和流转日志。按角色隐藏写入按钮；访客只读。新建表单字段必须与 `ProjectInput` 一致。

- [ ] **Step 4: 验证**

Run: `node --import tsx --test tests/sidebarNavigation.test.ts && npm run build`

Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add src/components/InjectionProjectManagement.tsx src/lib/sidebarNavigation.ts src/App.tsx tests/sidebarNavigation.test.ts
git commit -m "feat: add injection project management page"
```

### Task 4: 焖井转抽待办与一期联动

**Files:**
- Modify: `src/components/InjectionProductionCockpit.tsx`
- Modify: `src/App.tsx`
- Modify: `src/lib/injectionProductionCockpit.ts`
- Modify: `tests/injectionProjectStore.test.ts`

- [ ] **Step 1: 写失败测试**

```ts
test('marks soaking and pending-transfer projects overdue only after their planned transfer date', async () => {
  const pending = await listProjectPendingItems(db, '2026-07-25');
  assert.equal(pending[0].overdueDays, 3);
});
```

- [ ] **Step 2: 运行并确认失败**

Run: `node --import tsx --test tests/injectionProjectStore.test.ts`

Expected: FAIL，待办聚合不存在。

- [ ] **Step 3: 实现联动**

驾驶舱优先展示项目待办，并将点击跳转到项目管理页的对应项目；未关联项目继续使用一期的注汽跟踪待办。注汽跟踪记录显示关联方案编号和项目状态；仅 `producing`、`closed` 项目进入效果评价聚合。

- [ ] **Step 4: 验证**

Run: `node --import tsx --test tests/injectionProjectStore.test.ts tests/injectionProductionCockpit.test.ts && npm run build`

Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add src/components/InjectionProductionCockpit.tsx src/App.tsx src/lib/injectionProductionCockpit.ts src/lib/injectionProjectStore.ts tests/injectionProjectStore.test.ts
git commit -m "feat: link project lifecycle to cockpit tracking"
```

### Task 5: 全量验证

- [ ] **Step 1: 运行测试**

Run: `npm test`

Expected: PASS。

- [ ] **Step 2: 构建与类型检查**

Run: `npm run build && npm run lint`

Expected: build PASS；lint 若被既有错误阻断，确认无本期新增错误。

- [ ] **Step 3: 浏览器验收**

Run: `npm run dev`

确认可创建并下达方案；只能按顺序流转；焖井/待转抽逾期正确显示；驾驶舱能下钻项目；既有注汽选井、跟踪、评价仍可用。
