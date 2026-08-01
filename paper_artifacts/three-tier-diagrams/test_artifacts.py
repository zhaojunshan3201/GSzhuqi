"""Acceptance tests for the three-tier control paper artifacts."""

from __future__ import annotations

import hashlib
import unittest
import xml.etree.ElementTree as ET
from pathlib import Path

from docx import Document
from PIL import Image


ARTIFACT_DIR = Path(__file__).resolve().parent
FIGURE_1_SVG = ARTIFACT_DIR / "figure-1-three-tier-control-architecture.svg"
FIGURE_2_SVG = ARTIFACT_DIR / "figure-2-three-tier-collaboration-example.svg"
FIGURE_1_PNG = ARTIFACT_DIR / "figure-1-three-tier-control-architecture.png"
FIGURE_2_PNG = ARTIFACT_DIR / "figure-2-three-tier-collaboration-example.png"
OUTPUT_DOCX = ARTIFACT_DIR / "高采三区数智化注采管理系统的构建与应用-三级管控插图完成版.docx"
SOURCE_DOCX = Path(
    r"C:\Users\31541\Desktop\油水井\高采三区数智化注采管理系统的构建与应用(高升采油厂采三)7.13-完善版4.docx"
)


class ThreeTierArtifactTests(unittest.TestCase):
    def require_file(self, path: Path) -> None:
        if not path.is_file():
            self.fail(f"Required artifact is missing: {path}")

    def assert_svg(self, path: Path, view_box: str, required_text: list[str]) -> None:
        self.require_file(path)
        root = ET.parse(path).getroot()
        self.assertEqual(root.attrib.get("viewBox"), view_box)

        text_nodes = [node for node in root.iter() if node.tag.rsplit("}", 1)[-1] == "text"]
        self.assertTrue(text_nodes, f"SVG has no text nodes: {path}")
        for node in text_nodes:
            self.assertTrue(
                "".join(node.itertext()).strip(),
                f"SVG contains an empty text node: {path}",
            )

        document_text = "".join(root.itertext())
        for phrase in required_text:
            self.assertIn(phrase, document_text, f"Missing SVG text {phrase!r} in {path}")

    def assert_png(self, path: Path, expected_height: int) -> None:
        self.require_file(path)
        with Image.open(path) as image:
            self.assertIn(image.mode, {"RGB", "RGBA"})
            self.assertEqual(image.size, (2400, expected_height))
            for point in ((0, 0), (2399, 0), (0, expected_height - 1), (2399, expected_height - 1)):
                pixel = image.getpixel(point)
                self.assertEqual(pixel[:3], (255, 255, 255), f"Corner {point} is not white in {path}")

    def test_figure_1_svg(self) -> None:
        self.assert_svg(
            FIGURE_1_SVG,
            "0 0 1120 620",
            [
                "注汽全流程数字化闭环", "区块级", "井组级", "单井级", "诊断信息逐级上推",
                "调控决策逐级反馈", "统一数据底座", "Oracle / Excel", "SQLite缓存", "井号（JH）",
            ],
        )

    def test_figure_2_svg(self) -> None:
        self.assert_svg(
            FIGURE_2_SVG,
            "0 0 1120 590",
            [
                "单井精细诊断", "井组注采平衡", "区块整体调控", "+6 个百分点", "高3624块典型井组",
                "17 井次", "−195 t", "−215 t", "+15%", "高246区块拉大井距", "2200 → 2050 t",
                "选井效率提升 80% 以上", "异常响应 15–30 天 → 1–3 天",
            ],
        )

    def test_figure_1_png(self) -> None:
        self.assert_png(FIGURE_1_PNG, 1329)

    def test_figure_2_png(self) -> None:
        self.assert_png(FIGURE_2_PNG, 1264)

    def test_completed_docx_replaces_placeholders_and_adds_figures(self) -> None:
        self.require_file(SOURCE_DOCX)
        self.require_file(OUTPUT_DOCX)
        self.assertNotEqual(SOURCE_DOCX.resolve(), OUTPUT_DOCX.resolve())

        source_hash_before = hashlib.sha256(SOURCE_DOCX.read_bytes()).hexdigest()
        source = Document(SOURCE_DOCX)
        output = Document(OUTPUT_DOCX)
        output_text = "\n".join(paragraph.text for paragraph in output.paragraphs)

        self.assertNotIn("[系统三级管控架构图]", output_text)
        self.assertNotIn("[三级协同管控示例图]", output_text)
        self.assertIn("图1  系统三级管控架构示意图", output_text)
        self.assertIn("图2  井→组→区块三级协同管控效果示例", output_text)
        self.assertGreaterEqual(len(output.inline_shapes), len(source.inline_shapes) + 2)

        source_hash_after = hashlib.sha256(SOURCE_DOCX.read_bytes()).hexdigest()
        self.assertEqual(source_hash_before, source_hash_after, "Source DOCX changed during verification")


if __name__ == "__main__":
    unittest.main(verbosity=2)
