# 注汽项目管理布局调整 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (- [ ]) syntax for tracking.

**Goal:** 将锅炉计划时间轴置于计划执行统计看板后，并将导入历史改为默认折叠。

**Architecture:** 仅调整 InjectionProjectManagement 组件的渲染顺序和本地展开状态，不改变接口或数据模型。

**Tech Stack:** React、TypeScript、Tailwind、Vite。

---

### Task 1: 调整布局

**Files:**
- Modify: src/components/InjectionProjectManagement.tsx

- [ ] **Step 1: 添加导入历史折叠状态。**

~~~tsx
const [historyExpanded, setHistoryExpanded] = useState(false);
~~~

- [ ] **Step 2: 重排并折叠区块。**

将锅炉计划时间轴 section 移到计划执行统计看板 section 后、计划执行对比明细前。将导入历史 table 包裹在 historyExpanded 条件中，标题右侧提供“展开历史/收起历史”按钮，并显示 imports.length。

- [ ] **Step 3: 构建验证。**

Run: npm run build

Expected: PASS。

- [ ] **Step 4: 提交。**

~~~powershell
git add src/components/InjectionProjectManagement.tsx
git commit -m "feat: reorganize injection project layout"
~~~

