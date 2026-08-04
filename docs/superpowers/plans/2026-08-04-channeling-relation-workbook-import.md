# 注窜关系表上传与识别 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在空项目状态也可上传单个注窜关系 Excel，手动指定注汽窜或注氮气窜，预览清洗后的井间关系并选择项目确认入库，同时修正登录/注册错误提示。

**Architecture:** 扩展现有 `channelingRelationImport` 解析与批次存储，不另建平行业务模块。预览批次允许暂不绑定项目；确认时在一个事务内按“项目＋注窜类型＋注汽井＋关联井”重新去重并写入现有关系列表。React 页面把上传卡片提升到项目详情之外，继续复用现有项目创建、关系列表和权限模式。

**Tech Stack:** React 19、TypeScript、Express、Multer、SheetJS (`xlsx`)、SQLite、Node test runner

---

## 文件结构

- Modify: `src/lib/channelingRelationImport.ts` — 解析矩阵式样表、分类预览、无项目批次和确认时去重。
- Modify: `src/lib/channelingProjectStore.ts` — 为正式关系增加 `channelingType`，提供类型筛选。
- Modify: `server.ts` — 注册无项目预览、批次详情、带项目确认和类型筛选接口。
- Modify: `src/components/ChannelingProjectManagement.tsx` — 常驻上传卡、预览、项目选择、类型标签和筛选。
- Modify: `src/App.tsx` — 修正登录/注册连接失败和注册成功文案。
- Modify: `tests/channelingRelationImport.test.ts` — 样表解析、清洗、无项目预览、确认去重测试。
- Modify: `tests/channelingProjectStore.test.ts` — 关系类型持久化与筛选测试。
- Modify: `tests/channelingProjectApi.integration.test.ts` — 新接口、权限和确认流程测试。
- Modify: `tests/channelingLedgerAccess.test.ts` — 空项目时上传控件仍存在的 UI 契约。
- Create: `tests/authUiFeedback.test.ts` — 登录/注册提示回归测试。

### Task 1: 解析矩阵式注窜关系表

**Files:**
- Modify: `tests/channelingRelationImport.test.ts`
- Modify: `src/lib/channelingProjectStore.ts`
- Modify: `src/lib/channelingRelationImport.ts`

- [ ] **Step 1: 写入样表解析失败测试**

在 `tests/channelingRelationImport.test.ts` 增加矩阵工作簿 helper 和三项测试：

```ts
const matrixWorkbook = (rows: unknown[][]) => workbookWithRows(rows);

test('expands variable 井号N columns into directed relations without changing well numbers', () => {
  const preview = parseChannelingRelationRows(matrixWorkbook([
    ['注汽井', '井号1', '井号2', '井号3'],
    ['高3-6-莲H1', '高3-6-024', '高3-6-0245', ''],
  ]), 'steam');
  assert.deepEqual(preview.valid, [
    { rowNumber: 2, injectorWellNo: '高3-6-莲H1', producerWellNo: '高3-6-024', channelingType: 'steam' },
    { rowNumber: 2, injectorWellNo: '高3-6-莲H1', producerWellNo: '高3-6-0245', channelingType: 'steam' },
  ]);
});

test('classifies self-relations and duplicate directed relations', () => {
  const preview = parseChannelingRelationRows(matrixWorkbook([
    ['注汽井', '井号1', '井号2', '井号3'],
    ['高2-1-051C2', '高2-1-051C2', '高2-1-045', '高2-1-045'],
  ]), 'nitrogen');
  assert.equal(preview.valid.length, 1);
  assert.deepEqual(preview.selfRelations.map((row) => row.producerWellNo), ['高2-1-051C2']);
  assert.deepEqual(preview.duplicates.map((row) => row.producerWellNo), ['高2-1-045']);
});

test('rejects a matrix workbook without 注汽井 and 井号N headers', () => {
  assert.throws(
    () => parseChannelingRelationRows(matrixWorkbook([['井名', '关联井'], ['A', 'B']]), 'steam'),
    /表头必须包含“注汽井”和至少一个“井号N”列/,
  );
});
```

