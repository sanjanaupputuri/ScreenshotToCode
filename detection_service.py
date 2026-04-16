"""
Flask service for screenshot-oriented UI primitive detection.
"""
from flask import Flask, request, jsonify
import cv2
import pytesseract
import numpy as np
import os
import re
import json
import sys
from difflib import SequenceMatcher

app = Flask(__name__)

pytesseract.pytesseract.tesseract_cmd = "tesseract"
CONTROL_PLACEHOLDER_PATTERN = re.compile(r"(enter|search|type|email|name|password|phone|address|query|username)", re.I)
CONTROL_ACTION_PATTERN = re.compile(r"(go to file|add file|code|pin|watch|fork|star|public|private|main|submit|save|cancel|apply|next|back|close|open|edit|new|create|upload|download|copy)", re.I)
SECTION_HEADING_PATTERN = re.compile(r"(readme|activity|releases|packages|suggested workflows|based on your tech stack|no releases|no packages)", re.I)


def clamp(value, low, high):
    return max(low, min(high, value))


def hex_from_bgr(color):
    b, g, r = [int(clamp(v, 0, 255)) for v in color]
    return "#{:02x}{:02x}{:02x}".format(r, g, b)


def rgb_from_hex(color):
    if not color or color[0] != "#" or len(color) not in (4, 7):
        return None
    if len(color) == 4:
        color = "#{0}{0}{1}{1}{2}{2}".format(color[1], color[2], color[3])
    return (
        int(color[1:3], 16),
        int(color[3:5], 16),
        int(color[5:7], 16),
    )


def is_neutral_hex(color, tolerance=28):
    rgb = rgb_from_hex(color)
    if rgb is None:
        return False
    return max(rgb) - min(rgb) <= tolerance


def hex_distance(left, right):
    left_rgb = rgb_from_hex(left)
    right_rgb = rgb_from_hex(right)
    if left_rgb is None or right_rgb is None:
        return 999.0
    return float(np.linalg.norm(np.array(left_rgb, dtype=np.float32) - np.array(right_rgb, dtype=np.float32)))


def crop(image, x, y, w, h):
    height, width = image.shape[:2]
    x = int(clamp(x, 0, width))
    y = int(clamp(y, 0, height))
    w = int(clamp(w, 1, width - x))
    h = int(clamp(h, 1, height - y))
    return image[y:y + h, x:x + w]


def clean_ocr_text(text):
    if not text:
        return ""

    text = re.sub(r"[^\w\s\-.,!?@#$%&*()+=:/(){}\[\]|<>]", "", text)
    text = " ".join(text.split())
    if len(text) < 1:
        return ""

    useful = sum(c.isalnum() or c in "-_./:#" for c in text)
    if useful / max(len(text), 1) < 0.35:
        return ""

    # Remove OCR garbage tokens while preserving real short words
    COMMON_SHORT = {'a','an','as','at','be','by','do','go','he','if','in','is','it','me',
                    'my','no','of','on','or','so','to','up','us','we','the','and','for',
                    'not','but','are','was','has','had','its','via','ago','pin','add','new',
                    'all','can','did','get','got','how','let','may','now','old','our','out',
                    'own','put','say','see','set','she','too','try','use','way','who','why'}
    words = text.split()
    cleaned = []
    for w in words:
        wl = w.lower()
        alpha = sum(c.isalpha() for c in w)
        non_alpha = len(w) - alpha
        # Always keep common short words
        if wl in COMMON_SHORT:
            cleaned.append(w)
        # Keep long words
        elif len(w) >= 4:
            # Drop if has non-alpha symbols mixed in (OCR artifact like "Type(Z]", "jaa}")
            if non_alpha > 0 and len(w) <= 6:
                continue
            cleaned.append(w)
        # Drop 1-3 char tokens that aren't pure alpha (e.g. "[3", "fF", "Oo")
        elif alpha == len(w):
            # Drop 2-char mixed-case tokens (OCR artifacts: "fF", "Oo", "LX", "Cy", "py")
            if len(w) == 2 and w[0].isupper() != w[1].isupper():
                continue
            # Drop 2-char all-lowercase that aren't common words
            if len(w) == 2 and w.islower() and wl not in COMMON_SHORT:
                continue
            # Drop single letters that aren't common words
            if len(w) == 1 and wl not in COMMON_SHORT:
                continue
            # Drop 2-char all-uppercase tokens that look like OCR artifacts (e.g. "BP", "AF", "SS", "LX")
            if len(w) == 2 and w.isupper() and wl not in COMMON_SHORT:
                continue
            cleaned.append(w)
    text = " ".join(cleaned)

    if len(text) < 1:
        return ""

    return text.strip()


def normalized_token(token):
    token = token.strip().lower()
    return re.sub(r"[^a-z0-9#:/._-]", "", token)


def tokens_similar(left, right):
    left_norm = normalized_token(left)
    right_norm = normalized_token(right)
    if not left_norm or not right_norm:
        return False
    if left_norm == right_norm:
        return True
    return SequenceMatcher(None, left_norm, right_norm).ratio() >= 0.78


def collapse_duplicate_tokens(text):
    lines = []
    for raw_line in text.splitlines():
        parts = raw_line.split()
        collapsed = []
        for part in parts:
            if collapsed and tokens_similar(collapsed[-1], part):
                continue
            if sum(1 for existing in collapsed if tokens_similar(existing, part)) >= 2:
                continue
            collapsed.append(part)
        if collapsed:
            lines.append(" ".join(collapsed))
    return "\n".join(lines).strip()


def score_text_quality(text):
    if not text:
        return 0.0

    tokens = [normalized_token(token) for token in text.split()]
    tokens = [token for token in tokens if token]
    if not tokens:
        return 0.0

    unique_ratio = len(set(tokens)) / len(tokens)
    alpha_ratio = sum(any(char.isalpha() for char in token) for token in tokens) / len(tokens)
    duplicate_penalty = max(0, 1 - (len(tokens) - len(set(tokens))) / max(len(tokens), 1))

    # Penalize OCR noise: high ratio of non-alphanumeric symbols
    raw_tokens = text.split()
    symbol_noise = sum(
        1 for t in raw_tokens
        if len(t) <= 3 and not t.isalpha() and not t.isdigit()
    ) / max(len(raw_tokens), 1)

    # Penalize mixed garbage: tokens that are 1-2 chars and non-word
    garbage_ratio = sum(
        1 for t in raw_tokens
        if len(t) <= 2 and not t.isalpha()
    ) / max(len(raw_tokens), 1)

    noise_penalty = min(0.6, symbol_noise * 0.5 + garbage_ratio * 0.4)

    return max(0.0, (unique_ratio * 0.40) + (alpha_ratio * 0.35) + (duplicate_penalty * 0.15) - noise_penalty)


def iou(region_a, region_b):
    left = max(region_a["x"], region_b["x"])
    top = max(region_a["y"], region_b["y"])
    right = min(region_a["x"] + region_a["width"], region_b["x"] + region_b["width"])
    bottom = min(region_a["y"] + region_a["height"], region_b["y"] + region_b["height"])
    if right <= left or bottom <= top:
        return 0.0

    intersection = (right - left) * (bottom - top)
    union = region_a["width"] * region_a["height"] + region_b["width"] * region_b["height"] - intersection
    return intersection / union if union > 0 else 0.0


def overlap_ratio(region_a, region_b):
    left = max(region_a["x"], region_b["x"])
    top = max(region_a["y"], region_b["y"])
    right = min(region_a["x"] + region_a["width"], region_b["x"] + region_b["width"])
    bottom = min(region_a["y"] + region_a["height"], region_b["y"] + region_b["height"])
    if right <= left or bottom <= top:
        return 0.0

    intersection = (right - left) * (bottom - top)
    smaller = min(region_a["width"] * region_a["height"], region_b["width"] * region_b["height"])
    return intersection / smaller if smaller > 0 else 0.0


