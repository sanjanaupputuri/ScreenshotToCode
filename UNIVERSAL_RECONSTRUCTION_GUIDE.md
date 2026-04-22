# Universal Screenshot-to-Code Reconstruction Guide
### Definitive Reference — Based on Replication Plan + Webflow Case Study

---

## Overview

This guide describes **every rule, fix, and decision** the pipeline must follow to convert any UI screenshot into accurate HTML/CSS. It covers all 3 stages plus preprocessing, with universal applicability — not tied to the Webflow example.

The target accuracy range following this guide: **88–93%** visual fidelity.

---

## Stage 0 — Preprocessing (Run Before Everything Else)

### 0.1 — Resolution Normalization

**Rule:** Before any detection runs, normalize pixel coordinates to logical pixels.

- Detect device pixel ratio (DPR) by checking if the image's natural dimensions are 2× or 3× the expected viewport width.
- Divide all coordinates, widths, and heights by the DPR before storing.
- Default assumption if unknown: DPR = 1.

**Why this matters:** A retina screenshot of a 1440px page is 2880px wide. If not normalized, all font sizes and spacings will be halved in output, producing the tiny-text problem seen in the Webflow case.

---

### 0.2 — Color Inventory Extraction

**Rule:** Before any component detection, extract a named palette from the full image.

Extract and name:
- `--bg`: the single most dominant background color (usually white or near-white)
- `--surface`: secondary background (cards, panels — slightly different from bg)
- `--text`: the darkest text color found
- `--muted`: a lighter text color (subtitles, placeholders)
- `--accent`: the most saturated non-neutral color (CTAs, links, active states)
- `--border`: the most common thin-line color

**How:** Sample a 10×10 grid of points across the image. Cluster by Lab color distance (threshold ~15). Assign names based on luminance rank and saturation.

**Store as CSS variables.** Every component generated in Stage 3 draws from this palette — no hex values inlined except for these named variables.

---

### 0.3 — Macro Layout Detection

**Rule:** Identify the page's overall structure before detecting any individual components.

Classify the page into one of:
- `single-column-centered` — hero + search + filters (like Webflow showcase)
- `sidebar-main` — left/right nav + content area
- `header-grid-footer` — nav + card grid + footer bar
- `dashboard` — dense data with multiple panels
- `landing` — hero + feature sections + CTA footer

**How:** Run horizontal projection profiles (sum brightness along each row). Valleys reveal section boundaries. Then identify:
1. Top band height 48–80px with uniform background → **navbar zone**
2. Tall centered region with large text → **hero zone**
3. Repeating equal-size regions in a grid → **card grid zone**
4. Bottom band height 48–72px → **footer zone**

**Store as named zones** with bounding boxes. All Stage 1 detection runs inside zones, not on the full image.

---

## Stage 1 — OpenCV Detection

### 1.1 — Run Structural Detection First

**Rule:** Always detect zones before components. Never run contour detection on the full image.

For each zone, record:
- Zone type (navbar, hero, content, footer, sidebar)
- Bounding box (x, y, w, h)
- Background color (sampled from 5 interior points, averaged)
- Foreground contrast color (darkest color that differs from background by >30% luminance)

---

### 1.2 — Text Detection and Font Size Rules

**Rule:** Run Tesseract OCR per zone, not on the full image.

Font size calculation:
```
font_size = bounding_box_height × 0.82
```

**Critical overrides:**
- If a text block spans **>40% of the zone width** AND `height > 50px` → force `font_size = max(font_size, 48)`
- If `font_size >= 20` → **do not scale** in Stage 3. Preserve exactly.
- Headings ≥48px → render with `font-weight: 800`, `letter-spacing: -0.03em`, `line-height: 1.1`
- Body text 14–18px → render with `font-weight: 400`, `line-height: 1.6`
- Muted text (gray on white, contrast ratio 3–5) → classify as `muted_text`, **do not discard**

**Text classification tiers:**

| Tier | Pixel size | Font weight | Template name |
|---|---|---|---|
| display_heading | ≥48px | 800 | `display_heading` |
| section_heading | 28–47px | 700 | `section_heading` |
| subheading | 20–27px | 600 | `subheading` |
| body | 14–19px | 400 | `body_text` |
| muted/caption | 12–13px | 400 | `muted_text` |
| label/badge | 11–13px | 500–600 | `badge_label` |

---

