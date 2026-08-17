#!/usr/bin/env python3
"""Self-contained V12 layout-recovery smoke test.

Creates a synthetic academic page with a ruled table and a technical diagram,
then verifies that final-coordinate OpenCV analysis separates the two. A plain
text-only page is also checked to guard against obvious false positives.
"""
from __future__ import annotations

import json
import subprocess
import sys
import tempfile
from pathlib import Path

import cv2
import numpy as np

ROOT = Path(__file__).resolve().parents[1]
PREPROCESSOR = ROOT / "scripts" / "ocr_preprocess.py"


def analyze(path: Path) -> dict:
    completed = subprocess.run(
        [sys.executable, str(PREPROCESSOR), "--analyze", str(path)],
        check=True,
        capture_output=True,
        text=True,
        timeout=30,
    )
    return json.loads(completed.stdout.strip().splitlines()[-1])


def make_layout_page(path: Path) -> None:
    width, height = 1500, 2000
    image = np.full((height, width, 3), 255, np.uint8)
    font = cv2.FONT_HERSHEY_SIMPLEX
    cv2.putText(image, "ENGINEERING SCIENCE EXAMINATION", (260, 130), font, 1.0, (0, 0, 0), 2, cv2.LINE_AA)
    cv2.putText(image, "1. Complete the table. [8 marks]", (120, 330), font, 0.72, (0, 0, 0), 2, cv2.LINE_AA)

    x0, y0 = 130, 450
    columns = [0, 300, 650, 1050, 1250]
    rows = [0, 80, 160, 240, 320]
    for x in columns:
        cv2.line(image, (x0 + x, y0), (x0 + x, y0 + 320), (0, 0, 0), 3)
    for y in rows:
        cv2.line(image, (x0, y0 + y), (x0 + 1250, y0 + y), (0, 0, 0), 3)
    for column, text in enumerate(["Item", "Mass", "Acceleration", "Force"]):
        cv2.putText(image, text, (x0 + columns[column] + 18, y0 + 52), font, 0.55, (0, 0, 0), 2, cv2.LINE_AA)

    cv2.rectangle(image, (230, 1000), (1250, 1680), (0, 0, 0), 3)
    cv2.putText(image, "Figure 1: Simple electric circuit", (460, 1050), font, 0.65, (0, 0, 0), 2, cv2.LINE_AA)
    cv2.line(image, (360, 1300), (360, 1510), (0, 0, 0), 5)
    cv2.line(image, (390, 1330), (390, 1480), (0, 0, 0), 2)
    cv2.line(image, (390, 1405), (650, 1405), (0, 0, 0), 4)
    points = np.array([[650, 1405], [690, 1360], [740, 1450], [790, 1360], [840, 1450], [890, 1405]], np.int32)
    cv2.polylines(image, [points], False, (0, 0, 0), 4)
    cv2.line(image, (890, 1405), (1120, 1405), (0, 0, 0), 4)
    cv2.line(image, (1120, 1405), (1120, 1590), (0, 0, 0), 4)
    cv2.line(image, (1120, 1590), (360, 1590), (0, 0, 0), 4)
    cv2.line(image, (360, 1590), (360, 1510), (0, 0, 0), 4)
    cv2.imwrite(str(path), image)


def make_text_page(path: Path) -> None:
    image = np.full((1800, 1400, 3), 255, np.uint8)
    font = cv2.FONT_HERSHEY_SIMPLEX
    lines = [
        "SAMPLE UNIVERSITY",
        "PROGRAMMING EXAMINATION",
        "Instructions: Answer all questions.",
        "1. Explain object oriented programming. [10 marks]",
        "2. State four advantages of databases. [8 marks]",
    ]
    y = 120
    for index, line in enumerate(lines):
        cv2.putText(image, line, (100, y), font, 1.0 if index < 2 else 0.72, (0, 0, 0), 2, cv2.LINE_AA)
        y += 125 if index < 2 else 190
    cv2.imwrite(str(path), image)


def main() -> int:
    with tempfile.TemporaryDirectory(prefix="edusearch-v12-") as folder:
        folder_path = Path(folder)
        layout_path = folder_path / "layout.png"
        text_path = folder_path / "text.png"
        make_layout_page(layout_path)
        make_text_page(text_path)
        layout = analyze(layout_path)
        plain = analyze(text_path)

    tables = layout.get("tableRegions", [])
    figures = layout.get("visualRegions", [])
    assert tables, "Expected a ruled table region"
    assert tables[0].get("rows", 0) >= 3 and tables[0].get("columns", 0) >= 3, "Table grid dimensions were not recovered"
    assert figures, "Expected a technical figure region"
    assert not plain.get("tableRegions"), "Text-only page produced a false table"
    assert not plain.get("visualRegions"), "Text-only page produced a false figure"
    print(json.dumps({
        "ok": True,
        "table": tables[0],
        "figure": figures[0],
        "textOnlyFalseTables": 0,
        "textOnlyFalseFigures": 0,
    }, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
