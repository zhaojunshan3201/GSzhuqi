# Paper Three-Tier Diagrams Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Produce two accurate, overlap-free three-tier management diagrams and a new DOCX copy with both diagrams inserted at the existing placeholders while preserving the source document.

**Architecture:** Keep the approved diagrams as standalone SVG source files, rasterize them deterministically to 2400 px white-background PNGs with bundled Node.js and `sharp`, then use bundled Python and `python-docx` to copy the source paper and replace only the two placeholder paragraphs. Verification combines automated SVG/PNG/DOCX structure checks with full DOCX render inspection.

**Tech Stack:** SVG 1.1, bundled Node.js + `sharp`, bundled Python + `python-docx` + Pillow, LibreOffice-based `render_docx.py`.

---

## File map

- Create `paper_artifacts/three-tier-diagrams/figure-1-three-tier-control-architecture.svg`: editable source for Figure 1.
- Create `paper_artifacts/three-tier-diagrams/figure-2-three-tier-collaboration-example.svg`: editable source for Figure 2.
- Create `paper_artifacts/three-tier-diagrams/render_svgs.mjs`: deterministic SVG-to-PNG renderer.
- Create `paper_artifacts/three-tier-diagrams/insert_figures.py`: non-destructive DOCX copier and placeholder replacer.
- Create `paper_artifacts/three-tier-diagrams/test_artifacts.py`: structural and content regression checks.
- Generate `paper_artifacts/three-tier-diagrams/figure-1-three-tier-control-architecture.png`.
- Generate `paper_artifacts/three-tier-diagrams/figure-2-three-tier-collaboration-example.png`.
- Generate `paper_artifacts/three-tier-diagrams/高采三区数智化注采管理系统的构建与应用-三级管控插图完成版.docx`.
- Generate QA-only pages under `paper_artifacts/three-tier-diagrams/qa-render/`; do not present them as final deliverables.

### Task 1: Lock automated artifact requirements

**Files:**
- Create: `paper_artifacts/three-tier-diagrams/test_artifacts.py`

- [ ] **Step 1: Write tests for the two SVG sources**

Use `xml.etree.ElementTree` to parse both files. Assert a `viewBox` of `0 0 1120 620` for Figure 1 and `0 0 1120 590` for Figure 2. Assert the concatenated SVG text contains the approved required labels:

```python
FIG1_TEXT = (
    "注汽全流程数字化闭环", "区块级", "井组级", "单井级",
    "诊断信息逐级上推", "调控决策逐级反馈", "统一数据底座",
    "Oracle / Excel", "SQLite缓存", "井号（JH）",
)
FIG2_TEXT = (
    "单井精细诊断", "井组注采平衡", "区块整体调控",
    "+6 个百分点", "高3624块典型井组", "17 井次",
    "−195 t", "−215 t", "+15%", "高246区块拉大井距",
    "2200 → 2050 t", "选井效率提升 80% 以上",
    "异常响应 15–30 天 → 1–3 天",
)
```

Also parse every SVG `<text>` element and reject empty text nodes.

- [ ] **Step 2: Write tests for PNG output geometry**

With Pillow, require both PNGs to be RGB/RGBA, white in all four corners, and exactly 2400 px wide. Require heights of 1329 px for Figure 1 and 1264 px for Figure 2, preserving the SVG aspect ratios after rounding.

- [ ] **Step 3: Write tests for DOCX replacement behavior**

Open the generated DOCX with `python-docx` and assert:

```python
full_text = "\n".join(p.text for p in document.paragraphs)
assert "[系统三级管控架构图]" not in full_text
assert "[三级协同管控示例图]" not in full_text
assert "图1  系统三级管控架构示意图" in full_text
assert "图2  井→组→区块三级协同管控效果示例" in full_text
assert len(document.inline_shapes) >= source_inline_shape_count + 2
```

Verify the source and output paths resolve to different files, and verify the source SHA-256 digest recorded before insertion equals the digest after insertion.

- [ ] **Step 4: Run tests to establish the expected failure**

Run with bundled Python:

```powershell
& $BUNDLED_PYTHON paper_artifacts\three-tier-diagrams\test_artifacts.py
```

Expected: failure because the SVG, PNG, and output DOCX files do not exist yet.

### Task 2: Create Figure 1 editable SVG

**Files:**
- Create: `paper_artifacts/three-tier-diagrams/figure-1-three-tier-control-architecture.svg`
- Test: `paper_artifacts/three-tier-diagrams/test_artifacts.py`

- [ ] **Step 1: Create the SVG canvas and shared style tokens**

Use a `1120 × 620` viewBox, white background, 18 px outer corner radius, and this exact palette:

