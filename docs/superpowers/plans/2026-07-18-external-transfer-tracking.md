# 外输跟踪 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox syntax for tracking.

**Goal:** 在产量掌控中提供可上传 Sheet1 外输数据、按计量站和日期透视查看四项连续趋势的页面。

**Architecture:** 浏览器端使用现有 xlsx 解析用户文件；纯函数模块负责校验、日期标准化、筛选和多站逐日汇总。组件只管理上传与筛选状态并渲染 ECharts，App.tsx 只负责导航入口。

**Tech Stack:** React 19、TypeScript、Vite、SheetJS (xlsx)、ECharts、Node test runner。

---

## 文件结构

- Create: src/lib/externalTransferTracking.ts — Excel 解析、记录类型、筛选与每日汇总。
- Create: src/components/ExternalTransferTracking.tsx — 上传、筛选、空/错误状态和四图看板。
- Create: tests/externalTransferTracking.test.ts — 数据层单元测试。
- Modify: src/lib/sidebarNavigation.ts — 导航类型与“外输跟踪”项目。
- Modify: src/App.tsx — 页面标题和组件渲染。

### Task 1: 建立外输数据解析与透视聚合

**Files:**
- Create: tests/externalTransferTracking.test.ts
- Create: src/lib/externalTransferTracking.ts

- [ ] **Step 1: 写入解析和汇总的失败测试**

在新测试文件中创建 Sheet1 工作簿，表头为 日期、计量站、井数、日产液总量、日产油总量、日掺油总量、综合含水、外输、稀油用量（方）。断言 parseExternalTransferWorkbook 将 1/2/26 标准化为 2026-01-02；空稀油为 null；缺少 Sheet1 或日产液总量时抛出错误。为同日 18站（20井，60%含水）和21站（10井，80%含水）断言 summarizeExternalTransfer 返回总井数30、液量150、油量45、掺油15、外输165、稀油12，含水66.66666666666667。

- [ ] **Step 2: 运行测试并确认其失败**

Run: npm test -- tests/externalTransferTracking.test.ts

Expected: FAIL，提示 externalTransferTracking.ts 尚不存在。

- [ ] **Step 3: 实现最小解析模块**

定义 ExternalTransferRecord：date、station 及 wellCount、liquid、oil、diluent、waterCut、transfer、thinOil 数值字段；每一个数值字段均允许 null。定义 ExternalTransferDaily 为不含 station 的记录。

实现 parseExternalTransferWorkbook(workbook)：
    - 仅读取 workbook.Sheets.Sheet1；缺失时抛出“文件缺少 Sheet1 工作表”。
    - 校验上述九个表头都存在；缺少时抛出包含缺列名称的错误。
    - 支持 Excel serial、M/D/YY、YYYY-M-D 日期，统一为 yyyy-mm-dd。
    - 跳过无效日期或空计量站；空数值保留为 null；返回按名称排序且去重的 stations。

实现 summarizeExternalTransfer(records, stations, start, end)：
    - 过滤选中站和闭区间日期，按日期升序返回。
    - 井数、液量、油量、掺油、外输、稀油求和。
    - 综合含水使用 waterCut * wellCount / ΣwellCount；没有可用井数时返回 null。

- [ ] **Step 4: 运行数据层验证**

Run: npm test -- tests/externalTransferTracking.test.ts; npm test

Expected: 两条命令均 PASS。

- [ ] **Step 5: 提交数据层改动**

Run: git add src/lib/externalTransferTracking.ts tests/externalTransferTracking.test.ts; git commit -m "feat: parse external transfer workbook"

### Task 2: 增加外输跟踪看板组件

**Files:**
- Create: src/components/ExternalTransferTracking.tsx

- [ ] **Step 1: 实现上传和筛选状态**

实现 ExternalTransferTracking。隐藏文件控件仅接受 .xlsx，以 file.arrayBuffer() 读取，通过 XLSX.read(buffer, { type: 'array', cellDates: true }) 得到工作簿，随后调用 parseExternalTransferWorkbook。成功后加载 records、选择全部 stations，日期范围初始化为记录中的最早和最晚日期。失败时展示错误文字且不清空已加载数据。

未上传显示上传引导；上传后显示计量站原生多选、两个 type=date 控件、“全选计量站”和“重新上传”按钮。多选值由 Array.from(event.target.selectedOptions, option => option.value) 创建 Set。

- [ ] **Step 2: 渲染四图透视看板**

对 summarizeExternalTransfer(records, selectedStations, startDate, endDate) 的结果创建共用 ECharts option 工厂。每张图必须有 axis tooltip、legend、日期类目轴和 dataZoom。

