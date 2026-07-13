# 井温监控模块 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在“措施分析”后提供可持久化的井温测试数据上传、历史记录浏览、温度/压力-井深曲线和射孔井段标注。

**Architecture:** 新建一个只负责 Excel 解析与数据类型的服务端模块，以便直接单测。`server.ts` 使用该模块建立 SQLite 表、通过事务执行同井同日覆盖，并暴露导入/列表/详情/删除 API；`src/App.tsx` 按现有单文件页面模式增加独立模块状态、上传动作和 ECharts 图表。

**Tech Stack:** React 19、TypeScript、Express、SQLite (`sqlite`/`sqlite3`)、Multer、SheetJS (`xlsx`)、ECharts、Node built-in test runner + `tsx`。

---

## 文件结构

- 新建 `wellTemperature.ts`：读取工作簿、规范化日期、从 C/D/E/F/G/H/I 列提取测试摘要和测点；不访问数据库。
- 新建 `tests/wellTemperature.test.ts`：针对真实样例工作簿的解析回归测试，以及无效文件的失败断言。
- 新建 `tests/fixtures/高2-2-96（2026-06-21）井筒温度压力测试表.xlsx`：从用户提供的同名样例复制，作为稳定回归夹具。
- 修改 `package.json`：增加 `test` 脚本，不增加依赖。
- 修改 `server.ts`：导入解析器、初始化两张井温表、添加数据访问函数、Multer 中间件和四个 API。
- 修改 `src/App.tsx`：新增导航项、类型/状态/加载和上传函数、曲线 option、井温监控页面。

### Task 1: 建立可测试的 Excel 解析器

**Files:**
- Create: `wellTemperature.ts`
- Create: `tests/fixtures/高2-2-96（2026-06-21）井筒温度压力测试表.xlsx`
- Create: `tests/wellTemperature.test.ts`
- Modify: `package.json`

- [ ] **Step 1: 复制样例工作簿并写解析测试。**

将 `C:\Users\31541\Desktop\7.6\GSyuan7.10\井温测试\高2-2-96（2026-06-21）井筒温度压力测试表.xlsx` 复制到 `tests/fixtures`，然后创建：

```ts
// tests/wellTemperature.test.ts
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { parseWellTemperatureWorkbook } from "../wellTemperature.ts";

const fixturePath = path.join(process.cwd(), "tests", "fixtures", "高2-2-96（2026-06-21）井筒温度压力测试表.xlsx");

test("parses well, date, E/H/I points, and F/G perforation interval", async () => {
  const parsed = parseWellTemperatureWorkbook(
    "高2-2-96（2026-06-21）井筒温度压力测试表.xlsx",
    await readFile(fixturePath)
  );

  assert.equal(parsed.wellNo, "高2-2-96");
  assert.equal(parsed.testDate, "2026-06-21");
  assert.equal(parsed.perforationTopDepth, 1555.6);
  assert.equal(parsed.perforationBottomDepth, 1610.1);
  assert.equal(parsed.points.length, 2291);
  assert.deepEqual(parsed.points[0], { depth: 0.1, temperature: 31.9, pressure: 0 });
  assert.ok(parsed.points.every((point, index, rows) => index === 0 || rows[index - 1].depth <= point.depth));
});

test("rejects a workbook without valid measurement points", () => {
  assert.throws(
    () => parseWellTemperatureWorkbook("空表.xlsx", Buffer.from("not-an-xlsx")),
    /无法读取 Excel 文件|未读取到有效测试测点/
  );
});
```

在 `package.json` 的 `scripts` 增加：

```json
"test": "node --import tsx --test tests/**/*.test.ts"
```

- [ ] **Step 2: 运行测试，确认因解析器不存在而失败。**

Run: `npm test`

Expected: `ERR_MODULE_NOT_FOUND`，指出 `wellTemperature.ts` 尚不存在。

- [ ] **Step 3: 实现最小解析器。**

创建 `wellTemperature.ts`；列索引严格采用用户指定的 Excel 列（零基索引 C=2、D=3、E=4、F=5、G=6、H=7、I=8）。

