"""
Post-processing to fix overlapping elements and improve layout
"""

def fix_overlapping_elements(elements):
    """Fix z-index for overlapping text elements"""
    # Separate by kind
    shapes = [e for e in elements if e.get("kind") == "shape"]
    texts = [e for e in elements if e.get("kind") == "text"]
    
    # Increase z-index for text that overlaps shapes
    for text in texts:
        tx, ty, tw, th = text["x"], text["y"], text["width"], text["height"]
        
        for shape in shapes:
            sx, sy, sw, sh = shape["x"], shape["y"], shape["width"], shape["height"]
            
            # Check if text overlaps shape
            if not (tx + tw < sx or tx > sx + sw or ty + th < sy or ty > sy + sh):
                # Text overlaps shape - increase text z-index
                text["z_index"] = max(text.get("z_index", 1), shape.get("z_index", 1) + 5)
    
    return elements


def add_missing_borders(elements, image_width, image_height):
    """Add border styling hints for adjacent components"""
    # Find horizontal bands (toolbars, panels)
    bands = [e for e in elements if e.get("type") in ("toolbar", "panel") and e["width"] > image_width * 0.8]
    
    # Sort by y position
    bands.sort(key=lambda e: e["y"])
    
    # Add border hints
    for i, band in enumerate(bands):
        if i < len(bands) - 1:
            next_band = bands[i + 1]
            gap = next_band["y"] - (band["y"] + band["height"])
            
            # If bands are close, add border hint
            if 0 <= gap <= 5:
                if "metadata" not in band:
                    band["metadata"] = {}
                band["metadata"]["border_bottom"] = "1px solid #d0d7de"
    
    return elements
