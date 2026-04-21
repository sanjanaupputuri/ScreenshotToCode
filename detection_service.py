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
# Chevron/arrow characters that indicate a dropdown
DROPDOWN_CHARS = re.compile(r"[∨▾▼⌄ˇ]|(\s*[vV]\s*$)")


def has_dropdown_arrow(image_roi, x, y, w, h, full_image):
    """
    Check if there's a small downward-pointing chevron/arrow to the right of this region.
    Looks in a narrow strip to the right of the bounding box.
    """
    img_h, img_w = full_image.shape[:2]
    # Check a strip to the right of the element (up to 28px wide)
    strip_x = min(x + w, img_w - 1)
    strip_w = min(28, img_w - strip_x)
    if strip_w < 4:
        return False
    strip = full_image[max(0, y):min(img_h, y + h), strip_x:strip_x + strip_w]
    if strip.size == 0:
        return False
    # A chevron is a small dark region in the center-right of the strip
    gray = cv2.cvtColor(strip, cv2.COLOR_BGR2GRAY)
    _, dark = cv2.threshold(gray, 180, 255, cv2.THRESH_BINARY_INV)
    dark_ratio = np.count_nonzero(dark) / max(dark.size, 1)
    return 0.04 < dark_ratio < 0.45


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

    text = re.sub(r"[^\w\s\-.,!?@#$%&*()+=:/|<>]", "", text)  # remove brackets and other noise
    # Insert space between digit and letter runs (e.g. "1Branch" → "1 Branch")
    text = re.sub(r"(\d)([A-Za-z])", r"\1 \2", text)
    # Insert space between lowercase-to-uppercase transitions (e.g. "GotoFile" → "Goto File")  
    text = re.sub(r"([a-z])([A-Z])", r"\1 \2", text)
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
                    'own','put','say','see','set','she','too','try','use','way','who','why',
                    'pull','push','fork','star','wiki','code','file','type','find','view',
                    'edit','open','copy','save','run','tag','log','raw','zip','tab','nav'}
    # Known OCR misreads to always drop
    OCR_GARBAGE_WORDS = {'mae','smee','vour','yout','tne','tbe','ine','lhe','lhe','rne','adn','teh'}
    words = text.split()
    cleaned = []
    for w in words:
        wl = w.lower()
        if wl in OCR_GARBAGE_WORDS:
            continue
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
            # Drop known OCR garbage patterns (e.g. "vour"→"your" misread, "mae", "smee")
            if len(w) <= 5 and not any(c.isdigit() for c in w):
                vowels = sum(1 for c in w.lower() if c in 'aeiou')
                if vowels == 0:
                    continue  # no vowels = garbage
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
            same_baseline = abs(region["y"] - line["y"]) <= max(6, int(min(line["height"], region["height"]) * 0.40))
            close_x = region["x"] <= line["x"] + line["width"] + max(24, int(line["height"] * 1.5))
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
        same_row = abs(curr_center - prev_center) <= max(6, min(previous["height"], current["height"]) * 0.40)
        similar_height = abs(previous["height"] - current["height"]) <= max(10, min(previous["height"], current["height"]) * 0.75)
        similar_font = abs(previous["font_size"] - current["font_size"]) <= 10
        reasonable_gap = -2 <= gap <= max(48, min(previous["height"], current["height"]) * 3.5)
        combined_width = max(previous["x"] + previous["width"], current["x"] + current["width"]) - previous["x"]

        # Don't merge short labels with large gaps — likely separate nav tabs or buttons
        prev_words = len(previous.get("text","").split())
        curr_words = len(current.get("text","").split())
        avg_h = min(previous["height"], current["height"])
        # Broader guard: any gap > 1.5x line height between short labels = separate items
        looks_like_nav = (prev_words <= 3 and curr_words <= 3 and
                          gap > avg_h * 1.5)

        if same_row and similar_height and similar_font and reasonable_gap and combined_width <= 1400 and not looks_like_nav:
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


def merge_multiline_text_blocks(regions):
    """Merge vertically stacked text regions that form a single paragraph/heading."""
    if not regions:
        return regions

    sorted_r = sorted(regions, key=lambda r: (r["x"], r["y"]))
    merged = []
    used = set()

    for i, base in enumerate(sorted_r):
        if i in used:
            continue
        group = [base]
        used.add(i)
        for j, candidate in enumerate(sorted_r):
            if j in used:
                continue
            # Must be directly below base (within 2x line height)
            vertical_gap = candidate["y"] - (base["y"] + base["height"])
            if vertical_gap < 0 or vertical_gap > base["height"] * 2.0:
                continue
            # Must be in same x-region (left edge within 2x font size)
            x_dist = abs(candidate["x"] - base["x"])
            if x_dist > max(base["font_size"] * 2, 40):
                continue
            # Similar font size
            if abs(base["font_size"] - candidate["font_size"]) > 5:
                continue
            # Similar color
            if base.get("text_color") and candidate.get("text_color"):
                if hex_distance(base["text_color"], candidate["text_color"]) > 40:
                    continue
            group.append(candidate)
            used.add(j)

        if len(group) == 1:
            merged.append(base)
            continue

        group = sorted(group, key=lambda r: r["y"])
        combined_text = collapse_duplicate_tokens(" ".join(r["text"] for r in group))
        x0 = min(r["x"] for r in group)
        y0 = min(r["y"] for r in group)
        x1 = max(r["x"] + r["width"] for r in group)
        y1 = max(r["y"] + r["height"] for r in group)
        result = dict(group[0])
        result["text"] = combined_text
        result["x"] = x0
        result["y"] = y0
        result["width"] = x1 - x0
        result["height"] = y1 - y0
        result["area"] = result["width"] * result["height"]
        result["quality"] = score_text_quality(combined_text)
        merged.append(result)

    return sorted(merged, key=lambda r: (r["y"], r["x"]))


def detect_text_regions(image):
    gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
    rgb = cv2.cvtColor(image, cv2.COLOR_BGR2RGB)
    otsu = cv2.threshold(gray, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)[1]
    inverted = cv2.bitwise_not(otsu)

    # For dark UIs (white/light text on dark bg): invert the raw gray image so
    # white text becomes black text on white background — Tesseract reads this best.
    gray_inv = cv2.bitwise_not(gray)  # helps dark-bg text regardless of overall brightness

    variants = [
        (rgb, "--psm 6 --oem 3", 40),
        (otsu, "--psm 6 --oem 3", 40),
        (inverted, "--psm 6 --oem 3", 40),
        (gray, "--psm 11 --oem 3", 40),
        (gray, "--psm 13 --oem 3", 35),    # raw line — large isolated headings
        (gray_inv, "--psm 6 --oem 3", 30), # inverted gray — white-on-dark text
        (gray_inv, "--psm 11 --oem 3", 30),
        (gray_inv, "--psm 13 --oem 3", 25), # large colored/white text
    ]

    regions = []

    for variant, config, min_conf in variants:
        data = pytesseract.image_to_data(variant, output_type=pytesseract.Output.DICT, config=config)
        for i in range(len(data["text"])):
            raw = data["text"][i].strip()
            if not raw:
                continue

            confidence = float(data["conf"][i]) if data["conf"][i] != "-1" else 0.0
            if confidence < min_conf:
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
                "font_weight": 700 if h >= 48 else 600 if h >= 32 else 400,
                "text_align": "left",
                "z_index": 20,
                "brightness": brightness,
                "quality": score_text_quality(text),
            })

    consolidated = consolidate_text_candidates(regions)
    merged = merge_text_regions(consolidated)
    merged = merge_adjacent_text_regions(merged)
    merged = merge_adjacent_text_regions(merged)  # second pass catches stragglers
    merged = merge_multiline_text_blocks(merged)
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
    
    # Detect colored regions by looking for non-neutral colors
    # This helps find buttons with colored backgrounds
    b, g, r = cv2.split(image)
    
    # Find blue regions (B > R+G)
    blue_mask = cv2.threshold(b.astype(np.int16) - r.astype(np.int16) - 20, 20, 255, cv2.THRESH_BINARY)[1].astype(np.uint8)
    
    # Find red regions (R > B+G)
    red_mask = cv2.threshold(r.astype(np.int16) - b.astype(np.int16) - 20, 20, 255, cv2.THRESH_BINARY)[1].astype(np.uint8)
    
    # Find green regions (G > R+B)
    green_mask = cv2.threshold(g.astype(np.int16) - r.astype(np.int16) - 20, 20, 255, cv2.THRESH_BINARY)[1].astype(np.uint8)
    
    # Combine color masks
    color_mask = cv2.bitwise_or(blue_mask, red_mask)
    color_mask = cv2.bitwise_or(color_mask, green_mask)
    
    # Clean up color mask to get solid regions
    color_kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (7, 7))
    color_mask = cv2.morphologyEx(color_mask, cv2.MORPH_CLOSE, color_kernel, iterations=2)
    color_mask = cv2.dilate(color_mask, color_kernel, iterations=1)
    
    # Combine with edge detection
    mask = cv2.bitwise_or(edges, inv_white)
    mask = cv2.bitwise_or(mask, color_mask)
    
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