```ts
import * as XLSX from "xlsx";

export interface WellTemperaturePoint {
  depth: number;
  temperature: number | null;
  pressure: number | null;
}

export interface ParsedWellTemperatureTest {
  wellNo: string;
  testDate: string;
  perforationTopDepth: number | null;
  perforationBottomDepth: number | null;
  points: WellTemperaturePoint[];
}

const asNumber = (value: unknown): number | null => {
  const numberValue = typeof value === "number" ? value : Number(String(value ?? "").trim().replace(/,/g, ""));
  return Number.isFinite(numberValue) ? numberValue : null;
};

const asText = (value: unknown) => String(value ?? "").trim();

function toIsoDate(value: unknown): string {
  if (value instanceof Date && !Number.isNaN(value.valueOf())) return value.toISOString().slice(0, 10);
  const text = asText(value);
  const matched = text.match(/^(\d{4})[-/]?(\d{1,2})[-/]?(\d{1,2})$/) || text.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (!matched) return "";
  const [_, first, second, third] = matched;
  const [year, month, day] = first.length === 4
    ? [Number(first), Number(second), Number(third)]
    : [Number(third.length === 2 ? `20${third}` : third), Number(first), Number(second)];
  return new Date(Date.UTC(year, month - 1, day)).toISOString().slice(0, 10);
}

function metadataFromFilename(fileName: string) {
  const matched = fileName.match(/^(.+?)[（(](\d{4}-\d{2}-\d{2})[）)]/);
  return { wellNo: matched?.[1]?.replace(/井$/, "").trim() || "", testDate: matched?.[2] || "" };
}

export function parseWellTemperatureWorkbook(fileName: string, buffer: Buffer): ParsedWellTemperatureTest {
  let workbook: XLSX.WorkBook;
  try { workbook = XLSX.read(buffer, { type: "buffer", cellDates: true }); }
  catch { throw new Error("无法读取 Excel 文件"); }
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  if (!sheet) throw new Error("Excel 文件不包含工作表");
  const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: null, raw: true });
  const records = rows.slice(2).map((row) => ({ row, depth: asNumber(row[4]), temperature: asNumber(row[7]), pressure: asNumber(row[8]) }))
    .filter((item) => item.depth !== null && (item.temperature !== null || item.pressure !== null));
  if (!records.length) throw new Error("未读取到有效测试测点");
  const first = records[0].row;
  const fallback = metadataFromFilename(fileName);
  const wellNo = asText(first[2]) || fallback.wellNo;
  const testDate = toIsoDate(first[3]) || fallback.testDate;
  if (!wellNo || !testDate) throw new Error("无法确定井号或测试日期");
  return {
    wellNo, testDate,
    perforationTopDepth: asNumber(first[5]), perforationBottomDepth: asNumber(first[6]),
    points: records.map(({ depth, temperature, pressure }) => ({ depth: depth!, temperature, pressure })).sort((a, b) => a.depth - b.depth)
  };
}
```

- [ ] **Step 4: 运行解析测试，确认通过。**

Run: `npm test`

Expected: 2 个子测试通过，包含 2291 个测点、`高2-2-96`、`2026-06-21`、`1555.6–1610.1` 的断言。

- [ ] **Step 5: 提交解析器。**

```bash
git add wellTemperature.ts tests/wellTemperature.test.ts tests/fixtures package.json
git commit -m "feat: parse well temperature workbooks"
```

### Task 2: 持久化井温测试并提供 API

**Files:**
- Modify: `server.ts:1-30, 898-990, 2977-2985, 3378-3380`
- Test: `tests/wellTemperature.test.ts`

- [ ] **Step 1: 为覆盖规则写失败的数据库测试。**

把下列纯函数加入 `tests/wellTemperature.test.ts` 的第二个测试块之后，并在 `wellTemperature.ts` 暂时不导出它：

```ts
import { buildWellTemperatureReplaceSql } from "../wellTemperature.ts";

test("defines a transactional replacement keyed by well number and test date", () => {
  const statements = buildWellTemperatureReplaceSql(7, { wellNo: "高2-2-96", testDate: "2026-06-21" });
  assert.match(statements.deletePoints, /DELETE FROM well_temperature_points WHERE test_id = \?/);
  assert.match(statements.deleteTest, /DELETE FROM well_temperature_tests WHERE well_no = \? AND test_date = \?/);
  assert.deepEqual(statements.deleteTestParams, ["高2-2-96", "2026-06-21"]);
});
```

- [ ] **Step 2: 运行测试，确认新导出不存在。**

Run: `npm test`

