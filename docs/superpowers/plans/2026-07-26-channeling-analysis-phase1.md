# 注窜关系与影响分析一期实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 支持注窜项目及注井—采油井关系的维护、Excel 导入、地图关系图和可追溯产量影响趋势。

**Architecture:** 新建独立 store 管理项目与关系，关系以手工、导入和系统疑似三种来源记录。服务端提供项目、关系、汇总和趋势 API；状态地图消费只读关系图层，趋势先以可解释的生产基线/实际数据口径呈现，缺失数据明确标记。

**Tech Stack:** TypeScript、Express、SQLite、React、ECharts、Node test runner、tsx。

---

### Task 1: 注窜项目与关系数据模型

**Files:**
- Create: `src/lib/channelingProjectStore.ts`
- Create: `tests/channelingProjectStore.test.ts`
- Modify: `server.ts`

- [ ] **Step 1: 编写失败测试**

```ts
test('creates a channeling project and confirmed injector-producer relation', async () => {
  const project = await createChannelingProject(db, { name: '一区注窜-001', block: '一区', owner: '张工' });
  const relation = await createChannelingRelation(db, {
    projectId: project.id, injectorWellNo: 'Z1', producerWellNo: 'C1',
    impactLevel: 'high', status: 'confirmed', source: 'manual', confidence: 0.9,
  });
  assert.equal(relation.status, 'confirmed');
  assert.equal((await listChannelingRelations(db, project.id))[0].producerWellNo, 'C1');
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `node --import tsx --test tests/channelingProjectStore.test.ts`

Expected: FAIL，模块或导出函数不存在。

- [ ] **Step 3: 实现最小 store**

创建 `channeling_projects` 和 `channeling_relations` 表。关系字段包含注井、采油井、层系、影响等级、0–1 置信度、状态、来源、证据、有效起止日、负责人和创建/更新时间。对井号、枚举、置信度和日历日期严格校验；关系查询按状态、来源、区块和项目筛选。

- [ ] **Step 4: 增加 REST API**

新增 `GET/POST /api/channeling-projects`、`GET/POST /api/channeling-projects/:id/relations`、`PATCH /api/channeling-relations/:id`。返回 `{ success: true, data }`；非法输入返回 400，找不到返回 404。

- [ ] **Step 5: 验证并提交**

Run: `node --import tsx --test tests/channelingProjectStore.test.ts && npm test`

```bash
git add src/lib/channelingProjectStore.ts tests/channelingProjectStore.test.ts server.ts
git commit -m "feat: add channeling project relations"
```

### Task 2: Excel 导入与疑似关系确认

**Files:**
- Create: `src/lib/channelingRelationImport.ts`
- Create: `tests/channelingRelationImport.test.ts`
- Modify: `server.ts`

- [ ] **Step 1: 编写失败测试**

```ts
test('parses channeling relation workbook and marks suspected source', () => {
  const rows = parseChannelingRelationRows(workbookWithRows([
    ['注井', '采油井', '影响等级', '置信度', '来源'], ['Z1', 'C1', '高', 80, '疑似识别'],
  ]));
  assert.deepEqual(rows.valid[0], { injectorWellNo: 'Z1', producerWellNo: 'C1', impactLevel: 'high', confidence: 0.8, source: 'suspected' });
});
```

- [ ] **Step 2: 运行失败测试**

Run: `node --import tsx --test tests/channelingRelationImport.test.ts`

Expected: FAIL，解析器不存在。

- [ ] **Step 3: 实现解析、预览和确认**

支持 `.xlsx/.xls`，必填列为注井、采油井、影响等级；可选列为层系、置信度、来源、证据、有效期、负责人。导入先预览有效/异常行，确认后创建关系；疑似关系必须为 `suspected`，只能通过 PATCH 改为 `confirmed` 或 `released`。

- [ ] **Step 4: 验证并提交**

Run: `node --import tsx --test tests/channelingRelationImport.test.ts && npm test`

```bash
git add src/lib/channelingRelationImport.ts tests/channelingRelationImport.test.ts server.ts
git commit -m "feat: import channeling relations"
```

### Task 3: 地图关系图层与台账界面

**Files:**
- Modify: `src/components/OilWellMap.tsx`
- Create: `src/components/ChannelingProjectManagement.tsx`
- Create: `tests/channelingMapNavigation.test.ts`
- Modify: `src/App.tsx`

- [ ] **Step 1: 编写失败测试**

```ts
test('maps relation status to approved line style', () => {
  assert.deepEqual(getChannelingLineStyle({ status: 'confirmed', impactLevel: 'high' }), { color: '#dc2626', dash: false });
  assert.deepEqual(getChannelingLineStyle({ status: 'suspected', impactLevel: 'medium' }), { color: '#7c3aed', dash: true });
});
```

- [ ] **Step 2: 实现只读关系图层**

在状态地图增加“注窜关系”开关和项目/状态筛选。使用已有真实坐标；两端任一井无坐标时只进无坐标清单，不绘制伪连线。样式：高影响确认红实线、其他确认橙实线、疑似紫虚线、解除灰线。点击连线打开详情抽屉。

- [ ] **Step 3: 实现注窜项目台账**

新增项目清单、关系清单、手工新增、Excel 预览确认与疑似确认入口。管理员可编辑/解除关系；普通用户只读。

- [ ] **Step 4: 验证并提交**

Run: `node --import tsx --test tests/channelingMapNavigation.test.ts && npm test && npm run build`

```bash
git add src/components/OilWellMap.tsx src/components/ChannelingProjectManagement.tsx src/App.tsx tests/channelingMapNavigation.test.ts
git commit -m "feat: visualize channeling relations on map"
```

### Task 4: 注窜影响汇总与趋势

**Files:**
- Create: `src/lib/channelingImpactAnalysis.ts`
- Create: `tests/channelingImpactAnalysis.test.ts`
- Modify: `server.ts`
- Modify: `src/components/ChannelingProjectManagement.tsx`

- [ ] **Step 1: 编写失败测试**

```ts
test('separates actual oil, decline baseline, channeling loss and net oil', () => {
  const trend = buildChannelingImpactTrend({ actualOil: [10], baselineOil: [12], injectionGain: [4], occupancyLoss: [1] });
  assert.equal(trend.points[0].channelingLoss, 5);
  assert.equal(trend.points[0].netOil, 8);
});
```

- [ ] **Step 2: 实现可解释趋势**

基线使用同井注汽前有效产量序列的线性/指数递减规则并标明方法。注窜损失只在确认关系且具备可用生产数据时计算；缺失时返回 `null` 和“数据待补全”。净增油按 `actual - baseline` 展示，不将未知损失填为零。

- [ ] **Step 3: 增加汇总 API 与界面**

提供项目/区块/层系维度的项目数、关联井数、受影响日产油、风险注汽量、处理率和趋势 API。页面用 ECharts 绘制实际油、递减基线、注窜损失、占产损失、净增油，包含 aria 和空态说明。

- [ ] **Step 4: 验证并提交**

Run: `node --import tsx --test tests/channelingImpactAnalysis.test.ts && npm test && npm run build`

```bash
git add src/lib/channelingImpactAnalysis.ts tests/channelingImpactAnalysis.test.ts server.ts src/components/ChannelingProjectManagement.tsx
git commit -m "feat: analyze channeling production impact"
```

### Task 5: 一期验收

**Files:**
- Verify only: 新增关系、地图和分析文件

- [ ] **Step 1: 自动化验收**

Run: `npm test && npm run build`

Expected: 所有测试和构建通过；记录既有 lint 基线错误但不新增错误。

- [ ] **Step 2: 浏览器验收**

验证台账手工新增、Excel 预览/确认、关系图层样式、无坐标提示、详情抽屉、项目汇总和缺失数据空态。

- [ ] **Step 3: 提交前检查**

Run: `git status --short`

Expected: 不提交数据库、Excel、截图或临时浏览器目录。