### 1.3 — Button Detection

**Rule:** Detect by fill color difference from zone background, not by contour alone.

Requirements for a button match:
- Fill color differs from zone background by >20% in any Lab channel
- Aspect ratio between 2:1 and 8:1 (wider than tall)
- Minimum size: 50×28px (not smaller — avoids toggle overlap)
- Maximum size: 400×60px

**Corner radius detection:**
- Sample the 4 corner pixels (4px inset from each corner).
- If corner pixels match zone background instead of button fill → button has rounded corners.
- Estimate radius by binary-searching inward until pixels match fill.

**Variants to classify:**
- `filled_button`: fill ≠ background, no visible border
- `outline_button`: fill matches background, visible border color
- `ghost_button`: fill matches background, no border, hover-detectable only
- `pill_button`: border-radius > 50% of height
- `cta_button`: large (width > 140px), high-saturation fill

---

### 1.4 — Input Field Detection

**Rule:** Detect by white/near-white fill + visible border combination.

Requirements:
- Fill within 10% luminance of white
- Border visible (contrast with fill > 15%)
- Height > 34px
- Width > 100px
- May contain gray placeholder text (OCR it and store as `placeholder`)

**Variants:**
- `search_input`: contains a magnifying glass icon region on the left (detect 16×16px region with curved circle shape)
- `border_input`: standard rectangular input with border
- `select_dropdown`: has a downward chevron on the right edge

---

### 1.5 — Toggle Switch Detection

**Rule:** Use a dedicated toggle scanner, not standard contour detection.

Run this **after** main detection, scanning specifically in footer/toolbar zones:

```python
def find_toggle_switches(zone_image):
    # Look for pill-shaped objects: aspect ratio 1.5–2.5, width 28–70px
    # Two nested regions: outer track (gray or accent), inner thumb (white circle)
    # Thumb position: left = off state, right = on state
    # Minimum total size: 28×14px
    # Maximum total size: 70×36px
```

Store as:
- `toggle_switch_off`: track gray, thumb at left
- `toggle_switch_on`: track accent color, thumb at right

**Do not** let button detection consume toggle-sized regions. Enforce: if a detected shape is <70px wide AND <36px tall AND aspect ratio 1.5–2.5, route it through toggle detection first.

---

### 1.6 — Filter Pill / Chip Detection

**Rule:** Detect as a group, validate count against OCR token count.