Expected: 测试加载失败，提示 `buildWellTemperatureReplaceSql` 未导出。

- [ ] **Step 3: 在解析器中导出事务 SQL 描述，并在服务器中接入持久化。**

在 `wellTemperature.ts` 追加：

```ts
export function buildWellTemperatureReplaceSql(_testId: number, key: Pick<ParsedWellTemperatureTest, "wellNo" | "testDate">) {
  return {
    deletePoints: "DELETE FROM well_temperature_points WHERE test_id = ?",
    deleteTest: "DELETE FROM well_temperature_tests WHERE well_no = ? AND test_date = ?",
    deleteTestParams: [key.wellNo, key.testDate]
  };
}
```

在 `server.ts` 导入 `parseWellTemperatureWorkbook` 和 `buildWellTemperatureReplaceSql`。在 `initLocalDb()` 的建表 SQL 中加入：

```sql
CREATE TABLE IF NOT EXISTS well_temperature_tests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  well_no TEXT NOT NULL,
  test_date TEXT NOT NULL,
  perforation_top_depth REAL,
  perforation_bottom_depth REAL,
  point_count INTEGER NOT NULL,
  source_file TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(well_no, test_date)
);
CREATE TABLE IF NOT EXISTS well_temperature_points (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  test_id INTEGER NOT NULL,
  depth REAL NOT NULL,
  temperature REAL,
  pressure REAL,
  FOREIGN KEY(test_id) REFERENCES well_temperature_tests(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_well_temperature_tests_well_date ON well_temperature_tests(well_no, test_date DESC);
CREATE INDEX IF NOT EXISTS idx_well_temperature_points_test_depth ON well_temperature_points(test_id, depth);
```

在 `startServer()` 中创建 `wellTemperatureUpload`，复用 `handleMeasureImportUpload` 和 `MEASURE_IMPORT_FILE_LIMIT_BYTES`。新增 `replaceWellTemperatureTest(file)`：解析文件、`BEGIN`、找出同井同日旧测试 ID、删除其点和摘要、插入新摘要、批量插入点、`COMMIT`；catch 中 `ROLLBACK` 后继续抛错。所有 SQL 参数均使用 `?`。

在措施导入路由之后添加：

```ts
app.post("/api/well-temperature-tests/import", wellTemperatureUploadMiddleware, async (req, res) => {
  const file = (req as express.Request & { file?: { originalname: string; buffer: Buffer } }).file;
  if (!file || !file.originalname.toLowerCase().endsWith(".xlsx")) {
    res.status(400).json({ success: false, message: "请上传 .xlsx 井温测试文件" }); return;
  }
  try { res.json({ success: true, data: await replaceWellTemperatureTest(file), message: "井温测试数据已保存" }); }
  catch (error: any) { res.status(400).json({ success: false, message: error.message || "井温测试数据导入失败" }); }
});
app.get("/api/well-temperature-tests", async (req, res) => {
  const wellNo = typeof req.query.wellNo === "string" ? req.query.wellNo.trim() : "";
  const rows = await localDb.all(
    `SELECT id, well_no AS wellNo, test_date AS testDate, perforation_top_depth AS perforationTopDepth,
      perforation_bottom_depth AS perforationBottomDepth, point_count AS pointCount, source_file AS sourceFile,
      created_at AS createdAt, updated_at AS updatedAt FROM well_temperature_tests
      ${wellNo ? "WHERE well_no LIKE ?" : ""} ORDER BY well_no, test_date DESC`,
    wellNo ? [`%${wellNo}%`] : []
  );
  res.json({ success: true, data: rows });
});
app.get("/api/well-temperature-tests/:id", async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) { res.status(400).json({ success: false, message: "无效测试记录 ID" }); return; }
  const summary = await localDb.get("SELECT id, well_no AS wellNo, test_date AS testDate, perforation_top_depth AS perforationTopDepth, perforation_bottom_depth AS perforationBottomDepth, point_count AS pointCount, source_file AS sourceFile, created_at AS createdAt, updated_at AS updatedAt FROM well_temperature_tests WHERE id = ?", [id]);
  if (!summary) { res.status(404).json({ success: false, message: "井温测试记录不存在" }); return; }
  const points = await localDb.all("SELECT depth, temperature, pressure FROM well_temperature_points WHERE test_id = ? ORDER BY depth", [id]);
  res.json({ success: true, data: { ...summary, points } });
});
app.delete("/api/well-temperature-tests/:id", async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) { res.status(400).json({ success: false, message: "无效测试记录 ID" }); return; }
  await localDb.exec("BEGIN");
  try {
    await localDb.run("DELETE FROM well_temperature_points WHERE test_id = ?", [id]);
    const result = await localDb.run("DELETE FROM well_temperature_tests WHERE id = ?", [id]);
    if (!result.changes) { await localDb.exec("ROLLBACK"); res.status(404).json({ success: false, message: "井温测试记录不存在" }); return; }
    await localDb.exec("COMMIT"); res.json({ success: true, message: "井温测试记录已删除" });
  } catch (error) { await localDb.exec("ROLLBACK"); throw error; }
});
```

