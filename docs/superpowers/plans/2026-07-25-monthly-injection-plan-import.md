# 月度注汽主计划表导入 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (- [ ]) syntax for tracking.

**Goal:** 支持上传并预览月度注汽主计划表，确认后覆盖该月已导入计划，同时保留批次和变更记录。

**Architecture:** 将 Excel 两行计划块解析为独立纯函数，保证井表达式、日期和计划状态可测试。导入存储负责预览批次、确认覆盖和审计快照；现有项目存储扩展计划字段但保留生命周期字段。Express 仅负责文件上传与调用，React 页面负责上传、预览确认、项目筛选和按锅炉查看计划。

**Tech Stack:** TypeScript、Express、Multer、SheetJS xlsx、SQLite、React、Tailwind、Node test。

---

## 文件结构

- Create: src/lib/monthlyInjectionPlanParser.ts — 主计划表识别、两行计划块解析和标准化。
- Create: src/lib/monthlyInjectionPlanImportStore.ts — 导入批次、导入行快照、覆盖规则和导入历史。
- Create: tests/monthlyInjectionPlanParser.test.ts — 主表解析规则测试。
- Create: tests/monthlyInjectionPlanImportStore.test.ts — 预览、确认覆盖和生命周期保留测试。
- Modify: src/lib/injectionProjectStore.ts — 扩展项目计划字段和 SQLite 迁移。
- Modify: tests/injectionProjectStore.test.ts — 验证扩展字段不破坏原有生命周期。
- Modify: server.ts — 新增文件上传中间件及导入预览、确认、历史接口。
- Modify: src/components/InjectionProjectManagement.tsx — 上传预览、确认覆盖、筛选、历史和锅炉时间轴。

### Task 1: 主计划表解析器

**Files:**
- Create: tests/monthlyInjectionPlanParser.test.ts
- Create: src/lib/monthlyInjectionPlanParser.ts

- [ ] **Step 1: 写入失败测试，覆盖题述示例和两行继承规则。**

~~~ts
test('parses a two-row monthly plan block', () => {
  const parsed = parseMonthlyInjectionPlan(workbookWithRows([
    ['7月份注汽运行计划表（7.17）'],
    ['采三', '活6', '高3-4-17CH3（CO2+N+2500）'],
    ['', '', '8.08-8.21'],
    ['', '活7', '高3-莲H3CH（N2+2100）'],
    ['', '', '8.11-8.18'],
  ]));
  assert.deepEqual(parsed.rows.map(({ wellNo, boiler, plannedSteam, gasSupport, startDate, endDate }) =>
    ({ wellNo, boiler, plannedSteam, gasSupport, startDate, endDate })), [
    { wellNo: '高3-4-17CH3', boiler: '活6', plannedSteam: 2500, gasSupport: 'CO2+N2', startDate: '2026-08-08', endDate: '2026-08-21' },
    { wellNo: '高3-莲H3CH', boiler: '活7', plannedSteam: 2100, gasSupport: 'N2', startDate: '2026-08-11', endDate: '2026-08-18' },
  ]);
});
~~~

- [ ] **Step 2: 运行测试，确认解析器尚不存在。**

Run: node --import tsx --test tests/monthlyInjectionPlanParser.test.ts

Expected: FAIL，提示无法导入 monthlyInjectionPlanParser。

- [ ] **Step 3: 实现最小解析器。**

~~~ts
export type MonthlyPlanRow = {
  unit: string; boiler: string; wellNo: string; plannedSteam: number | null;
  gasSupport: string; startDate: string | null; endDate: string | null;
  planStatus: 'scheduled' | 'pending' | 'stopped' | 'maintenance' | 'relocation';
  remark: string; sourceCell: string; rawWellText: string; rawScheduleText: string;
};

export function parseMonthlyInjectionPlan(workbook: XLSX.WorkBook): MonthlyPlanPreview {
  // 选择标题包含“注汽运行计划表”的工作表；标题提取计划年份和月份。
  // 按第 3 列及以后成对读取计划井行与日期/说明行，并继承最近的单位和锅炉。
  // 使用 parseWellExpression 和 parseScheduleText 生成 rows、pendingRows 和 invalidRows。
}
~~~

从标题提取月份；没有年份时使用当前年份。待定、停注、停注检修、先搬家、接大一站写入非 scheduled 状态或备注；无法可靠解析的记录归入 invalidRows。

- [ ] **Step 4: 补充跨月日期、待定和异常测试。**

~~~ts
test('keeps pending and maintenance text out of valid well rows', () => {
  const preview = parseMonthlyInjectionPlan(workbookWithRows([
    ['7月份注汽运行计划表'],
    ['采一', '活4', '高2-6-028（1500）', '先搬家', '待定'],
    ['', '', '7.20停注', '', ''],
  ]));
  assert.equal(preview.rows[0].planStatus, 'stopped');
  assert.equal(preview.pendingRows.length, 2);
});
~~~