def fill_solidity(roi):
    """
    Return the fraction of pixels that are close to the median fill color.
    High solidity (>0.6) = solid background (real button/panel).
    Low solidity (<0.4) = text/icons on a different background (not a button).
    """
    if roi.size == 0:
        return 0.0
    flat = roi.reshape(-1, 3).astype(np.float32)
    median = np.median(flat, axis=0)
    dists = np.linalg.norm(flat - median, axis=1)
    return float(np.mean(dists < 40))


def shape_type(x, y, w, h, text_count, image_w, image_h, fill_bgr, border_width,
               roi=None, page_background=None):
    aspect = w / max(h, 1)
    area_ratio = (w * h) / float(image_w * image_h)
    brightness = float(np.mean(fill_bgr))

    if y < image_h * 0.12 and h <= image_h * 0.08 and w > image_w * 0.45:
        return "toolbar"
    if 0.75 <= aspect <= 1.25 and 10 <= w <= 96 and 10 <= h <= 96 and text_count == 0:
        # Reject if fill is bright on a dark page — likely a letter outline, not an avatar/icon
        fill_brightness = float(np.mean(fill_bgr)) if fill_bgr is not None else 255.0
        page_brightness = float(np.mean(page_background)) if page_background is not None else 128.0
        if fill_brightness > 180 and page_brightness < 120:
            pass  # fall through — not an avatar
        else:
            return "avatar" if w >= 24 and h >= 24 else "icon"
    if w >= 160 and 4.0 <= aspect <= 20.0 and 24 <= h <= 72 and (brightness > 238 or (border_width > 0 and brightness > 220)):
        return "input"

    # Compute fill solidity to distinguish solid-bg buttons from text-on-bg regions
    solidity = fill_solidity(roi) if roi is not None else 1.0

    # A real button must have a solid fill (not just colored text pixels on dark bg)
    # Low solidity means the region is mostly text/icons, not a solid button background
    is_solid_fill = solidity >= 0.6

    # Button detection — requires solid fill
    if text_count > 0 and 2.0 <= aspect <= 10.0 and 28 <= h <= 80 and w >= 120:
        if (brightness < 220 or border_width > 0) and is_solid_fill:
            return "button"

    # Chip detection - smaller, badge-like elements
    if text_count > 0 and w <= 260 and area_ratio < 0.012 and 2.0 <= aspect <= 10.0 and 18 <= h <= 46:
        if (w < 120 or (brightness > 220 and border_width == 0)) and is_solid_fill:
            return "chip"

    # Fallback button detection — only for solid-fill regions
    if 2.0 <= aspect <= 10.0 and 24 <= h <= 80 and (brightness < 230 or border_width > 0) and is_solid_fill:
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


