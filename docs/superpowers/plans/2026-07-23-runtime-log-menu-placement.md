# 运行日志独立菜单位置调整 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Render “运行日志” as an ungrouped sidebar item immediately after the “产量掌控” group.

**Architecture:** Keep `runtimeLogs` and its page intact. Remove the item from `sidebarNavigationGroups`, export it independently, and render it after the grouped sidebar navigation through the existing `SidebarItem` component.

**Tech Stack:** React 19, TypeScript, Tailwind CSS, Node.js test runner.

---

## Files

- Modify `src/lib/sidebarNavigation.ts`: export an independent runtime-log item rather than placing it in overview.
- Modify `src/App.tsx`: render that item after grouped navigation.
- Modify `tests/sidebarNavigation.test.ts`: verify it has no group.
- Modify `tests/appRuntimeLogs.test.ts`: verify independent rendering after grouped navigation.

### Task 1: Navigation data

- [ ] Add a failing test asserting `getSidebarGroupKey('runtimeLogs')` is undefined and `runtimeLogNavigationItem` equals `{ tab: 'runtimeLogs', label: '运行日志', icon: 'ClipboardList' }`.
- [ ] Run `npm test -- tests/sidebarNavigation.test.ts` and confirm failure.
- [ ] Remove runtime logs from the overview items and export `runtimeLogNavigationItem` with that exact object.
- [ ] Run `npm test -- tests/sidebarNavigation.test.ts` and confirm pass.

### Task 2: Sidebar location

- [ ] Add a failing source contract in `tests/appRuntimeLogs.test.ts` that requires `runtimeLogNavigationItem` and checks it is rendered after `sidebarNavigationGroups.map`.
- [ ] Run `npm test -- tests/appRuntimeLogs.test.ts` and confirm failure.
- [ ] Import `runtimeLogNavigationItem` in `App.tsx` and, immediately after grouped navigation rendering, render `<SidebarItem>` using its icon, label, active tab and `setActiveTab` callback.
- [ ] Run `npm test` and `npm run build`; commit only `src/App.tsx`, `src/lib/sidebarNavigation.ts`, and the two changed tests with message `feat: place runtime logs below production navigation`.

## Self-review

- Runtime logs is not inside overview or production.
- It follows the production group without a group heading.
- Existing runtime-log page behavior remains unchanged.