- [ ] **Step 5: 运行解析器测试。**

Run: node --import tsx --test tests/monthlyInjectionPlanParser.test.ts

Expected: PASS。

- [ ] **Step 6: 提交解析器。**

~~~powershell
git add src/lib/monthlyInjectionPlanParser.ts tests/monthlyInjectionPlanParser.test.ts
git commit -m "feat: parse monthly injection plan workbook"
~~~

### Task 2: 导入批次存储和项目字段迁移

**Files:**
- Modify: src/lib/injectionProjectStore.ts
- Create: src/lib/monthlyInjectionPlanImportStore.ts
- Create: tests/monthlyInjectionPlanImportStore.test.ts
- Modify: tests/injectionProjectStore.test.ts

- [ ] **Step 1: 写失败测试，确认覆盖同月导入计划但保留生命周期状态。**

~~~ts
test('replaces imported plan fields for the same month without resetting lifecycle', async () => {
  const first = await createPlanPreview(db, { planMonth: '2026-07', rows: [row('高3-4-17CH3', '活6', 2500)] });
  await confirmPlanImport(db, first.id);
  const project = (await listInjectionProjects(db))[0];
  await updatePlanStatus(db, project.id, 'issued');
  await transitionInjectionProject(db, project.id, 'injecting', '2026-08-08');
  const revision = await createPlanPreview(db, { planMonth: '2026-07', rows: [row('高3-4-17CH3', '活7', 2600)] });
  await confirmPlanImport(db, revision.id);
  const updated = (await listInjectionProjects(db))[0];
  assert.equal(updated.boiler, '活7');
  assert.equal(updated.plannedSteam, 2600);
  assert.equal(updated.lifecycleStatus, 'injecting');
});
~~~

- [ ] **Step 2: 运行测试，确认存储接口尚不存在。**

Run: node --import tsx --test tests/monthlyInjectionPlanImportStore.test.ts

Expected: FAIL，提示无法导入导入存储模块。

- [ ] **Step 3: 扩展项目表并实现安全迁移。**

在 initInjectionProjectTables 中增加 unit、boiler、planned_start_date、planned_end_date、gas_support、schedule_status、source_import_id 字段。先用 PRAGMA table_info(injection_projects) 检查列，再逐一执行缺失列的 ALTER TABLE ... ADD COLUMN，确保已有 production.db 可升级。更新 ProjectInput、InjectionProject、toProject 和 createInjectionProject，新增字段均为可选，保持手工新建流程兼容。

- [ ] **Step 4: 实现批次与快照表及确认覆盖。**

~~~ts
export async function createPlanPreview(db: DatabaseLike, input: PlanPreviewInput) {
  // 插入 injection_plan_imports(status='preview') 和 injection_plan_import_rows。
}

export async function confirmPlanImport(db: DatabaseLike, importId: number) {
  // 读取有效行；按计划月份更新当前导入项目。
  // 同井保留 project_no、plan_status 和 lifecycle_status，其余计划字段更新。
  // 新井创建 draft/pending 项目；批次改 confirmed，旧 confirmed 改 superseded。
}
~~~

injection_plan_imports 保存计划月份、文件名、工作表、状态、有效/待定/异常数量、总量、创建和确认时间。injection_plan_import_rows 保存所有解析行、分类、原始文本和 JSON 快照。确认时用事务包裹批次状态更新和项目更新，避免半覆盖。

- [ ] **Step 5: 补充存储测试。**

~~~ts
test('keeps prior import snapshots and excludes manual projects from replacement', async () => {
  // 确认两次同月导入后历史包含 first=superseded 和 revision=confirmed；
  // 手工项目 sourceImportId 为 null 且仍存在。
});
~~~

同时在 tests/injectionProjectStore.test.ts 断言扩展字段可为空，原有创建、下达和流转测试仍然通过。

- [ ] **Step 6: 运行存储测试。**

Run: node --import tsx --test tests/injectionProjectStore.test.ts tests/monthlyInjectionPlanImportStore.test.ts

Expected: PASS。

- [ ] **Step 7: 提交存储和迁移。**

~~~powershell
git add src/lib/injectionProjectStore.ts src/lib/monthlyInjectionPlanImportStore.ts tests/injectionProjectStore.test.ts tests/monthlyInjectionPlanImportStore.test.ts
git commit -m "feat: store monthly injection plan imports"
~~~

### Task 3: 导入接口

**Files:**
- Modify: server.ts

- [ ] **Step 1: 增加月度计划上传中间件。**

在现有 multer.memoryStorage() 模式旁新增 monthlyInjectionPlanUpload，沿用 MEASURE_IMPORT_FILE_LIMIT_BYTES 和 handleMeasureImportUpload。只接受 file 字段；缺少文件返回 400 和“请选择主计划表文件”。

