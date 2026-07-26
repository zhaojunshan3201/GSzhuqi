# README 业务说明与技术部署文档 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 以 UTF-8 中文完整重写 README，使其同时说明数智化注采管理系统的业务能力与本地技术部署方式。

**Architecture:** README 以业务主线和功能边界为上半部分，以技术栈、环境、启动、数据、接口、测试和构建为技术附录。文档只描述当前可用能力和明确的扩展边界，不变更任何应用代码或运行配置。

**Tech Stack:** Markdown、Node.js、React、Express、SQLite、Vite。

---

## File structure

- Modify: `README.md` — 用 UTF-8 中文完整替换旧乱码内容，提供业务说明和技术部署附录。
- Modify: `docs/superpowers/plans/2026-07-26-readme-business-and-deployment.md` — 本实施计划；不在实现提交中重复修改。

### Task 1: 重写业务与部署 README

**Files:**
- Modify: `README.md`

- [ ] **Step 1: 写入文档校验脚本并确认旧 README 不符合新口径**

在 PowerShell 中运行以下只读校验，确认旧文档包含乱码或旧系统名称，且不包含目标业务闭环标题：

```powershell
$readme = Get-Content -Raw README.md
if ($readme -match '数智化注采管理系统' -and $readme -match '选井决策 → 方案与计划 → 施工监控') {
  throw 'README already matches the new product description'
}
if ($readme -notmatch '[�]|???') {
  Write-Output 'README still requires terminology and structure replacement'
}
```

- [ ] **Step 2: 运行校验以确认当前 README 未满足目标**

Run: `powershell -NoProfile -Command "...Step 1 command..."`

Expected: 退出码为 0，且不会输出 “README already matches the new product description”。

- [ ] **Step 3: 用最小完整内容替换 README**

按以下固定顺序撰写 UTF-8 中文 Markdown：

```markdown
# 数智化注采管理系统

## 系统定位
## 注汽管理业务闭环
选井决策 → 方案与计划 → 施工监控 → 焖井转抽 → 生产响应 → 效果评价 → 优化复盘
## 核心业务模块
## 数智化决策能力
## 角色与数据边界
## 技术架构
## 快速启动
## 环境变量与生产启动
## 数据存储与数据接入
## 接口能力概览
## 验证与构建
## 当前边界与后续扩展
```

业务模块必须说明：系统概览、注采驾驶舱、注采状态地图、选井决策、方案与计划、施工监控、焖井转抽、生产响应、效果评价、注汽优化预测、运行报告、注窜项目台账。

数智化能力必须说明：可解释选井评分、同类井智能匹配、四情景产量预测、Top 3 最优运行推荐、注窜影响与治理闭环、自动日报/周报/项目复盘。

技术附录必须包含以下准确命令和信息：

```bash
npm install
npm run dev
npm test
npm run lint
npm run build
```

注明默认本地访问地址为 `http://localhost:5001`，生产环境需要 `AUTH_TOKEN_SECRET`，当前业务数据以本地 SQLite 和导入数据为主，Oracle/生产数据库对接为可选扩展而非启动前置条件。

- [ ] **Step 4: 运行文档校验以验证新 README**

Run:

```powershell
$readme = Get-Content -Raw README.md
$required = @(
  '数智化注采管理系统',
  '选井决策 → 方案与计划 → 施工监控 → 焖井转抽 → 生产响应 → 效果评价 → 优化复盘',
  '注汽优化预测',
  '注窜项目台账',
  '同类井智能匹配',
  'Top 3',
  'AUTH_TOKEN_SECRET',
  'http://localhost:5001',
  'npm run build'
)
$missing = $required | Where-Object { -not $readme.Contains($_) }
if ($missing) { throw "README missing: $($missing -join ', ')" }
if ($readme -match '�') { throw 'README contains replacement characters' }
```

Expected: exit code 0。

- [ ] **Step 5: 提交 README**

```bash
git add README.md
git commit -m "docs: rewrite digital injection production README"
```

### Task 2: 文档与构建验证、推送准备

**Files:**
- Modify: none

- [ ] **Step 1: 检查 README 变更范围**

Run: `git diff HEAD~1 -- README.md`

Expected: 仅 README 的业务和技术部署文档重写。

- [ ] **Step 2: 构建应用**

Run: `npm run build`

Expected: Vite build exit code 0。

- [ ] **Step 3: 执行串行完整测试**

Run: `node --import tsx --test --test-concurrency=1 tests/*.test.ts`

Expected: 所有测试通过。使用串行模式避免已知的 `authTokenSecret` 并行时序问题。

- [ ] **Step 4: 检查主分支推送目标**

Run: `git remote -v && git status --short && git log --oneline origin/main..main`

Expected: `origin` 指向 `https://github.com/zhaojunshan3201/GSzhuqi.git`，待推送提交清晰可见；用户原有未提交文件不被暂存或提交。

- [ ] **Step 5: 推送主分支**

Run: `git push origin main`

Expected: `main -> main` 成功，远端包含 README 提交和此前已合并的菜单调整。