四张 app-card 图表分别为：
    1. 井口液与外输：日产液总量、外输，均为折线。
    2. 稀油用量与井口稀油：日掺油总量、稀油用量（方），均为折线。
    3. 井口产油：日产油总量为左轴柱状图、井数为右轴折线图。
    4. 含水：综合含水折线图。

每图用 ReactECharts 且高度 320。无聚合数据时不渲染图表，显示“当前筛选条件下没有可展示的数据”。不得添加自动异常阈值、颜色标记或结论。

- [ ] **Step 3: 运行组件相关静态验证**

Run: npm run lint; npm run build

Expected: 两条命令均以 exit code 0 完成。

- [ ] **Step 4: 提交页面组件**

Run: git add src/components/ExternalTransferTracking.tsx; git commit -m "feat: add external transfer dashboard"

### Task 3: 挂入产量掌控导航并验收

**Files:**
- Modify: src/lib/sidebarNavigation.ts
- Modify: src/App.tsx
- Modify: tests/sidebarNavigation.test.ts

- [ ] **Step 1: 增加导航失败测试**

在现有导航测试中断言 production 组 item tabs 的顺序为 productionForecast、externalTransferTracking。

- [ ] **Step 2: 运行导航测试并确认失败**

Run: npm test -- tests/sidebarNavigation.test.ts

Expected: FAIL，因为新 tab 尚未定义。

- [ ] **Step 3: 最小化集成页面**

在 SidebarTab 联合类型加入 externalTransferTracking；在 production 分组紧随 productionForecast 添加 { tab: 'externalTransferTracking', label: '外输跟踪', icon: 'TrendingUp' }。在 App.tsx 导入 ExternalTransferTracking，新增页面标题“外输跟踪”，并按 activeTab === 'externalTransferTracking' 渲染该组件。

- [ ] **Step 4: 运行完整验证与手工验收**

Run: npm test; npm run lint; npm run build

Expected: 三条命令均 PASS。

启动 npm run dev，打开“产量掌控 → 外输跟踪”，上传 C:\Users\31541\Downloads\外输分析7月(1)..xlsx，确认默认使用 Sheet1；单站、多站、日期范围会同步刷新四图；多站含水按井数加权；空日期范围显示空状态。

- [ ] **Step 5: 提交导航集成**

Run: git add src/lib/sidebarNavigation.ts src/App.tsx tests/sidebarNavigation.test.ts; git commit -m "feat: add external transfer tracking navigation"

## 自检

- Sheet1 限制、字段校验、空/错误状态由 Task 1 和 2 覆盖。
- 四图、计量站多选、日期范围及连续日期趋势由 Task 2 覆盖。
- 未实现自动异常阈值，符合仅供人工判读的范围。

## 2026-07-18 图表扩展

### Task 4: 增加外输差、排污和回流指标

**Files:**
- Modify: `tests/externalTransferTracking.test.ts`
- Modify: `src/lib/externalTransferTracking.ts`
- Modify: `src/components/ExternalTransferTracking.tsx`

- [ ] **Step 1: 写入失败测试**

在测试工作簿表头加入 `外输差`、`排污`、`回流`，并在样例记录中加入数值。断言解析结果包含 `transferDifference`、`sewage`、`returnFlow`；多站同日汇总时三项数值均求和。

- [ ] **Step 2: 运行测试确认失败**

Run: `npm test -- tests/externalTransferTracking.test.ts`

Expected: FAIL，新增字段尚未定义。

- [ ] **Step 3: 更新数据模型与解析**

在 `ExternalTransferRecord` 和 `ExternalTransferDaily` 中新增 `transferDifference`、`sewage`、`returnFlow`，三个字段均为 `number | null`。在表头映射中分别绑定 `外输差`、`排污`、`回流`，并在 `summarizeExternalTransfer` 中逐日求和。

- [ ] **Step 4: 增加两张图表**

在现有看板网格中增加：

```ts
chartOption('外输差值', daily, [{ name: '外输差', metric: 'transferDifference' }])
chartOption('排污/回流', daily, [
  { name: '排污', metric: 'sewage' },
  { name: '回流', metric: 'returnFlow', yAxisIndex: 1 },
], true)
```

排污/回流图必须传入双轴配置，确保排污为左侧主坐标轴、回流为右侧副坐标轴。

- [ ] **Step 5: 验证并提交**

Run: `npm test; npm run build`

Expected: 两条命令均 PASS。

```bash
git add src/lib/externalTransferTracking.ts src/components/ExternalTransferTracking.tsx tests/externalTransferTracking.test.ts
git commit -m "feat: add external transfer difference charts"
```