- [ ] **Step 2: 实现预览接口。**

~~~ts
app.post('/api/injection-project-imports/preview', monthlyInjectionPlanUploadMiddleware, async (req, res) => {
  const file = (req as any).file;
  const workbook = XLSX.read(file.buffer, { type: 'buffer' });
  const preview = parseMonthlyInjectionPlan(workbook);
  const data = await createPlanPreview(localDb, { ...preview, fileName: file.originalname });
  res.status(201).json({ success: true, data });
});
~~~

对“未找到主计划表”“标题未含月份”等用户输入问题返回 400；其他错误返回 500。

- [ ] **Step 3: 实现确认和历史接口。**

~~~ts
app.post('/api/injection-project-imports/:id/confirm', async (req, res) => {
  res.json({ success: true, data: await confirmPlanImport(localDb, Number(req.params.id)) });
});
app.get('/api/injection-project-imports', async (_req, res) => {
  res.json({ success: true, data: await listPlanImports(localDb) });
});
~~~

确认不存在或已确认的预览批次时返回 404 或 409；确认后 GET /api/injection-projects 自然返回扩展后的项目字段。

- [ ] **Step 4: 构建并手工验证接口错误边界。**

Run: npm run build

Expected: Vite build 成功。

Run: curl.exe -i -X POST http://localhost:3000/api/injection-project-imports/preview

Expected: 服务运行时返回 400 JSON，不因缺少文件崩溃。

- [ ] **Step 5: 提交接口。**

~~~powershell
git add server.ts
git commit -m "feat: add monthly injection plan import APIs"
~~~

### Task 4: 注汽项目管理导入和计划视图

**Files:**
- Modify: src/components/InjectionProjectManagement.tsx

- [ ] **Step 1: 增加导入状态和 API 调用。**

定义 ImportPreview、ImportHistoryItem 和扩展 Project 类型。通过 FormData 上传选中的 .xlsx 文件到预览接口；预览成功后加载导入批次、有效/待定/异常记录及上一版对比。确认按钮调用 /:id/confirm，成功后重新加载项目和历史。

- [ ] **Step 2: 实现预览确认界面。**

~~~tsx
<section className="app-card p-5">
  <h3 className="text-lg font-bold">月度注汽计划导入</h3>
  <input type="file" accept=".xlsx,.xls" onChange={selectFile} />
  <button disabled={!file || previewing} onClick={previewFile}>解析预览</button>
  {preview && <button onClick={confirmImport}>确认覆盖导入 {preview.planMonth}</button>}
</section>
~~~

预览区域显示计划月份、工作表和文件名；统计卡显示有效、待定、异常和计划注汽总量；表格显示单位、锅炉、井、开注/停注、计划量、气体配套、状态、备注；异常记录不显示确认覆盖计数。

- [ ] **Step 3: 扩展项目列表与筛选。**

新增单位、锅炉、计划状态、生命周期状态四个筛选控件；项目表加入锅炉、计划开注、计划停注、计划注汽量、气体配套、来源批次。已有“下达”和生命周期流转按钮继续可用，并将内部英文状态显示为中文标签。

- [ ] **Step 4: 实现锅炉计划时间轴和导入历史。**

按 boiler 分组 plannedStartDate/plannedEndDate 均有效的项目，使用现有 Tailwind 卡片和相对定位条展示井号与日期区间；没有日期的计划列在“待定/异常计划”而非伪造时间条。历史表显示计划月份、文件名、导入时间、有效/待定/异常数量和当前状态。

- [ ] **Step 5: 构建及浏览器验收。**

Run: npm run build

Expected: Vite build 成功。

启动 npm run dev 后，在“注汽项目管理”上传 C:\Users\31541\Desktop\7.6\GSyuan7.10\GSyuan\GS\.worktrees\injection-production-cockpit\injection-plan.xlsx，确认预览中示例井、锅炉、日期、2500/2100 和 CO2+N2/N2 均正确；点击确认后刷新页面，项目和历史可见。

- [ ] **Step 6: 提交界面。**

~~~powershell
git add src/components/InjectionProjectManagement.tsx
git commit -m "feat: add monthly injection plan import UI"
~~~

### Task 5: 全量验证

**Files:**
- Modify: none

- [ ] **Step 1: 运行所有测试。**

Run: npm test

Expected: 所有测试通过。

- [ ] **Step 2: 检查类型和生产构建。**

Run: npm run lint; npm run build

Expected: 构建成功；若 lint 仍存在本功能之前的既有错误，记录其文件、行号和与本功能无关的原因。

- [ ] **Step 3: 检查变更范围。**

Run: git status --short; git diff main...HEAD --check

Expected: 无空白错误；不包含 injection-plan.xlsx 或 production.db 等运行数据。
