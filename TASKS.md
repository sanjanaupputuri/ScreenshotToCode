# Implementation Task List

## Stage 1 — Detection Upgrades
- [x] T1: Vertical projection profile (column gutter detection) — `detect_column_boundaries()` in detection_service.py
- [x] T2: Divider detection (1-2px horizontal/vertical lines) — `detect_dividers()` in detection_service.py
- [x] T3: Card detection (panel with multiple children of different types) — `detect_cards()` in detection_service.py
- [x] T4: Alignment & spacing measurement (exact pixel gaps per element pair) — `measure_spacing()` in detection_service.py
- [x] T5: Repetition detection (list/grid repeated patterns) — `detect_repetition()` in detection_service.py
- [x] T6: Gradient direction sampling (5-point sample) — `sample_gradient()` in detection_service.py
- [x] T7: Glassmorphism/blur detection and flagging — `detect_glassmorphism()` in detection_service.py
- [x] T8: Color inventory — surface + border named vars — `extract_color_inventory()` in detection_service.py, passed to `build_zone_analysis()`

## Stage 2 — SQLite Upgrades
- [x] T9: Add border_radius_tier to primitive_profiles + scoring — `borderRadiusTierForElement()` + `scoreProfileMatch()` in database.js
- [x] T10: Add missing button variants (secondary/outline, ghost, pill, icon, CTA) — added to primitiveProfiles in database.js
- [x] T11: Add missing text variants (display, subheading, caption, badge, inline-link) — added to primitiveProfiles in database.js
- [x] T12: Add missing layout templates (2-col split, 3-col grid, form) — `extraTemplates` in database.js
- [x] T13: Wire getSpacingClass() into rendering — `pxToRem()` + `zoneGap()` in layoutRefiner.js, spacing_right/spacing_bottom passed through normalizeElement()

## Stage 3 — LLM + Validation
- [x] T14: Structured LLM prompt (scene graph + color system + layout instructions) — `buildZoneAwarePrompt()` rewritten in layoutRefiner.js
- [x] T15: Post-LLM validation (verify all components present, colors match inventory) — `validateOutput()` in `refineHTML()` in layoutRefiner.js

## Cannot-Auto-Handle
- [x] T16: Icon → HTML comment placeholder with size/color + Lucide mapping suggestion — `renderIconPlaceholder()` + `suggestLucideIcon()` + `LUCIDE_ICON_MAP` in componentService.js
- [x] T17: Gradient background → CSS gradient output — `renderShape()` + `renderBackground()` + `renderImagePlaceholder()` use `element.gradient` in componentService.js
- [x] T18: Per-component hover state flagging — `data-hover="true"` attribute + CSS rules in componentService.js

## All 18 tasks complete ✅
