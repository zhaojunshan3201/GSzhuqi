# 高采三区生产动态分析系统

基于 React + Node.js 的全栈油田生产动态分析平台，集成远程数据库同步、多维度数据可视化及智能诊断功能。

## 核心功能

- **系统概览 (Dashboard)**：全区日产液、日产油、日产气及综合含水率的实时走势图
- **区块分析 (Block Analysis)**：支持按区块筛选查看生产动态，一键导出区块生产数据至 Excel
- **单井分析 (Well Analysis)**：精细化查看单口井的历史生产曲线，支持自定义时间范围
- **措施跟踪 (Measure Tracking)**：管理油井措施记录，支持 Excel 批量导入/导出，自动计算本轮累产油、上轮同期累产油及效果评价
- **重点监控 (Issue Diagnosis)**：含水分布饼图、异常井识别、递减预警
- **对比分析 (Comparison Analysis)**：A/B 时段对比、自动诊断、Excel 导出
- **数据同步**：支持从远程 Oracle 数据库增量同步数据至本地 SQLite

## 技术栈

- **前端**：React 19, Vite, Tailwind CSS, ECharts, Lucide React, Motion
- **后端**：Node.js, Express, tsx
- **数据库**：Oracle (远程) + SQLite (本地缓存)
- **工具**：XLSX, dotenv, multer

## 快速启动

`ash
npm install
npm run dev
`

访问 http://localhost:3000

## 措施跟踪

系统支持 Excel 批量导入措施数据，常见表头映射：

| 字段 | Excel 表头 |
|------|-----------|
| 井号 | 井号、井名、油井 |
| 转注时间 | 转注时间、转抽时间 |
| 措施类型 | 措施类型、工艺类型 |
| 生产天数 | 生产天数、产油天数 |
| 日产液 | 日产液、日液量 |
| 日产油 | 日产油、日油量 |
| 含水率 | 含水率、含水 |
| 累增油 | 累增油、累计增油 |
| 评价 | 评价、措施效果 |

Excel 中 _1 后缀或上轮前缀的列将被识别为上一轮数据，用于计算上轮同期累产油。

## 数据库

- production.db：production 表(日产数据)、measure_tracking 表(措施记录)、users 表(用户)

---

2026 高采采油作业三区
