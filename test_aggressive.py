"""
Aggressive test suite: validates Python detection accuracy, coordinate precision,
overlap detection, button visibility, and HTML output fidelity for all test images.
"""
import subprocess, json, sys, os, re, math
from pathlib import Path

ROOT = Path(__file__).parent
IMAGES = {
    "test.png":  ROOT / "test.png",
    "test2.png": ROOT / "test2.png",
    "test3.png": ROOT / "test3.png",
}

# ── Ground truth ──────────────────────────────────────────────────────────────
GROUND_TRUTH = {
    "test.png": {
        "image": {"width": 1920, "height": 919},
        "bg_color": "#e6e9eb",
        "required_texts": [
            "Code", "Issues", "Actions", "Projects", "Settings",
            "FIRETRUCK", "main", "Add file", "Readme",
            "Releases", "Packages",
        ],
        "required_shape_types": ["toolbar", "button", "input", "panel"],
        "buttons": [
            # (approx x, approx y, approx w, approx h, label_hint)
            {"x": 1172, "y": 233, "w": 140, "h": 47, "bg": "#1f883d", "label": "Code"},
            {"x": 188,  "y": 234, "w": 136, "h": 46, "bg": "#f6f8fa", "label": "main"},
        ],
        "inputs": [
            {"x": 1271, "y": 22,  "w": 220, "h": 33},
            {"x": 203,  "y": 314, "w": 313, "h": 34},
        ],
        "no_overlap_types": [("button", "text"), ("input", "text")],
    },
    "test2.png": {
        "image": {"width": 1920, "height": 1080},
        "bg_color": "#1a1a2e",
        "required_texts": [
            "EMERGENCY", "RESPONSE", "SIMULATOR",
            "Hyderabad", "Multi-City Support",
            "Advanced Pathfinding", "Real-time Simulation",
            "Performance Analytics",
        ],
        "required_shape_types": ["button"],
        "buttons": [
            # START SIMULATION - blue button
            {"x": 675, "y": 694, "w": 380, "h": 78, "bg": "#1976d2", "label": "START SIMULATION"},
            # EXIT - red button
            {"x": 1081, "y": 698, "w": 164, "h": 69, "bg": "#d32f2f", "label": "EXIT"},
        ],
        "inputs": [],
        "no_overlap_types": [("button", "text")],
        # The title words EMERGENCY/RESPONSE/SIMULATOR must NOT be classified as buttons
        "must_not_be_button": [
            {"x": 406, "y": 296, "w": 420, "h": 45},  # EMERGENCY text
            {"x": 851, "y": 296, "w": 358, "h": 45},  # RESPONSE text
            {"x": 1234,"y": 296, "w": 391, "h": 45},  # SIMULATOR text
        ],
    },
    "test3.png": {
        "image": {"width": 1920, "height": 898},
        "bg_color": "#433e56",
        "required_texts": [
            "Finally", "Sign up",
        ],
        "required_shape_types": ["button", "toolbar"],
        "buttons": [
            {"x": 1729, "y": 21, "w": 113, "h": 56, "bg": "#f03621", "label": "Download"},
        ],
        "inputs": [],
        "no_overlap_types": [("button", "text")],
    },
}

PASS = "\033[92m✓\033[0m"
FAIL = "\033[91m✗\033[0m"
WARN = "\033[93m⚠\033[0m"

results = {"passed": 0, "failed": 0, "warnings": 0}

def ok(msg):
    print(f"  {PASS} {msg}")
    results["passed"] += 1

def fail(msg):
    print(f"  {FAIL} {msg}")
    results["failed"] += 1

def warn(msg):
    print(f"  {WARN} {msg}")
    results["warnings"] += 1

def run_detection(image_path):
    proc = subprocess.run(
        ["python3", str(ROOT / "detection_service.py"), "--once", str(image_path)],
        capture_output=True, text=True, timeout=60
    )
    if proc.returncode != 0:
        raise RuntimeError(f"Detection failed: {proc.stderr[:300]}")
    return json.loads(proc.stdout)

def rect_overlap_pct(a, b):
    """Return what % of the smaller rect is overlapped by the other."""
    ox = max(0, min(a["x"]+a["w"], b["x"]+b["w"]) - max(a["x"], b["x"]))
    oy = max(0, min(a["y"]+a["h"], b["y"]+b["h"]) - max(a["y"], b["y"]))
    inter = ox * oy
    smaller = min(a["w"]*a["h"], b["w"]*b["h"])
    return (inter / smaller * 100) if smaller > 0 else 0