- [ ] **Step 2: 运行测试并确认 RED**

Run:

```bash
node --import tsx --test --test-concurrency=1 tests/channelingRelationImport.test.ts
```

Expected: FAIL，提示 `parseChannelingRelationRows` 不接受第二个参数返回类型，或 `selfRelations`/`duplicates` 不存在。

- [ ] **Step 3: 实现最小矩阵解析与分类**

先在 `src/lib/channelingProjectStore.ts` 增加唯一的共享类型：

```ts
export type ChannelingType = 'steam' | 'nitrogen';
```

再由 `src/lib/channelingRelationImport.ts` 导入并使用该类型；保留现有详细模板解析作为兼容路径：

```ts
import type { ChannelingType } from './channelingProjectStore.ts';

export type ChannelingRelationImportRow = {
  rowNumber: number;
  injectorWellNo: string;
  producerWellNo: string;
  channelingType: ChannelingType;
  impactLevel?: ImpactLevel;
  reservoirLayer?: string;
  confidence?: number;
  source?: RelationSource;
  evidence?: string;
  effectiveStartDate?: string;
  effectiveEndDate?: string;
  owner?: string;
};

export type ChannelingRelationImportPreviewRows = {
  valid: ChannelingRelationImportRow[];
  duplicates: ChannelingRelationImportRow[];
  selfRelations: ChannelingRelationImportRow[];
  invalid: Array<{ row: number; reason: string }>;
};

export function parseChannelingRelationRows(
  workbook: XLSX.WorkBook,
  channelingType: ChannelingType = 'steam',
): ChannelingRelationImportPreviewRows {
  if (!['steam', 'nitrogen'].includes(channelingType)) throw new Error('注窜类型无效');
  const sheetName = workbook.SheetNames[0];
  if (!sheetName || !workbook.Sheets[sheetName]) throw new Error('工作簿没有可用工作表');
  const rows = XLSX.utils.sheet_to_json<unknown[]>(workbook.Sheets[sheetName], { header: 1, defval: null, raw: true });
  const header = rows[0] ?? [];
  const normalized = header.map(normalizeHeader);
  const matrixColumns = normalized
    .map((value, index) => ({ value, index }))
    .filter(({ value, index }) => index > 0 && /^井号[1-9]\d*$/.test(value));
  if (normalized[0] === '注汽井' && matrixColumns.length) {
    if (normalized.slice(1).some((value) => value && !/^井号[1-9]\d*$/.test(value))) {
      throw new Error('表头必须包含“注汽井”和至少一个“井号N”列');
    }
    return parseMatrixRows(rows, matrixColumns.map(({ index }) => index), channelingType);
  }
  return parseDetailedRows(rows, channelingType);
}

function parseMatrixRows(rows: unknown[][], relationColumns: number[], channelingType: ChannelingType): ChannelingRelationImportPreviewRows {
  const result: ChannelingRelationImportPreviewRows = { valid: [], duplicates: [], selfRelations: [], invalid: [] };
  const seen = new Set<string>();
  rows.slice(1).forEach((row, index) => {
    if (row.every(isBlank)) return;
    const rowNumber = index + 2;
    const injectorWellNo = textAt(row, 0);
    const related = relationColumns.map((column) => textAt(row, column)).filter((value): value is string => Boolean(value));
    if (!injectorWellNo) {
      if (related.length) result.invalid.push({ row: rowNumber, reason: '注汽井不能为空' });
      return;
    }
    for (const producerWellNo of related) {
      const relation = { rowNumber, injectorWellNo, producerWellNo, channelingType };
      if (injectorWellNo === producerWellNo) result.selfRelations.push(relation);
      else {
        const key = `${channelingType}\u0000${injectorWellNo}\u0000${producerWellNo}`;
        if (seen.has(key)) result.duplicates.push(relation);
        else { seen.add(key); result.valid.push(relation); }
      }
    }
  });
  if (!result.valid.length && !result.duplicates.length && !result.selfRelations.length) throw new Error('工作表中没有可识别的注窜关系');
  return result;
}
```