def candidate_score(region):
    quality = region.get("quality", score_text_quality(region.get("text", "")))
    confidence = float(region.get("confidence", 0.0)) / 100.0
    token_count = len((region.get("text", "") or "").split())
    duplicate_penalty = 0.15 if "\n" in (region.get("text", "") or "") else 0.0
    return confidence * 0.55 + quality * 0.35 + min(token_count, 6) * 0.03 - duplicate_penalty


def cluster_text_candidates(candidates):
    clusters = []
    for candidate in sorted(candidates, key=lambda item: (item["y"], item["x"])):
        placed = False
        for cluster in clusters:
            if any(iou(candidate, existing) > 0.32 or overlap_ratio(candidate, existing) > 0.6 for existing in cluster):
                cluster.append(candidate)
                placed = True
                break
        if not placed:
            clusters.append([candidate])
    return clusters


def consolidate_text_candidates(candidates):
    consolidated = []
    for cluster in cluster_text_candidates(candidates):
        best = max(cluster, key=candidate_score)
        representative = dict(best)
        representative["confidence"] = max(item["confidence"] for item in cluster)
        representative["quality"] = max(item.get("quality", 0.0) for item in cluster)
        representative["text"] = collapse_duplicate_tokens(representative["text"])
        consolidated.append(representative)
    return consolidated


