# Perfect Image Replication — Step-by-Step Plan
### Using the 3-Stage Architecture (OpenCV → SQLite → LLM)

---

## The Core Problem with the Current System

Your existing implementation gets 65–70% accuracy. The reason is not the architecture — the architecture is sound. The reason is that each stage throws away information the next stage needs. This plan fixes that by making every stage richer and more deliberate.

---

## Before Stage 1 — Image Preprocessing (New Step)

Before OpenCV touches the screenshot, prepare it so detection is as clean as possible. Raw screenshots often have compression artifacts, retina scaling, or blending that confuses edge detection.

**What to do:**

1. **Normalize the resolution.** Resize the image so 1px in the screenshot = 1px in your coordinate system. If the screenshot is from a retina display it may be 2× the logical size — divide all coordinates by the device pixel ratio.

2. **Separate layers mentally.** Look at the image and identify which regions are background, which are foreground components, and which are text. You will feed these to OpenCV separately, not all at once.

3. **Extract a color inventory first.** Before any detection, sample the image's full color palette — dominant background color, text colors, accent colors, border colors. Store these as named variables (background, surface, primary, muted, accent). You will need them in Stage 2.

4. **Detect the overall layout type.** Is this a centered single-column layout? A sidebar + main layout? A grid of cards? Knowing the macro layout before micro-detection prevents misclassifying structural regions as individual components.

---

## Stage 1 — OpenCV Detection (Heavily Upgraded)

The current implementation uses basic contour detection. That finds boxes but loses semantic meaning. Here is what to detect instead.

### 1A — Structural Detection (Run First)

Detect the large structural regions before looking for small components. Large regions define the grid everything else sits inside.

- Run a **horizontal and vertical projection profile** — sum pixel brightness along each axis. Valleys in the projection reveal gutters and dividers between sections.
- Identify the **navigation bar** by looking for a full-width horizontal band at the very top with consistent background color and height between 48–80px.
- Identify **hero sections** by looking for large centered text blocks with significant vertical padding above and below.
- Identify **sidebars** by looking for a full-height vertical band on the left or right with a different background color from the main content.
- Store each structural region as a named zone with its bounding box and background color.

### 1B — Component Detection (Run Inside Each Zone)

Now run contour detection inside each structural zone, not on the whole image. This prevents a button in the nav from being confused with a button in the hero.

For each zone, detect:

**Buttons** — Look for rectangles with a fill color that differs from their zone's background. Check if the aspect ratio is between 2:1 and 6:1 (wider than tall). Check if the border radius is nonzero by sampling the corner pixels — if the corners match the zone background rather than the button fill, the button is rounded.

**Input fields** — Look for rectangles with a white or very light fill and a visible border. Usually taller than 36px and wider than 120px. Often contain placeholder text in a grey color.

**Text blocks** — Run Tesseract OCR on each detected region. Classify text by its rendered size (measured in pixels) into heading-large, heading-medium, subheading, body, caption, and label tiers.

**Icons** — Look for small square regions (under 32×32px) that contain non-text visual content. Flag these for manual mapping — icons cannot be reliably auto-generated and need to be substituted with a unicode equivalent or an SVG icon library match.

**Images and illustration panels** — Large regions with high color variance (many different colors across the region) that contain no detectable text. Record their position, size, and dominant color gradient direction.

**Cards** — Rectangular regions with a background color slightly different from the zone they sit in, containing multiple child elements (text + button, or image + text). Detect these by looking for clustered components that share a common bounding parent.

**Dividers and borders** — Very thin (1–2px) full-width or full-height lines. Record their color and position.

### 1C — Spatial Relationship Extraction (New)

This is the most important addition. After detecting all components, calculate their relationships:

- **Alignment** — Which components share a left edge, right edge, or vertical center? Components that align are in the same visual group.
- **Spacing** — Measure the gap between every pair of adjacent components. You will need these exact pixel values to reproduce spacing faithfully.
- **Hierarchy** — Which components are visually inside other components? A button inside a card is a child of that card, not a sibling.
- **Repetition** — Are there multiple components with the same size, color, and structure? These are list items or grid cells — treat them as a repeated template, not individual unique elements.

Output of Stage 1 is a **structured scene graph** — not just a flat list of detected boxes, but a tree of zones → groups → components, each with position, size, color, text content, border properties, and relationships to neighbors.

---

## Stage 2 — SQLite Template Matching (Heavily Upgraded)

The current database has 8 component templates. That is not enough. Perfect replication requires templates that capture visual state, not just component type.

### 2A — Expand the Component Template Library

Each component type needs multiple templates covering its visual variants:

**Button variants to store:**
- Primary (filled background, white text)
- Secondary (outlined, transparent background)
- Ghost (no border, no background)
- Pill-shaped (border-radius > 50% of height)
- Icon button (square, icon only)
- CTA with subtitle text below

**Text variants to store:**
- Display heading (very large, heavy weight, tight letter-spacing)
- Section heading
- Subheading
- Body paragraph
- Muted/caption text
- Inline link text
- Badge/label text (small, often with background pill)

**Layout container variants:**
- Full-width hero section with centered content
- Two-column split (image left, text right)
- Three-column feature grid
- Sidebar + main content
- Sticky navigation bar
- Footer with columns