把旧的逐行解析主体移动为 `parseDetailedRows(rows, channelingType)`，给每个有效行补上 `channelingType`，并初始化空的 `duplicates` 和 `selfRelations`。

- [ ] **Step 4: 运行解析测试并确认 GREEN**

Run the Task 1 command. Expected: PASS，现有详细模板测试也保持通过。

- [ ] **Step 5: 提交解析器**

```bash
git add src/lib/channelingProjectStore.ts src/lib/channelingRelationImport.ts tests/channelingRelationImport.test.ts
git commit -m "feat: parse channeling relationship matrices"
```

### Task 2: 持久化注窜类型和无项目预览批次

**Files:**
- Modify: `tests/channelingProjectStore.test.ts`
- Modify: `tests/channelingRelationImport.test.ts`
- Modify: `src/lib/channelingProjectStore.ts`
- Modify: `src/lib/channelingRelationImport.ts`

- [ ] **Step 1: 写入类型筛选和无项目预览失败测试**

在 store 测试的 `relationInput` 增加 `channelingType: 'steam' as const`，并增加：

```ts
test('stores and filters steam and nitrogen channeling relations independently', async () => {
  await withStore(async (db) => {
    const project = await createChannelingProject(db, projectInput());
    await createChannelingRelation(db, { ...relationInput(project.id), channelingType: 'steam' });
    await createChannelingRelation(db, { ...relationInput(project.id), productionWell: '采A-3', channelingType: 'nitrogen' });
    assert.equal((await listChannelingRelations(db, { projectId: project.id, channelingType: 'steam' })).length, 1);
    assert.equal((await listChannelingRelations(db, { projectId: project.id, channelingType: 'nitrogen' }))[0].productionWell, '采A-3');
  });
});
```

在 import 测试增加：

```ts
test('creates a preview without a project and binds it on confirmation', async () => {
  await withStore(async (db) => {
    const preview = await createChannelingRelationPreview(db, null, '汽窜.xlsx', 'steam', parseChannelingRelationRows(
      matrixWorkbook([['注汽井', '井号1'], ['Z1', 'C1']]),
      'steam',
    ));
    assert.equal(preview.projectId, null);
    const project = await createChannelingProject(db, { projectName: 'project', block: 'A', owner: 'owner' });
    const confirmed = await confirmChannelingRelationImport(db, preview.id, project.id);
    assert.equal(confirmed.projectId, project.id);
    assert.equal((await listChannelingRelations(db, { projectId: project.id, channelingType: 'steam' })).length, 1);
  });
});

test('rechecks target-project duplicates during confirmation', async () => {
  await withStore(async (db) => {
    const project = await createChannelingProject(db, { projectName: 'project', block: 'A', owner: 'owner' });
    await createChannelingRelation(db, {
      projectId: project.id, channelingType: 'steam', injectionWell: 'Z1', productionWell: 'C1',
      reservoirLayer: 'S1', impactLevel: 'medium', confidence: 0.5, status: 'confirmed', source: 'import',
      evidence: 'existing', effectiveStartDate: '2026-08-04', effectiveEndDate: '2026-08-04', owner: 'owner',
    });
    const preview = await createChannelingRelationPreview(db, null, '汽窜.xlsx', 'steam', parseChannelingRelationRows(
      matrixWorkbook([['注汽井', '井号1'], ['Z1', 'C1']]),
      'steam',
    ));
    const confirmed = await confirmChannelingRelationImport(db, preview.id, project.id);
    assert.equal(confirmed.duplicateCount, 1);
    assert.equal((await listChannelingRelations(db, { projectId: project.id, channelingType: 'steam' })).length, 1);
  });
});
```

- [ ] **Step 2: 运行两组测试并确认 RED**

```bash
node --import tsx --test --test-concurrency=1 tests/channelingProjectStore.test.ts tests/channelingRelationImport.test.ts
```

Expected: FAIL，提示 `channelingType` 筛选和 nullable `projectId`/确认参数尚未实现。

- [ ] **Step 3: 扩展正式关系模型**

