# Axon Homepage Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a full-viewport Axon homepage that enters the existing production dashboard when its CTA is pressed.

**Architecture:** Add a self-contained `AxonLandingPage` presentation component. `App` owns a landing visibility state and connects the CTA to the established `handleLogin` path, leaving existing dashboard loading and rendering intact.

**Tech Stack:** React 19, TypeScript, Tailwind CSS v4, Vite.

---

## File structure

- `src/components/AxonLandingPage.tsx` — Hero markup and exported title/video constants.
- `src/App.tsx` — Landing visibility and CTA-to-dashboard integration.
- `src/index.css` — Google font import and global Axon typography.
- `index.html` — Browser title.
- `tests/axonLanding.test.ts` — Video/title constant test.

### Task 1: Add the landing component and test

**Files:**
- Create: `src/components/AxonLandingPage.tsx`
- Create: `tests/axonLanding.test.ts`

- [ ] **Step 1: Write the failing constants test**

```ts
import assert from 'node:assert/strict';
import test from 'node:test';
import { AXON_PAGE_TITLE, AXON_VIDEO_URL } from '../src/components/AxonLandingPage.tsx';

test('Axon landing exposes title and video source', () => {
  assert.equal(AXON_PAGE_TITLE, 'Axon — Digital Workers for Mundane Workflows');
  assert.equal(AXON_VIDEO_URL, 'https://d8j0ntlcm91z4.cloudfront.net/user_38xzZboKViGWJOttwIXH07lWA1P/hf_20260714_113715_c7e0daa0-8bdd-4486-a2da-040901f8f0ea.mp4');
});
```

- [ ] **Step 2: Verify it fails**

Run: `node --import tsx --test tests/axonLanding.test.ts`  
Expected: FAIL because the component module does not exist.

- [ ] **Step 3: Implement the static component**

Create the exports below and a semantic `header`, `nav`, `main`, `h1`, `p`, and native CTA `button`. Use the user-specified Tailwind classes for the responsive glass nav, YC badge, heading, subtitle, CTA, and `relative z-10` content. Render the supplied video URL in an `aria-hidden` video with `autoPlay muted loop playsInline` and `absolute inset-0 z-0 h-[130%] w-full object-cover object-top`.

```tsx
export const AXON_PAGE_TITLE = 'Axon — Digital Workers for Mundane Workflows';
export const AXON_VIDEO_URL = 'https://d8j0ntlcm91z4.cloudfront.net/user_38xzZboKViGWJOttwIXH07lWA1P/hf_20260714_113715_c7e0daa0-8bdd-4486-a2da-040901f8f0ea.mp4';
export function AxonLandingPage({ onEnter }: { onEnter: () => void }) { /* JSX */ }
```

- [ ] **Step 4: Verify the component test**

Run: `node --import tsx --test tests/axonLanding.test.ts`  
Expected: PASS with one passing test.

- [ ] **Step 5: Commit**

Run: `git add src/components/AxonLandingPage.tsx tests/axonLanding.test.ts && git commit -m "feat: add Axon landing page"`

### Task 2: Enter the current dashboard from the CTA

**Files:**
- Modify: `src/App.tsx:1-40, 2145-2450, 5837-5842`

- [ ] **Step 1: Add state and import**

Import `AxonLandingPage` and add `const [showLanding, setShowLanding] = useState(true);` adjacent to `isLoggedIn`.

- [ ] **Step 2: Add the CTA handler**

After `handleLogin`, add the minimal integration:

```ts
const handleEnterFromLanding = () => {
  setShowLanding(false);
  handleLogin({ name: '系统管理员', role: 'admin', username: 'admin' });
};
```

- [ ] **Step 3: Render before the login guard**

Immediately before `if (!isLoggedIn)`, add:

```tsx
if (showLanding) return <AxonLandingPage onEnter={handleEnterFromLanding} />;
```

- [ ] **Step 4: Verify static types**

Run: `npm run lint`  
Expected: exits 0 with no TypeScript diagnostics.

- [ ] **Step 5: Commit**

Run: `git add src/App.tsx && git commit -m "feat: enter dashboard from Axon homepage"`

### Task 3: Configure typography and title

**Files:**
- Modify: `src/index.css:1-20`
- Modify: `index.html:1-8`

- [ ] **Step 1: Import typography**

Add a Google Fonts import for Instrument Serif (regular and italic) and Inter (400, 500, 600). In the existing base `body`, retain current declarations and add `font-family: 'Inter', sans-serif; color: #1B133C;`.

- [ ] **Step 2: Update document title**

Set `index.html` to `<title>Axon — Digital Workers for Mundane Workflows</title>`.

- [ ] **Step 3: Verify production build**

Run: `npm run build`  
Expected: Vite completes successfully.

- [ ] **Step 4: Browser smoke test**

Open `http://localhost:5001`; confirm the initial view is only the full-screen Axon hero and clicking **Get Early Access** reveals the existing dashboard shell.

- [ ] **Step 5: Commit**

Run: `git add src/index.css index.html && git commit -m "style: configure Axon typography"`

### Task 4: Final verification

**Files:**
- Test: `tests/axonLanding.test.ts`

- [ ] **Step 1: Run all tests**

Run: `npm test`  
Expected: all tests pass.

- [ ] **Step 2: Run lint and build**

Run: `npm run lint && npm run build`  
Expected: both commands exit 0.

- [ ] **Step 3: Check the scoped diff**

Run: `git diff HEAD~3..HEAD -- src/App.tsx src/components/AxonLandingPage.tsx src/index.css index.html tests/axonLanding.test.ts`  
Expected: only the planned Axon changes appear.