def dominant_text_color(roi):
    if roi.size == 0:
        return "#24292f", 128.0

    gray = cv2.cvtColor(roi, cv2.COLOR_BGR2GRAY)
    h, w = gray.shape[:2]
    strip = max(1, min(2, h // 3 if h >= 3 else 1, w // 3 if w >= 3 else 1))
    edge_samples = [
        roi[:strip, :, :].reshape(-1, 3),
        roi[h - strip:, :, :].reshape(-1, 3),
        roi[:, :strip, :].reshape(-1, 3),
        roi[:, w - strip:, :].reshape(-1, 3),
    ]
    edge_samples = [sample for sample in edge_samples if sample.size]
    edge_pixels = np.concatenate(edge_samples, axis=0) if edge_samples else roi.reshape(-1, 3)
    background_bgr = np.median(edge_pixels, axis=0)

    diff = np.linalg.norm(roi.astype(np.float32) - background_bgr.astype(np.float32), axis=2)
    diff_threshold = max(20.0, float(np.percentile(diff, 72)))
    mask = (diff >= diff_threshold).astype(np.uint8) * 255
    mask = cv2.morphologyEx(mask, cv2.MORPH_OPEN, np.ones((2, 2), np.uint8), iterations=1)

    if np.count_nonzero(mask) < max(6, mask.size * 0.01):
        background_luma = float(cv2.cvtColor(np.uint8([[background_bgr]]), cv2.COLOR_BGR2GRAY)[0][0])
        darker_pixels = roi[gray < background_luma - 18]
        lighter_pixels = roi[gray > background_luma + 18]

        if darker_pixels.size or lighter_pixels.size:
            darker_gap = abs(float(gray[gray < background_luma - 18].mean()) - background_luma) if np.any(gray < background_luma - 18) else 0.0
            lighter_gap = abs(float(gray[gray > background_luma + 18].mean()) - background_luma) if np.any(gray > background_luma + 18) else 0.0
            text_pixels = darker_pixels if darker_gap >= lighter_gap else lighter_pixels
        else:
            text_pixels = roi.reshape(-1, 3)
    else:
        text_pixels = roi[mask > 0]

    mean_bgr = np.median(text_pixels, axis=0) if text_pixels.size else background_bgr
    brightness = float(cv2.cvtColor(np.uint8([[mean_bgr]]), cv2.COLOR_BGR2GRAY)[0][0])
    return hex_from_bgr(mean_bgr), brightness


def estimate_page_background(image):
    height, width = image.shape[:2]
    sample = max(8, min(height, width) // 18)
    corners = np.concatenate([
        image[:sample, :sample].reshape(-1, 3),
        image[:sample, width - sample:].reshape(-1, 3),
        image[height - sample:, :sample].reshape(-1, 3),
        image[height - sample:, width - sample:].reshape(-1, 3),
    ], axis=0)
    return corners.mean(axis=0)


def normalize_component(component, image_w, image_h):
    component["x_pct"] = round(component["x"] / image_w, 6)
    component["y_pct"] = round(component["y"] / image_h, 6)
    component["w_pct"] = round(component["width"] / image_w, 6)
    component["h_pct"] = round(component["height"] / image_h, 6)
    return component


def merge_text_regions(regions):
    if not regions:
        return []

    regions = sorted(regions, key=lambda item: (item["y"], item["x"]))
    lines = []

    for region in regions:
        match = None
        for line in lines:
            same_baseline = abs(region["y"] - line["y"]) <= max(10, int(line["height"] * 0.7))
            close_x = region["x"] <= line["x"] + line["width"] + 24
            similar_height = abs(region["height"] - line["height"]) <= max(10, int(line["height"] * 0.8))
            if same_baseline and close_x and similar_height:
                match = line
                break

        if match is None:
            lines.append(dict(region))
            continue

        parts = match.setdefault("parts", [])
        if not parts:
            parts.append({
                "text": match["text"],
                "x": match["x"],
                "width": match["width"],
                "font_size": match["font_size"],
                "font_weight": match["font_weight"],
            })
        parts.append({
            "text": region["text"],
            "x": region["x"],
            "width": region["width"],
            "font_size": region["font_size"],
            "font_weight": region["font_weight"],
        })

        right = max(match["x"] + match["width"], region["x"] + region["width"])
        bottom = max(match["y"] + match["height"], region["y"] + region["height"])
        match["x"] = min(match["x"], region["x"])
        match["y"] = min(match["y"], region["y"])
        match["width"] = right - match["x"]
        match["height"] = bottom - match["y"]
        match["confidence"] = max(match["confidence"], region["confidence"])
        merged_text = " ".join(part["text"] for part in sorted(parts, key=lambda item: item["x"])).strip()
        match["text"] = collapse_duplicate_tokens(merged_text)
        match["font_size"] = int(round(np.median([part["font_size"] for part in parts])))
        match["font_weight"] = max(part["font_weight"] for part in parts)

    return lines


def dedupe_regions(regions):
    deduped = []
    for region in sorted(regions, key=lambda item: (item["confidence"], item["width"] * item["height"]), reverse=True):
        duplicate = False
        for existing in deduped:
            x_overlap = max(0, min(region["x"] + region["width"], existing["x"] + existing["width"]) - max(region["x"], existing["x"]))
            y_overlap = max(0, min(region["y"] + region["height"], existing["y"] + existing["height"]) - max(region["y"], existing["y"]))
            overlap_area = x_overlap * y_overlap
            smaller = min(region["width"] * region["height"], existing["width"] * existing["height"])
            if smaller > 0 and overlap_area / smaller > 0.8:
                duplicate = True
                break

        if not duplicate:
            deduped.append(region)

    return sorted(deduped, key=lambda item: (item["y"], item["x"]))


def merge_adjacent_text_regions(regions):
    if not regions:
        return []

    def expand_parts(region):
        if region.get("parts"):
            return list(region["parts"])
        return [{
            "text": region.get("text", ""),
            "x": region["x"],
            "width": region["width"],
            "font_size": region["font_size"],
            "font_weight": region["font_weight"],
        }]

    merged = []
    for region in sorted(regions, key=lambda item: (item["y"], item["x"])):
        current = dict(region)
        current["parts"] = expand_parts(current)

        if not merged:
            merged.append(current)
            continue

        previous = merged[-1]
        prev_center = previous["y"] + previous["height"] / 2
        curr_center = current["y"] + current["height"] / 2
        gap = current["x"] - (previous["x"] + previous["width"])
        same_row = abs(curr_center - prev_center) <= max(8, min(previous["height"], current["height"]) * 0.8)
        similar_height = abs(previous["height"] - current["height"]) <= max(8, min(previous["height"], current["height"]) * 0.65)
        similar_font = abs(previous["font_size"] - current["font_size"]) <= 4
        reasonable_gap = -2 <= gap <= max(28, min(previous["height"], current["height"]) * 2.4)
        combined_width = max(previous["x"] + previous["width"], current["x"] + current["width"]) - previous["x"]

        if same_row and similar_height and similar_font and reasonable_gap and combined_width <= 420:
            previous["parts"].extend(expand_parts(current))
            previous["parts"] = sorted(previous["parts"], key=lambda item: item["x"])
            previous["text"] = collapse_duplicate_tokens(" ".join(part["text"] for part in previous["parts"]).strip())
            previous["x"] = min(previous["x"], current["x"])
            previous["y"] = min(previous["y"], current["y"])
            previous_right = max(previous["x"] + previous["width"], current["x"] + current["width"])
            previous_bottom = max(previous["y"] + previous["height"], current["y"] + current["height"])
            previous["width"] = previous_right - previous["x"]
            previous["height"] = previous_bottom - previous["y"]
            previous["area"] = int(previous["width"] * previous["height"])
            previous["confidence"] = max(previous["confidence"], current["confidence"])
            previous["font_size"] = int(round(np.median([part["font_size"] for part in previous["parts"]])))
            previous["font_weight"] = max(part["font_weight"] for part in previous["parts"])
            previous["brightness"] = float(np.median([previous.get("brightness", 128.0), current.get("brightness", 128.0)]))
            previous["quality"] = score_text_quality(previous["text"])
            continue

        merged.append(current)

    for region in merged:
        if region.get("parts"):
            region["parts"] = sorted(region["parts"], key=lambda item: item["x"])

    return dedupe_regions(merged)


def detect_text_regions(image):
    gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
    rgb = cv2.cvtColor(image, cv2.COLOR_BGR2RGB)
    otsu = cv2.threshold(gray, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)[1]
    inverted = cv2.bitwise_not(otsu)

    variants = [
        (rgb, "--psm 11"),
        (otsu, "--psm 11"),
        (inverted, "--psm 11"),
        (gray, "--psm 6"),
    ]

    regions = []

    for variant, config in variants:
        data = pytesseract.image_to_data(variant, output_type=pytesseract.Output.DICT, config=config)
        for i in range(len(data["text"])):
            raw = data["text"][i].strip()
            if not raw:
                continue

            confidence = float(data["conf"][i]) if data["conf"][i] != "-1" else 0.0
            if confidence < 28:
                continue

            text = clean_ocr_text(raw)
            if not text:
                continue

            x = int(data["left"][i])
            y = int(data["top"][i])
            w = int(data["width"][i])
            h = int(data["height"][i])
            if w < 3 or h < 6:
                continue

            roi = crop(image, x, y, w, h)
            text_color, brightness = dominant_text_color(roi)

            regions.append({
                "kind": "text",
                "type": "text",
                "text": text,
                "x": x,
                "y": y,
                "width": w,
                "height": h,
                "area": int(w * h),
                "confidence": confidence,
                "background_color": "transparent",
                "border_color": "transparent",
                "border_width": 0,
                "border_radius": 0,
                "text_color": text_color,
                "font_size": int(max(11, round(h * 0.82))),
                "font_weight": 700 if h >= 24 else 600 if h >= 18 else 400,
                "text_align": "left",
                "z_index": 20,
                "brightness": brightness,
                "quality": score_text_quality(text),
            })

    consolidated = consolidate_text_candidates(regions)
    merged = merge_text_regions(consolidated)
    merged = merge_adjacent_text_regions(merged)
    for region in merged:
        region["text"] = collapse_duplicate_tokens(region["text"])
        region["quality"] = score_text_quality(region["text"])
    filtered = [region for region in merged if region.get("quality", 0) >= 0.22 and len(region.get("text", "")) >= 2]
    return dedupe_regions(filtered)


def explode_long_text_lines(text_regions, shape_regions=None):
    exploded = []
    shape_regions = shape_regions or []

    def should_split(region):
        if len(region.get("parts") or []) < 3 or region["width"] < 260:
            return False

        overlaps = 0
        for shape in shape_regions:
            if shape.get("kind") != "shape":
                continue
            vertical_overlap = not (shape["y"] + shape["height"] < region["y"] - 8 or region["y"] + region["height"] < shape["y"] - 8)
            horizontal_overlap = not (shape["x"] + shape["width"] < region["x"] - 20 or region["x"] + region["width"] < shape["x"] - 20)
            if vertical_overlap and horizontal_overlap:
                overlaps += 1
            if overlaps >= 2:
                return True
        return False

    for region in text_regions:
        parts = region.get("parts") or []
        # Long OCR lines spanning many UI controls are split into word fragments.
        if should_split(region):
            for part in parts:
                text = collapse_duplicate_tokens(part.get("text", "")).strip()
                if not text or len(text) < 2:
                    continue
                fragment = dict(region)
                fragment["text"] = text
                fragment["x"] = int(part.get("x", region["x"]))
                fragment["width"] = int(max(8, part.get("width", max(10, len(text) * 8))))
                fragment["area"] = int(fragment["width"] * fragment["height"])
                fragment["font_size"] = int(part.get("font_size", region["font_size"]))
                fragment.pop("parts", None)
                fragment["quality"] = score_text_quality(text)
                exploded.append(fragment)
        else:
            exploded.append(region)
    return dedupe_regions(exploded)


def build_shape_mask(image):
    gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
    edges = cv2.Canny(gray, 35, 120)
    inv_white = cv2.threshold(gray, 245, 255, cv2.THRESH_BINARY_INV)[1]
    mask = cv2.bitwise_or(edges, inv_white)
    kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (5, 5))
    mask = cv2.morphologyEx(mask, cv2.MORPH_CLOSE, kernel, iterations=2)
    return cv2.dilate(mask, kernel, iterations=1)


def contour_depth(index, hierarchy):
    depth = 0
    parent = hierarchy[0][index][3]
    while parent != -1:
        depth += 1
        parent = hierarchy[0][parent][3]
    return depth


def estimate_border_and_fill(roi, contour_mask):
    h, w = contour_mask.shape[:2]
    strip = max(1, min(4, min(w, h) // 10))
    erode_kernel = np.ones((max(1, strip), max(1, strip)), np.uint8)
    inner_mask = cv2.erode(contour_mask, erode_kernel, iterations=1)
    border_mask = cv2.subtract(contour_mask, inner_mask)

    fill_pixels = roi[inner_mask > 0] if np.count_nonzero(inner_mask) else roi[contour_mask > 0]
    border_pixels = roi[border_mask > 0] if np.count_nonzero(border_mask) else roi[contour_mask > 0]

    fill_bgr = np.median(fill_pixels, axis=0) if fill_pixels.size else np.array([255, 255, 255])
    border_bgr = np.median(border_pixels, axis=0) if border_pixels.size else fill_bgr

    fill_hex = hex_from_bgr(fill_bgr)
    border_distance = np.linalg.norm(fill_bgr - border_bgr)
    border_width = strip if border_distance > 10 else 0
    border_hex = hex_from_bgr(border_bgr if border_width > 0 else fill_bgr)

    ys, xs = np.where(contour_mask > 0)
    radius = 0
    if len(xs) > 0:
        x0, x1 = xs.min(), xs.max()
        y0, y1 = ys.min(), ys.max()
        sample = max(1, int(min(x1 - x0 + 1, y1 - y0 + 1) * 0.15))
        corners = [
            contour_mask[y0:y0 + sample, x0:x0 + sample],
            contour_mask[y0:y0 + sample, x1 - sample + 1:x1 + 1],
            contour_mask[y1 - sample + 1:y1 + 1, x0:x0 + sample],
            contour_mask[y1 - sample + 1:y1 + 1, x1 - sample + 1:x1 + 1],
        ]
        missing = []
        for corner in corners:
            if corner.size:
                missing.append(1 - (np.count_nonzero(corner) / corner.size))
        radius = int(round((sum(missing) / len(missing)) * min(w, h) * 0.4)) if missing else 0

    return fill_hex, border_hex, border_width, radius


def shape_type(x, y, w, h, text_count, image_w, image_h, fill_bgr, border_width):
    aspect = w / max(h, 1)
    area_ratio = (w * h) / float(image_w * image_h)
    brightness = float(np.mean(fill_bgr))

    if y < image_h * 0.12 and h <= image_h * 0.08 and w > image_w * 0.45:
        return "toolbar"
    if 0.75 <= aspect <= 1.25 and 10 <= w <= 96 and 10 <= h <= 96 and text_count == 0:
        return "avatar" if w >= 24 and h >= 24 else "icon"
    if w >= 160 and 4.0 <= aspect <= 20.0 and 24 <= h <= 72 and (brightness > 238 or (border_width > 0 and brightness > 220)):
        return "input"
    if text_count > 0 and w <= 260 and area_ratio < 0.012 and 2.0 <= aspect <= 10.0 and 18 <= h <= 46:
        return "chip"
    if 2.0 <= aspect <= 10.0 and 24 <= h <= 70 and (brightness < 230 or border_width > 0):
        return "button"
    if area_ratio > 0.015 and h > 28 and w > 90:
        return "panel"
    return "shape"


def create_structural_bands(image, text_regions, shape_regions, page_background):
    """
    Inject structural container shapes (navbar, tab bar, content panels, sidebar)
    that OpenCV misses because they're near-background color.
    Uses text row clustering to infer where bands are.
    """
    height, width = image.shape[:2]
    page_bg_hex = hex_from_bgr(page_background)
    synthetic = []
    next_id = 9000

    # Group texts into horizontal rows
    rows = []
    for text in sorted(text_regions, key=lambda t: t["y"]):
        mid_y = text["y"] + text["height"] / 2
        placed = False
        for row in rows:
            if abs(mid_y - row["mid_y"]) <= max(12, text["height"] * 0.9):
                row["texts"].append(text)
                row["mid_y"] = sum(t["y"] + t["height"] / 2 for t in row["texts"]) / len(row["texts"])
                row["min_y"] = min(row["min_y"], text["y"])
                row["max_y"] = max(row["max_y"], text["y"] + text["height"])
                placed = True
                break
        if not placed:
            rows.append({"mid_y": mid_y, "min_y": text["y"], "max_y": text["y"] + text["height"], "texts": [text]})

    def already_covered(x, y, w, h):
        for s in shape_regions:
            sx, sy, sw, sh = s["x"], s["y"], s["width"], s["height"]
            ox = max(0, min(x + w, sx + sw) - max(x, sx))
            oy = max(0, min(y + h, sy + sh) - max(y, sy))
            if ox * oy > (w * h * 0.5):
                return True
        return False

    def sample_band_color(y0, y1):
        band = image[max(0, y0):min(height, y1), :, :]
        if band.size == 0:
            return page_bg_hex
        return hex_from_bgr(np.median(band.reshape(-1, 3), axis=0))

    # Track which y-ranges already have a band to avoid overlapping bands
    placed_bands = []

    def band_overlaps_existing(y, h):
        for (by, bh) in placed_bands:
            oy = max(0, min(y + h, by + bh) - max(y, by))
            if oy > min(h, bh) * 0.5:
                return True
        return False

    for row in rows:
        if len(row["texts"]) < 2:
            continue
        min_x = min(t["x"] for t in row["texts"])
        max_x = max(t["x"] + t["width"] for t in row["texts"])
        if (max_x - min_x) < width * 0.25:
            continue

        row_y = int(row["min_y"])
        row_h = int(row["max_y"] - row["min_y"])
        pad_y = max(6, int(row_h * 0.4))
        band_y = max(0, row_y - pad_y)
        band_h = min(height - band_y, row_h + pad_y * 2)

        if already_covered(0, band_y, width, band_h):
            continue
        if band_overlaps_existing(band_y, band_h):
            continue

        band_color = sample_band_color(band_y, band_y + band_h)
        if hex_distance(band_color, page_bg_hex) < 8:
            band_color = "#f6f8fa" if page_bg_hex in ("#ffffff", "#f6f8fa", "#e6e9eb") else "#2d333b"

        y_ratio = row_y / height
        band_type = "toolbar" if y_ratio < 0.25 else "panel"
        band_z = 5 if y_ratio < 0.12 else (4 if y_ratio < 0.25 else 3)

        synthetic.append({
            "id": next_id,
            "kind": "shape",
            "type": band_type,
            "text": "",
            "x": 0,
            "y": band_y,
            "width": width,
            "height": band_h,
            "area": width * band_h,
            "background_color": band_color,
            "border_color": "transparent",
            "border_width": 0,
            "border_radius": 0,
            "text_color": "transparent",
            "font_size": 0,
            "font_weight": 0,
            "text_align": "left",
            "z_index": band_z,
            "linked_text_count": len(row["texts"]),
            "nesting_level": 0,
        })
        placed_bands.append((band_y, band_h))
        next_id += 1

    # Sidebar: texts clustering on right side across many rows
    right_texts = [t for t in text_regions if t["x"] > width * 0.65]
    if len(right_texts) >= 4:
        min_y = min(t["y"] for t in right_texts)
        max_y = max(t["y"] + t["height"] for t in right_texts)
        min_x = max(0, min(t["x"] for t in right_texts) - 16)
        sidebar_w = width - min_x
        if sidebar_w > 80 and not already_covered(min_x, min_y - 10, sidebar_w, max_y - min_y + 20):
            sidebar_color = sample_band_color(min_y, max_y)
            if hex_distance(sidebar_color, page_bg_hex) < 8:
                sidebar_color = "#f6f8fa"
            synthetic.append({
                "id": next_id,
                "kind": "shape",
                "type": "panel",
                "text": "",
                "x": int(min_x),
                "y": int(min_y - 10),
                "width": int(sidebar_w),
                "height": int(max_y - min_y + 20),
                "area": int(sidebar_w * (max_y - min_y + 20)),
                "background_color": sidebar_color,
                "border_color": "transparent",
                "border_width": 0,
                "border_radius": 0,
                "text_color": "transparent",
                "font_size": 0,
                "font_weight": 0,
                "text_align": "left",
                "z_index": 2,
                "linked_text_count": len(right_texts),
                "nesting_level": 0,
            })

    return synthetic


def detect_shape_regions(image, text_regions, page_background):
    height, width = image.shape[:2]
    mask = build_shape_mask(image)
    contours, hierarchy = cv2.findContours(mask, cv2.RETR_TREE, cv2.CHAIN_APPROX_SIMPLE)

    elements = []
    min_area = max(180, int(width * height * 0.00045))

    if hierarchy is None:
        return elements

    for index, contour in enumerate(contours):
        x, y, w, h = cv2.boundingRect(contour)
        area = w * h
        if area < min_area or w < 10 or h < 10:
            continue
        if w > width * 0.99 and h > height * 0.99:
            continue

        depth = contour_depth(index, hierarchy)
        if depth > 3:
            continue

        approx = cv2.approxPolyDP(contour, 0.03 * cv2.arcLength(contour, True), True)
        if len(approx) > 12:
            continue

        roi = crop(image, x, y, w, h)
        if roi.size == 0:
            continue

        local_mask = np.zeros((h, w), dtype=np.uint8)
        shifted = contour - [x, y]
        cv2.drawContours(local_mask, [shifted], -1, 255, thickness=-1)

        fill_hex, border_hex, border_width, border_radius = estimate_border_and_fill(roi, local_mask)
        fill_bgr = np.array([int(fill_hex[5:7], 16), int(fill_hex[3:5], 16), int(fill_hex[1:3], 16)])
        bg_distance = np.linalg.norm(fill_bgr - page_background)

        linked_texts = []
        for region in text_regions:
            within = (
                region["x"] >= x - 4 and
                region["y"] >= y - 4 and
                region["x"] + region["width"] <= x + w + 4 and
                region["y"] + region["height"] <= y + h + 4
            )
            if within:
                linked_texts.append(region)

        if bg_distance < 6 and border_width == 0 and not linked_texts:
            continue

        element_type = shape_type(x, y, w, h, len(linked_texts), width, height, fill_bgr, border_width)
        if element_type == "input" and linked_texts:
            text_content = " ".join(region.get("text", "") for region in sorted(linked_texts, key=lambda item: (item["x"], item["y"]))).strip()
            text_left = min(region["x"] for region in linked_texts)
            text_right = max(region["x"] + region["width"] for region in linked_texts)
            text_span = text_right - text_left
            if not CONTROL_PLACEHOLDER_PATTERN.search(text_content):
                if w < 280 or text_span > (w * 0.78):
                    if bg_distance < 28:
                        continue
                    element_type = "shape"
        border_bgr = np.array([int(border_hex[5:7], 16), int(border_hex[3:5], 16), int(border_hex[1:3], 16)])
        if border_width > 0 and element_type in ("button", "panel") and bg_distance > 22 and np.linalg.norm(border_bgr - page_background) < 16:
            border_width = 0
            border_hex = fill_hex
        if element_type == "input" and border_width == 0:
            edge_band = np.concatenate([
                roi[:2, :, :].reshape(-1, 3),
                roi[max(0, h - 2):, :, :].reshape(-1, 3),
                roi[:, :2, :].reshape(-1, 3),
                roi[:, max(0, w - 2):, :].reshape(-1, 3),
            ], axis=0)
            edge_bgr = np.median(edge_band, axis=0) if edge_band.size else fill_bgr
            if np.linalg.norm(edge_bgr - fill_bgr) > 8:
                border_hex = hex_from_bgr(edge_bgr)
            else:
                border_hex = "#d0d7de"
            border_width = 1
        if element_type == "shape" and not linked_texts and (area < max(1200, int(width * height * 0.0012)) or (border_width == 0 and bg_distance < 12)):
            continue
        z_index = 5 + min(depth, 4)
        if element_type in ("icon", "avatar"):
            z_index = 14 + min(depth, 3)
        elif element_type in ("chip", "button", "input"):
            z_index = 10 + min(depth, 3)

        elements.append({
            "kind": "shape",
            "type": element_type,
            "text": "",
            "x": int(x),
            "y": int(y),
            "width": int(w),
            "height": int(h),
            "area": int(area),
            "background_color": fill_hex,
            "border_color": border_hex,
            "border_width": int(border_width),
            "border_radius": int(border_radius),
            "text_color": "transparent",
            "font_size": 0,
            "font_weight": 0,
            "text_align": "left",
            "z_index": z_index,
            "linked_text_count": len(linked_texts),
            "nesting_level": depth,
        })

    return elements


def create_synthetic_text_containers(elements):
    synthetic = []
    shape_elements = [el for el in elements if el["kind"] == "shape"]
    text_elements = [el for el in elements if el["kind"] == "text"]

    def has_covering_shape(text_el):
        for shape in shape_elements:
            if overlap_ratio(shape, text_el) > 0.42:
                return True
        return False

    for text in text_elements:
        words = len(text.get("text", "").split())
        if words == 0 or words > 5:
            continue
        if text["width"] > 320 or text["height"] > 40 or text["width"] < 26:
            continue
        if has_covering_shape(text):
            continue
        if is_neutral_hex(text.get("text_color")) and text.get("font_weight", 400) <= 500:
            continue
        sibling_on_row = sum(
            1 for other in text_elements
            if other is not text and abs((other["y"] + other["height"] / 2) - (text["y"] + text["height"] / 2)) <= max(10, text["height"] * 0.9)
        )
        if sibling_on_row > 0:
            continue

        padding_x = int(clamp(text["height"] * 0.8, 6, 16))
        padding_y = int(clamp(text["height"] * 0.35, 3, 10))
        x = int(max(0, text["x"] - padding_x))
        y = int(max(0, text["y"] - padding_y))
        w = int(text["width"] + padding_x * 2)
        h = int(text["height"] + padding_y * 2)

        synthetic.append({
            "kind": "shape",
            "type": "chip",
            "text": "",
            "x": x,
            "y": y,
            "width": w,
            "height": h,
            "area": int(w * h),
            "background_color": "#f6f8fa",
            "border_color": "#d0d7de",
            "border_width": 1,
            "border_radius": int(clamp(h * 0.45, 6, 18)),
            "text_color": "transparent",
            "font_size": 0,
            "font_weight": 0,
            "text_align": "left",
            "z_index": 9,
            "linked_text_count": 1,
            "nesting_level": 0,
        })

    return synthetic


def find_enclosing_control_rect(image, text_region):
    image_h, image_w = image.shape[:2]
    pad_left = int(clamp(text_region["height"] * 2.0, 18, 64))
    pad_right = int(clamp(max(text_region["width"] * 1.9, 120), 120, image_w * 0.55))
    pad_y = int(clamp(text_region["height"] * 1.8, 16, 44))

    x0 = int(max(0, text_region["x"] - pad_left))
    y0 = int(max(0, text_region["y"] - pad_y))
    x1 = int(min(image_w, text_region["x"] + text_region["width"] + pad_right))
    y1 = int(min(image_h, text_region["y"] + text_region["height"] + pad_y))
    roi = image[y0:y1, x0:x1]
    if roi.size == 0:
        return None

    gray = cv2.cvtColor(roi, cv2.COLOR_BGR2GRAY)
    blurred = cv2.GaussianBlur(gray, (3, 3), 0)
    edges = cv2.Canny(blurred, 40, 140)
    edges = cv2.dilate(edges, np.ones((3, 3), np.uint8), iterations=1)
    contours, _ = cv2.findContours(edges, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)

    best_rect = None
    best_score = -1e9

    for contour in contours:
        rx, ry, rw, rh = cv2.boundingRect(contour)
        if rw < max(90, int(text_region["width"] * 1.35)) or rh < max(24, int(text_region["height"] * 1.45)):
            continue
        if rw > image_w * 0.95 or rh > min(image_h * 0.32, 140):
            continue

        aspect = rw / max(rh, 1)
        if aspect < 2.0 or aspect > 24.0:
            continue

        rect = {"x": x0 + rx, "y": y0 + ry, "width": rw, "height": rh}
        if not contains(rect, text_region, margin=12):
            continue

        approx = cv2.approxPolyDP(contour, 0.03 * cv2.arcLength(contour, True), True)
        if len(approx) > 10:
            continue

        left_pad = text_region["x"] - rect["x"]
        right_pad = rect["x"] + rect["width"] - (text_region["x"] + text_region["width"])
        vertical_center_offset = abs((rect["y"] + rect["height"] / 2) - (text_region["y"] + text_region["height"] / 2))
        height_target = text_region["height"] * 2.7
        score = (
            rw * rh * 0.002
            - vertical_center_offset * 0.18
            - abs(rh - height_target) * 0.25
            + (2.5 if len(approx) in (4, 5) else 0.0)
            + (2.0 if 8 <= left_pad <= 42 else 0.0)
            + (1.5 if right_pad >= left_pad else 0.0)
        )

        if score > best_score:
            best_score = score
            best_rect = rect

    return best_rect if best_rect and best_score > 2 else None


def create_synthetic_input_containers(image, text_elements, shape_elements):
    synthetic = []

    for text in text_elements:
        words = len((text.get("text") or "").split())
        if words < 2 or words > 6:
            continue
        if text["width"] < 40 or text["width"] > 360 or text["height"] < 10 or text["height"] > 28:
            continue
        if text.get("font_weight", 400) > 550:
            continue
        if not is_neutral_hex(text.get("text_color")):
            continue
        if not CONTROL_PLACEHOLDER_PATTERN.search(text.get("text", "")):
            continue

        if any(overlap_ratio(shape, text) > 0.28 or contains(shape, text, margin=6) for shape in shape_elements):
            continue

        rect = find_enclosing_control_rect(image, text)
        if rect is None:
            continue
        if any(overlap_ratio(shape, rect) > 0.65 for shape in shape_elements):
            continue
        left_pad = text["x"] - rect["x"]
        right_pad = rect["x"] + rect["width"] - (text["x"] + text["width"])
        if left_pad < 8 or left_pad > 42:
            continue
        if right_pad < max(left_pad + 16, 42):
            continue
        if rect["width"] < max(160, text["width"] + 60):
            continue
        if rect["width"] > max(420, text["width"] * 3.6):
            continue
        if rect["height"] < text["height"] * 1.7 or rect["height"] > text["height"] * 4.0:
            continue

        roi = crop(image, rect["x"], rect["y"], rect["width"], rect["height"])
        mask = np.ones((rect["height"], rect["width"]), dtype=np.uint8) * 255
        fill_hex, border_hex, border_width, border_radius = estimate_border_and_fill(roi, mask)

        synthetic.append({
            "kind": "shape",
            "type": "input",
            "text": "",
            "x": rect["x"],
            "y": rect["y"],
            "width": rect["width"],
            "height": rect["height"],
            "area": int(rect["width"] * rect["height"]),
            "background_color": fill_hex,
            "border_color": border_hex,
            "border_width": int(max(1, border_width)),
            "border_radius": int(border_radius),
            "text_color": "transparent",
            "font_size": 0,
            "font_weight": 0,
            "text_align": "left",
            "z_index": 10,
            "linked_text_count": 1,
            "nesting_level": 0,
        })

    return synthetic


def filter_regions(regions):
    regions = sorted(regions, key=lambda item: (item.get("z_index", 0), item["area"]), reverse=True)
    kept = []

    for region in regions:
        duplicate = False
        for existing in kept:
            x_overlap = max(0, min(region["x"] + region["width"], existing["x"] + existing["width"]) - max(region["x"], existing["x"]))
            y_overlap = max(0, min(region["y"] + region["height"], existing["y"] + existing["height"]) - max(region["y"], existing["y"]))
            overlap_area = x_overlap * y_overlap
            smaller = min(region["area"], existing["area"])
            if smaller > 0 and overlap_area / smaller > 0.84 and region["kind"] == existing["kind"]:
                duplicate = True
                break

        if not duplicate:
            kept.append(region)

    return sorted(kept, key=lambda item: (item.get("z_index", 0), item["y"], item["x"]))


def contains(parent, child, margin=4):
    return (
        child["x"] >= parent["x"] - margin and
        child["y"] >= parent["y"] - margin and
        child["x"] + child["width"] <= parent["x"] + parent["width"] + margin and
        child["y"] + child["height"] <= parent["y"] + parent["height"] + margin
    )


def parent_candidate_score(parent, element):
    if parent["area"] <= element["area"]:
        return -1e9

    overlap = overlap_ratio(parent, element)
    inter = iou(parent, element)
    center_x = abs((parent["x"] + parent["width"] / 2) - (element["x"] + element["width"] / 2))
    center_y = abs((parent["y"] + parent["height"] / 2) - (element["y"] + element["height"] / 2))
    area_ratio = parent["area"] / max(element["area"], 1)
    type_bonus = 0.0

    if element["kind"] == "text":
        if parent["type"] in ("button", "chip", "input"):
            if element["width"] > parent["width"] * 1.18:
                return -1e9
            if element["height"] > parent["height"] * 1.25:
                return -1e9
            if len((element.get("text") or "").split()) > 4 and parent["width"] < 220:
                return -1e9

        if parent["type"] in ("button", "chip"):
            inside_horizontally = (
                element["x"] >= parent["x"] - 6 and
                element["x"] + element["width"] <= parent["x"] + parent["width"] + 6
            )
            if not inside_horizontally:
                return -1e9

        if parent["type"] == "input" and not CONTROL_PLACEHOLDER_PATTERN.search(element.get("text", "")):
            inside_horizontally = (
                element["x"] >= parent["x"] - 4 and
                element["x"] + element["width"] <= parent["x"] + parent["width"] + 4
            )
            if not inside_horizontally:
                return -1e9
            if element["width"] > parent["width"] * 0.58:
                return -1e9

        if parent["type"] == "button":
            type_bonus += 4.5
        elif parent["type"] == "input":
            type_bonus += 4.0
        elif parent["type"] == "chip":
            type_bonus += 3.5
        elif parent["type"] == "toolbar":
            type_bonus += 2.2
        elif parent["type"] == "panel":
            type_bonus += 1.6

        if parent["type"] in ("button", "chip", "input"):
            height_fit = 1 - min(1.0, abs(parent["height"] - (element["height"] * 2.5)) / max(parent["height"], 1))
            type_bonus += height_fit * 1.5
            if center_y <= max(8, parent["height"] * 0.32):
                type_bonus += 1.25

        if parent["type"] == "panel":
            left_padding = element["x"] - parent["x"]
            top_padding = element["y"] - parent["y"]
            if 0 <= left_padding <= max(48, parent["width"] * 0.22):
                type_bonus += 0.9
            if 0 <= top_padding <= max(56, parent["height"] * 0.38):
                type_bonus += 0.7

    else:
        if parent["type"] in ("panel", "toolbar"):
            type_bonus += 2.0

    containment_penalty = min(2.0, max(0.0, area_ratio - 40.0) * 0.03)
    return (
        overlap * 5.5
        + inter * 3.0
        + type_bonus
        - (center_x / max(parent["width"], 1)) * 0.8
        - (center_y / max(parent["height"], 1)) * 1.2
        - containment_penalty
    )


def assign_relationships(elements):
    indexed = []
    for idx, element in enumerate(elements):
        enriched = dict(element)
        enriched["id"] = idx
        enriched["parent_id"] = None
        enriched["row_id"] = None
        indexed.append(enriched)

    shape_candidates = [el for el in indexed if el["kind"] == "shape" and el["type"] in ("panel", "toolbar", "button", "input", "chip")]
    shape_candidates.sort(key=lambda item: (item["area"], item["y"], item["x"]))

    for element in indexed:
        best_parent = None
        best_score = -1e9
        for parent in shape_candidates:
            if parent["id"] == element["id"]:
                continue
            if parent["area"] <= element["area"]:
                continue
            if contains(parent, element, margin=3):
                score = parent_candidate_score(parent, element)
                if score > best_score:
                    best_score = score
                    best_parent = parent

        # Fallback: attach nearby text to overlapping row controls if strict containment fails.
        if best_parent is None and element["kind"] == "text":
            overlap_sorted = sorted(shape_candidates, key=lambda parent: (
                overlap_ratio(parent, element),
                iou(parent, element),
                -abs((parent["y"] + parent["height"] / 2) - (element["y"] + element["height"] / 2)),
                -abs((parent["x"] + parent["width"] / 2) - (element["x"] + element["width"] / 2)),
            ), reverse=True)

            for parent in overlap_sorted:
                if parent["area"] <= element["area"]:
                    continue
                y_dist = abs((parent["y"] + parent["height"] / 2) - (element["y"] + element["height"] / 2))
                x_dist = abs((parent["x"] + parent["width"] / 2) - (element["x"] + element["width"] / 2))
                near_row = y_dist <= max(10, parent["height"] * 0.9, element["height"] * 1.1)
                near_column = x_dist <= max(36, parent["width"] * 0.9)

                if (
                    overlap_ratio(parent, element) >= 0.18 or
                    iou(parent, element) >= 0.08 or
                    (near_row and near_column)
                ):
                    score = parent_candidate_score(parent, element)
                    if score > best_score:
                        best_score = score
                        best_parent = parent

        if best_parent is not None:
            element["parent_id"] = best_parent["id"]
            element["parent_type"] = best_parent["type"]
            element["parent_background_color"] = best_parent["background_color"]

    visible = [el for el in indexed if el["kind"] != "background"]
    rows = []
    for element in sorted(visible, key=lambda item: (item["y"], item["x"])):
        placed = False
        mid_y = element["y"] + element["height"] / 2
        for row in rows:
            if abs(mid_y - row["center"]) <= max(10, row["height"] * 0.7, element["height"] * 0.7):
                row["items"].append(element)
                row["center"] = sum(item["y"] + item["height"] / 2 for item in row["items"]) / len(row["items"])
                row["height"] = max(row["height"], element["height"])
                placed = True
                break
        if not placed:
            rows.append({"center": mid_y, "height": element["height"], "items": [element]})

    for row_id, row in enumerate(rows):
        for element in row["items"]:
            element["row_id"] = row_id

    return indexed


def prune_detected_elements(elements):
    child_counts = {el["id"]: 0 for el in elements}
    child_texts = {}
    page_background = "#ffffff"
    for element in elements:
        if element["kind"] == "background":
            page_background = element.get("background_color", "#ffffff")
            break

    for element in elements:
        parent_id = element.get("parent_id")
        if parent_id is not None and parent_id in child_counts:
            child_counts[parent_id] += 1
            if element["kind"] == "text":
                child_texts.setdefault(parent_id, []).append((element.get("text") or "").strip())

    kept = []
    for element in elements:
        if element["kind"] == "background":
            kept.append(element)
            continue

        if element["kind"] == "shape":
            combined_text = " ".join(text for text in child_texts.get(element["id"], []) if text).strip()
            if element["type"] == "shape" and child_counts.get(element["id"], 0) == 0 and element["area"] < 3200:
                continue
            if element["type"] == "input" and element["width"] < 160 and child_counts.get(element["id"], 0) <= 1:
                continue
            if element["type"] == "chip" and (element["width"] > 260 or element["height"] > 46) and child_counts.get(element["id"], 0) <= 1:
                continue
            if element["type"] == "input" and combined_text and not CONTROL_PLACEHOLDER_PATTERN.search(combined_text):
                continue
            if element["type"] in ("button", "chip") and combined_text:
                if SECTION_HEADING_PATTERN.search(combined_text):
                    continue
                if not CONTROL_ACTION_PATTERN.search(combined_text):
                    bg_distance = hex_distance(element.get("background_color"), page_background)
                    if bg_distance < 42 or child_counts.get(element["id"], 0) > 1:
                        continue
            if element["type"] in ("button", "chip", "input"):
                bg_distance = hex_distance(element.get("background_color"), page_background)
                border_width = element.get("border_width", 0) or 0
                child_count = child_counts.get(element["id"], 0)
                if bg_distance < 18 and border_width <= 1 and child_count <= 1:
                    if element["type"] == "input" and element["width"] < 260:
                        continue
                    if element["type"] in ("button", "chip") and element["width"] < 220:
                        continue
            kept.append(element)
            continue

        text = (element.get("text") or "").strip()
        words = text.split()
        quality = element.get("quality", score_text_quality(text))
        parent_id = element.get("parent_id")

        if parent_id is None:
            if len(text) <= 1:
                continue
            if len(words) == 1 and len(text) <= 2:
                continue
            if quality < 0.35 and len(text) < 16:
                continue
            if element["width"] < 24 and element["height"] < 12:
                continue
            # Re-clean text to remove OCR garbage tokens
            recleaned = clean_ocr_text(text)
            if not recleaned:
                continue
            if recleaned != text:
                element = dict(element)
                element["text"] = recleaned
                text = recleaned
                words = text.split()
            # Drop pure OCR noise: short texts with high symbol ratio
            alpha_chars = sum(c.isalpha() for c in text)
            if len(text) <= 8 and alpha_chars / max(len(text), 1) < 0.5:
                continue
            # Drop texts that are mostly non-word tokens
            non_word_tokens = sum(1 for w in words if not re.match(r'^[a-zA-Z0-9_\-\.]+$', w))
            if len(words) <= 4 and non_word_tokens / max(len(words), 1) > 0.5:
                continue
            # Drop single-word texts that are 1-2 chars (noise like "at", "to", "On")
            # unless they are meaningful standalone labels
            MEANINGFUL_SHORT = {'ok', 'no', 'go', 'up', 'id', 'ui', 'api', 'css', 'git', 'url', 'ssh'}
            if len(words) == 1 and len(text) <= 3 and text.lower() not in MEANINGFUL_SHORT:
                continue
            # Drop texts where first word is a single uppercase letter (OCR artifact prefix like "A Activity", "B Projects")
            if len(words) >= 2 and len(words[0]) == 1 and words[0].isupper():
                element = dict(element)
                element["text"] = " ".join(words[1:])
                text = element["text"]
                words = text.split()

        kept.append(element)

    final = []
    seen_orphan_keys = set()
    for element in kept:
        if element["kind"] != "text" or element.get("parent_id") is not None:
            final.append(element)
            continue

        row_id = element.get("row_id")
        key_text = normalized_token(element.get("text", ""))
        key = (row_id, key_text)
        if key in seen_orphan_keys:
            continue
        seen_orphan_keys.add(key)
        final.append(element)

    return final


def normalized_text_signature(text):
    tokens = [normalized_token(token) for token in (text or "").split()]
    tokens = [token for token in tokens if token]
    return " ".join(tokens)


def text_region_score(region):
    quality = region.get("quality", score_text_quality(region.get("text", "")))
    confidence = float(region.get("confidence", 0.0)) / 100.0
    text = (region.get("text") or "").strip()
    token_count = len(text.split())
    area_score = min(region.get("width", 0) * region.get("height", 0), 12000) / 12000.0
    return quality * 0.58 + confidence * 0.24 + min(token_count, 6) * 0.09 + area_score * 0.09


def text_regions_duplicate(left, right):
    left_signature = normalized_text_signature(left.get("text", ""))
    right_signature = normalized_text_signature(right.get("text", ""))
    if not left_signature or not right_signature:
        return False

    if left.get("parent_id") != right.get("parent_id"):
        return False

    similar_text = (
        left_signature == right_signature or
        SequenceMatcher(None, left_signature, right_signature).ratio() >= 0.84
    )
    if not similar_text:
        return False

    if iou(left, right) >= 0.36 or overlap_ratio(left, right) >= 0.62:
        return True

    left_center_x = left["x"] + left["width"] / 2
    right_center_x = right["x"] + right["width"] / 2
    left_center_y = left["y"] + left["height"] / 2
    right_center_y = right["y"] + right["height"] / 2
    center_dx = abs(left_center_x - right_center_x)
    center_dy = abs(left_center_y - right_center_y)
    max_y = max(8, min(left["height"], right["height"]) * 0.9)
    max_x = max(14, min(left["width"], right["width"]) * 0.7)
    return center_dx <= max_x and center_dy <= max_y


def dedupe_text_elements(elements):
    non_text = [element for element in elements if element.get("kind") != "text"]
    text_elements = sorted(
        [element for element in elements if element.get("kind") == "text"],
        key=lambda item: text_region_score(item),
        reverse=True,
    )

    kept = []
    for candidate in text_elements:
        duplicate_index = None
        for index, existing in enumerate(kept):
            if text_regions_duplicate(candidate, existing):
                duplicate_index = index
                break

        if duplicate_index is None:
            kept.append(candidate)
            continue

        if text_region_score(candidate) > text_region_score(kept[duplicate_index]):
            kept[duplicate_index] = candidate

    return sorted(non_text + kept, key=lambda item: (item.get("z_index", 0), item["y"], item["x"]))


def clamp_element_bounds(element, image_w, image_h):
    if element.get("kind") == "background":
        element["x"] = 0
        element["y"] = 0
        element["width"] = int(image_w)
        element["height"] = int(image_h)
    else:
        element["x"] = int(clamp(element.get("x", 0), 0, max(0, image_w - 1)))
        element["y"] = int(clamp(element.get("y", 0), 0, max(0, image_h - 1)))
        element["width"] = int(clamp(element.get("width", 1), 1, max(1, image_w - element["x"])))
        element["height"] = int(clamp(element.get("height", 1), 1, max(1, image_h - element["y"])))

    element["area"] = int(element["width"] * element["height"])
    return element


def stabilize_parented_text_positions(elements):
    by_id = {element["id"]: element for element in elements}

    for element in elements:
        if element.get("kind") != "text":
            continue
        parent_id = element.get("parent_id")
        if parent_id is None:
            continue

        parent = by_id.get(parent_id)
        if not parent or parent.get("kind") != "shape":
            continue

        parent_left = parent["x"]
        parent_top = parent["y"]
        parent_right = parent["x"] + parent["width"]
        parent_bottom = parent["y"] + parent["height"]
        parent_type = parent.get("type")

        if parent_type in ("button", "chip"):
            target_y = int(round(parent_top + (parent["height"] - element["height"]) / 2))
            if abs(element["y"] - target_y) > max(4, int(parent["height"] * 0.22)):
                element["y"] = target_y

            max_width = max(8, parent["width"] - 6)
            if element["width"] > max_width:
                element["width"] = max_width

            min_x = parent_left + 3
            max_x = parent_right - element["width"] - 3
            if max_x < min_x:
                element["x"] = parent_left + 1
                element["width"] = max(6, parent["width"] - 2)
            else:
                element["x"] = int(clamp(element["x"], min_x, max_x))

        elif parent_type == "input":
            pad_x = int(clamp(parent["height"] * 0.28, 8, 22))
            target_x = parent_left + pad_x
            target_y = int(round(parent_top + (parent["height"] - element["height"]) / 2))
            usable_width = max(12, parent["width"] - (pad_x * 2))

            if abs(element["y"] - target_y) > max(4, int(parent["height"] * 0.22)):
                element["y"] = target_y

            if (
                element["width"] > usable_width * 1.18 or
                element["x"] < parent_left + 2 or
                element["x"] + element["width"] > parent_right - 2 or
                abs(element["x"] - target_x) > max(12, int(pad_x * 1.5))
            ):
                element["x"] = target_x
                element["width"] = min(element["width"], usable_width)
            else:
                min_x = parent_left + max(3, pad_x // 2)
                max_x = parent_right - element["width"] - max(3, pad_x // 2)
                if max_x >= min_x:
                    element["x"] = int(clamp(element["x"], min_x, max_x))

        elif parent_type == "toolbar":
            target_y = int(round(parent_top + (parent["height"] - element["height"]) / 2))
            if abs(element["y"] - target_y) <= max(10, int(parent["height"] * 0.45)):
                element["y"] = target_y

        inner_left = parent_left + 1
        inner_top = parent_top + 1
        inner_right = parent_right - 1
        inner_bottom = parent_bottom - 1

        if element["width"] > parent["width"] - 2:
            element["width"] = max(1, parent["width"] - 2)
        if element["height"] > parent["height"] - 2:
            element["height"] = max(1, parent["height"] - 2)

        max_x = inner_right - element["width"]
        max_y = inner_bottom - element["height"]
        if max_x >= inner_left:
            element["x"] = int(clamp(element["x"], inner_left, max_x))
        if max_y >= inner_top:
            element["y"] = int(clamp(element["y"], inner_top, max_y))


def align_text_row_baselines(elements):
    rows = {}
    for element in elements:
        if element.get("kind") != "text":
            continue
        row_id = element.get("row_id")
        if row_id is None:
            continue
        rows.setdefault(row_id, []).append(element)

    for row_elements in rows.values():
        by_parent = {}
        for element in row_elements:
            by_parent.setdefault(element.get("parent_id"), []).append(element)

        for group in by_parent.values():
            if len(group) < 2:
                continue

            heights = [item["height"] for item in group]
            y_values = [item["y"] for item in group]
            median_height = float(np.median(heights))
            if max(heights) - min(heights) > max(10, int(median_height * 0.85)):
                continue
            if np.std(y_values) > max(5.0, median_height * 0.34):
                continue

            target_y = int(round(np.median(y_values)))
            for element in group:
                if abs(element["y"] - target_y) <= max(6, int(element["height"] * 0.5)):
                    element["y"] = target_y


def stabilize_element_coordinates(elements, image_w, image_h):
    stabilized = [clamp_element_bounds(dict(element), image_w, image_h) for element in elements]
    stabilized = dedupe_text_elements(stabilized)
    stabilize_parented_text_positions(stabilized)
    align_text_row_baselines(stabilized)
    stabilized = [clamp_element_bounds(element, image_w, image_h) for element in stabilized]
    return sorted(stabilized, key=lambda item: (item.get("z_index", 0), item["y"], item["x"]))


def detect_ui_elements(image_path):
    image = cv2.imread(image_path)
    if image is None:
        return None

    height, width = image.shape[:2]
    page_background = estimate_page_background(image)
    text_regions_base = detect_text_regions(image)
    shape_regions = detect_shape_regions(image, text_regions_base, page_background)
    text_regions = explode_long_text_lines(text_regions_base, shape_regions)
    text_regions = merge_adjacent_text_regions(text_regions)
    synthetic_inputs = create_synthetic_input_containers(image, text_regions, shape_regions)
    shape_regions.extend(synthetic_inputs)
    shape_regions.extend(create_synthetic_text_containers(shape_regions + text_regions))
    # Inject structural bands (navbar, tab bar, content panels, sidebar) missed by contour detection

    background = {
        "kind": "background",
        "type": "background",
        "text": "",
        "x": 0,
        "y": 0,
        "width": width,
        "height": height,
        "area": int(width * height),
        "background_color": hex_from_bgr(page_background),
        "border_color": "transparent",
        "border_width": 0,
        "border_radius": 0,
        "text_color": "transparent",
        "font_size": 0,
        "font_weight": 0,
        "text_align": "left",
        "z_index": 0,
    }

    elements = [background] + shape_regions + text_regions
    elements = assign_relationships(filter_regions(elements))
    # Add structural bands AFTER filter_regions so they aren't removed by overlap logic
    structural_bands = create_structural_bands(image, text_regions, shape_regions, page_background)
    if structural_bands:
        elements = structural_bands + elements  # bands go behind everything
    elements = prune_detected_elements(elements)
    elements = stabilize_element_coordinates(elements, width, height)
    elements = [normalize_component(element, width, height) for element in elements]

    return {
        "image": {
            "width": width,
            "height": height,
            "background_color": background["background_color"],
        },
        "components": elements[:220],
    }


@app.route("/health", methods=["GET"])
def health():
    return jsonify({"status": "ok"})


@app.route("/detect", methods=["POST"])
def detect():
    data = request.get_json()
    if not data or "image_path" not in data:
        return jsonify({"error": "image_path required"}), 400

    image_path = data["image_path"]
    if not os.path.exists(image_path):
        return jsonify({"error": f"File not found: {image_path}"}), 404

    try:
        detection = detect_ui_elements(image_path)
        if detection is None:
            return jsonify({"error": "Could not read image"}), 400
        return jsonify(detection)
    except Exception as error:
        import traceback
        traceback.print_exc()
        return jsonify({"error": str(error)}), 500


if __name__ == "__main__":
    if len(sys.argv) >= 3 and sys.argv[1] == "--once":
        detection = detect_ui_elements(sys.argv[2])
        if detection is None:
            print(json.dumps({"error": "Could not read image"}))
            sys.exit(1)
        print(json.dumps(detection))
        sys.exit(0)
    app.run(host="0.0.0.0", port=5001, debug=False)