在 `src/lib/channelingProjectStore.ts`：

```ts
const channelingTypes = new Set<ChannelingType>(['steam', 'nitrogen']);

export type ChannelingRelationInput = {
  projectId: number;
  channelingType: ChannelingType;
  injectionWell: string;
  productionWell: string;
  reservoirLayer: string;
  impactLevel: ImpactLevel;
  confidence: number;
  status: RelationStatus;
  source: RelationSource;
  evidence: string;
  effectiveStartDate: string;
  effectiveEndDate: string;
  owner: string;
};
```

给 `channeling_relations` 建表语句和迁移增加 `channeling_type TEXT NOT NULL DEFAULT 'steam'`；`validateRelation` 校验类型；INSERT、UPDATE、row mapper 和 `listChannelingRelations` 都包含该字段。筛选 options 精确改为：

```ts
options: { projectId?: number; status?: string; source?: string; block?: string; channelingType?: string } = {}
```

非法类型抛出 `channelingType is invalid`。

- [ ] **Step 4: 迁移导入批次并实现确认时去重**

在 `initChannelingRelationImportTables` 中读取 `PRAGMA table_info(channeling_relation_imports)`。若旧表 `project_id` 为 NOT NULL，则在关闭 foreign keys 的事务中创建 nullable 新表、复制旧数据、替换旧表并重建索引；新表完整列为：

```sql
id INTEGER PRIMARY KEY AUTOINCREMENT,
project_id INTEGER,
file_name TEXT NOT NULL,
channeling_type TEXT NOT NULL DEFAULT 'steam',
status TEXT NOT NULL DEFAULT 'preview',
valid_count INTEGER NOT NULL DEFAULT 0,
invalid_count INTEGER NOT NULL DEFAULT 0,
duplicate_count INTEGER NOT NULL DEFAULT 0,
self_relation_count INTEGER NOT NULL DEFAULT 0,
created_at TEXT NOT NULL,
confirmed_at TEXT,
FOREIGN KEY(project_id) REFERENCES channeling_projects(id)
```

更新公开签名：

```ts
createChannelingRelationPreview(
  db: DatabaseLike,
  projectId: number | null,
  fileName: string,
  channelingType: ChannelingType,
  rows: ChannelingRelationImportPreviewRows,
): Promise<ChannelingRelationImport>

confirmChannelingRelationImport(
  db: DatabaseLike,
  importId: number,
  projectId: number,
): Promise<ChannelingRelationImport>
```

创建预览时直接保存调用方传入并校验后的 `channelingType`，并分别写入 `valid`、`duplicate`、`self_relation`、`invalid` 快照。同步更新现有详细模板测试中的所有调用以传入 `'steam'`。确认事务中先验证项目，再按类型和井对查询已有关系；命中时把该行的 `row_class` 更新为 `duplicate`，递增重复统计，否则创建正式关系：

```ts
await createChannelingRelation(db, {
  projectId,
  channelingType: row.channelingType,
  injectionWell: row.injectorWellNo,
  productionWell: row.producerWellNo,
  reservoirLayer: row.reservoirLayer ?? '未提供',
  impactLevel: row.impactLevel ?? 'medium',
  confidence: row.confidence ?? 0.5,
  source: row.source ?? 'import',
  status: 'confirmed',
  evidence: row.evidence ?? '未提供',
  effectiveStartDate: row.effectiveStartDate ?? today,
  effectiveEndDate: row.effectiveEndDate ?? today,
  owner: row.owner ?? 'Excel导入',
});
```

最后同一事务更新批次 `project_id`、统计、状态和确认时间。同时把私有 `readImport` 包装为导出的 `getChannelingRelationImport(db, id)`，供批次详情接口读取含分类行的预览；`ChannelingRelationImport` 类型补齐 nullable `projectId`、`channelingType`、`duplicateCount`、`selfRelationCount`、`duplicates` 和 `selfRelations`。

- [ ] **Step 5: 运行测试并确认 GREEN**

Run the Task 2 command. Expected: PASS。

