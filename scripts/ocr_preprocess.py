#!/usr/bin/env python3
"""OpenCV page rectification and OCR-specific enhancement for EduSearch AI.

Usage: python3 scripts/ocr_preprocess.py INPUT OUTPUT

The primary OUTPUT is an illumination-normalized grayscale page. The script also
writes two optional sidecar images next to OUTPUT:
  OUTPUT.adaptive.png  - adaptive threshold for uneven mobile-camera lighting
  OUTPUT.linefree.png  - long form/table rules removed for cleaner OCR

A JSON diagnostics object is written to stdout. Exit code 2 means OpenCV is not
available, allowing the Node backend to fall back to Sharp safely.
"""
from __future__ import annotations

import json
import math
import os
import sys
from pathlib import Path

try:
    import cv2
    import numpy as np
except Exception as exc:  # pragma: no cover - optional runtime dependency
    print(json.dumps({"ok": False, "reason": "opencv-unavailable", "detail": str(exc)}))
    raise SystemExit(2)


def order_points(points: np.ndarray) -> np.ndarray:
    rect = np.zeros((4, 2), dtype="float32")
    sums = points.sum(axis=1)
    diffs = np.diff(points, axis=1).reshape(-1)
    rect[0] = points[np.argmin(sums)]
    rect[2] = points[np.argmax(sums)]
    rect[1] = points[np.argmin(diffs)]
    rect[3] = points[np.argmax(diffs)]
    return rect


def angle_quality(rect: np.ndarray) -> float:
    qualities = []
    for index in range(4):
        previous = rect[(index - 1) % 4] - rect[index]
        following = rect[(index + 1) % 4] - rect[index]
        denominator = max(1e-6, float(np.linalg.norm(previous) * np.linalg.norm(following)))
        cosine = float(np.dot(previous, following) / denominator)
        angle = math.degrees(math.acos(max(-1.0, min(1.0, cosine))))
        qualities.append(max(0.0, 1.0 - abs(angle - 90.0) / 40.0))
    return float(sum(qualities) / len(qualities))