def coord_close(detected, expected, tol=60):
    """Check if detected bounding box is within tolerance of expected."""
    dx = abs(detected["x"] - expected["x"])
    dy = abs(detected["y"] - expected["y"])
    dw = abs(detected["w"] - expected["w"])
    dh = abs(detected["h"] - expected["h"])
    return dx <= tol and dy <= tol and dw <= tol*1.5 and dh <= tol

def hex_close(h1, h2, tol=40):
    """Check if two hex colors are perceptually close."""
    def parse(h):
        h = h.lstrip("#")
        if len(h) == 3: h = h[0]*2+h[1]*2+h[2]*2
        return int(h[0:2],16), int(h[2:4],16), int(h[4:6],16)
    r1,g1,b1 = parse(h1); r2,g2,b2 = parse(h2)
    return math.sqrt((r1-r2)**2+(g1-g2)**2+(b1-b2)**2) <= tol

# ── HTML analysis helpers ─────────────────────────────────────────────────────
def parse_html_elements(html):
    """Extract positioned elements from generated HTML."""
    elements = []
    # buttons
    for m in re.finditer(
        r'<button[^>]*style="([^"]*)"[^>]*>(.*?)</button>', html, re.S):
        style, content = m.group(1), re.sub(r'<[^>]+>', '', m.group(2)).strip()
        coords = _parse_style_coords(style)
        if coords:
            elements.append({**coords, "type": "button", "content": content,
                              "bg": _parse_style_bg(style)})
    # inputs
    for m in re.finditer(r'<input[^>]*style="([^"]*)"', html):
        coords = _parse_style_coords(m.group(1))
        if coords:
            elements.append({**coords, "type": "input", "content": "",
                              "bg": _parse_style_bg(m.group(1))})
    # divs
    for m in re.finditer(
        r'<div[^>]*class="([^"]*)"[^>]*style="([^"]*)"[^>]*>(.*?)</div>', html, re.S):
        cls, style, content = m.group(1), m.group(2), re.sub(r'<[^>]+>', '', m.group(3)).strip()
        coords = _parse_style_coords(style)
        if coords:
            t = "text" if "screen-text" in cls else "shape"
            elements.append({**coords, "type": t, "content": content[:60],
                              "bg": _parse_style_bg(style)})
    return elements

def _parse_style_coords(style):
    def g(k):
        m = re.search(rf'{k}:(\d+)px', style)
        return int(m.group(1)) if m else None
    x, y, w, h = g("left"), g("top"), g("width"), g("height")
    zi = None
    m = re.search(r'z-index:(\d+)', style)
    if m: zi = int(m.group(1))
    if x is None or y is None or w is None or h is None:
        return None
    return {"x": x, "y": y, "w": w, "h": h, "z": zi or 1}

def _parse_style_bg(style):
    m = re.search(r'background:(#[0-9a-fA-F]{3,6})', style)
    return m.group(1) if m else None

