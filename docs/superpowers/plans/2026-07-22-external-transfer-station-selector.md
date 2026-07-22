# 外输跟踪计量站选择器紧凑化 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the tall native multi-select on the external-transfer page with a one-line, collapsible multi-select that preserves all existing filtering behavior.

**Architecture:** Keep selection data in the component's existing `Set<string>` state. Replace only the native `<select multiple>` markup with a button, a positioned checkbox popover, and outside-click handling. The existing upload, default-all-selected, all-select button, aggregation, and chart data flow remain unchanged.

**Tech Stack:** React 19, TypeScript, Tailwind CSS utility classes, Node.js test runner, tsx.

---

## File structure

- Modify: `src/components/ExternalTransferTracking.tsx` — compact trigger, checkbox popover, selection text, and outside-click handling.
- Modify: `tests/externalTransferTracking.test.ts` — source-level regression checks for the compact selector contract, consistent with existing component source checks.

### Task 1: Lock in the compact selector contract

**Files:**
- Modify: `tests/externalTransferTracking.test.ts`

- [ ] **Step 1: Write the failing regression test**

Append this test to `tests/externalTransferTracking.test.ts`:

```ts
test('ExternalTransferTracking uses a compact checkbox popover for station selection', async () => {
  const source = await readFile(new URL('../src/components/ExternalTransferTracking.tsx', import.meta.url), 'utf8');

  assert.match(source, /已选 \$\{selectedStations\.size\} 个/);
  assert.match(source, /type="checkbox"/);
  assert.match(source, /stationSelectorRef/);
  assert.doesNotMatch(source, /<select\s+multiple/);
});
```

- [ ] **Step 2: Run test to confirm it fails**

Run: `npm test -- tests/externalTransferTracking.test.ts`

Expected: FAIL in the new test because the component still contains `<select multiple>`.

### Task 2: Implement the compact checkbox popover

**Files:**
- Modify: `src/components/ExternalTransferTracking.tsx:1-115`

- [ ] **Step 1: Add component-local open state and trigger reference**

Near the existing file-input reference and state declarations, add:

```ts
const stationSelectorRef = useRef<HTMLDivElement>(null);
const [isStationSelectorOpen, setIsStationSelectorOpen] = useState(false);
```

- [ ] **Step 2: Close the selector when the user clicks outside it**

Add this effect after the upload-loading effect:

```ts
useEffect(() => {
  const handlePointerDown = (event: MouseEvent) => {
    if (!stationSelectorRef.current?.contains(event.target as Node)) setIsStationSelectorOpen(false);
  };

  document.addEventListener('mousedown', handlePointerDown);
  return () => document.removeEventListener('mousedown', handlePointerDown);
}, []);
```

- [ ] **Step 3: Replace the native multi-select with a button and popover**

Replace the existing `<div className="min-w-[190px] flex-1">…<select multiple … /></div>` block with:

```tsx
<div ref={stationSelectorRef} className="relative min-w-[190px] flex-1">
  <label className="mb-1 block text-xs font-medium text-slate-500">计量站（可多选）</label>
  <button type="button" className="field-control flex h-10 w-full items-center justify-between gap-3 text-left" aria-expanded={isStationSelectorOpen} onClick={() => setIsStationSelectorOpen((open) => !open)}>
    <span className="truncate">已选 {selectedStations.size} 个：{Array.from(selectedStations).join('、')}</span>
    <span className="shrink-0 text-slate-400">⌄</span>
  </button>
  {isStationSelectorOpen && (
    <div className="absolute z-20 mt-1 max-h-64 w-full overflow-y-auto rounded-md border border-slate-200 bg-white p-2 shadow-lg">
      {stations.map((station) => (
        <label key={station} className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-sm text-slate-700 hover:bg-slate-50">
          <input type="checkbox" checked={selectedStations.has(station)} onChange={() => setSelectedStations((current) => {
            const next = new Set(current);
            if (next.has(station)) next.delete(station); else next.add(station);
            return next;
          })} />
          {station}
        </label>
      ))}
    </div>
  )}
</div>
```

The trigger remains 40px high, excess names truncate, and each checkbox updates the existing `selectedStations` state immediately.

- [ ] **Step 4: Run the targeted test to confirm it passes**

Run: `npm test -- tests/externalTransferTracking.test.ts`

Expected: PASS, including the new compact-selector test.

- [ ] **Step 5: Commit the focused implementation**

Run:

```powershell
git add src/components/ExternalTransferTracking.tsx tests/externalTransferTracking.test.ts
git commit -m "feat: compact external transfer station selector"
```

### Task 3: Verify application behavior

**Files:**
- Verify: `src/components/ExternalTransferTracking.tsx`

- [ ] **Step 1: Run the complete automated suite**

Run:

```powershell
npm test
npm run lint
npm run build
```

Expected: all commands finish with exit code 0.

- [ ] **Step 2: Perform the browser regression check**

Open `http://localhost:5001`, navigate to “外输跟踪”, and verify:

1. The selector is one 40px-high row before it is opened.
2. Its text includes the selected count and truncates rather than increasing height.
3. Clicking opens a checkbox list with all current selections checked.
4. Toggling a station refreshes the charts using the existing filtering behavior.
5. Clicking elsewhere closes the list.
6. “全选计量站” selects all stations and the trigger count updates.

## Self-review

- **Spec coverage:** Task 2 implements the one-line trigger, selected summary, checkbox list, immediate filtering, and outside-click closing. Existing default-all and all-select writes are unchanged. Task 3 verifies the full interaction and chart update.
- **Placeholder scan:** No TBD/TODO markers or undefined implementation steps are present.
- **Type consistency:** `stationSelectorRef` encloses the trigger and popover; `isStationSelectorOpen` is the only visibility state; `selectedStations` remains `Set<string>` throughout.