def extract_text_from_region(image, x, y, w, h):
    """Extract text directly from a specific region using OCR."""
    roi = crop(image, x, y, w, h)
    if roi.size == 0:
        return ""

    # Upscale small regions for better OCR accuracy
    scale = max(1, min(3, 48 // max(h, 1)))
    if scale > 1:
        roi = cv2.resize(roi, (w * scale, h * scale), interpolation=cv2.INTER_CUBIC)

    gray = cv2.cvtColor(roi, cv2.COLOR_BGR2GRAY)
    _, thresh = cv2.threshold(gray, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
    inv = cv2.bitwise_not(thresh)

    best = ""
    for variant in [thresh, inv, roi]:
        t = pytesseract.image_to_string(variant, config="--psm 7").strip()
        cleaned = clean_ocr_text(t)
        stripped = re.sub(r'^[\d\W]+\s*', '', cleaned).strip()
        candidate = stripped if stripped else cleaned
        if len(candidate) > len(best):
            best = candidate

    return best


def detect_shape_regions(image, text_regions, page_background):
    height, width = image.shape[:2]
    
    # Standard edge-based detection
    mask = build_shape_mask(image)
    contours, hierarchy = cv2.findContours(mask, cv2.RETR_TREE, cv2.CHAIN_APPROX_SIMPLE)
    
    # Additional color-based button detection
    b, g, r = cv2.split(image)
    blue_mask = cv2.threshold(b.astype(np.int16) - r.astype(np.int16) - 20, 20, 255, cv2.THRESH_BINARY)[1].astype(np.uint8)
    red_mask = cv2.threshold(r.astype(np.int16) - b.astype(np.int16) - 20, 20, 255, cv2.THRESH_BINARY)[1].astype(np.uint8)
    green_mask = cv2.threshold(g.astype(np.int16) - r.astype(np.int16) - 20, 20, 255, cv2.THRESH_BINARY)[1].astype(np.uint8)
    
    color_mask = cv2.bitwise_or(blue_mask, red_mask)
    color_mask = cv2.bitwise_or(color_mask, green_mask)
    
    color_kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (7, 7))
    color_mask = cv2.morphologyEx(color_mask, cv2.MORPH_CLOSE, color_kernel, iterations=2)
    color_mask = cv2.dilate(color_mask, color_kernel, iterations=1)
    
    color_contours, _ = cv2.findContours(color_mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)

    elements = []
    min_area = max(180, int(width * height * 0.00045))

    # Process color-detected contours first (buttons with colored backgrounds)
    for contour in color_contours:
        x, y, w, h = cv2.boundingRect(contour)
        area = w * h
        
        # Button-sized colored regions (allow smaller for toggles/chips)
        if area < min_area or w < 28 or h < 14:
            continue
        if w > width * 0.99 and h > height * 0.99:
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

        # Check if the bounding box corners match the page background.
        # Only apply for large regions where the fill is close to the page background
        # (i.e., the contour is outlining text on the page bg, not a solid button).
        # Skip this check if the fill is clearly different from page background (real button).
        fill_vs_page_dist = np.linalg.norm(fill_bgr.astype(float) - page_background.astype(float))
        if (w > 300 or h > 60) and fill_vs_page_dist < 80:
            corner_strip = max(2, min(5, min(w, h) // 8))
            corner_pixels = np.concatenate([
                roi[:corner_strip, :corner_strip].reshape(-1, 3),
                roi[:corner_strip, w - corner_strip:].reshape(-1, 3),
                roi[h - corner_strip:, :corner_strip].reshape(-1, 3),
                roi[h - corner_strip:, w - corner_strip:].reshape(-1, 3),
            ], axis=0)
            corner_bgr = np.median(corner_pixels, axis=0)
            corner_bg_dist = np.linalg.norm(corner_bgr - page_background)
            if corner_bg_dist < 30:
                continue

        # If the contour fill color is very different from the bounding box median
        # AND the bounding box is mostly dark, this is colored text on a dark background.
        roi_median = np.median(roi.reshape(-1, 3), axis=0)
        roi_brightness = float(np.mean(roi_median))
        fill_vs_roi_dist = np.linalg.norm(fill_bgr.astype(float) - roi_median.astype(float))
        if fill_vs_roi_dist > 60 and roi_brightness < 100:
            continue

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

        # Only classify as button if the region has a solid fill (not just colored text on dark bg)
        solidity = fill_solidity(roi)
        if solidity < 0.6:
            continue

        element_type = shape_type(x, y, w, h, len(linked_texts), width, height,
                                  fill_bgr, border_width, roi=roi, page_background=page_background)
        if element_type not in ("button", "chip", "input"):
            element_type = "button"
        z_index = 10

        # Extract text directly from the button region (don't rely on global OCR text matching)
        direct_text = ""
        if element_type in ("button", "chip"):
            raw_dt = extract_text_from_region(image, x, y, w, h)
            words = raw_dt.split()
            alpha_ratio = sum(c.isalpha() for c in raw_dt) / max(len(raw_dt), 1)
            # More lenient: accept single words if they're long enough
            if raw_dt and len(words) >= 1 and alpha_ratio >= 0.5 and len(raw_dt) >= 2:
                direct_text = raw_dt

        elements.append({
            "kind": "shape",
            "type": element_type,
            "text": direct_text,  # Store in 'text' field directly
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
            "nesting_level": 0,
        })

    # Process standard edge-detected contours
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

        # Check if the contour fill color is actually the text/icon color rather than a background.
        # If the bounding box median (full roi) is much darker than the contour fill,
        # the contour is outlining text pixels on a dark background — not a solid button.
        roi_median = np.median(roi.reshape(-1, 3), axis=0)
        fill_vs_roi_dist = np.linalg.norm(fill_bgr.astype(float) - roi_median.astype(float))
        # If fill is very different from the overall roi median AND roi is dark, it's text on bg
        roi_brightness = float(np.mean(roi_median))
        page_brightness = float(np.mean(page_background))
        if fill_vs_roi_dist > 60 and roi_brightness < 120:
            # The contour fill is a bright/colored text on a dark background — skip
            continue

        # Skip small near-square bright shapes on dark pages — these are letter outlines from large text
        fill_brightness = float(np.mean(fill_bgr))
        aspect_ratio = w / max(h, 1)
        if (0.5 <= aspect_ratio <= 2.0 and w <= 120 and h <= 120
                and fill_brightness > 180 and page_brightness < 120
                and not linked_texts):
            continue

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

        element_type = shape_type(x, y, w, h, len(linked_texts), width, height, fill_bgr, border_width, roi=roi, page_background=page_background)
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

        # Extract text directly from button/chip regions
        direct_text = ""
        if element_type in ("button", "chip"):
            raw_dt = extract_text_from_region(image, x, y, w, h)
            # Only use direct_text if it looks like real words (not OCR garbage)
            words = raw_dt.split()
            alpha_ratio = sum(c.isalpha() for c in raw_dt) / max(len(raw_dt), 1)
            # More lenient: accept single words if they're long enough
            if raw_dt and len(words) >= 1 and alpha_ratio >= 0.5 and len(raw_dt) >= 2:
                direct_text = raw_dt

        elements.append({
            "kind": "shape",
            "type": element_type,
            "text": direct_text,  # Store in 'text' field directly
            "_direct_text": direct_text,
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
        # Tighter constraints: max 32px height (not 40), and skip large text
        if text["width"] > 280 or text["height"] > 32 or text["width"] < 26:
            continue
        # Skip if text is too large (likely a heading, not a chip)
        if text.get("font_size", 0) > 24 or text.get("font_weight", 400) > 650:
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
            # Stricter overlap threshold for inputs: 40% instead of 55%
            threshold = 0.40 if (region.get("type") == "input" or existing.get("type") == "input") else 0.55
            if smaller > 0 and overlap_area / smaller > threshold and region["kind"] == existing["kind"]:
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
            # Two elements are on the same row only if their vertical centers are within
            # 40% of the smaller element's height — strict enough to separate adjacent rows
            tolerance = min(row["height"], element["height"]) * 0.40
            if abs(mid_y - row["center"]) <= max(6, tolerance):
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
    shapes_with_direct_text = set()
    for element in elements:
        if element["kind"] == "shape" and element.get("_direct_text"):
            shapes_with_direct_text.add(element["id"])

    # Build a map of button/chip shapes for quick lookup
    button_shapes = {}
    for element in elements:
        if element["kind"] == "shape" and element["type"] in ("button", "chip"):
            button_shapes[element["id"]] = element

    for element in elements:
        if element["kind"] == "background":
            kept.append(element)
            continue

        # Skip text elements that are inside a button/chip with _direct_text
        if element["kind"] == "text":
            parent_id = element.get("parent_id")
            if parent_id is not None and parent_id in shapes_with_direct_text:
                continue
            
            # Also skip if text is completely contained in any button/chip (even without direct_text)
            # This prevents duplicate text showing up both as standalone and inside button
            skip_text = False
            for btn_id, btn in button_shapes.items():
                if contains(btn, element, margin=2):
                    skip_text = True
                    break
            if skip_text:
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
            if quality < 0.42 and len(text) < 16:
                continue
            if element["width"] < 24 and element["height"] < 16:
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
            if np.std(y_values) > max(3.0, median_height * 0.20):
                continue

            target_y = int(round(np.median(y_values)))
            for element in group:
                if abs(element["y"] - target_y) <= max(6, int(element["height"] * 0.5)):
                    element["y"] = target_y


def detect_macro_layout(image, page_background):
    """
    Detect the overall layout type before micro-detection.
    Returns one of: 'centered-single-column', 'sidebar-main', 'grid-cards', 'hero-content', 'generic'
    Also returns structural zone hints: navbar_bottom, sidebar_x, hero_bottom.
    """
    height, width = image.shape[:2]
    gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
    page_bg_hex = hex_from_bgr(page_background)
    page_luma = float(np.mean(page_background))

    # Horizontal projection: find content rows
    _, binary = cv2.threshold(gray, 240 if page_luma > 128 else 30, 255, cv2.THRESH_BINARY_INV if page_luma > 128 else cv2.THRESH_BINARY)
    h_proj = np.sum(binary, axis=1).astype(np.float32)
    h_proj_smooth = np.convolve(h_proj, np.ones(5)/5, mode='same')

    # Vertical projection: find content columns
    v_proj = np.sum(binary, axis=0).astype(np.float32)
    v_proj_smooth = np.convolve(v_proj, np.ones(5)/5, mode='same')

    # Detect sidebar: a vertical band on left/right with different background color
    sidebar_x = None
    left_band = image[:, :int(width * 0.28), :]
    right_band = image[:, int(width * 0.72):, :]
    main_band = image[:, int(width * 0.28):int(width * 0.72), :]

    left_median = np.median(left_band.reshape(-1, 3), axis=0)
    right_median = np.median(right_band.reshape(-1, 3), axis=0)
    main_median = np.median(main_band.reshape(-1, 3), axis=0)

    left_diff = float(np.linalg.norm(left_median - main_median))
    right_diff = float(np.linalg.norm(right_median - main_median))

    has_left_sidebar = left_diff > 18 and v_proj_smooth[:int(width * 0.28)].mean() > v_proj_smooth[int(width * 0.28):int(width * 0.72)].mean() * 0.3
    has_right_sidebar = right_diff > 18 and v_proj_smooth[int(width * 0.72):].mean() > v_proj_smooth[int(width * 0.28):int(width * 0.72)].mean() * 0.3

    if has_left_sidebar:
        sidebar_x = int(width * 0.28)
    elif has_right_sidebar:
        sidebar_x = int(width * 0.72)

    # Detect hero: large top section with big text (high h_proj values in top 40%)
    hero_bottom = None
    top_proj = h_proj_smooth[:int(height * 0.4)]
    if len(top_proj) > 0:
        # Find where content density drops significantly after a high-density region
        max_density = float(top_proj.max())
        if max_density > width * 0.05:
            # Find the first significant gap after the dense region
            for y in range(int(height * 0.15), int(height * 0.4)):
                if h_proj_smooth[y] < max_density * 0.15:
                    hero_bottom = y
                    break

    # Detect grid of cards: regular repeating pattern in content area
    # Look for evenly-spaced vertical gaps in the content zone
    content_start = int(height * 0.15)
    content_proj = h_proj_smooth[content_start:]
    gap_positions = []
    in_gap = False
    for i, val in enumerate(content_proj):
        if val < width * 0.01 and not in_gap:
            in_gap = True
            gap_positions.append(content_start + i)
        elif val >= width * 0.01:
            in_gap = False

    is_grid = False
    if len(gap_positions) >= 3:
        gaps = [gap_positions[i+1] - gap_positions[i] for i in range(len(gap_positions)-1)]
        if gaps:
            avg_gap = float(np.mean(gaps))
            std_gap = float(np.std(gaps))
            is_grid = std_gap < avg_gap * 0.35 and avg_gap > 20

    # Determine layout type
    if has_left_sidebar or has_right_sidebar:
        layout_type = 'sidebar-main'
    elif is_grid:
        layout_type = 'grid-cards'
    elif hero_bottom and hero_bottom > height * 0.2:
        layout_type = 'hero-content'
    else:
        # Check if content is centered (most content in middle 60% of width)
        center_density = float(v_proj_smooth[int(width*0.2):int(width*0.8)].mean())
        edge_density = float(np.concatenate([v_proj_smooth[:int(width*0.2)], v_proj_smooth[int(width*0.8):]]).mean())
        layout_type = 'centered-single-column' if center_density > edge_density * 1.5 else 'generic'

    return {
        'layout_type': layout_type,
        'sidebar_x': sidebar_x,
        'hero_bottom': hero_bottom,
        'is_grid': is_grid,
        'has_left_sidebar': has_left_sidebar,
        'has_right_sidebar': has_right_sidebar,
    }


def detect_row_boundaries(image):
    """
    Horizontal projection profile: find true row boundaries by locating
    whitespace gaps between rows of content pixels.
    Returns a list of (row_top, row_bottom) tuples in image pixel coords.
    """
    gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY) if len(image.shape) == 3 else image
    h, w = gray.shape

    # Binarize: pixels darker than 240 are "content"
    _, binary = cv2.threshold(gray, 240, 255, cv2.THRESH_BINARY_INV)

    # Horizontal projection: count content pixels per row
    projection = np.sum(binary, axis=1).astype(np.float32)

    # Smooth to avoid single-pixel noise
    kernel = np.ones(5) / 5
    projection = np.convolve(projection, kernel, mode='same')

    # Find valleys (gaps = rows where projection < threshold)
    threshold = w * 0.005  # less than 0.5% of width has content = gap row
    in_gap = projection < threshold

    # Build row bands from non-gap regions
    bands = []
    in_band = False
    band_start = 0
    for y in range(h):
        if not in_gap[y] and not in_band:
            in_band = True
            band_start = y
        elif in_gap[y] and in_band:
            in_band = False
            bands.append((band_start, y))
    if in_band:
        bands.append((band_start, h))

    # Merge bands that are very close together (gap < 8px)
    merged = []
    for band in bands:
        if merged and band[0] - merged[-1][1] < 8:
            merged[-1] = (merged[-1][0], band[1])
        else:
            merged.append(list(band))

    return merged  # list of [top, bottom]


# T1: Vertical projection profile — find column gutters
def detect_column_boundaries(image):
    """
    Vertical projection profile: find column gutters by locating
    whitespace gaps between columns of content pixels.
    Returns list of (col_left, col_right) tuples.
    """
    gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY) if len(image.shape) == 3 else image
    h, w = gray.shape
    _, binary = cv2.threshold(gray, 240, 255, cv2.THRESH_BINARY_INV)
    projection = np.sum(binary, axis=0).astype(np.float32)
    kernel = np.ones(5) / 5
    projection = np.convolve(projection, kernel, mode='same')
    threshold = h * 0.005
    in_gap = projection < threshold
    cols = []
    in_col = False
    col_start = 0
    for x in range(w):
        if not in_gap[x] and not in_col:
            in_col = True
            col_start = x
        elif in_gap[x] and in_col:
            in_col = False
            cols.append([col_start, x])
    if in_col:
        cols.append([col_start, w])
    merged = []
    for col in cols:
        if merged and col[0] - merged[-1][1] < 8:
            merged[-1] = [merged[-1][0], col[1]]
        else:
            merged.append(col)
    return merged


# T2: Divider detection — 1-2px full-width/full-height lines
def detect_dividers(image, page_background):
    """Detect thin horizontal/vertical divider lines."""
    gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY) if len(image.shape) == 3 else image
    h, w = gray.shape
    dividers = []
    bg_luma = float(cv2.cvtColor(np.uint8([[page_background]]), cv2.COLOR_BGR2GRAY)[0][0])

    # Horizontal dividers: rows where >80% of pixels differ from bg by 10-60 luma
    for y in range(1, h - 1):
        row = gray[y, :].astype(np.float32)
        diff = np.abs(row - bg_luma)
        # Must be a thin line: this row has many different pixels, rows above/below don't
        line_pixels = np.sum((diff > 8) & (diff < 80))
        if line_pixels / w > 0.75:
            above = np.sum(np.abs(gray[y-1, :].astype(np.float32) - bg_luma) > 8) / w
            below = np.sum(np.abs(gray[y+1, :].astype(np.float32) - bg_luma) > 8) / w
            if above < 0.15 and below < 0.15:
                color = hex_from_bgr(np.median(image[y, :, :], axis=0))
                dividers.append({"kind": "divider", "type": "divider", "orientation": "horizontal",
                                  "x": 0, "y": y, "width": w, "height": 1,
                                  "background_color": color, "text": "", "z_index": 2})
    return dividers


# T3: Card detection — panel containing multiple children of different types
def detect_cards(elements):
    """
    Tag panel elements as 'card' if they contain children of at least 2 different types
    (e.g. text + button, or image + text).
    """
    by_id = {el["id"]: el for el in elements if "id" in el}
    child_types = {}
    for el in elements:
        pid = el.get("parent_id")
        if pid is not None:
            child_types.setdefault(pid, set()).add(el.get("type", el.get("kind", "unknown")))

    for el in elements:
        if el.get("type") == "panel" and el.get("id") in child_types:
            types = child_types[el["id"]]
            # Card = panel with children of 2+ distinct types including at least one text
            has_text = any(t in ("text", "body_text", "title", "muted_text") for t in types)
            if len(types) >= 2 and has_text:
                el["type"] = "card"
    return elements


# T4: Alignment & spacing measurement
def measure_spacing(elements):
    """
    For each element, measure the gap to its nearest right-neighbor and bottom-neighbor
    on the same row/column. Store as spacing_right and spacing_bottom.
    """
    visible = [e for e in elements if e.get("kind") not in ("background",)]
    for el in visible:
        ex, ey, ew, eh = el["x"], el["y"], el["width"], el["height"]
        el_right = ex + ew
        el_bottom = ey + eh
        el_cy = ey + eh / 2

        # Nearest right neighbor on same row
        right_gap = None
        for other in visible:
            if other is el:
                continue
            ox, oy, ow, oh = other["x"], other["y"], other["width"], other["height"]
            oc_y = oy + oh / 2
            if ox > el_right and abs(oc_y - el_cy) < max(eh, oh) * 0.5:
                gap = ox - el_right
                if right_gap is None or gap < right_gap:
                    right_gap = gap
        if right_gap is not None:
            el["spacing_right"] = int(right_gap)

        # Nearest bottom neighbor in same column
        bottom_gap = None
        el_cx = ex + ew / 2
        for other in visible:
            if other is el:
                continue
            ox, oy, ow, oh = other["x"], other["y"], other["width"], other["height"]
            oc_x = ox + ow / 2
            if oy > el_bottom and abs(oc_x - el_cx) < max(ew, ow) * 0.5:
                gap = oy - el_bottom
                if bottom_gap is None or gap < bottom_gap:
                    bottom_gap = gap
        if bottom_gap is not None:
            el["spacing_bottom"] = int(bottom_gap)

    # T4b: Alignment groups — find elements sharing left/right/center edges
    LEFT_TOL = 4
    for el in visible:
        el_left = el["x"]
        el_cx = el["x"] + el["width"] / 2
        aligned_left = [o["id"] for o in visible if o is not el and abs(o["x"] - el_left) <= LEFT_TOL]
        aligned_center = [o["id"] for o in visible if o is not el and abs((o["x"] + o["width"]/2) - el_cx) <= LEFT_TOL]
        if aligned_left:
            el["aligned_left_with"] = aligned_left[:4]
        if aligned_center:
            el["aligned_center_with"] = aligned_center[:4]

    return elements


# T5: Repetition detection — identify list/grid repeated patterns
def detect_repetition(elements):
    """
    Find groups of elements with same type, similar size, and regular spacing.
    Tag them with repeat_group_id and repeat_index.
    """
    shapes = [e for e in elements if e.get("kind") == "shape" and e.get("type") not in ("background", "toolbar", "panel")]
    used = set()
    group_id = 0

    for i, base in enumerate(shapes):
        if i in used:
            continue
        bw, bh, bt = base["width"], base["height"], base["type"]
        group = [i]
        for j, other in enumerate(shapes):
            if j <= i or j in used:
                continue
            # Same type, similar size (within 20%)
            if other["type"] != bt:
                continue
            if abs(other["width"] - bw) / max(bw, 1) > 0.20:
                continue
            if abs(other["height"] - bh) / max(bh, 1) > 0.20:
                continue
            group.append(j)

        if len(group) >= 3:
            # Check regular spacing: gaps between consecutive items should be similar
            group_els = sorted([shapes[k] for k in group], key=lambda e: (e["y"], e["x"]))
            gaps = []
            for k in range(1, len(group_els)):
                prev, curr = group_els[k-1], group_els[k]
                gap_x = curr["x"] - (prev["x"] + prev["width"])
                gap_y = curr["y"] - (prev["y"] + prev["height"])
                gaps.append((gap_x, gap_y))
            if gaps:
                avg_gx = float(np.mean([g[0] for g in gaps]))
                avg_gy = float(np.mean([g[1] for g in gaps]))
                std_gx = float(np.std([g[0] for g in gaps]))
                std_gy = float(np.std([g[1] for g in gaps]))
                # Regular if std < 30% of avg gap
                is_regular = (std_gx < max(abs(avg_gx) * 0.3, 8) or std_gy < max(abs(avg_gy) * 0.3, 8))
                if is_regular:
                    for k, idx in enumerate(group):
                        shapes[idx]["repeat_group_id"] = group_id
                        shapes[idx]["repeat_index"] = k
                        used.add(idx)
                    group_id += 1

    return elements


# T6: Gradient direction sampling — 5-point sample across gradient regions
def sample_gradient(image, x, y, w, h):
    """
    Sample 5 points across a region to detect gradient direction and colors.
    Returns {"type": "gradient", "direction": "to right"|"to bottom"|"diagonal",
             "stops": [hex1, hex2, ...]} or None if solid.
    """
    img_h, img_w = image.shape[:2]
    x, y = max(0, x), max(0, y)
    w = min(w, img_w - x)
    h = min(h, img_h - y)
    if w < 4 or h < 4:
        return None

    # Sample 5 points: top-left, top-right, center, bottom-left, bottom-right
    points = [
        image[y, x],
        image[y, x + w - 1],
        image[y + h // 2, x + w // 2],
        image[y + h - 1, x],
        image[y + h - 1, x + w - 1],
    ]
    hexes = [hex_from_bgr(p) for p in points]

    # Check if it's actually a gradient (high variance between samples)
    colors_arr = np.array([[int(c[1:3], 16), int(c[3:5], 16), int(c[5:7], 16)] for c in hexes], dtype=np.float32)
    variance = float(np.std(colors_arr))
    if variance < 15:
        return None  # solid color

    # Determine direction: compare left vs right vs top vs bottom
    left_avg = np.mean(colors_arr[[0, 3]], axis=0)
    right_avg = np.mean(colors_arr[[1, 4]], axis=0)
    top_avg = np.mean(colors_arr[[0, 1]], axis=0)
    bottom_avg = np.mean(colors_arr[[3, 4]], axis=0)
    h_diff = float(np.linalg.norm(right_avg - left_avg))
    v_diff = float(np.linalg.norm(bottom_avg - top_avg))

    if h_diff > v_diff * 1.5:
        direction = "to right"
        stops = [hexes[0], hexes[1]]
    elif v_diff > h_diff * 1.5:
        direction = "to bottom"
        stops = [hexes[0], hexes[3]]
    else:
        direction = "135deg"
        stops = [hexes[0], hexes[4]]

    return {"type": "gradient", "direction": direction, "stops": stops, "all_samples": hexes}


# T7: Glassmorphism/blur detection
def detect_glassmorphism(image, x, y, w, h, page_background):
    """
    Detect if a region has a frosted-glass look:
    semi-transparent with content visible through it.
    Heuristic: region has moderate variance AND its median color is close to bg
    but not identical (blended).
    """
    img_h, img_w = image.shape[:2]
    roi = image[max(0,y):min(img_h,y+h), max(0,x):min(img_w,x+w)]
    if roi.size == 0:
        return False
    median_bgr = np.median(roi.reshape(-1, 3), axis=0)
    variance = float(np.std(roi.reshape(-1, 3).astype(np.float32)))
    bg_dist = float(np.linalg.norm(median_bgr - page_background))
    # Glass: moderate variance (not solid, not chaotic), close-ish to bg
    return 8 < variance < 45 and 5 < bg_dist < 60


# T8: Color inventory — extract surface + border colors
def extract_color_inventory(image, page_background):
    """
    Extract named color inventory: background, surface, border, text, accent.
    Returns dict of named hex colors.
    """
    h, w = image.shape[:2]
    bg_hex = hex_from_bgr(page_background)
    bg_luma = float(np.mean(page_background))
    is_dark = bg_luma < 128

    # Surface: sample a central region slightly different from bg
    center = image[h//4:3*h//4, w//4:3*w//4]
    center_flat = center.reshape(-1, 3).astype(np.float32)
    bg_arr = page_background.astype(np.float32)
    dists = np.linalg.norm(center_flat - bg_arr, axis=1)
    # Surface pixels: slightly different from bg (5-40 distance)
    surface_mask = (dists > 5) & (dists < 40)
    if np.any(surface_mask):
        surface_bgr = np.median(center_flat[surface_mask], axis=0)
        surface_hex = hex_from_bgr(surface_bgr)
    else:
        surface_hex = lighten_hex(bg_hex, 12) if is_dark else darken_hex(bg_hex, 4)

    # Border: look for thin-line colors (pixels with moderate diff from bg, low saturation)
    gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
    edges = cv2.Canny(gray, 30, 100)
    edge_pixels = image[edges > 0]
    if len(edge_pixels) > 10:
        border_bgr = np.median(edge_pixels, axis=0)
        border_hex = hex_from_bgr(border_bgr)
    else:
        border_hex = "#d0d7de" if not is_dark else "#30363d"

    # Accent: most saturated non-neutral color in image
    hsv = cv2.cvtColor(image, cv2.COLOR_BGR2HSV)
    sat = hsv[:, :, 1].astype(np.float32)
    val = hsv[:, :, 2].astype(np.float32)
    # High saturation, medium-high value pixels
    accent_mask = (sat > 80) & (val > 60)
    if np.any(accent_mask):
        accent_pixels = image[accent_mask]
        accent_bgr = np.median(accent_pixels, axis=0)
        accent_hex = hex_from_bgr(accent_bgr)
    else:
        accent_hex = "#0969da" if not is_dark else "#ff4a36"

    # Text: most common dark-on-light or light-on-dark color
    if is_dark:
        text_mask = gray > 200
    else:
        text_mask = gray < 60
    if np.any(text_mask):
        text_bgr = np.median(image[text_mask], axis=0)
        text_hex = hex_from_bgr(text_bgr)
    else:
        text_hex = "#f0f0f0" if is_dark else "#1f2328"

    return {
        "background": bg_hex,
        "surface": surface_hex,
        "border": border_hex,
        "accent": accent_hex,
        "text": text_hex,
        # Muted: for dark themes, darken text (make it dimmer); for light themes, lighten text
        "muted": darken_hex(text_hex, 40) if is_dark else lighten_hex(text_hex, 40),
        "theme": "dark" if is_dark else "light",
    }


def lighten_hex(hex_color, amt):
    try:
        n = int(hex_color.lstrip('#'), 16)
        r = min(255, (n >> 16) + amt)
        g = min(255, ((n >> 8) & 0xff) + amt)
        b = min(255, (n & 0xff) + amt)
        return "#{:02x}{:02x}{:02x}".format(r, g, b)
    except Exception:
        return hex_color


def darken_hex(hex_color, amt):
    return lighten_hex(hex_color, -amt)




def snap_elements_to_rows(elements, row_bands):
    """
    Assign each element to the row band whose vertical range best contains
    its center-y. Then snap all elements in the same band to the same y
    (tallest element anchors). Only snaps if drift <= 20% of band height
    to avoid merging elements from adjacent rows.
    """
    if not row_bands:
        return elements

    from collections import defaultdict

    def best_band(el):
        cy = el["y"] + el["height"] / 2
        # Only assign to a band if center-y is strictly inside it
        for i, (top, bot) in enumerate(row_bands):
            if top <= cy <= bot:
                return i
        # Fallback: nearest band center, but only if very close
        best_i, best_d = None, float("inf")
        for i, (top, bot) in enumerate(row_bands):
            d = abs(cy - (top + bot) / 2)
            band_h = max(1, bot - top)
            # Only snap to nearest band if within 15% of band height
            if d < best_d and d < band_h * 0.15:
                best_d, best_i = d, i
        return best_i  # None means don't snap this element

    groups = defaultdict(list)
    for el in elements:
        if el.get("kind") == "background":
            continue
        band_i = best_band(el)
        if band_i is not None:
            groups[band_i].append(el)

    for band_i, group in groups.items():
        if len(group) < 2:
            continue
        band_top, band_bot = row_bands[band_i]
        band_h = max(1, band_bot - band_top)
        tallest = max(group, key=lambda e: e["height"])
        anchor_y = tallest["y"]
        for el in group:
            if el is tallest:
                continue
            # Only snap if drift is very small (≤20% of band height)
            # This prevents elements from different rows being merged
            if abs(el["y"] - anchor_y) <= band_h * 0.20:
                el["y"] = anchor_y

    return elements


def stabilize_element_coordinates(elements, image_w, image_h):
    stabilized = [clamp_element_bounds(dict(element), image_w, image_h) for element in elements]
    stabilized = dedupe_text_elements(stabilized)
    stabilize_parented_text_positions(stabilized)
    align_text_row_baselines(stabilized)
    stabilized = [clamp_element_bounds(element, image_w, image_h) for element in stabilized]
    return sorted(stabilized, key=lambda item: (item.get("z_index", 0), item["y"], item["x"]))


UPSCALE_FACTOR = 2  # Upscale input for better OCR and contour precision, then divide coords back

def upscale_image(image):
    h, w = image.shape[:2]
    return cv2.resize(image, (w * UPSCALE_FACTOR, h * UPSCALE_FACTOR), interpolation=cv2.INTER_CUBIC)

def downscale_element(element, factor):
    """Divide all pixel coordinates and sizes back to original image space."""
    for key in ("x", "y", "width", "height"):
        element[key] = max(1 if key in ("width", "height") else 0, round(element[key] / factor))
    if "font_size" in element and element["font_size"] > 0:
        element["font_size"] = max(8, round(element["font_size"] / factor))
    element["area"] = element["width"] * element["height"]
    return element

def tag_dropdowns_and_images(elements, image):
    """
    1. Tag text/button elements as 'select' if their text contains a chevron
       or if a small downward-arrow strip exists to their right.
    2. Tag avatar/shape elements as 'image' if they contain no text and
       their fill is visually complex (not a solid color) — i.e. a real image.
    """
    img_h, img_w = image.shape[:2]

    for el in elements:
        # --- Dropdown detection ---
        if el.get("kind") in ("text", "shape") and el.get("type") in ("text", "button", "chip", "shape"):
            text = el.get("text", "") or ""
            # Chevron in OCR text
            if DROPDOWN_CHARS.search(text):
                el["type"] = "select"
                el["kind"] = "shape"
                el["text"] = DROPDOWN_CHARS.sub("", text).strip()
                continue
            # Check for a small chevron strip to the right of this element
            x, y, w, h = el["x"], el["y"], el["width"], el["height"]
            word_count = len(text.split())
            if h < 60 and w < 300 and text and word_count <= 2:  # only short nav-sized items
                if has_dropdown_arrow(None, x, y, w, h, image):
                    el["type"] = "select"
                    el["kind"] = "shape"
                    continue
            # Pill-shaped small button with rounded corners = likely a dropdown selector
            border_radius = el.get("border_radius", 0)
            aspect = w / max(h, 1)
            is_action_word = bool(re.match(r'^(search|submit|go|ok|send|find|apply)$', text.strip(), re.I))
            if (border_radius >= h * 0.4 and 1.5 <= aspect <= 6.0 and
                    h <= 32 and word_count <= 2 and text and not is_action_word):
                el["type"] = "select"
                el["kind"] = "shape"

        # --- Image placeholder detection ---
        # Only tag avatar/icon shapes with no text and visually complex fill
        if el.get("kind") == "shape" and el.get("type") in ("avatar", "icon"):
            if el.get("text"):
                continue
            x, y, w, h = el["x"], el["y"], el["width"], el["height"]
            if w < 16 or h < 16:
                continue
            roi = image[max(0,y):min(img_h,y+h), max(0,x):min(img_w,x+w)]
            if roi.size == 0:
                continue
            variance = float(np.std(roi.reshape(-1, 3).astype(np.float32)))
            if variance > 30:
                el["type"] = "image"

    return elements


def detect_ui_elements(image_path, device_pixel_ratio=1.0):
    image = cv2.imread(image_path)
    if image is None:
        return None

    # Preprocessing: normalize retina / device pixel ratio so 1px in output ~= 1 logical px.
    try:
        dpr = float(device_pixel_ratio or 1.0)
    except Exception:
        dpr = 1.0
    if dpr > 0 and dpr != 1.0:
        h0, w0 = image.shape[:2]
        new_w = max(1, int(round(w0 / dpr)))
        new_h = max(1, int(round(h0 / dpr)))
        image = cv2.resize(image, (new_w, new_h), interpolation=cv2.INTER_AREA)

    orig_h, orig_w = image.shape[:2]
    orig_image = image.copy()
    image = upscale_image(image)  # 2x upscale — improves OCR accuracy and contour precision

    height, width = image.shape[:2]
    page_background = estimate_page_background(image)

    # T8: Extract full color inventory before detection
    color_inventory = extract_color_inventory(image, page_background)

    # Macro layout detection: identify overall structure before micro-detection
    macro_layout = detect_macro_layout(image, page_background)

    text_regions_base = detect_text_regions(image)
    shape_regions = detect_shape_regions(image, text_regions_base, page_background)
    text_regions = explode_long_text_lines(text_regions_base, shape_regions)
    text_regions = merge_adjacent_text_regions(text_regions)
    synthetic_inputs = create_synthetic_input_containers(image, text_regions, shape_regions)
    shape_regions.extend(synthetic_inputs)
    shape_regions.extend(create_synthetic_text_containers(shape_regions + text_regions))

    # T2: Detect dividers
    dividers = detect_dividers(image, page_background)
    shape_regions.extend(dividers)

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
    structural_bands = create_structural_bands(image, text_regions, shape_regions, page_background)
    if structural_bands:
        elements = structural_bands + elements
    elements = prune_detected_elements(elements)
    elements = stabilize_element_coordinates(elements, width, height)

    # T3: Detect cards (panels with multi-type children)
    elements = detect_cards(elements)

    # T5: Detect repetition (list/grid patterns)
    elements = detect_repetition(elements)

    # Horizontal + T1 vertical projection
    row_bands = detect_row_boundaries(image)
    col_bands = detect_column_boundaries(image)
    elements = snap_elements_to_rows(elements, row_bands)

    # Downscale all coordinates back to original image space
    elements = [downscale_element(element, UPSCALE_FACTOR) for element in elements]
    elements = [normalize_component(element, orig_w, orig_h) for element in elements]

    # Tag dropdown elements and image placeholders using original (DPR-normalized) image
    elements = tag_dropdowns_and_images(elements, orig_image)

    # T6: Sample gradients for panels/backgrounds
    # T7: Flag glassmorphism regions
    for el in elements:
        if el.get("kind") == "shape" and el.get("type") in ("panel", "toolbar", "card", "background"):
            x, y, w, h = el["x"], el["y"], el["width"], el["height"]
            grad = sample_gradient(orig_image, x, y, w, h)
            if grad:
                el["gradient"] = grad
            elif detect_glassmorphism(orig_image, x, y, w, h, page_background):
                el["glassmorphism"] = True

    # T4: Measure spacing and alignment between elements
    elements = measure_spacing(elements)

    elements = fix_overlapping_text_zindex(elements)

    # Build structured zone analysis for high-quality HTML generation
    zones = build_zone_analysis(elements, orig_w, orig_h, hex_from_bgr(page_background), color_inventory, col_bands, macro_layout)
    scene_graph = build_scene_graph(elements, orig_w, orig_h, zones)

    return {
        "image": {
            "width": orig_w,
            "height": orig_h,
            "background_color": background["background_color"],
        },
        "components": elements[:220],
        "zones": zones,
        "scene_graph": scene_graph,
        "macro_layout": macro_layout,
    }


def build_zone_analysis(elements, img_w, img_h, page_bg, color_inventory=None, col_bands=None, macro_layout=None):
    # Filter out low-confidence OCR text. Confidence < 45 is likely garbage.
    # For large headings (font_size >= 32), require confidence >= 50 since OCR errors on large text
    # produce plausible-looking but wrong fragments (e.g. "ees Eee" from partial letter detection).
    def _text_ok(e):
        conf = e.get("confidence", 100)
        fs = e.get("font_size", 0)
        if fs >= 32:
            return conf >= 50
        return conf >= 45
    texts = [e for e in elements if e.get("kind") == "text" and e.get("text") and _text_ok(e)]
    shapes = [e for e in elements if e.get("kind") == "shape"]

    # T8: Use color inventory if available, else derive from page_bg
    if color_inventory:
        palette = {
            "background": color_inventory.get("background", page_bg),
            "surface": color_inventory.get("surface", page_bg),
            "border": color_inventory.get("border", "#d0d7de"),
            "theme": color_inventory.get("theme", "light"),
            "accent": color_inventory.get("accent", "#0969da"),
            "text": color_inventory.get("text", "#1f2328"),
            "muted": color_inventory.get("muted", "#57606a"),
        }
    else:
        bg_rgb = rgb_from_hex(page_bg) or (255, 255, 255)
        luma = bg_rgb[0] * 0.299 + bg_rgb[1] * 0.587 + bg_rgb[2] * 0.114
        theme = "dark" if luma < 128 else "light"
        accent = None
        for e in sorted(texts, key=lambda x: x.get("font_size", 0), reverse=True):
            c = e.get("text_color", "")
            if c and c != "transparent" and not is_neutral_hex(c, 40):
                accent = c
                break
        if not accent:
            for s in shapes:
                c = s.get("background_color", "")
                if c and c not in ("transparent", "none") and not is_neutral_hex(c, 40):
                    accent = c
                    break
        palette = {
            "background": page_bg,
            "surface": page_bg,
            "border": "#d0d7de" if theme == "light" else "#30363d",
            "theme": theme,
            "accent": accent or ("#ff4a36" if theme == "dark" else "#0969da"),
            "text": "#f0f0f0" if theme == "dark" else "#1f2328",
            "muted": "#aaaacc" if theme == "dark" else "#57606a",
        }

    # T1: Store column layout info from vertical projection + macro layout
    col_layout = "single"
    if col_bands and len(col_bands) >= 2:
        # Two or more distinct content columns = multi-column layout
        col_layout = "two-column" if len(col_bands) == 2 else "multi-column"

    # Use macro layout to override col_layout if sidebar detected
    macro_layout_type = (macro_layout or {}).get("layout_type", "generic")
    if macro_layout_type == "sidebar-main":
        col_layout = "two-column"

    # Dynamically find navbar bottom from full-width toolbars near top
    navbar_bottom_pct = 0.10
    for s in sorted(shapes, key=lambda x: x["y"]):
        if s.get("type") in ("toolbar", "panel") and s.get("width", 0) > img_w * 0.7:
            bottom_pct = (s["y"] + s["height"]) / img_h
            if bottom_pct < 0.40:
                navbar_bottom_pct = max(navbar_bottom_pct, bottom_pct)

    # Find footer top from full-width panels near bottom
    footer_top_pct = 0.88
    for s in sorted(shapes, key=lambda x: x["y"], reverse=True):
        if s.get("type") in ("toolbar", "panel") and s.get("width", 0) > img_w * 0.7:
            top_pct = s["y"] / img_h
            if top_pct > 0.65:
                footer_top_pct = min(footer_top_pct, top_pct)

    ZONES = [
        ("navbar",  0.0,               navbar_bottom_pct),
        ("content", navbar_bottom_pct, footer_top_pct),
        ("footer",  footer_top_pct,    1.0),
    ]

    right_texts = [e for e in texts if e["x"] / img_w > 0.65
                   and navbar_bottom_pct < e["y"] / img_h < footer_top_pct]
    is_two_col = len(right_texts) >= 3 or col_layout == "two-column"

    zone_results = []
    for zone_name, y_start, y_end in ZONES:
        y0, y1 = img_h * y_start, img_h * y_end
        zone_texts = [e for e in texts if y0 <= e["y"] < y1]
        zone_shapes = [e for e in shapes if y0 <= e["y"] < y1]
        if not zone_texts and not zone_shapes:
            continue

        zone_bg = page_bg
        wide = next((s for s in sorted(zone_shapes, key=lambda x: x.get("width", 0), reverse=True)
                     if s.get("width", 0) > img_w * 0.5 and s.get("type") in ("toolbar", "panel")), None)
        if wide:
            zone_bg = wide.get("background_color", page_bg)

        zone_elements = []
        for e in sorted(zone_texts, key=lambda x: (x["y"], x["x"])):
            fs = e.get("font_size", 14)
            fw = e.get("font_weight", 400)
            x_pct = e["x"] / img_w
            y_pct = e["y"] / img_h

            if zone_name == "navbar":
                role = "logo" if x_pct < 0.12 else ("nav-actions" if x_pct > 0.78 else "nav-links")
            elif zone_name == "content":
                if fs >= 48 or (fs >= 28 and fw >= 700):
                    role = "heading"
                elif fs >= 20 and fw >= 600:
                    role = "subheading"
                elif is_two_col and x_pct > 0.65:
                    role = "sidebar-text"
                else:
                    role = "content-text"
            else:
                role = "footer-text"

            # Check if this text element is actually a select/dropdown
            if e.get("type") == "select":
                role = "select"

            zone_elements.append({
                "role": role, "text": e.get("text", ""),
                "color": e.get("text_color", palette["text"]),
                "font_size": fs, "font_weight": fw,
                "x_pct": round(x_pct, 3), "y_pct": round(y_pct, 3),
                "w_pct": round(e["width"] / img_w, 4),
                "h_pct": round(e["height"] / img_h, 4),
            })

        for b in zone_shapes:
            if b.get("type") == "select":
                zone_elements.append({
                    "role": "select", "text": b.get("text", ""),
                    "bg": b.get("background_color", "#fff"),
                    "border": b.get("border_color", "#d0d7de"),
                    "border_radius": b.get("border_radius", 6),
                    "x_pct": round(b["x"] / img_w, 3), "y_pct": round(b["y"] / img_h, 3),
                    "h_pct": round(b["height"] / img_h, 4),
                })
                continue
            if b.get("type") == "image":
                zone_elements.append({
                    "role": "image",
                    "x_pct": round(b["x"] / img_w, 3), "y_pct": round(b["y"] / img_h, 3),
                    "width_pct": round(b["width"] / img_w, 3), "h_pct": round(b["height"] / img_h, 4),
                })
                continue
            if b.get("type") not in ("button", "chip") or not b.get("text"):
                continue
            zone_elements.append({
                "role": "button", "text": b.get("text", ""),
                "bg": b.get("background_color", "#333"),
                "border_radius": b.get("border_radius", 6),
                "x_pct": round(b["x"] / img_w, 3), "y_pct": round(b["y"] / img_h, 3),
                "h_pct": round(b["height"] / img_h, 4),
            })

        # Include input elements in ALL zones (not just navbar)
        for inp in zone_shapes:
            if inp.get("type") != "input":
                continue
            # Get placeholder text from linked text children
            inp_text = inp.get("text", "")
            if not inp_text:
                # Try to find a text element inside this input
                for t in texts:
                    if (t["x"] >= inp["x"] - 4 and t["y"] >= inp["y"] - 4 and
                            t["x"] + t["width"] <= inp["x"] + inp["width"] + 4 and
                            t["y"] + t["height"] <= inp["y"] + inp["height"] + 4):
                        inp_text = t.get("text", "")
                        break
            zone_elements.append({
                "role": "input", "text": inp_text,
                "bg": inp.get("background_color", "#fff"),
                "border": inp.get("border_color", "#d0d7de"),
                "border_radius": inp.get("border_radius", 6),
                "width_pct": round(inp["width"] / img_w, 3),
                "x_pct": round(inp["x"] / img_w, 3), "y_pct": round(inp["y"] / img_h, 3),
                "h_pct": round(inp["height"] / img_h, 4),
            })

        zone_results.append({
            "zone": zone_name,
            "bg": zone_bg,
            "bounds": {
                "y_start_pct": round(float(y_start), 4),
                "y_end_pct": round(float(y_end), 4),
                "y_start_px": int(round(y0)),
                "y_end_px": int(round(y1)),
            },
            "elements": sorted(zone_elements, key=lambda e: (e.get("y_pct", 0), e.get("x_pct", 0))),
        })

    zone_bounds = [
        {
            "zone": zone_name,
            "y_start_pct": round(float(y_start), 4),
            "y_end_pct": round(float(y_end), 4),
            "y_start_px": int(round(img_h * y_start)),
            "y_end_px": int(round(img_h * y_end)),
        }
        for zone_name, y_start, y_end in ZONES
    ]

    return {
        "palette": palette,
        "zones": zone_results,
        "zone_bounds": zone_bounds,
        "layout": "two-column" if is_two_col else "single-column",
        "col_bands": col_bands or [],
        "macro_layout": macro_layout or {},
    }


def build_scene_graph(elements, img_w, img_h, zones_analysis=None):
    """
    Convert the flat Stage 1 detections into a structured scene graph:
    - nodes: all elements with geometry + attributes
    - zones: navbar/content/footer bounds with child ids
    - edges: adjacency/spacing (right-of, below)
    - alignment_groups: shared left/center alignments (from T4b)
    - repetition_groups: repeated patterns (from T5)
    """
    zones_analysis = zones_analysis or {}
    zone_bounds = zones_analysis.get("zone_bounds") or []

    nodes = []
    by_id = {}
    for el in elements:
        node = {
            "id": el.get("id"),
            "kind": el.get("kind"),
            "type": el.get("type"),
            "text": el.get("text", "") if el.get("kind") == "text" else el.get("text", ""),
            "x": int(el.get("x", 0)),
            "y": int(el.get("y", 0)),
            "width": int(el.get("width", 0)),
            "height": int(el.get("height", 0)),
            "x_pct": float(el.get("x_pct", 0.0)),
            "y_pct": float(el.get("y_pct", 0.0)),
            "w_pct": float(el.get("w_pct", 0.0)),
            "h_pct": float(el.get("h_pct", 0.0)),
            "z_index": int(el.get("z_index", 0) or 0),
            "parent_id": el.get("parent_id"),
            "row_id": el.get("row_id"),
            "repeat_group_id": el.get("repeat_group_id"),
            "repeat_index": el.get("repeat_index"),
            "spacing_right": el.get("spacing_right"),
            "spacing_bottom": el.get("spacing_bottom"),
            "aligned_left_with": el.get("aligned_left_with", []),
            "aligned_center_with": el.get("aligned_center_with", []),
            "background_color": el.get("background_color"),
            "border_color": el.get("border_color"),
            "border_width": el.get("border_width"),
            "border_radius": el.get("border_radius"),
            "text_color": el.get("text_color"),
            "font_size": el.get("font_size"),
            "font_weight": el.get("font_weight"),
            "text_align": el.get("text_align"),
            "confidence": el.get("confidence"),
            "quality": el.get("quality"),
            "gradient": el.get("gradient"),
            "glassmorphism": el.get("glassmorphism"),
        }
        nodes.append(node)
        if node["id"] is not None:
            by_id[node["id"]] = node

    visible_ids = [n["id"] for n in nodes if n.get("kind") not in ("background",) and n.get("id") is not None]
    edges = []

    # Build explicit right/below edges (reusing the same heuristic as measure_spacing, but recording links).
    for el_id in visible_ids:
        el = by_id.get(el_id)
        if not el:
            continue
        ex, ey, ew, eh = el["x"], el["y"], max(1, el["width"]), max(1, el["height"])
        el_right = ex + ew
        el_bottom = ey + eh
        el_cy = ey + eh / 2.0
        el_cx = ex + ew / 2.0

        nearest_right = None
        nearest_right_gap = None
        nearest_bottom = None
        nearest_bottom_gap = None

        for other_id in visible_ids:
            if other_id == el_id:
                continue
            other = by_id.get(other_id)
            if not other:
                continue
            ox, oy, ow, oh = other["x"], other["y"], max(1, other["width"]), max(1, other["height"])
            oc_y = oy + oh / 2.0
            oc_x = ox + ow / 2.0

            if ox > el_right and abs(oc_y - el_cy) < max(eh, oh) * 0.5:
                gap = ox - el_right
                if nearest_right_gap is None or gap < nearest_right_gap:
                    nearest_right_gap = gap
                    nearest_right = other_id

            if oy > el_bottom and abs(oc_x - el_cx) < max(ew, ow) * 0.5:
                gap = oy - el_bottom
                if nearest_bottom_gap is None or gap < nearest_bottom_gap:
                    nearest_bottom_gap = gap
                    nearest_bottom = other_id

        if nearest_right is not None:
            edges.append({
                "from": el_id,
                "to": nearest_right,
                "relation": "right_of",
                "gap": int(round(nearest_right_gap)),
            })
        if nearest_bottom is not None:
            edges.append({
                "from": el_id,
                "to": nearest_bottom,
                "relation": "above",
                "gap": int(round(nearest_bottom_gap)),
            })

    # Zones: attach node ids based on zone bounds.
    zones = []
    if zone_bounds:
        for zb in zone_bounds:
            y0 = int(zb.get("y_start_px", 0))
            y1 = int(zb.get("y_end_px", img_h))
            child_ids = [
                n["id"] for n in nodes
                if n.get("id") is not None and n.get("kind") != "background" and y0 <= n.get("y", 0) < y1
            ]
            zones.append({
                "zone": zb.get("zone"),
                "bounds": zb,
                "children": child_ids,
            })

    # Alignment groups (dedupe by signature).
    alignment_groups = []
    seen_groups = set()
    for n in nodes:
        nid = n.get("id")
        if nid is None:
            continue
        for key, group_type in (("aligned_left_with", "left"), ("aligned_center_with", "center_x")):
            peers = n.get(key) or []
            if not peers:
                continue
            member_ids = sorted(set([nid] + [p for p in peers if p is not None]))
            signature = (group_type, tuple(member_ids))
            if signature in seen_groups:
                continue
            seen_groups.add(signature)
            alignment_groups.append({
                "type": group_type,
                "members": member_ids,
            })

    # Repetition groups
    rep_groups = {}
    for n in nodes:
        gid = n.get("repeat_group_id")
        if gid is None:
            continue
        rep_groups.setdefault(gid, []).append(n.get("id"))
    repetition_groups = [{"repeat_group_id": gid, "members": sorted([i for i in ids if i is not None])} for gid, ids in rep_groups.items()]

    return {
        "meta": {
            "image": {"width": int(img_w), "height": int(img_h)},
            "col_bands": zones_analysis.get("col_bands") or [],
            "layout": zones_analysis.get("layout"),
            "macro_layout": zones_analysis.get("macro_layout") or {},
        },
        "nodes": nodes,
        "zones": zones,
        "edges": edges,
        "alignment_groups": alignment_groups,
        "repetition_groups": repetition_groups,
    }


def fix_overlapping_text_zindex(elements):
    """FORCE all text to z-index 100 to ensure it's always above shapes"""
    for el in elements:
        if el.get("kind") == "text":
            el["z_index"] = 100
    return elements


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
        use_regions = data.get("use_regions", False)
        device_pixel_ratio = data.get("device_pixel_ratio", 1.0)
        
        if use_regions:
            detection = detect_with_regions(image_path, device_pixel_ratio=device_pixel_ratio)
        else:
            detection = detect_ui_elements(image_path, device_pixel_ratio=device_pixel_ratio)
            
        if detection is None:
            return jsonify({"error": "Could not read image"}), 400
        return jsonify(detection)
    except Exception as error:
        import traceback
        traceback.print_exc()
        return jsonify({"error": str(error)}), 500


def detect_with_regions(image_path, device_pixel_ratio=1.0):
    """Detect UI elements using 2x2 grid with overlap for better accuracy"""
    image = cv2.imread(image_path)
    if image is None:
        return None

    # DPR normalization for region workflow
    try:
        dpr = float(device_pixel_ratio or 1.0)
    except Exception:
        dpr = 1.0
    if dpr > 0 and dpr != 1.0:
        h0, w0 = image.shape[:2]
        new_w = max(1, int(round(w0 / dpr)))
        new_h = max(1, int(round(h0 / dpr)))
        image = cv2.resize(image, (new_w, new_h), interpolation=cv2.INTER_AREA)
    
    h, w = image.shape[:2]
    overlap = 0.15  # 15% overlap
    
    # Calculate region dimensions
    rw = int(w / 2 * (1 + overlap))
    rh = int(h / 2 * (1 + overlap))
    
    regions = [
        (0, 0, min(rw, w), min(rh, h)),
        (int(w/2 * (1-overlap)), 0, min(rw, w - int(w/2 * (1-overlap))), min(rh, h)),
        (0, int(h/2 * (1-overlap)), min(rw, w), min(rh, h - int(h/2 * (1-overlap)))),
        (int(w/2 * (1-overlap)), int(h/2 * (1-overlap)), min(rw, w - int(w/2 * (1-overlap))), min(rh, h - int(h/2 * (1-overlap))))
    ]
    
    all_elements = []
    
    for rx, ry, rw, rh in regions:
        roi = image[ry:ry+rh, rx:rx+rw]
        result = detect_ui_elements_from_image(roi)
        
        if result and result.get("components"):
            for el in result["components"]:
                # Skip background elements from regions
                if el.get("kind") == "background":
                    continue
                
                # Adjust coordinates to global space
                el["x"] = int(el["x"] + rx)
                el["y"] = int(el["y"] + ry)
                
                # Clamp to image boundaries
                el["x"] = max(0, min(el["x"], w - el["width"]))
                el["y"] = max(0, min(el["y"], h - el["height"]))
                
                # Recalculate percentages for full image
                el["x_pct"] = round(el["x"] / w, 6)
                el["y_pct"] = round(el["y"] / h, 6)
                el["w_pct"] = round(el["width"] / w, 6)
                el["h_pct"] = round(el["height"] / h, 6)
                
                all_elements.append(el)
    
    # Deduplicate using IoU (Intersection over Union)
    def iou(e1, e2):
        x1 = max(e1["x"], e2["x"])
        y1 = max(e1["y"], e2["y"])
        x2 = min(e1["x"] + e1["width"], e2["x"] + e2["width"])
        y2 = min(e1["y"] + e1["height"], e2["y"] + e2["height"])
        
        if x2 <= x1 or y2 <= y1:
            return 0.0
        
        intersection = (x2 - x1) * (y2 - y1)
        area1 = e1["width"] * e1["height"]
        area2 = e2["width"] * e2["height"]
        union = area1 + area2 - intersection
        
        return intersection / union if union > 0 else 0.0
    
    # Remove duplicates with >60% overlap (stricter)
    deduplicated = []
    for el in all_elements:
        is_duplicate = False
        for existing in deduplicated:
            if el["kind"] == existing["kind"] and iou(el, existing) > 0.6:
                # Keep the one with more text or larger size
                if len(el.get("text", "")) > len(existing.get("text", "")):
                    deduplicated.remove(existing)
                    break
                else:
                    is_duplicate = True
                    break
        
        if not is_duplicate:
            deduplicated.append(el)
    
    # Build a unified detection pass: add background, re-assign relationships/rows, spacing, and zones.
    page_background = estimate_page_background(image)
    page_bg_hex = hex_from_bgr(page_background)

    # Sort by z-index to maintain proper layering
    deduplicated.sort(key=lambda e: e.get("z_index", 1))

    background = {
        "kind": "background",
        "type": "background",
        "text": "",
        "x": 0,
        "y": 0,
        "width": w,
        "height": h,
        "area": int(w * h),
        "background_color": page_bg_hex,
        "border_color": "transparent",
        "border_width": 0,
        "border_radius": 0,
        "text_color": "transparent",
        "font_size": 0,
        "font_weight": 0,
        "text_align": "left",
        "z_index": 0,
    }

    merged = [background] + deduplicated
    merged = assign_relationships(filter_regions(merged))

    # Re-run lightweight structure helpers so Stage 2/3 have similar signals as full-image detection.
    merged = prune_detected_elements(merged)
    merged = stabilize_element_coordinates(merged, w, h)
    merged = detect_cards(merged)
    merged = detect_repetition(merged)
    row_bands = detect_row_boundaries(image)
    col_bands = detect_column_boundaries(image)
    merged = snap_elements_to_rows(merged, row_bands)
    merged = [normalize_component(element, w, h) for element in merged]
    merged = measure_spacing(merged)
    merged = fix_overlapping_text_zindex(merged)

    color_inventory = extract_color_inventory(image, page_background)
    macro_layout = detect_macro_layout(image, page_background)
    zones = build_zone_analysis(merged, w, h, page_bg_hex, color_inventory, col_bands, macro_layout)
    scene_graph = build_scene_graph(merged, w, h, zones)

    return {
        "image": {"width": w, "height": h, "background_color": page_bg_hex},
        "components": merged[:220],
        "zones": zones,
        "scene_graph": scene_graph,
        "macro_layout": macro_layout,
    }


def detect_ui_elements_from_image(image):
    """Detect from image array (for region processing)"""
    if image is None or image.size == 0:
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

    background = {
        "kind": "background", "type": "background", "text": "", "x": 0, "y": 0,
        "width": width, "height": height, "area": int(width * height),
        "background_color": hex_from_bgr(page_background), "border_color": "transparent",
        "border_width": 0, "border_radius": 0, "text_color": "transparent",
        "font_size": 0, "font_weight": 0, "text_align": "left", "z_index": 0,
    }

    elements = [background] + shape_regions + text_regions
    elements = assign_relationships(filter_regions(elements))
    structural_bands = create_structural_bands(image, text_regions, shape_regions, page_background)
    if structural_bands:
        elements = structural_bands + elements
    elements = prune_detected_elements(elements)
    elements = stabilize_element_coordinates(elements, width, height)
    row_bands = detect_row_boundaries(image)
    elements = snap_elements_to_rows(elements, row_bands)
    elements = [normalize_component(element, width, height) for element in elements]

    return {"image": {"width": width, "height": height, "background_color": background["background_color"]}, "components": elements}


if __name__ == "__main__":
    if len(sys.argv) >= 3 and sys.argv[1] == "--once":
        image_path = sys.argv[2]
        use_regions = "--use-regions" in sys.argv
        dpr = 1.0
        if "--dpr" in sys.argv:
            try:
                idx = sys.argv.index("--dpr")
                dpr = float(sys.argv[idx + 1])
            except Exception:
                dpr = 1.0

        detection = detect_with_regions(image_path, device_pixel_ratio=dpr) if use_regions else detect_ui_elements(image_path, device_pixel_ratio=dpr)
        if detection is None:
            print(json.dumps({"error": "Could not read image"}))
            sys.exit(1)
        print(json.dumps(detection))
        sys.exit(0)
    app.run(host="0.0.0.0", port=5001, debug=False)