# ── Test runner ───────────────────────────────────────────────────────────────
def test_detection(name, data, gt):
    print(f"\n{'─'*70}")
    print(f"DETECTION TESTS: {name}")
    print('─'*70)

    comps = data["components"]
    img   = data["image"]
    shapes = [c for c in comps if c["kind"] == "shape"]
    texts  = [c for c in comps if c["kind"] == "text"]

    # 1. Image dimensions
    if img["width"] == gt["image"]["width"] and img["height"] == gt["image"]["height"]:
        ok(f"Image dimensions: {img['width']}x{img['height']}")
    else:
        fail(f"Image dimensions: got {img['width']}x{img['height']}, expected {gt['image']['width']}x{gt['image']['height']}")

    # 2. Background color
    bg = data["image"].get("background_color","")
    if hex_close(bg, gt["bg_color"], tol=35):
        ok(f"Background color: {bg} ≈ {gt['bg_color']}")
    else:
        fail(f"Background color: got {bg}, expected {gt['bg_color']}")

    # 3. Required texts present
    all_text = " ".join(c.get("text","") for c in texts)
    for t in gt["required_texts"]:
        if t.lower() in all_text.lower():
            ok(f"Text detected: '{t}'")
        else:
            fail(f"Text MISSING: '{t}'")

    # 4. Required shape types present
    shape_types = {s["type"] for s in shapes}
    for st in gt["required_shape_types"]:
        if st in shape_types:
            ok(f"Shape type present: {st}")
        else:
            fail(f"Shape type MISSING: {st}")

    # 5. Button coordinate accuracy
    for btn in gt.get("buttons", []):
        found = False
        for s in shapes:
            if s["type"] != "button": continue
            det = {"x": s["x"], "y": s["y"], "w": s["width"], "h": s["height"]}
            exp = {"x": btn["x"], "y": btn["y"], "w": btn["w"], "h": btn["h"]}
            if coord_close(det, exp, tol=70):
                found = True
                # Check color
                if hex_close(s.get("background_color","#000"), btn["bg"], tol=50):
                    ok(f"Button '{btn['label']}': coords ✓ color {s['background_color']} ≈ {btn['bg']}")
                else:
                    warn(f"Button '{btn['label']}': coords ✓ but color {s.get('background_color')} ≠ {btn['bg']}")
                break
        if not found:
            fail(f"Button '{btn['label']}' NOT FOUND near ({btn['x']},{btn['y']}) {btn['w']}x{btn['h']}")

    # 6. Input coordinate accuracy
    for inp in gt.get("inputs", []):
        found = any(
            s["type"] == "input" and
            coord_close({"x":s["x"],"y":s["y"],"w":s["width"],"h":s["height"]},
                        {"x":inp["x"],"y":inp["y"],"w":inp["w"],"h":inp["h"]}, tol=70)
            for s in shapes
        )
        if found:
            ok(f"Input at ({inp['x']},{inp['y']}) detected")
        else:
            fail(f"Input at ({inp['x']},{inp['y']}) NOT FOUND")

    # 7. Must-not-be-button regions (large text misclassified as buttons)
    for region in gt.get("must_not_be_button", []):
        bad = [
            s for s in shapes
            if s["type"] == "button" and
            coord_close({"x":s["x"],"y":s["y"],"w":s["width"],"h":s["height"]},
                        {"x":region["x"],"y":region["y"],"w":region["w"],"h":region["h"]}, tol=50)
        ]
        if bad:
            fail(f"Text region at ({region['x']},{region['y']}) WRONGLY classified as button")
        else:
            ok(f"Text region at ({region['x']},{region['y']}) correctly NOT a button")

    # 8. No duplicate text elements (same text, same position)
    seen_sigs = {}
    dups = 0
    for t in texts:
        sig = (t.get("text","").strip().lower()[:30], t["x"]//20, t["y"]//20)
        if sig in seen_sigs:
            dups += 1
        seen_sigs[sig] = True
    if dups == 0:
        ok(f"No duplicate text elements")
    else:
        fail(f"{dups} duplicate text elements detected")

    # 9. All elements within image bounds
    oob = 0
    for c in comps:
        if c["kind"] == "background": continue
        if (c["x"] < 0 or c["y"] < 0 or
            c["x"] + c["width"] > img["width"] + 5 or
            c["y"] + c["height"] > img["height"] + 5):
            oob += 1
    if oob == 0:
        ok("All elements within image bounds")
    else:
        fail(f"{oob} elements out of image bounds")

    # 10. Text z-index always >= shape z-index (text must be visible)
    text_zs  = [c.get("z_index",0) for c in texts]
    shape_zs = [c.get("z_index",0) for c in shapes]
    if text_zs and shape_zs:
        min_text_z = min(text_zs)
        max_shape_z = max(shape_zs)
        if min_text_z >= max_shape_z:
            ok(f"Text z-index ({min_text_z}) >= max shape z-index ({max_shape_z})")
        else:
            fail(f"Text z-index ({min_text_z}) < max shape z-index ({max_shape_z}) — text may be hidden")

    # 11. No shape-on-shape overlap > 80% (excluding parent-child)
    shape_overlaps = 0
    for i, a in enumerate(shapes):
        for j, b in enumerate(shapes):
            if j <= i: continue
            ra = {"x":a["x"],"y":a["y"],"w":a["width"],"h":a["height"]}
            rb = {"x":b["x"],"y":b["y"],"w":b["width"],"h":b["height"]}
            pct = rect_overlap_pct(ra, rb)
            if pct > 80 and a["type"] not in ("panel","toolbar") and b["type"] not in ("panel","toolbar"):
                shape_overlaps += 1
    if shape_overlaps == 0:
        ok("No excessive shape-on-shape overlaps")
    else:
        warn(f"{shape_overlaps} shape-on-shape overlaps > 80%")

    # 12. Text elements have non-empty text
    empty_texts = sum(1 for t in texts if not t.get("text","").strip())
    if empty_texts == 0:
        ok("All text elements have non-empty text")
    else:
        fail(f"{empty_texts} text elements with empty text")

    # 13. Buttons have reasonable dimensions (not tiny, not full-page)
    bad_buttons = [
        s for s in shapes if s["type"] == "button"
        and (s["width"] < 40 or s["height"] < 20 or
             s["width"] > img["width"] * 0.9 or s["height"] > img["height"] * 0.5)
    ]
    if not bad_buttons:
        ok("All buttons have reasonable dimensions")
    else:
        fail(f"{len(bad_buttons)} buttons with unreasonable dimensions: " +
             str([(s["width"],s["height"]) for s in bad_buttons]))

    # 14. Coordinate precision: no element with x=0,y=0,w=full,h=full except background
    false_fullpage = [
        c for c in comps
        if c["kind"] != "background" and
        c["x"] == 0 and c["y"] == 0 and
        c["width"] >= img["width"] * 0.95 and c["height"] >= img["height"] * 0.95
    ]
    if not false_fullpage:
        ok("No false full-page elements")
    else:
        fail(f"{len(false_fullpage)} non-background elements covering full page")

    return {
        "shapes": len(shapes), "texts": len(texts),
        "buttons": sum(1 for s in shapes if s["type"]=="button"),
        "inputs":  sum(1 for s in shapes if s["type"]=="input"),
    }


def test_html_output(name, html, gt, det_stats):
    print(f"\n{'─'*70}")
    print(f"HTML OUTPUT TESTS: {name}")
    print('─'*70)

    elems = parse_html_elements(html)
    buttons = [e for e in elems if e["type"] == "button"]
    inputs  = [e for e in elems if e["type"] == "input"]
    texts   = [e for e in elems if e["type"] == "text"]
    shapes  = [e for e in elems if e["type"] == "shape"]

    # 1. Valid HTML structure
    for tag in ["<!DOCTYPE html>", "<html", "<head>", "<body>", "</html>"]:
        if tag in html:
            ok(f"HTML has {tag}")
        else:
            fail(f"HTML missing {tag}")

    # 2. Canvas dimensions match image
    m = re.search(r'class="canvas"[^>]*style="[^"]*width:(\d+)px[^"]*height:(\d+)px', html)
    if not m:
        m = re.search(r'\.canvas\s*\{[^}]*width:\s*(\d+)px[^}]*height:\s*(\d+)px', html)
    if m:
        cw, ch = int(m.group(1)), int(m.group(2))
        ew, eh = gt["image"]["width"], gt["image"]["height"]
        if abs(cw-ew) <= 10 and abs(ch-eh) <= 10:
            ok(f"Canvas size {cw}x{ch} matches image {ew}x{eh}")
        else:
            fail(f"Canvas size {cw}x{ch} ≠ image {ew}x{eh}")

    # 3. Buttons are visible (have content or are styled)
    visible_buttons = [b for b in buttons if b["content"] or (b["bg"] and b["bg"] != "transparent")]
    if buttons:
        pct = len(visible_buttons) / len(buttons) * 100
        if pct >= 80:
            ok(f"Buttons visible: {len(visible_buttons)}/{len(buttons)} ({pct:.0f}%)")
        else:
            fail(f"Buttons NOT visible: only {len(visible_buttons)}/{len(buttons)} have content/color")
    else:
        if det_stats["buttons"] > 0:
            fail(f"No <button> elements in HTML but {det_stats['buttons']} buttons detected")
        else:
            warn("No buttons detected or rendered")

    # 4. Required texts appear in HTML
    for t in gt["required_texts"]:
        if t.lower() in html.lower():
            ok(f"Text in HTML: '{t}'")
        else:
            fail(f"Text MISSING from HTML: '{t}'")

    # 5. No text hidden by shapes (z-index check)
    hidden_count = 0
    for txt in texts:
        for shp in shapes + buttons + inputs:
            pct = rect_overlap_pct(txt, shp)
            if pct > 30:
                tz = txt.get("z") or 1
                sz = shp.get("z") or 1
                if sz > tz:
                    hidden_count += 1
                    fail(f"TEXT HIDDEN: '{txt['content'][:25]}' z={tz} under {shp['type']} z={sz} overlap={pct:.0f}%")
                    break
    if hidden_count == 0:
        ok("No text hidden by shapes (z-index correct)")

    # 6. No same-type element overlaps > 50% (buttons, inputs)
    for group, label in [(buttons, "button"), (inputs, "input")]:
        overlaps = 0
        for i, a in enumerate(group):
            for j, b in enumerate(group):
                if j <= i: continue
                if rect_overlap_pct(a, b) > 50:
                    overlaps += 1
        if overlaps == 0:
            ok(f"No {label}-on-{label} overlaps > 50%")
        else:
            fail(f"{overlaps} {label}-on-{label} overlaps > 50%")

    # 7. All positioned elements within canvas bounds
    canvas_w = gt["image"]["width"]
    canvas_h = gt["image"]["height"]
    oob = [e for e in elems if e["x"] + e["w"] > canvas_w + 20 or e["y"] + e["h"] > canvas_h + 20]
    if not oob:
        ok("All HTML elements within canvas bounds")
    else:
        fail(f"{len(oob)} HTML elements outside canvas bounds")

    # 8. Background color in CSS
    if gt["bg_color"].lower() in html.lower():
        ok(f"Background color {gt['bg_color']} present in HTML")
    else:
        warn(f"Background color {gt['bg_color']} not found in HTML (may be approximate)")

    # 9. Button coordinate accuracy vs ground truth
    for btn in gt.get("buttons", []):
        found = any(
            coord_close(b, {"x":btn["x"],"y":btn["y"],"w":btn["w"],"h":btn["h"]}, tol=80)
            for b in buttons
        )
        if found:
            ok(f"Button '{btn['label']}' at correct position in HTML")
        else:
            fail(f"Button '{btn['label']}' NOT at expected position in HTML ({btn['x']},{btn['y']})")

    # 10. No zero-size elements
    zero_size = [e for e in elems if e["w"] <= 0 or e["h"] <= 0]
    if not zero_size:
        ok("No zero-size elements in HTML")
    else:
        fail(f"{len(zero_size)} zero-size elements in HTML")

    print(f"\n  📊 HTML element counts: {len(buttons)} buttons, {len(inputs)} inputs, "
          f"{len(texts)} texts, {len(shapes)} shapes")


def main():
    print("\n" + "═"*70)
    print("  AGGRESSIVE SCREENSHOT-TO-CODE TEST SUITE")
    print("═"*70)

    for name, path in IMAGES.items():
        if not path.exists():
            print(f"\n⚠  {name} not found, skipping")
            continue

        gt = GROUND_TRUTH[name]
        print(f"\n{'═'*70}")
        print(f"IMAGE: {name}")
        print('═'*70)

        # Run detection
        print("\n[Running Python detection...]")
        try:
            data = run_detection(path)
        except Exception as e:
            fail(f"Detection crashed: {e}")
            continue

        det_stats = test_detection(name, data, gt)

        # Generate HTML via Node.js backend
        print(f"\n[Generating HTML output...]")
        html_path = ROOT / f"output_{name}.html"
        try:
            proc = subprocess.run(
                ["node", "--input-type=module"],
                input=f"""
import {{ generateCode }} from './backend/codeGenerator.js';
import fs from 'fs';
import path from 'path';
const code = await generateCode(path.resolve('{path}'));
fs.writeFileSync('{html_path}', code);
console.log('done');
""",
                capture_output=True, text=True, timeout=120,
                cwd=str(ROOT)
            )
            if proc.returncode != 0 or not html_path.exists():
                fail(f"HTML generation failed: {proc.stderr[:300]}")
                continue
            html = html_path.read_text()
            ok(f"HTML generated: {len(html)} chars → {html_path.name}")
        except Exception as e:
            fail(f"HTML generation error: {e}")
            continue

        test_html_output(name, html, gt, det_stats)

    # Final summary
    print(f"\n{'═'*70}")
    print("FINAL RESULTS")
    print('═'*70)
    total = results["passed"] + results["failed"]
    pct = results["passed"] / total * 100 if total else 0
    print(f"  Passed:   {results['passed']}/{total} ({pct:.1f}%)")
    print(f"  Failed:   {results['failed']}")
    print(f"  Warnings: {results['warnings']}")
    if results["failed"] == 0:
        print(f"\n  \033[92m✓ ALL TESTS PASSED\033[0m")
    else:
        print(f"\n  \033[91m✗ {results['failed']} TESTS FAILED\033[0m")
    print('═'*70 + "\n")
    sys.exit(0 if results["failed"] == 0 else 1)


if __name__ == "__main__":
    main()