- [ ] **Step 6: 提交持久化改动**

```bash
git add src/lib/channelingProjectStore.ts src/lib/channelingRelationImport.ts tests/channelingProjectStore.test.ts tests/channelingRelationImport.test.ts
git commit -m "feat: persist typed channeling import previews"
```

### Task 3: 暴露无项目预览和带项目确认 API

**Files:**
- Modify: `tests/channelingProjectApi.integration.test.ts`
- Modify: `tests/channelingProjectApi.test.ts`
- Modify: `server.ts`

- [ ] **Step 1: 写入 HTTP 失败测试**

在 integration test 登录后创建项目之前，使用 SheetJS 生成矩阵文件 buffer 并提交 multipart：

```ts
const workbook = XLSX.utils.book_new();
XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([
  ['注汽井', '井号1', '井号2'],
  ['Z1', 'C1', 'Z1'],
]), 'Sheet1');
const form = new FormData();
form.append('channelingType', 'steam');
form.append('file', new Blob([XLSX.write(workbook, { type: 'array', bookType: 'xlsx' })]), '汽窜.xlsx');
const previewResponse = await fetch(`http://127.0.0.1:${port}/api/channeling-relation-imports/preview`, {
  method: 'POST', headers: authorized, body: form,
});
assert.equal(previewResponse.status, 201);
const preview = (await previewResponse.json() as any).data;
assert.equal(preview.projectId, null);
assert.equal(preview.validCount, 1);
assert.equal(preview.selfRelationCount, 1);
```

创建项目后确认：

```ts
const confirm = await request(`/api/channeling-relation-imports/${preview.id}/confirm`, {
  method: 'POST', headers: authorized, body: JSON.stringify({ projectId: project.id }),
});
assert.equal(confirm.status, 200);
const typedRelations = await request(`/api/channeling-projects/${project.id}/relations?channelingType=steam`);
assert.equal((await typedRelations.json() as any).data.length, 1);
```

再断言游客预览为 `401`、错误类型为 `400`、不存在项目确认不写入。

- [ ] **Step 2: 运行 API 测试并确认 RED**

```bash
node --import tsx --test --test-concurrency=1 tests/channelingProjectApi.test.ts tests/channelingProjectApi.integration.test.ts
```

Expected: FAIL，顶级 preview 路由返回 404。

- [ ] **Step 3: 注册新接口并保持旧历史接口**

在 `server.ts` 增加：

```ts
app.post('/api/channeling-relation-imports/preview', channelingRelationImportUploadMiddleware, async (req, res) => {
  if (!requireChannelingAdmin(req, res)) return;
  try {
    const file = (req as express.Request & { file?: { originalname: string; buffer: Buffer } }).file;
    const channelingType = String(req.body?.channelingType || '');
    if (!file) return res.status(400).json({ success: false, message: '请选择 Excel 文件' });
    if (!/\.xlsx?$/i.test(file.originalname)) return res.status(400).json({ success: false, message: '仅支持 .xlsx 和 .xls 文件' });
    if (!['steam', 'nitrogen'].includes(channelingType)) return res.status(400).json({ success: false, message: '请选择注汽窜或注氮气窜' });
    const rows = parseChannelingRelationRows(XLSX.read(file.buffer, { type: 'buffer' }), channelingType as ChannelingType);
    const data = await createChannelingRelationPreview(localDb, null, decodeUploadedFileName(file.originalname), channelingType as ChannelingType, rows);
    res.status(201).json({ success: true, data });
  } catch (error: any) {
    res.status(channelingErrorStatus(error)).json({ success: false, message: error.message });
  }
});