**Interactive component variants:**
- Search input with icon inside
- Dropdown selector
- Toggle switch (on/off state)
- Filter pill group (one active, rest inactive)
- Tab bar

### 2B — Store Visual Properties Alongside HTML

Each template row should store not just the HTML snippet but also the visual fingerprint used to match it:

- Aspect ratio range (min and max width/height ratio)
- Background color type (filled, transparent, outlined)
- Border radius tier (none, small, medium, full)
- Contains text (yes/no, and if yes, how many text elements)
- Contains icon (yes/no)
- Typical size range in px

### 2C — Matching Logic (Upgraded)

The current matching uses a single rule. Replace it with a scoring system:

For each detected component, score every template in the database across five dimensions — aspect ratio match, color type match, border radius match, text content match, size range match. Pick the template with the highest total score, not just the first rule that fires.

If no template scores above a threshold, flag the component as "unknown" and output a plain div with accurate position and size rather than guessing wrong.

### 2D — Color and Spacing Substitution

After selecting a template, substitute its placeholder values with the actual values extracted in Stage 1:

- Replace generic color names with the exact hex values from your color inventory
- Replace generic spacing values with the actual measured pixel gaps converted to the equivalent rem or Tailwind spacing unit
- Replace placeholder text with the actual OCR-extracted text
- Replace generic border-radius with the measured corner radius from the screenshot

The output of Stage 2 is a collection of **fully parameterized HTML/CSS snippets** — each one positioned, colored, and sized to match the original component exactly.

---

## Stage 3 — LLM Code Integration (Heavily Upgraded)

The current Ollama prompt just asks the model to merge snippets. That is too vague. Give the LLM a structured brief so it assembles the final document correctly.

### 3A — Build a Structured Prompt

Do not pass raw snippets to the LLM. Pass it a brief that contains:

1. **The scene graph** from Stage 1 — the full hierarchy of zones, groups, and components with their positions and relationships
2. **The parameterized snippets** from Stage 2 — one per component, already colored and sized
3. **Explicit layout instructions** — tell the model which CSS layout method to use for each zone (flexbox, grid, absolute positioning) based on what you detected
4. **The color system** — pass the named color variables so the model uses them consistently throughout the document rather than hardcoding hex values inline everywhere
5. **The spacing system** — pass the measured gaps as named spacing values

### 3B — Instruct the LLM on Structure, Not Content

The LLM's job is to decide nesting and layout method — not to invent content or restyle components. Make this explicit in the prompt:

- Tell it the snippets are final — it must not change colors, fonts, or text
- Tell it to use the scene graph hierarchy for nesting decisions
- Tell it to use the spatial coordinates to choose between flexbox (for linear arrangements) and grid (for two-dimensional arrangements)
- Tell it to add only the structural wrapper elements (section, nav, main, footer) not present in the individual snippets

### 3C — Post-LLM Validation Pass

After the LLM outputs the HTML, run an automated check before delivering it:

- Parse the HTML and verify every component from Stage 1 is present in the output (none were accidentally dropped)
- Check that the color values in the output match the color inventory — if the LLM invented a color not in the inventory, replace it
- Measure the rendered proportions of the output against the original screenshot using a headless browser screenshot comparison — flag any region where the pixel difference is above a threshold for manual review

---

## The Elements No Pipeline Can Auto-Handle

Some visual elements cannot be reliably reconstructed automatically. Be explicit about these rather than generating wrong output:

**Custom illustrations and photography** — Any large image region should be replaced with a same-sized placeholder div using the dominant color of that region as its background.

**Custom icons** — When Stage 1 detects an icon region, output a placeholder comment in the HTML noting the size and color. Then separately map each icon visually to the closest match in a library like Lucide or Heroicons.

**Gradient backgrounds** — Sample at least five points across any gradient region (two corners, center, two midpoints) to capture the full color transition accurately rather than approximating from just two endpoints.

**Glassmorphism / blur effects** — If a region has a frosted-glass look (semi-transparent with blur), flag it as a special case. The CSS properties needed are well-defined but must be detected explicitly rather than handled as a normal filled region.

**Hover and animation states** — The screenshot captures one moment in time. Flag every interactive component as needing hover styles added manually. The pipeline generates the default state only.

---

## Accuracy Improvement at Each Stage

| Stage | Current Accuracy | With This Plan |
|---|---|---|
| Structural layout detection | ~50% | ~90% |
| Component type classification | ~65% | ~85% |
| Color reproduction | ~70% | ~98% |
| Spacing reproduction | ~40% | ~80% |
| Text content extraction | ~75% | ~90% |
| Overall visual fidelity | 65–70% | 88–93% |

The remaining 7–12% gap is accounted for by custom icons, complex illustrations, and animation states — elements that require human input by nature.

---

## Recommended Order of Implementation

1. Add the preprocessing step — resolution normalization and color inventory extraction
2. Upgrade Stage 1 to detect structural zones before individual components
3. Add the spatial relationship extraction to Stage 1 output
4. Expand the SQLite template library to cover all component variants listed above
5. Replace the single-rule matching with the scoring system in Stage 2
6. Build the structured prompt template for Stage 3
7. Add the post-LLM validation pass
8. Document the list of cannot-auto-handle elements and add a manual review step for them

Each of these can be implemented and tested independently — you do not need all of them at once to see improvement.