1. Detect the pill-shaped buttons in a horizontal band.
2. Run OCR on the same band and count distinct text tokens.
3. **If detected pill count < OCR token count:** insert synthetic pills for the missing tokens at interpolated x positions.
4. Active pill: border is darker/thicker than inactive pills, or fill is dark (near #111827). Mark as `active_filter_pill`.
5. Inactive pill: light fill, light border. Mark as `pill_chip`.
6. **Minimum pill width: 30px** — short labels like "All", "CMS", "New" must not be filtered out by a width threshold.

---

### 1.7 — Badge / Tag Detection

**Rule:** Classify small pill-shaped elements near headings as badges, not buttons.

A badge differs from a button:
- Width < 180px
- Height < 32px
- Located above or near a heading block (within 40px vertical gap)
- May contain an icon prefix (small colored square/circle region before text)

If text content contains "Made in", "Beta", "New", "Free", "Pro" → high confidence badge.

Render as: `<div class="badge">icon + text</div>` with the detected fill color, `border-radius: 20px`.

---

### 1.8 — Spurious Shape Rejection

**Rule:** Reject false-positive shapes before passing to Stage 2.

Reject a detected shape if ALL of the following are true:
- Height > 30% of zone height
- No child text elements detected inside it
- Fill color is within 12% luminance of the zone background color
- No visible border

These are background regions misread as panels. Discard them. This eliminates the gray-block artifact seen in the Webflow reconstruction.

---

### 1.9 — Spatial Relationship Extraction

**Rule:** After all components are detected within a zone, compute their relationships.

For every component pair (A, B) in the same zone:

**Alignment** — check if:
- `|A.x - B.x| < 4px` → `aligned_left_with`
- `|A.right - B.right| < 4px` → `aligned_right_with`
- `|A.centerY - B.centerY| < 4px` → `aligned_center_with`

**Spacing:**
- `spacing_right = B.x - (A.x + A.width)` (when B is to the right of A)
- `spacing_bottom = B.y - (A.y + A.height)` (when B is below A)

**Hierarchy:**
- If component B is fully contained within component A's bounding box → B is a child of A

**Repetition:**
- If ≥3 components have matching width (±5%), height (±5%), fill color (±5%), and regular spacing → mark as `repeat_group` with a shared template ID

**Output:** A scene graph tree: `zones → groups → components`, with all spatial metadata.

---

### 1.10 — Logo and Icon Region Detection

**Rule:** Detect the leftmost small region in the navbar as a logo placeholder.

In the navbar zone:
- If a non-text region exists at x < 120, width 24–80px, height 24–80px → classify as `brand_logo`
- Render as an SVG placeholder (colored rectangle) at the detected dimensions and position
- Do not try to reproduce actual logo imagery

For inline icons (magnifying glass, chevron, question mark):
- Regions < 24×24px with non-text visual content adjacent to a text or input element → classify as `icon`
- Map to nearest Unicode or SVG icon equivalent based on shape analysis:
  - Circular arc + line → search icon (🔍)
  - Downward triangle/chevron → dropdown indicator
  - Circle with "?" → help icon
  - "×" shape → close icon

---

## Stage 2 — SQLite Template Matching

### 2.1 — Required Template Library

Every template stores: HTML snippet, min/max aspect ratio, min/max width, min/max height, fill mode, border radius tier, text pattern, priority score.

**Minimum required templates:**

```
Buttons:         filled_button, outline_button, ghost_button, pill_button,
                 cta_button, icon_button

Text:            display_heading, section_heading, subheading, body_text,
                 muted_text, badge_label, inline_link

Inputs:          search_input, border_input, select_dropdown

Chips/pills:     active_filter_pill, pill_chip, tab_chip

Toggles:         toggle_switch_on, toggle_switch_off  ← priority 10/9 (highest)

Containers:      navbar_zone, hero_zone, content_zone, footer_zone,
                 card_panel, sidebar_panel

Badges:          badge_with_icon, badge_plain

Misc:            brand_logo, divider_line, icon_placeholder, help_icon
```

**Toggle priority MUST be 9–10.** Toggles are small and will lose to button templates if priorities are equal. Any shape ≤70×36px with aspect ratio 1.5–2.5 should be routed to toggle templates before button templates.

---

### 2.2 — Scoring System (Replace Single-Rule Matching)

For each detected component, score every candidate template across 6 dimensions:

| Dimension | Max Points | How to score |
|---|---|---|
| Aspect ratio | 2.0 | `1 - abs(detected_ratio - template_midpoint_ratio) / template_range` |
| Size range | 2.0 | 2 if within range, 1 if within 20% outside, 0 if further |
| Fill mode | 1.25 | Exact match = 1.25, adjacent fill mode = 0.5 |
| Border radius | 2.0 | Exact tier = 2.0, adjacent tier = 1.0 |
| Text pattern | 2.25 | Regex match on OCR text content |
| Type bonus | 2.0–4.5 | Contextual boosts (see below) |

**Type bonuses:**
- Toggle-sized shape in footer/toolbar zone → +4.5 to toggle templates
- Shape with `border-radius > 50% height` → +3.0 to pill templates
- Shape near heading block → +2.5 to badge templates
- Shape with search icon child → +4.0 to search_input

**Thresholds:**
- Shapes: accept template if score ≥ 4.5
- Text blocks: accept if score ≥ 3.0
- Below threshold: output `<div>` with detected dimensions and background color, add `data-unmatched="true"` for debugging

---

### 2.3 — Color and Spacing Substitution

**Rule:** After template selection, substitute every generic value with the exact detected value.

Substitution map:
- `{{fill_color}}` → `element.background` (exact hex)
- `{{text_color}}` → `element.text_color` (exact hex)
- `{{border_color}}` → `element.border_color` (exact hex)
- `{{border_radius}}` → `element.border_radius` (exact px)
- `{{font_size}}` → `element.font_size` (exact px, do not recalculate)
- `{{text_content}}` → `element.ocr_text`
- `{{spacing_right}}` → `element.spacing_right` (exact px, convert to rem: px/16)
- `{{spacing_bottom}}` → `element.spacing_bottom`
- `{{width}}` → `element.width`
- `{{height}}` → `element.height`

**Never recalculate these values.** They come from OCR and color sampling. The pipeline's job is to preserve them, not approximate them.

---

## Stage 3 — HTML Generation

### 3.1 — Zone-Based Structure

**Rule:** Generate HTML organized by zones (navbar, hero, content, footer), not by raw y-coordinate order.

```html
<nav>    <!-- navbar zone elements -->
<section class="hero">    <!-- hero zone elements -->
<section class="content">    <!-- content zone elements -->
<footer>    <!-- footer zone elements -->
```

Each zone gets its detected background color, not the global `--bg`.

---

### 3.2 — Font Size Rules (Critical)

**Rule — never violate these:**

```javascript
function renderFontSize(el) {
  // 1. If font_size from OCR is available, use it directly
  if (el.font_size) {
    // 2. Large text: never scale down
    if (el.font_size >= 20) return el.font_size + 'px';
    // 3. Small text: scale by viewport ratio
    return (el.font_size * OUTPUT_W / IMG_W) + 'px';
  }
  // 4. Fallback: estimate from bounding box
  return (el.height * 0.82) + 'px';
}

// Special case: buttons always cap at 14px
function renderButtonFontSize(el) {
  return Math.min(renderFontSize(el), 14) + 'px';
}
```

**For display headings (≥48px):** Always use:
```css
font-size: clamp(36px, 5vw, 80px);
font-weight: 800;
line-height: 1.1;
letter-spacing: -0.03em;
```

---

### 3.3 — Footer Zone Layout

**Rule:** Footer must render as a flex row with 3 groups.

```html
<footer style="display:flex; align-items:center; justify-content:space-between; padding:0.75rem 2rem; border-top:1px solid var(--border);">
  <div class="footer-left">
    <!-- Sort/filter dropdown -->
    <!-- Toggle switch -->
    <!-- Label text -->
    <!-- Help icon -->
  </div>
  <div class="footer-right">
    <!-- CTA button (margin-left:auto equivalent) -->
  </div>
</footer>
```

**Deduplication rule:** If a `select_dropdown` element appears in both the content zone AND the footer zone, keep only the footer instance. The content-zone one is a misclassification artifact.

---

### 3.4 — Navbar Zone Layout

**Rule:** Navbar must render as a flex row with brand on left, nav links in middle, CTAs on right.

```html
<nav style="display:flex; align-items:center; height:60px; padding:0 2rem; gap:0.75rem; border-bottom:1px solid var(--border); position:sticky; top:0; z-index:100; background:{{navbar_bg}};">
  <!-- brand_logo placeholder -->
  <!-- nav links group (flex:1) -->
  <!-- CTA buttons group -->
</nav>
```

**Nav link splitting rule:** If OCR produces a token like "LearnResources" or "ProductMarketplace" (two capitalized words merged), split on internal capital letters: `re.sub(r'([a-z])([A-Z])', r'\1 \2', token)`.

---

### 3.5 — Hero Zone Layout

**Rule:** Hero is always centered, with generous vertical padding.

```html
<section class="hero" style="padding:5rem 2rem 4rem; text-align:center; display:flex; flex-direction:column; align-items:center;">
  <!-- badge (if present) -->
  <!-- display_heading -->
  <!-- muted subtitle text -->
  <!-- search input -->
  <!-- filter pills row -->
</section>
```

Vertical gaps:
- Badge to heading: 1rem
- Heading to subtitle: 1.5rem
- Subtitle to search: 2rem
- Search to filter pills: 1.5rem

---

### 3.6 — Filter Pill Group Layout

**Rule:** Pills always render as a flex row centered, with gap 0.5–0.75rem.

Active pill: `background: #111827; color: #fff; border-color: #111827;`
Inactive pill: `background: transparent; border: 1px solid var(--border);`

JavaScript click handler — one function, not inline per button:
```javascript
document.querySelectorAll('.filter-pill').forEach(pill => {
  pill.addEventListener('click', () => {
    document.querySelectorAll('.filter-pill').forEach(p => p.classList.remove('active'));
    pill.classList.add('active');
  });
});
```

---

### 3.7 — Duplicate Filtering

**Rule:** Remove overlapping synthetic elements before rendering.

For every pair of detected elements (A, B):
- Calculate intersection area as % of the smaller element's area
- If intersection > 40% → keep the one with higher template match score, discard the other
- Exception: an icon inside an input field — the icon is a child, not a duplicate

This prevents double search bars and duplicate inputs.

---

## Stage 4 — Post-Generation Validation (New Step)

### 4.1 — Component Completeness Check

After generating HTML, verify:
- Every component detected in Stage 1 is present in the output
- Count of each component type in output matches Stage 1 count (±1 for edge cases)
- If a component is missing → insert it at its detected position with detected dimensions

### 4.2 — Color Consistency Check

- Parse all color values in the output HTML
- Compare against the Stage 0 color inventory
- If a color appears in the output that was NOT in the inventory → replace with the nearest inventory color

### 4.3 — Font Size Sanity Check

- Find the largest font-size in the output
- If it is <20px AND the original screenshot's largest text was >40px → re-run Stage 3 font size calculation with DPR correction

---

## Universal Problem-to-Fix Reference

| Symptom | Root Cause | Fix Location |
|---|---|---|
| Heading text tiny | Font size scaling on large text | `layoutRefiner.js` — add `≥20px no-scale` guard |
| Subtitle text missing | Gray text filtered as noise | `detection_service.py` — lower muted_text contrast threshold |
| Gray block in content | False positive shape detection | `detection_service.py` — add spurious shape rejection (Section 1.8) |
| Toggle missing | Size too small for button detector | `detection_service.py` — add dedicated toggle scanner (Section 1.5) |
| Short pill labels missing ("All", "CMS") | min_width threshold too high | `database.js` — set pill_chip min_width to 30px |
| Nav items merged ("LearnResources") | OCR merges adjacent tokens | `detection_service.py` — split on internal capitals |
| Logo missing | Not handled by any template | `database.js` + `layoutRefiner.js` — add brand_logo template |
| "Looking" dropdown misplaced | Wrong zone assignment | `layoutRefiner.js` — deduplication rule removes content-zone duplicate |
| Badge wrong color | Color substitution not applied | `database.js` — ensure `{{fill_color}}` substitution runs for badge template |
| Duplicate search bar | Overlap filter threshold too high | `layoutRefiner.js` — lower overlap threshold to 40% |
| CTA button not right-aligned | Footer not flex space-between | `layoutRefiner.js` — use footer layout template (Section 3.3) |
| Filter pills all inactive | Active state not detected | `detection_service.py` — detect darker border = active state |

---

## Elements That Cannot Be Auto-Handled

Always substitute these manually:

| Element | Replacement Strategy |
|---|---|
| Custom brand logo/icon | Same-size SVG rect with detected dominant color |
| Photography / illustrations | Same-size `<div>` with detected dominant color as background |
| Custom icon set | Map to nearest Lucide/Heroicons equivalent by shape analysis |
| Gradient backgrounds | Sample 5 points, build `linear-gradient` from detected color stops |
| Hover/animation states | Output default state only, add `data-has-hover="true"` comment |
| Glassmorphism / blur | Flag as `<!-- glass-effect -->`, apply `backdrop-filter: blur(10px)` |

---

## Accuracy Targets

| Aspect | Target | Key Requirement |
|---|---|---|
| Font sizes | Exact match | Never scale text ≥20px |
| Button text size | ≤14px | Cap at 14px always |
| Colors | ≥98% match | Use exact hex from Stage 0 inventory |
| Spacing | ≥80% match | Use detected spacing_right/bottom values |
| Component count | ≥95% present | Post-generation completeness check |
| Toggle detection | ≥90% | Dedicated scanner + priority 10/9 |
| Text content | ≥90% | Zone-scoped OCR |
| Structural layout | ≥90% | Zone detection before components |

---

## Implementation Priority Order

When applying fixes to an existing system, implement in this order:

1. **Resolution normalization** (Stage 0.1) — fixes entire class of size issues
2. **Font size no-scale rule** (Stage 3.2) — highest visual impact
3. **Spurious shape rejection** (Stage 1.8) — removes visual corruption
4. **Dedicated toggle scanner** (Stage 1.5) — recovers missing interactive elements
5. **Pill min_width = 30px** (Stage 2.1) — recovers short filter labels
6. **Footer flex layout** (Stage 3.3) — fixes structural layout
7. **Zone-based deduplication** (Stage 3.7) — removes wrong-zone elements
8. **Nav token splitting** (Stage 3.4) — fixes merged label text
9. **Badge template + color substitution** (Stage 2.3) — polish
10. **Post-generation validation** (Stage 4) — catches regressions

Each step is independent — implement and test one at a time.