```xml
<style>
  text { font-family: "Microsoft YaHei", "Noto Sans CJK SC", sans-serif; }
  .ink { fill: #17233c; }
  .block-title { font-size: 19px; font-weight: 700; }
  .body { font-size: 12px; }
</style>
```

Use `#2F6FB5` for block level, `#6685A4` for well-group level, `#D43B3B` for single-well level, and `#172F4B` for the top lifecycle band.

- [ ] **Step 2: Add the lifecycle band**

Place a top band at `x=55, y=48, width=1010, height=54`. Include the exact flow:

```text
选井决策 → 方案与计划 → 施工监控 → 焖井转抽 → 生产响应 → 效果评价 → 优化复盘
```

- [ ] **Step 3: Add the three control layers**

Place three cards at `x=150`, `width=820`, `height=105`, with y positions `128`, `250`, and `372`. Use the approved module names from sections 3.2 of the design spec. Place the level circles at `cx=205`, label them `区`, `组`, and `井`, and keep every module line within `x=255..930`.

- [ ] **Step 4: Add the bidirectional management loop**

Place the blue upward arrow at `x=116` and the red downward arrow at `x=1004`. Label them exactly `诊断信息逐级上推` and `调控决策逐级反馈`; keep rotated labels outside the three cards.

- [ ] **Step 5: Add the unified data foundation**

Place the data band at `x=55, y=505, width=1010, height=64`. Include the approved eight data categories and the line:

```text
Oracle / Excel → SQLite缓存｜以井号（JH）为主键、以日期为时间轴｜字段、日期、数值完整性校验
```

- [ ] **Step 6: Run the Figure 1 SVG tests**

Expected: all Figure 1 XML, geometry, and required-text assertions pass; later artifact tests may still fail because Figure 2, PNGs, and DOCX are not yet built.

### Task 3: Create Figure 2 editable SVG

**Files:**
- Create: `paper_artifacts/three-tier-diagrams/figure-2-three-tier-collaboration-example.svg`
- Test: `paper_artifacts/three-tier-diagrams/test_artifacts.py`

- [ ] **Step 1: Create the three-card evidence-chain layout**

Use a `1120 × 590` viewBox. Place cards at `x=52, width=288`; `x=408, width=304`; and `x=780, width=288`, all at `y=52, height=392`. Use the same red, blue-gray, and blue level colors as Figure 1.

- [ ] **Step 2: Populate the single-well card**

Include the approved diagnosis inputs, output, and the effect value `+6 个百分点`. Keep the effect value centered at `x=196`.

- [ ] **Step 3: Populate the well-group card with non-overlapping metrics**

Include `高3624块典型井组` and `实施分段注汽 17 井次`. Create three independent effect cells at `x=432`, `520`, and `608`, each `80 px` wide, with centers `472`, `560`, and `648`. Use no more than `18 px` for the values `−195 t`, `−215 t`, and `+15%`; put each description below its value and center both lines within the same cell.

- [ ] **Step 4: Populate the block card**

Include the approved strategic actions, `高246区块拉大井距`, and `2200 → 2050 t`. Keep the case and effect inside the third card.

- [ ] **Step 5: Add management arrows and overall effects**

Use horizontal red arrows labeled `依据上推` and `经验推广`. Add the bottom overall-effect band with exactly `选井效率提升 80% 以上` and `异常响应 15–30 天 → 1–3 天`.

- [ ] **Step 6: Run both SVG tests**

Expected: all SVG parsing and required-text checks pass.

### Task 4: Render SVGs to high-resolution PNGs

**Files:**
- Create: `paper_artifacts/three-tier-diagrams/render_svgs.mjs`
- Generate: both PNG files
- Test: `paper_artifacts/three-tier-diagrams/test_artifacts.py`

- [ ] **Step 1: Implement the deterministic renderer**

Use bundled `sharp` with a 2400 px target width and white flattening:

```javascript
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const dir = path.dirname(fileURLToPath(import.meta.url));
const jobs = [
  ['figure-1-three-tier-control-architecture.svg', 'figure-1-three-tier-control-architecture.png'],
  ['figure-2-three-tier-collaboration-example.svg', 'figure-2-three-tier-collaboration-example.png'],
];

for (const [input, output] of jobs) {
  const svg = await fs.readFile(path.join(dir, input));
  await sharp(svg, { density: 300 })
    .resize({ width: 2400 })
    .flatten({ background: '#ffffff' })
    .png({ compressionLevel: 9 })
    .toFile(path.join(dir, output));
}
```

- [ ] **Step 2: Render both PNGs with bundled Node.js**

Set `NODE_PATH` to the bundled package directory, then run `render_svgs.mjs`. Expected: two non-empty PNGs.

- [ ] **Step 3: Run PNG geometry tests**

Expected: width, height, color mode, and corner-color checks pass.

- [ ] **Step 4: Visually inspect both PNGs**

