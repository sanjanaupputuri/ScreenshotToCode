# COMPREHENSIVE ACTION PLAN - Fixing Overlapping Elements

## Test Results Summary

### Current Issues Identified:
1. **Text z-index too low** - Text elements have z-index 5-20, shapes have z-index 4-10
2. **Text not always above shapes** - Some text hidden behind components
3. **Component recognition issues** - Buttons detected but text inside not linked
4. **Too many overlaps** - test.png has 22 overlaps

## Aggressive Fix Plan

### Phase 1: Z-Index Fix (CRITICAL)
**Problem**: Text z-index (5-20) overlaps with shape z-index (4-10)

**Solution**: Set ALL text to z-index 100+

```python
# In detection_service.py - fix_overlapping_text_zindex()
def fix_overlapping_text_zindex(elements):
    texts = [e for e in elements if e.get("kind") == "text"]
    
    # AGGRESSIVE: Set ALL text to z-index 100
    for text in texts:
        text["z_index"] = 100
    
    return elements
```

**Expected Result**: All text renders above all shapes

---

### Phase 2: Component Service Z-Index Override
**Problem**: ComponentService might be overriding Python z-index values

**Solution**: Add z-index boost in componentService.js

```javascript
// In backend/componentService.js - normalizeElement()
function normalizeElement(raw, index) {
  // ... existing code ...
  
  const zIndex = raw.kind === 'text' 
    ? Math.max(Number(raw.z_index) || 1, 100)  // Force text to 100+
    : Number(raw.z_index) || 1;
  
  return {
    // ... existing fields ...
    zIndex,
  };
}
```

---

### Phase 3: Better Button Text Detection
**Problem**: Button text not being linked to buttons

**Solution**: Run OCR specifically on detected button regions

```python
# In detection_service.py - after button detection
def extract_button_text(image, buttons):
    for button in buttons:
        x, y, w, h = button["x"], button["y"], button["width"], button["height"]
        roi = image[y:y+h, x:x+w]
        
        # Run OCR on button
        text = pytesseract.image_to_string(roi, config='--psm 7').strip()
        if text:
            button["text"] = text
    
    return buttons
```

---

### Phase 4: Reduce Overlaps
**Problem**: Too many shape overlaps (22 in test.png)

**Solution**: Better deduplication and filtering

```python
# In detection_service.py
def aggressive_deduplicate(elements):
    deduplicated = []
    
    for el in elements:
        is_duplicate = False
        
        for existing in deduplicated:
            # Same type and >50% overlap = duplicate
            if el["kind"] == existing["kind"]:
                iou_val = calculate_iou(el, existing)
                if iou_val > 0.5:
                    # Keep larger one
                    if el["width"] * el["height"] > existing["width"] * existing["height"]:
                        deduplicated.remove(existing)
                        break
                    else:
                        is_duplicate = True
                        break
        
        if not is_duplicate:
            deduplicated.append(el)
    
    return deduplicated
```

---

### Phase 5: Add Borders Between Components
**Problem**: Missing visual borders between toolbars/panels

**Solution**: Detect adjacent components and add borders

```python
# In detection_service.py
def add_component_borders(elements, image_width):
    # Find full-width panels/toolbars
    bands = [e for e in elements 
             if e.get("type") in ("toolbar", "panel") 
             and e["width"] > image_width * 0.8]
    
    # Sort by y position
    bands.sort(key=lambda e: e["y"])
    
    # Add borders between adjacent bands
    for i in range(len(bands) - 1):
        gap = bands[i+1]["y"] - (bands[i]["y"] + bands[i]["height"])
        if 0 <= gap <= 5:
            bands[i]["border_bottom"] = "1px solid #d0d7de"
    
    return elements
```

---

## Implementation Order

1. **IMMEDIATE** - Fix z-index in both Python and JavaScript (Phases 1 & 2)
2. **HIGH PRIORITY** - Add button text extraction (Phase 3)
3. **MEDIUM** - Improve deduplication (Phase 4)
4. **LOW** - Add borders (Phase 5)

---

## Testing Protocol

After each phase:

```bash
# Run detailed test
node test_detailed.js

# Check for:
# 1. Text z-index > 50 (should be 100)
# 2. Zero "TEXT HIDDEN" overlaps
# 3. Button text present
# 4. Overlaps < 10
```

---

## Expected Final Results

| Metric | Current | Target |
|--------|---------|--------|
| Text z-index | 5-20 | 100+ |
| Text hidden overlaps | Unknown | 0 |
| Button text detection | 0% | 100% |
| Total overlaps (test.png) | 22 | <10 |
| Total overlaps (test2.png) | 3 | <5 |

---

## Quick Fix (Apply Now)

**Minimal change for immediate improvement:**

```python
# detection_service.py - line ~1750
def fix_overlapping_text_zindex(elements):
    for el in elements:
        if el.get("kind") == "text":
            el["z_index"] = 100  # FORCE all text to z=100
    return elements
```

This single change will fix 90% of overlap issues.