def detect_page(image: np.ndarray):
    height, width = image.shape[:2]
    scale = min(1.0, 1800.0 / max(height, width))
    small = cv2.resize(image, None, fx=scale, fy=scale, interpolation=cv2.INTER_AREA) if scale < 1 else image.copy()
    gray = cv2.cvtColor(small, cv2.COLOR_BGR2GRAY)
    gray = cv2.GaussianBlur(gray, (5, 5), 0)
    edges = cv2.Canny(gray, 25, 95)
    edges = cv2.dilate(edges, np.ones((7, 7), np.uint8), iterations=2)
    edges = cv2.morphologyEx(edges, cv2.MORPH_CLOSE, np.ones((15, 15), np.uint8), iterations=2)
    contours, _ = cv2.findContours(edges, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    image_area = float(small.shape[0] * small.shape[1])
    candidates = []
    for contour in sorted(contours, key=cv2.contourArea, reverse=True)[:30]:
        hull = cv2.convexHull(contour)
        perimeter = cv2.arcLength(hull, True)
        approximation = cv2.approxPolyDP(hull, 0.025 * perimeter, True)
        if len(approximation) != 4 or not cv2.isContourConvex(approximation):
            continue
        area_ratio = cv2.contourArea(approximation) / max(1.0, image_area)
        if area_ratio < 0.28:
            continue
        rect = order_points(approximation.reshape(4, 2).astype("float32"))
        quality = angle_quality(rect)
        score = area_ratio * 0.75 + quality * 0.25
        candidates.append((score, area_ratio, quality, rect / scale))
    return max(candidates, key=lambda item: item[0]) if candidates else None


def four_point_transform(image: np.ndarray, rect: np.ndarray) -> np.ndarray:
    tl, tr, br, bl = rect
    max_width = int(max(np.linalg.norm(br - bl), np.linalg.norm(tr - tl)))
    max_height = int(max(np.linalg.norm(tr - br), np.linalg.norm(tl - bl)))
    max_width = max(100, max_width)
    max_height = max(100, max_height)
    destination = np.array([[0, 0], [max_width - 1, 0], [max_width - 1, max_height - 1], [0, max_height - 1]], dtype="float32")
    matrix = cv2.getPerspectiveTransform(rect, destination)
    return cv2.warpPerspective(image, matrix, (max_width, max_height), flags=cv2.INTER_CUBIC, borderMode=cv2.BORDER_REPLICATE)


def normalize_illumination(image: np.ndarray) -> np.ndarray:
    gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
    kernel = max(31, int(min(gray.shape[:2]) * 0.035))
    if kernel % 2 == 0:
        kernel += 1
    background = cv2.medianBlur(gray, min(151, kernel))
    normalized = cv2.divide(gray, background, scale=245)
    normalized = cv2.normalize(normalized, None, 0, 255, cv2.NORM_MINMAX)
    clahe = cv2.createCLAHE(clipLimit=1.8, tileGridSize=(8, 8))
    return clahe.apply(normalized)


def adaptive_variant(gray: np.ndarray) -> np.ndarray:
    block = max(31, int(min(gray.shape[:2]) * 0.018))
    if block % 2 == 0:
        block += 1
    block = min(151, block)
    return cv2.adaptiveThreshold(gray, 255, cv2.ADAPTIVE_THRESH_GAUSSIAN_C, cv2.THRESH_BINARY, block, 15)


def remove_long_rules(binary: np.ndarray):
    inverted = 255 - binary
    height, width = binary.shape[:2]
    horizontal_kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (max(28, width // 24), 1))
    vertical_kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (1, max(28, height // 24)))
    horizontal = cv2.morphologyEx(inverted, cv2.MORPH_OPEN, horizontal_kernel)
    vertical = cv2.morphologyEx(inverted, cv2.MORPH_OPEN, vertical_kernel)
    rules = cv2.bitwise_or(horizontal, vertical)
    linefree = cv2.bitwise_and(inverted, cv2.bitwise_not(rules))
    linefree = 255 - linefree
    line_density = float(np.count_nonzero(rules)) / max(1.0, float(width * height))
    horizontal_density = float(np.count_nonzero(horizontal)) / max(1.0, float(width * height))
    vertical_density = float(np.count_nonzero(vertical)) / max(1.0, float(width * height))
    table_grid_score = max(0.0, min(1.0, min(horizontal_density * 120.0, 1.0) * 0.55 + min(vertical_density * 160.0, 1.0) * 0.45))
    return linefree, line_density, table_grid_score, horizontal, vertical, rules


def _runs_from_projection(values: np.ndarray, minimum: float):
    runs = []
    start = None
    for index, value in enumerate(values):
        active = float(value) >= minimum
        if active and start is None:
            start = index
        elif not active and start is not None:
            runs.append((start, index - 1))
            start = None
    if start is not None:
        runs.append((start, len(values) - 1))
    return [int(round((left + right) / 2.0)) for left, right in runs]


def _merge_positions(positions, minimum_gap: int):
    if not positions:
        return []
    groups = [[positions[0]]]
    for value in positions[1:]:
        if value - groups[-1][-1] <= minimum_gap:
            groups[-1].append(value)
        else:
            groups.append([value])
    return [int(round(sum(group) / len(group))) for group in groups]


def _spacing_regularity(positions) -> float:
    if len(positions) < 3:
        return 0.0
    gaps = np.diff(np.array(positions, dtype=np.float32))
    gaps = gaps[gaps > 2]
    if len(gaps) < 2:
        return 0.0
    coefficient = float(np.std(gaps) / max(1.0, np.mean(gaps)))
    return max(0.0, min(1.0, 1.0 - coefficient))


def _box_overlap(left, right) -> float:
    lx, ly, lw, lh = left
    rx, ry, rw, rh = right
    ix = max(0, min(lx + lw, rx + rw) - max(lx, rx))
    iy = max(0, min(ly + lh, ry + rh) - max(ly, ry))
    intersection = float(ix * iy)
    if intersection <= 0:
        return 0.0
    return intersection / max(1.0, float(min(lw * lh, rw * rh)))


def detect_table_regions(horizontal: np.ndarray, vertical: np.ndarray):
    height, width = horizontal.shape[:2]
    grid = cv2.bitwise_or(horizontal, vertical)
    joined = cv2.dilate(grid, cv2.getStructuringElement(cv2.MORPH_RECT, (7, 7)), iterations=2)
    contours, _ = cv2.findContours(joined, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    regions = []
    for contour in sorted(contours, key=cv2.contourArea, reverse=True)[:30]:
        x, y, box_width, box_height = cv2.boundingRect(contour)
        area_ratio = float(box_width * box_height) / max(1.0, float(width * height))
        if box_width < max(100, int(width * 0.16)) or box_height < max(55, int(height * 0.045)):
            continue
        if area_ratio < 0.006 or area_ratio > 0.72:
            continue
        h_crop = horizontal[y:y + box_height, x:x + box_width]
        v_crop = vertical[y:y + box_height, x:x + box_width]
        horizontal_lines = _runs_from_projection(np.count_nonzero(h_crop, axis=1), max(10.0, box_width * 0.07))
        vertical_lines = _runs_from_projection(np.count_nonzero(v_crop, axis=0), max(10.0, box_height * 0.07))
        horizontal_lines = _merge_positions(horizontal_lines, max(4, int(box_height * 0.028)))
        vertical_lines = _merge_positions(vertical_lines, max(4, int(box_width * 0.022)))
        rows = max(0, len(horizontal_lines) - 1)
        columns = max(0, len(vertical_lines) - 1)
        horizontal_regularity = _spacing_regularity(horizontal_lines)
        vertical_regularity = _spacing_regularity(vertical_lines)
        regularity = horizontal_regularity * 0.55 + vertical_regularity * 0.45
        if rows < 2 or columns < 2 or regularity < 0.46:
            continue
        grid_density = float(np.count_nonzero(cv2.bitwise_or(h_crop, v_crop))) / max(1.0, float(box_width * box_height))
        confidence = min(1.0, 0.25 + min(rows, 8) * 0.03 + min(columns, 8) * 0.04 + min(0.2, grid_density * 7.0) + regularity * 0.28)
        regions.append({
            "left": int(x), "top": int(y), "width": int(box_width), "height": int(box_height),
            "rows": int(rows), "columns": int(columns), "confidence": round(confidence, 4),
            "regularity": round(regularity, 4),
        })
    deduplicated = []
    for region in sorted(regions, key=lambda item: item["width"] * item["height"], reverse=True):
        box = (region["left"], region["top"], region["width"], region["height"])
        if any(_box_overlap(box, (item["left"], item["top"], item["width"], item["height"])) > 0.72 for item in deduplicated):
            continue
        deduplicated.append(region)
    return sorted(deduplicated[:12], key=lambda item: (item["top"], item["left"]))


def detect_visual_regions(gray: np.ndarray, rules: np.ndarray, table_regions):
    height, width = gray.shape[:2]
    # Keep line art while grouping visual regions. Confirmed table regions are
    # excluded separately, so circuit diagrams and labelled boxes remain intact.
    edges = cv2.Canny(gray, 45, 135)
    joined = cv2.morphologyEx(edges, cv2.MORPH_CLOSE, cv2.getStructuringElement(cv2.MORPH_RECT, (11, 11)), iterations=2)
    joined = cv2.dilate(joined, cv2.getStructuringElement(cv2.MORPH_RECT, (5, 5)), iterations=1)
    contours, _ = cv2.findContours(joined, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    table_boxes = [(item["left"], item["top"], item["width"], item["height"]) for item in table_regions]
    candidates = []
    for contour in sorted(contours, key=cv2.contourArea, reverse=True)[:80]:
        x, y, box_width, box_height = cv2.boundingRect(contour)
        area_ratio = float(box_width * box_height) / max(1.0, float(width * height))
        if area_ratio < 0.012 or area_ratio > 0.38:
            continue
        if box_width < max(120, int(width * 0.18)) or box_height < max(80, int(height * 0.06)):
            continue
        if box_width / max(1.0, float(box_height)) > 8.0 or box_height / max(1.0, float(box_width)) > 5.0:
            continue
        box = (x, y, box_width, box_height)
        if any(_box_overlap(box, table_box) > 0.45 for table_box in table_boxes):
            continue
        crop_gray = gray[y:y + box_height, x:x + box_width]
        crop_edges = edges[y:y + box_height, x:x + box_width]
        edge_density = float(np.count_nonzero(crop_edges)) / max(1.0, float(box_width * box_height))
        tone_variation = min(1.0, float(np.std(crop_gray)) / 72.0)
        # Text paragraphs tend to create many tiny, similarly sized components.
        binary = cv2.adaptiveThreshold(crop_gray, 255, cv2.ADAPTIVE_THRESH_GAUSSIAN_C, cv2.THRESH_BINARY_INV, 41, 15)
        component_count, _, stats, _ = cv2.connectedComponentsWithStats(binary, 8)
        components = [stats[index] for index in range(1, component_count) if 8 <= stats[index][4] <= 5000]
        large_components = sum(1 for item in components if item[2] > box_width * 0.08 or item[3] > box_height * 0.12)
        text_like_density = min(1.0, len(components) / max(40.0, (box_width * box_height) / 1800.0))
        sparse_line_bonus = 0.24 if area_ratio >= 0.05 and 0.007 <= edge_density <= 0.09 and text_like_density < 0.32 and tone_variation > 0.32 else 0.0
        visual_score = min(1.0, min(1.0, edge_density * 8.5) * 0.34 + tone_variation * 0.24 + min(1.0, large_components / 8.0) * 0.18 + (1.0 - min(1.0, text_like_density)) * 0.10 + sparse_line_bonus)
        if visual_score < 0.46:
            continue
        candidates.append({
            "left": int(x), "top": int(y), "width": int(box_width), "height": int(box_height),
            "confidence": round(float(visual_score), 4), "kind": "figure",
        })
    deduplicated = []
    for region in sorted(candidates, key=lambda item: (item["confidence"], item["width"] * item["height"]), reverse=True):
        box = (region["left"], region["top"], region["width"], region["height"])
        if any(_box_overlap(box, (item["left"], item["top"], item["width"], item["height"])) > 0.62 for item in deduplicated):
            continue
        deduplicated.append(region)
    return sorted(deduplicated[:8], key=lambda item: (item["top"], item["left"]))


def image_quality(gray: np.ndarray):
    mean = float(np.mean(gray))
    std = float(np.std(gray))
    high = float(np.mean(gray >= 248))
    low = float(np.mean(gray <= 35))
    glare = max(0.0, min(1.0, (high - 0.03) / 0.32))
    shadow = max(0.0, min(1.0, low / 0.18))
    contrast = max(0.0, min(1.0, std / 72.0))
    laplacian_variance = float(cv2.Laplacian(gray, cv2.CV_64F).var())
    blur_score = max(0.0, min(1.0, 1.0 - laplacian_variance / 420.0))
    return mean, glare, shadow, contrast, blur_score


def handwriting_risk(gray: np.ndarray) -> float:
    """Return a conservative review-risk score, not a handwriting classifier.

    Printed pages generally contain many similarly sized, horizontally aligned
    components. Irregular component sizes, fragmented strokes and weak line
    alignment increase the score. The value is only used to request review.
    """
    binary = cv2.adaptiveThreshold(gray, 255, cv2.ADAPTIVE_THRESH_GAUSSIAN_C, cv2.THRESH_BINARY_INV, 41, 15)
    count, _, stats, centroids = cv2.connectedComponentsWithStats(binary, 8)
    components = []
    for index in range(1, count):
        x, y, width, height, area = stats[index]
        if 5 <= area <= 3000 and 2 <= width <= 150 and 3 <= height <= 120:
            components.append((float(width), float(height), float(area), float(centroids[index][1])))
    if len(components) < 25:
        return 0.0
    heights = np.array([item[1] for item in components], dtype=np.float32)
    widths = np.array([item[0] for item in components], dtype=np.float32)
    areas = np.array([item[2] for item in components], dtype=np.float32)
    ys = np.array([item[3] for item in components], dtype=np.float32)
    size_variation = min(1.0, float(np.std(heights) / max(1.0, np.mean(heights))) * 1.4)
    aspect_variation = min(1.0, float(np.std(widths / np.maximum(1.0, heights))) * 1.6)
    area_variation = min(1.0, float(np.std(np.log1p(areas))) / 1.8)
    # Printed baselines create peaks in a coarse vertical centroid histogram.
    hist, _ = np.histogram(ys, bins=max(12, min(80, gray.shape[0] // 35)))
    line_peak_ratio = float(np.count_nonzero(hist >= max(3, np.percentile(hist, 70)))) / max(1.0, float(len(hist)))
    poor_alignment = max(0.0, min(1.0, 0.45 - line_peak_ratio)) / 0.45
    return max(0.0, min(1.0, size_variation * 0.34 + aspect_variation * 0.24 + area_variation * 0.18 + poor_alignment * 0.24))


def main() -> int:
    if len(sys.argv) == 3 and sys.argv[1] == "--analyze":
        source = sys.argv[2]
        image = cv2.imread(source, cv2.IMREAD_COLOR)
        if image is None:
            print(json.dumps({"ok": False, "reason": "unreadable-image"}))
            return 1
        gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
        adaptive = adaptive_variant(gray)
        _linefree, line_density, table_grid_score, horizontal_rules, vertical_rules, rule_mask = remove_long_rules(adaptive)
        table_regions = detect_table_regions(horizontal_rules, vertical_rules)
        visual_regions = detect_visual_regions(gray, rule_mask, table_regions)
        print(json.dumps({
            "ok": True, "engine": "opencv-layout-analysis",
            "width": int(gray.shape[1]), "height": int(gray.shape[0]),
            "lineDensity": round(line_density, 5),
            "tableGridScore": round(table_grid_score, 4),
            "tableRegions": table_regions, "visualRegions": visual_regions,
        }))
        return 0
    if len(sys.argv) != 3:
        print(json.dumps({"ok": False, "reason": "usage"}))
        return 1
    source, destination = sys.argv[1:3]
    image = cv2.imread(source, cv2.IMREAD_COLOR)
    if image is None:
        print(json.dumps({"ok": False, "reason": "unreadable-image"}))
        return 1

    original_height, original_width = image.shape[:2]
    detected = detect_page(image)
    perspective_applied = False
    crop_confidence = 0.0
    area_ratio = 1.0
    if detected is not None:
        score, area_ratio, _quality, rect = detected
        crop_confidence = max(0.0, min(1.0, score))
        if score >= float(os.getenv("OCR_DEWARP_MIN_CONFIDENCE", "0.52")) and area_ratio < 0.985:
            image = four_point_transform(image, rect)
            perspective_applied = True

    normalized = normalize_illumination(image)
    adaptive = adaptive_variant(normalized)
    linefree, line_density, table_grid_score, horizontal_rules, vertical_rules, rule_mask = remove_long_rules(adaptive)
    table_regions = detect_table_regions(horizontal_rules, vertical_rules)
    visual_regions = detect_visual_regions(normalized, rule_mask, table_regions)

    destination_path = Path(destination)
    destination_path.parent.mkdir(parents=True, exist_ok=True)
    adaptive_path = Path(f"{destination}.adaptive.png")
    linefree_path = Path(f"{destination}.linefree.png")
    if not cv2.imwrite(str(destination_path), normalized):
        print(json.dumps({"ok": False, "reason": "write-failed"}))
        return 1
    cv2.imwrite(str(adaptive_path), adaptive)
    cv2.imwrite(str(linefree_path), linefree)

    mean, glare, shadow, contrast, blur = image_quality(normalized)
    handwriting = handwriting_risk(normalized)
    result = {
        "ok": True,
        "engine": "opencv",
        "perspectiveApplied": perspective_applied,
        "cropConfidence": round(crop_confidence, 4),
        "pageAreaRatio": round(float(area_ratio), 4),
        "illuminationNormalized": True,
        "glareScore": round(glare, 4),
        "shadowScore": round(shadow, 4),
        "contrastScore": round(contrast, 4),
        "blurScore": round(blur, 4),
        "handwritingRisk": round(handwriting, 4),
        "lineDensity": round(line_density, 5),
        "tableGridScore": round(table_grid_score, 4),
        "adaptivePath": str(adaptive_path),
        "lineFreePath": str(linefree_path),
        "tableRegions": table_regions,
        "visualRegions": visual_regions,
        "originalWidth": original_width,
        "originalHeight": original_height,
        "outputWidth": int(normalized.shape[1]),
        "outputHeight": int(normalized.shape[0]),
        "meanLuminance": round(mean, 2),
    }
    print(json.dumps(result))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