- [ ] **Step 4: 运行单元测试和手动 API 覆盖验证。**

Run: `npm test`

Expected: 3 个子测试通过。

启动服务后运行：

```powershell
$file = 'C:\Users\31541\Desktop\7.6\GSyuan7.10\井温测试\高2-2-96（2026-06-21）井筒温度压力测试表.xlsx'
curl.exe -F "file=@$file" http://localhost:5000/api/well-temperature-tests/import
curl.exe http://localhost:5000/api/well-temperature-tests
```

Expected: 导入响应包含 `wellNo: "高2-2-96"`、`testDate: "2026-06-21"`、`pointCount: 2291`；同一命令再次执行后，列表仍只含该井该日一条记录。

- [ ] **Step 5: 提交服务端持久化与接口。**

```bash
git add server.ts wellTemperature.ts tests/wellTemperature.test.ts
git commit -m "feat: persist well temperature tests"
```

### Task 3: 增加井温监控页面与曲线

**Files:**
- Modify: `src/App.tsx:1-120, 2104-2225, 2416-2419, 4328-4332, 4623-4685, 5762-5773, 5831-5844, 6749-6750`

- [ ] **Step 1: 为曲线 option 写失败的前端纯函数测试。**

在 `src/wellTemperatureChart.ts` 先创建测试期望，再实现；该文件不依赖 React，方便 Node 测试。

```ts
// tests/wellTemperatureChart.test.ts
import assert from "node:assert/strict";
import test from "node:test";
import { getWellTemperatureChartOption } from "../src/wellTemperatureChart.ts";

test("builds an inverse depth chart with a perforation mark area", () => {
  const option = getWellTemperatureChartOption("井温曲线", "温度", "℃", "#ef4444", [
    { depth: 0.1, temperature: 31.9, pressure: 0 },
    { depth: 1555.6, temperature: 80, pressure: 5 }
  ], "temperature", 1555.6, 1610.1) as any;
  assert.equal(option.yAxis.inverse, true);
  assert.deepEqual(option.series[0].data[0], [31.9, 0.1]);
  assert.equal(option.series[0].markArea.data[0][0].yAxis, 1555.6);
  assert.equal(option.series[0].markArea.data[0][1].yAxis, 1610.1);
});
```

- [ ] **Step 2: 运行测试，确认模块尚不存在。**

Run: `node --import tsx --test tests/wellTemperatureChart.test.ts`

Expected: `ERR_MODULE_NOT_FOUND`，指出 `src/wellTemperatureChart.ts` 尚不存在。

- [ ] **Step 3: 实现图表 option 与前端状态。**

创建 `src/wellTemperatureChart.ts`，实现下列接口；数据点使用 `[value, depth]`，Y 轴设 `inverse: true`，只有顶深和底深均存在时才设置 `markArea`：

```ts
export function getWellTemperatureChartOption(
  title: string, seriesName: string, unit: string, color: string,
  points: Array<{ depth: number; temperature: number | null; pressure: number | null }>,
  field: "temperature" | "pressure", top: number | null, bottom: number | null
) {
  return {
    title: { text: title, left: "center", textStyle: { fontSize: 15 } },
    tooltip: { trigger: "axis", formatter: (items: any[]) => `${items[0]?.value?.[1] ?? "-"} m<br/>${seriesName}：${items[0]?.value?.[0] ?? "-"} ${unit}` },
    grid: { left: 70, right: 30, top: 55, bottom: 45 },
    xAxis: { type: "value", name: `${seriesName}(${unit})` },
    yAxis: { type: "value", name: "井深(m)", inverse: true },
    series: [{ type: "line", name: seriesName, showSymbol: false, smooth: true, lineStyle: { color, width: 2 }, data: points.filter((point) => point[field] !== null).map((point) => [point[field], point.depth]), markArea: top !== null && bottom !== null ? { silent: true, itemStyle: { color: "rgba(251, 191, 36, .28)" }, label: { show: true, formatter: `射孔井段 ${top}–${bottom}m` }, data: [[{ yAxis: top }, { yAxis: bottom }]] } : undefined }]
  };
}
```