app.get('/api/channeling-relation-imports/:id', async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ success: false, message: 'id is invalid' });
  try { res.json({ success: true, data: await getChannelingRelationImport(localDb, id) }); }
  catch (error: any) { res.status(error.message.includes('not found') ? 404 : 500).json({ success: false, message: error.message }); }
});
```

从 `channelingProjectStore.ts` 导入 `ChannelingType`，修改确认接口读取 JSON `projectId` 并传入 `confirmChannelingRelationImport(localDb, importId, projectId)`。关系 GET 路由传递 `channelingType` query，关系 PATCH 白名单加入 `channelingType`。保留旧的项目内 preview 路由作为兼容入口，但让它调用相同解析器并立即绑定 URL 中的项目 ID。

- [ ] **Step 4: 运行 API 测试并确认 GREEN**

Run the Task 3 command. Expected: PASS。

- [ ] **Step 5: 提交 API 改动**

```bash
git add server.ts tests/channelingProjectApi.test.ts tests/channelingProjectApi.integration.test.ts
git commit -m "feat: expose channeling relationship preview API"
```

### Task 4: 在空项目状态显示上传预览卡

**Files:**
- Modify: `tests/channelingLedgerAccess.test.ts`
- Modify: `tests/channelingUiTextEncoding.test.ts`
- Modify: `src/components/ChannelingProjectManagement.tsx`

- [ ] **Step 1: 写入 UI 契约失败测试**

在 `tests/channelingLedgerAccess.test.ts` 增加：

```ts
test('channeling upload card is outside the selected-project branch and supports manual types', async () => {
  const component = await readFile(new URL('../src/components/ChannelingProjectManagement.tsx', import.meta.url), 'utf8');
  assert.match(component, /注窜关系识别/);
  assert.match(component, /value="steam"/);
  assert.match(component, /value="nitrogen"/);
  assert.match(component, /multiple=\{false\}|type="file"/);
  assert.match(component, /\/api\/channeling-relation-imports\/preview/);
  assert.match(component, /确认保存/);
  assert.ok(component.indexOf('注窜关系识别') < component.indexOf('selected ?'));
});
```

在 encoding test 主标签测试中加入 `注汽窜`、`注氮气窜`、`有效关系`、`自关联`。

- [ ] **Step 2: 运行测试并确认 RED**

```bash
node --import tsx --test --test-concurrency=1 tests/channelingLedgerAccess.test.ts tests/channelingUiTextEncoding.test.ts
```

Expected: FAIL，常驻卡片和类型文案不存在。

- [ ] **Step 3: 实现上传、预览和确认状态**

在组件中增加状态：

```ts
const [channelingType, setChannelingType] = useState<ChannelingType>('steam');
const [selectedImportProjectId, setSelectedImportProjectId] = useState<number | null>(null);
const [importPreview, setImportPreview] = useState<ChannelingRelationImport | null>(null);
const [importing, setImporting] = useState(false);
```

同时从 store 导入 `ChannelingType`，把 `blankRelation()` 的默认关系补为 `channelingType: 'steam'`，并在手工新增关系表单加入相同的类型选择，确保 `ChannelingRelationInput` 的所有调用方都提供该字段。

把上传 handler 改为调用顶级 preview 路由并提交类型：

```ts
const uploadRelations = async (event: React.ChangeEvent<HTMLInputElement>) => {
  const file = event.target.files?.[0];
  event.target.value = '';
  if (!file) return;
  const body = new FormData();
  body.append('channelingType', channelingType);
  body.append('file', file);
  setImporting(true);
  try {
    const preview = await request('/api/channeling-relation-imports/preview', { method: 'POST', body });
    setImportPreview(preview);
    setSelectedImportProjectId(selected?.id ?? projects[0]?.id ?? null);
    setMessage('解析完成，请检查预览并选择项目');
  } catch (error: any) { setMessage(error.message); }
  finally { setImporting(false); }
};
```

确认 handler 提交选择的项目：

```ts
const confirmImport = async (id: number) => {
  if (!selectedImportProjectId) { setMessage('请先新建或选择项目'); return; }
  try {
    await request(`/api/channeling-relation-imports/${id}/confirm`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ projectId: selectedImportProjectId }),
    });
    setSelectedId(selectedImportProjectId);
    setImportPreview(null);
    await loadRelations(selectedImportProjectId);
  } catch (error: any) { setMessage(error.message); }
};
```

在 `selected ?` 条件之前渲染管理员上传卡，包含类型选择、单文件 input、摘要统计、异常/有效行预览、项目选择和禁用条件明确的确认按钮。不要保留项目详情内部旧的文件 input，避免两个入口。

关系筛选增加 `channelingType`，请求和前端列表都支持类型；每条关系展示“注汽窜”或“注氮气窜”标签。

- [ ] **Step 4: 运行 UI 测试和类型检查**

```bash
node --import tsx --test --test-concurrency=1 tests/channelingLedgerAccess.test.ts tests/channelingUiTextEncoding.test.ts
npm run lint
```

Expected: 两个测试文件 PASS；TypeScript 无新增错误。

- [ ] **Step 5: 提交 UI 改动**

```bash
git add src/components/ChannelingProjectManagement.tsx tests/channelingLedgerAccess.test.ts tests/channelingUiTextEncoding.test.ts
git commit -m "feat: add persistent channeling upload preview"
```

### Task 5: 修正登录和注册反馈文案

**Files:**
- Create: `tests/authUiFeedback.test.ts`
- Modify: `src/App.tsx`

- [ ] **Step 1: 写入登录反馈失败测试**

```ts
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('login and registration feedback never uses import wording', async () => {
  const app = await readFile(new URL('../src/App.tsx', import.meta.url), 'utf8');
  const login = app.slice(app.indexOf('const Login ='), app.indexOf('export default function App'));
  assert.match(login, /注册成功，请登录/);
  assert.match(login, /无法连接服务器，请确认服务已启动/);
  assert.doesNotMatch(login, /导入成功！已更新数据|导入失败，请检查文件格式/);
});
```

- [ ] **Step 2: 运行测试并确认 RED**

```bash
node --import tsx --test --test-concurrency=1 tests/authUiFeedback.test.ts
```

Expected: FAIL，仍匹配到两条导入文案。

- [ ] **Step 3: 最小修正文案**

在 Login 的注册成功分支改为：

```ts
setSuccess('注册成功，请登录');
```

catch 分支改为：

```ts
} catch {
  setError('无法连接服务器，请确认服务已启动');
}
```

保留接口业务错误 `setError(data.message || '操作失败')`，以继续显示“用户名或密码错误”。

- [ ] **Step 4: 运行测试并确认 GREEN**

Run the Task 5 command. Expected: PASS。

- [ ] **Step 5: 提交登录修复**

```bash
git add src/App.tsx tests/authUiFeedback.test.ts
git commit -m "fix: correct authentication feedback messages"
```

### Task 6: 全量验证和浏览器验收

**Files:**
- No production file changes expected

- [ ] **Step 1: 运行注窜相关测试**

```bash
node --import tsx --test --test-concurrency=1 tests/channeling*.test.ts tests/authUiFeedback.test.ts
```

Expected: 全部 PASS，无未处理 rejection 或 SQLite transaction 警告。

- [ ] **Step 2: 运行项目级校验**

```bash
npm test
npm run lint
npm run build
```

Expected: 三条命令均 exit 0。若已有与本功能无关的基线失败，记录精确测试名和现象，不修改无关代码。

- [ ] **Step 3: 启动服务并完成管理员浏览器验收**

使用 `npm run dev` 后检查：

1. 空项目清单时，顶部仍显示“注窜关系识别”。
2. 选择“注汽窜”并上传 `注窜关系（汽窜）(1).xlsx`，预览显示原始关系 466、自关联 6、有效 460（无文件内重复时）。
3. 选择“注氮气窜”并上传 `注窜关系（氮气窜）.xlsx`，预览显示有效 24、自关联 0。
4. 没有项目时确认按钮禁用并提示创建项目；创建项目后可确认。
5. 确认后关系显示类型标签，并可按类型筛选。
6. 停止服务后提交登录，显示“无法连接服务器，请确认服务已启动”；重启后错误账号显示“用户名或密码错误”。

- [ ] **Step 4: 检查最终差异范围**

```bash
git status --short
git diff --check
git diff --stat
```

Expected: 仅包含本计划列出的文件；不覆盖或提交用户原有的其他工作区修改。