Open each PNG at original detail. Check every label, arrow, border, and metric cell. Reject any overlap, clipping, missing Chinese glyph, uneven centering, or insufficient contrast.

### Task 5: Build a new DOCX copy and insert both figures

**Files:**
- Create: `paper_artifacts/three-tier-diagrams/insert_figures.py`
- Generate: `paper_artifacts/three-tier-diagrams/高采三区数智化注采管理系统的构建与应用-三级管控插图完成版.docx`
- Test: `paper_artifacts/three-tier-diagrams/test_artifacts.py`

- [ ] **Step 1: Implement non-destructive copying and placeholder replacement**

Use these exact paths and replacement rules:

```python
from hashlib import sha256
from pathlib import Path
from docx import Document
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.shared import Mm

SOURCE = Path(r"C:\Users\31541\Desktop\油水井\高采三区数智化注采管理系统的构建与应用(高升采油厂采三)7.13-完善版4.docx")
HERE = Path(__file__).resolve().parent
OUTPUT = HERE / "高采三区数智化注采管理系统的构建与应用-三级管控插图完成版.docx"
REPLACEMENTS = {
    "[系统三级管控架构图]": HERE / "figure-1-three-tier-control-architecture.png",
    "[三级协同管控示例图]": HERE / "figure-2-three-tier-collaboration-example.png",
}

before = sha256(SOURCE.read_bytes()).hexdigest()
document = Document(SOURCE)
found = set()
for paragraph in document.paragraphs:
    key = paragraph.text.strip()
    if key not in REPLACEMENTS:
        continue
    paragraph.clear()
    paragraph.alignment = WD_ALIGN_PARAGRAPH.CENTER
    paragraph.paragraph_format.keep_with_next = True
    paragraph.add_run().add_picture(str(REPLACEMENTS[key]), width=Mm(146))
    found.add(key)

if found != set(REPLACEMENTS):
    raise RuntimeError(f"missing placeholders: {set(REPLACEMENTS) - found}")

document.save(OUTPUT)
after = sha256(SOURCE.read_bytes()).hexdigest()
if before != after:
    raise RuntimeError("source document changed")
```

- [ ] **Step 2: Preserve caption formatting**

Do not recreate or restyle the two caption paragraphs. Confirm the paragraphs immediately following the inserted image paragraphs remain:

```text
图1  系统三级管控架构示意图
图2  井→组→区块三级协同管控效果示例
```

Set each image paragraph to `keep_with_next=True` so the image remains attached to its existing caption.

- [ ] **Step 3: Generate the new DOCX**

Run with bundled Python. Expected: a new non-empty DOCX in the artifact folder; the source file remains byte-identical.

- [ ] **Step 4: Run all automated artifact tests**

Expected: all SVG, PNG, DOCX, caption, placeholder, inline-shape-count, and source-hash tests pass.

### Task 6: Render and visually verify the completed DOCX

**Files:**
- Generate QA intermediates: `paper_artifacts/three-tier-diagrams/qa-render/page-*.png`
- Inspect: completed DOCX

- [ ] **Step 1: Render with the canonical document renderer**

Run the bundled document skill renderer:

```powershell
& $BUNDLED_PYTHON $DOCUMENT_SKILL\render_docx.py `
  paper_artifacts\three-tier-diagrams\高采三区数智化注采管理系统的构建与应用-三级管控插图完成版.docx `
  --output_dir paper_artifacts\three-tier-diagrams\qa-render `
  --emit_pdf
```

Expected: one PNG per DOCX page and a non-empty PDF.

- [ ] **Step 2: Inspect every rendered page**

At 100% zoom, confirm there is no clipping, overlap, missing glyph, broken table, unexpected blank page, or header/footer displacement. On the two figure pages, confirm each image fits within the 146.6 mm usable width, the corresponding caption is directly below it, and the following section heading does not overlap.

- [ ] **Step 3: Iterate if any visual defect exists**

Make only the smallest SVG coordinate/font-size or DOCX image-width adjustment needed, rerender the affected PNGs, regenerate the DOCX, rerun all automated tests, and inspect every DOCX page again.

- [ ] **Step 4: Final source-preservation check**

Recompute the source DOCX SHA-256 and compare it with the pre-build digest. Expected: identical.

### Task 7: Deliver the requested artifacts

**Files:**
- Deliver: two SVG files, two PNG files, and the completed DOCX.

- [ ] **Step 1: Confirm final files and sizes**

List the five requested files and require each to be non-empty. Do not include QA PNG pages or the QA PDF in the user-facing deliverables.

- [ ] **Step 2: Report content and verification outcome**

State that the source paper was not modified, both placeholders were replaced in a new copy, the overlap reported in the well-group metrics was resolved with equal-width cells, and the latest DOCX render was visually inspected.