在 `App.tsx`：

1. 从 `lucide-react` 导入 `Thermometer`；把 `wellTemperature` 加入 `activeTab` 联合类型。
2. 添加 `WellTemperatureTestSummary`、`WellTemperatureTestDetail` 类型，`wellTemperatureImportInputRef`、`wellTemperatureTests`、`wellTemperatureSelectedId`、`wellTemperatureDetail`、`wellTemperatureLoading`、`wellTemperatureImporting`、`wellTemperatureError` 状态。
3. 添加 `loadWellTemperatureTests` 和 `loadWellTemperatureTest(id)`，分别请求列表和详情；导入成功后刷新列表并选中服务端返回的 `id`；删除成功后清空详情并刷新列表。
4. 在 `activeTab === 'wellTemperature'` 时触发首次列表加载；导航中紧接“措施分析”添加 `SidebarItem`，页面标题添加“井温监控”。
5. 在 `measureAnalysis` 页面块结束后插入 `wellTemperature` 页面：隐藏 file input（`accept=".xlsx"`）、上传按钮、加载/错误提示；左列为井号文本筛选和按井号/日期显示的记录按钮；右列为选中记录摘要和两个 `ReactECharts`，分别调用 `getWellTemperatureChartOption(..., "temperature", ...)` 与 `getWellTemperatureChartOption(..., "pressure", ...)`。

- [ ] **Step 4: 运行图表测试、构建并进行浏览器验收。**

Run: `npm test && npm run build`

Expected: 全部测试通过，Vite 构建退出码为 0。

浏览器验收：打开 `http://localhost:5000`，登录后点击“措施分析”后面的“井温监控”；上传样例文件；确认：

1. 历史记录出现 `高2-2-96 / 2026-06-21 / 2291 个测点`。
2. 井温、井压两张图的井深从上到下增加。
3. 图中均出现 `1555.6–1610.1m` 的浅黄色射孔井段。
4. 再次上传同一文件，列表没有重复条目。

- [ ] **Step 5: 提交前端页面。**

```bash
git add src/App.tsx src/wellTemperatureChart.ts tests/wellTemperatureChart.test.ts package.json
git commit -m "feat: add well temperature monitoring page"
```

### Task 4: 发布前验证与备份同步

**Files:**
- Modify: `README.md`（仅在现有“核心功能”列表中增加一条“井温监控”说明）

- [ ] **Step 1: 更新 README 的功能列表。**

在“核心功能”列表中新增：

```md
- **井温监控**：上传井筒温度压力测试表，按井号和测试日期保存历史测试，显示温度/压力—井深曲线及射孔井段。
```

- [ ] **Step 2: 完整验证。**

Run: `npm test && npm run build && git status --short`

Expected: 测试全部通过、构建退出码为 0；`git status --short` 只显示 README 的预期修改。

- [ ] **Step 3: 提交并推送。**

```bash
git add README.md
git commit -m "docs: document well temperature monitoring"
git push origin main
```

- [ ] **Step 4: 验证远程备份。**

Run: `git ls-remote --heads origin main`

Expected: 输出的 `main` 提交哈希与 `git rev-parse HEAD` 完全一致。

## 计划自检

- 规格覆盖：Task 1 实现 C/D/E/F/G/H/I 读取和样例回归；Task 2 实现独立表、覆盖语义和 API；Task 3 实现“措施分析”后导航、历史列表、反向井深曲线与射孔区间；Task 4 验证并推送。
- 占位扫描：无未实现标记或模糊的后续步骤。
- 类型一致性：服务端解析器使用 `wellNo`/`testDate`/`points`；API 详情和图表均使用 `depth`、`temperature`、`pressure`，射孔字段均为 `perforationTopDepth`/`perforationBottomDepth`。
