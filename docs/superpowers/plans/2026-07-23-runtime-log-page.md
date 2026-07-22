# 运行日志入口 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove technical status text from the global header and expose it through a dedicated sidebar page.

**Architecture:** Reuse `syncStatus`, `cacheInfo`, and `cacheSourceText` in `App.tsx`; add one overview tab and a read-only runtime-log page. No endpoint or synchronization behavior changes.

**Tech Stack:** React 19, TypeScript, Tailwind CSS, Node.js test runner, tsx.

---

## File structure

- Modify: `src/lib/sidebarNavigation.ts` — add `runtimeLogs` and its overview item.
- Modify: `src/App.tsx` — remove header status block, add title and runtime-log content.
- Modify: `tests/sidebarNavigation.test.ts` — navigation regression test.
- Modify: `tests/axonLanding.test.ts` — header/log-page source regression test.

### Task 1: Add runtime-log navigation

**Files:**
- Modify: `tests/sidebarNavigation.test.ts`
- Modify: `src/lib/sidebarNavigation.ts`

- [ ] **Step 1: Write a failing test**

```ts
test('places runtime logs in the overview navigation group', () => {
  const overview = sidebarNavigationGroups.find((group) => group.key === 'overview');
  assert.deepEqual(overview?.items.at(-1), { tab: 'runtimeLogs', label: '运行日志', icon: 'ClipboardList' });
  assert.equal(getSidebarGroupKey('runtimeLogs'), 'overview');
});
```

- [ ] **Step 2: Confirm RED**

Run: `npm test -- tests/sidebarNavigation.test.ts`

Expected: FAIL because `runtimeLogs` is absent.

- [ ] **Step 3: Implement the navigation item**

Add `'runtimeLogs'` to `SidebarTab` and append this overview item:

```ts
{ tab: 'runtimeLogs', label: '运行日志', icon: 'ClipboardList' },
```

- [ ] **Step 4: Confirm GREEN**

Run: `npm test -- tests/sidebarNavigation.test.ts`

Expected: PASS.

### Task 2: Move diagnostics into the runtime-log page

**Files:**
- Modify: `tests/axonLanding.test.ts`
- Modify: `src/App.tsx:5970-6040`

- [ ] **Step 1: Write a failing source regression test**

```ts
test('keeps runtime status out of the header and renders it in the runtime logs page', async () => {
  const source = await readFile(new URL('../src/App.tsx', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /hidden xl:flex max-w-\[520px\] flex-wrap justify-end/);
  assert.match(source, /activeTab === 'runtimeLogs'/);
  assert.match(source, /同步错误详情/);
  assert.match(source, /syncStatus\?\.lastError/);
});
```

- [ ] **Step 2: Confirm RED**

Run: `npm test -- tests/axonLanding.test.ts`

Expected: FAIL because the header status block remains and no log page exists.

- [ ] **Step 3: Remove the header diagnostics**

Delete only the `<div className="hidden xl:flex max-w-[520px] ...">` block between the header title and search input. Do not alter title, search, or user controls.

- [ ] **Step 4: Render the runtime-log page**

Add `{activeTab === 'runtimeLogs' && '运行日志'}` to the title mappings. In `<main>`, render a `page-stack` containing four read-only cards for `syncStatus?.lastLocalDataDate`, sync state, `cacheInfo.cacheWarm`, and `cacheSourceText`. When `syncStatus?.lastError` exists, render it in a red `同步错误详情` panel using `<pre className="whitespace-pre-wrap break-words font-sans">`.

- [ ] **Step 5: Confirm GREEN and build**

Run:

```powershell
npm test -- tests/sidebarNavigation.test.ts tests/axonLanding.test.ts
npm run build
```

Expected: tests and build pass; existing Vite chunk-size warning may remain.

- [ ] **Step 6: Commit**

```powershell
git add src/App.tsx src/lib/sidebarNavigation.ts tests/sidebarNavigation.test.ts tests/axonLanding.test.ts
git commit -m "feat: add runtime logs page"
```

### Task 3: Final verification

**Files:**
- Verify: `src/App.tsx`
- Verify: `src/lib/sidebarNavigation.ts`

- [ ] **Step 1: Run all automated checks**

Run:

```powershell
npm test
npm run lint
npm run build
```

Expected: tests and build pass. Record known lint errors in unmodified files without changing unrelated code.

- [ ] **Step 2: Manually verify**

At `http://localhost:5001`, verify the header has no status/error text, “运行日志” is under “基本情况”, its page shows four status cards and any error only in “同步错误详情”, and search/user controls remain aligned.

## Self-review

- **Spec coverage:** Tasks 1–2 add the menu, remove global diagnostics, and render every requested runtime value and error detail.
- **Placeholder scan:** No TBD/TODO markers exist.
- **Type consistency:** `runtimeLogs` is used consistently in tab union, sidebar config, title mapping, and page render.
