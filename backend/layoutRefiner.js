const OLLAMA_URL = 'http://127.0.0.1:11434/api/generate';
const OLLAMA_MODEL = process.env.OLLAMA_LAYOUT_MODEL || 'llama3.2';

function safeJsonParse(text) {
  try { return JSON.parse(text); } catch {}
  const match = text.match(/\{[\s\S]*\}/);
  if (match) { try { return JSON.parse(match[0]); } catch {} }
  return null;
}

function buildPageClassifyPrompt(components = []) {
  const texts = components.filter((e) => e.kind === 'text' && e.text).slice(0, 15).map((e) => e.text.slice(0, 60));
  const shapes = components.filter((e) => e.kind === 'shape').slice(0, 8).map((e) => `${e.type}(${e.x},${e.y},${e.width}x${e.height})`);
  return [
    'Identify the page type from these UI texts and return JSON only.',
    'Schema: {"page_kind":"generic|repository|dashboard|form|landing|docs","hide_shape_ids":[],"notes":[]}',
    'Use "repository" for GitHub/GitLab/code repo pages.',
    'Use "landing" for marketing/product landing pages.',
    'Use "dashboard" for analytics/admin dashboards.',
    `Texts: ${texts.join(' | ')}`,
    `Shapes: ${shapes.join(', ')}`,
    'Return ONLY the JSON.',
  ].join('\n');
}

// T14: Structured LLM prompt — scene graph + color system + layout instructions
function buildZoneAwarePrompt(zones, pageKind, baseHTML, sceneGraph) {
  const palette = zones?.palette || {};
  const zoneList = zones?.zones || [];
  const layout = zones?.layout || 'single-column';
  const macroLayout = zones?.macro_layout || sceneGraph?.meta?.macro_layout || {};
  const macroLayoutType = macroLayout.layout_type || 'generic';

  // Determine CSS layout method per zone based on detected spatial relationships
  function zoneLayoutMethod(zone) {
    if (zone.zone === 'navbar') return 'flexbox row (space-between)';
    if (zone.zone === 'footer') return 'flexbox row (wrap)';
    if (macroLayoutType === 'sidebar-main') return 'css grid (grid-template-columns: 240px 1fr)';
    if (macroLayoutType === 'grid-cards') return 'css grid (auto-fill, minmax(280px, 1fr))';
    if (layout === 'two-column') return 'css grid (grid-template-columns: 1fr 300px)';
    // Check if zone has elements with repeat_group_id → grid
    const hasGrid = zone.elements && zone.elements.some(e => e.repeat_group_id != null);
    if (hasGrid) return 'css grid (auto-fill columns)';
    return 'flexbox column';
  }

  // Build scene graph description: zones → elements with roles, positions, and nesting
  const sceneGraphDesc = zoneList.map(z => {
    const elDesc = z.elements.map(e => {
      const pos = `x=${(e.x_pct||0).toFixed(2)} y=${(e.y_pct||0).toFixed(2)}`;
      const spacing = e.spacing_right ? ` gap-right=${e.spacing_right}px` : '';
      if (e.role === 'button') return `  [button ${pos} bg=${e.bg} r=${e.border_radius||0}${spacing}] "${e.text}"`;
      if (e.role === 'input') return `  [input ${pos} w=${e.width_pct||'?'}${spacing}] "${e.text||'placeholder'}"`;
      if (e.role === 'select') return `  [select ${pos}] "${e.text}"`;
      if (e.role === 'image') return `  [image ${pos} w=${e.width_pct||'?'} h=${e.h_pct||'?'}]`;
      return `  [${e.role} ${pos} fs=${e.font_size}px fw=${e.font_weight} color=${e.color}${spacing}] "${e.text}"`;
    }).join('\n');
    const layoutMethod = zoneLayoutMethod(z);
    return `ZONE: ${z.zone} (bg=${z.bg}, layout=${layoutMethod})\n${elDesc}`;
  }).join('\n\n');

  // Include repetition groups from scene graph for grid/list detection
  const repGroups = sceneGraph?.repetition_groups?.length
    ? `\nREPETITION GROUPS (use CSS grid/list for these):\n${sceneGraph.repetition_groups.slice(0,5).map(g => `  group_${g.repeat_group_id}: ${g.members.length} items`).join('\n')}`
    : '';

  // Include alignment groups for flex alignment hints
  const alignGroups = sceneGraph?.alignment_groups?.length
    ? `\nALIGNMENT GROUPS (elements sharing edges — use same flex container):\n${sceneGraph.alignment_groups.slice(0,8).map(g => `  ${g.type}: ids [${g.members.slice(0,4).join(',')}]`).join('\n')}`
    : '';

  return `You are an expert frontend developer replicating a UI screenshot.

SCENE GRAPH (zones → elements with positions and spacing):
${sceneGraphDesc}
${repGroups}
${alignGroups}

COLOR SYSTEM (use these CSS variables — do NOT invent new colors):
--bg: ${palette.background}
--accent: ${palette.accent}
--text: ${palette.text}
--muted: ${palette.muted}
--border: ${palette.border || '#e5e7eb'}
--surface: ${palette.surface || palette.background}
Theme: ${palette.theme}
Layout: ${layout}

CURRENT HTML (improve structure only — do NOT change text content or colors):
${baseHTML.slice(0, 2000)}

STRICT RULES:
1. Keep ALL text content exactly as detected — do not paraphrase or omit
2. Use ONLY the colors from the color system above
3. Use the layout method specified per zone (flexbox/grid) — NOT position:absolute
4. Add semantic wrappers: <nav>, <main>, <section>, <footer> — nothing else
5. For repetition groups: use CSS grid or ul/li list — do NOT repeat inline styles
6. Use measured spacing gaps (spacing_right/spacing_bottom) for gap/margin values
7. Buttons on ONE line with padding. Inputs with placeholder text
8. Add hover transitions and focus rings using accent color
9. The LLM's job is nesting and layout method — do NOT change colors, fonts, or text

OUTPUT ONLY the complete HTML document starting with <!DOCTYPE html>`;
}

// Stream Ollama to avoid timeout — reads chunks as they arrive
async function ollamaStream(prompt, numPredict = 4096) {
  const response = await fetch(OLLAMA_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: OLLAMA_MODEL,
      prompt,
      stream: true,
      options: { temperature: 0.2, top_p: 0.95, num_predict: numPredict },
    }),
    signal: AbortSignal.timeout(300000), // 5 min — streaming keeps alive
  });

  if (!response.ok) throw new Error(`Ollama failed: ${response.status}`);

  let full = '';
  const reader = response.body.getReader();
  const decoder = new TextDecoder();

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    const chunk = decoder.decode(value, { stream: true });
    for (const line of chunk.split('\n').filter(Boolean)) {
      try {
        const obj = JSON.parse(line);
        if (obj.response) {
          full += obj.response;
          process.stdout.write(obj.response); // live progress
        }
        if (obj.done) { process.stdout.write('\n'); return full; }
      } catch {}
    }
  }
  return full;
}

function esc(text) {
  return String(text || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// Determine readable text color on a background
function contrastColor(bg) {
  if (!bg || bg === 'transparent') return '#1f2328';
  const hex = bg.replace('#','');
  if (hex.length < 6) return '#1f2328';
  const r = parseInt(hex.slice(0,2),16), g = parseInt(hex.slice(2,4),16), b = parseInt(hex.slice(4,6),16);
  return (r*0.299 + g*0.587 + b*0.114) > 128 ? '#1f2328' : '#ffffff';
}

// OCR garbage filter — remove known bad tokens
const OCR_GARBAGE = /^(Type\(|mae$|smee$|vour$|\[\d|\d\]|[^a-z0-9\s]{3,})/i;
// Short repeated-char patterns like "ees Eee", "aaa Bbb" — OCR artifacts from large text
const OCR_REPEATED_FRAG = /^([a-z]{2,4}\s+[A-Z][a-z]{2,4})$|^([a-z]{3,5})$/;
function isGarbage(text) {
  if (!text) return true;
  if (OCR_GARBAGE.test(text.trim())) return true;
  // Drop very short OCR fragments that look like partial word captures
  const trimmed = text.trim();
  if (trimmed.length <= 7 && OCR_REPEATED_FRAG.test(trimmed)) return true;
  // Drop if >40% non-alpha chars (OCR noise)
  const alpha = (text.match(/[a-zA-Z]/g)||[]).length;
  return alpha / Math.max(text.length,1) < 0.4;
}

function buildSemanticFromZones(zones, pageKind, image) {
  if (!zones?.zones?.length) return null;

  const palette = zones.palette || {};
  const bg = palette.background || '#ffffff';
  const theme = palette.theme || 'light';
  const accent = palette.accent || (theme === 'dark' ? '#ff4a36' : '#0969da');
  const textColor = palette.text || (theme === 'dark' ? '#f0f0f0' : '#1f2328');
  const mutedColor = palette.muted || (theme === 'dark' ? '#aaaacc' : '#57606a');
  const isDark = theme === 'dark';
  const layout = zones.layout || 'single-column';
  const macroLayout = zones.macro_layout || {};
  const macroLayoutType = macroLayout.layout_type || 'generic';
  const isGridLayout = macroLayoutType === 'grid-cards';
  const isSidebarLayout = macroLayoutType === 'sidebar-main';

  // Scale factor: original image width → output container (1280px max)
  const imgW = image?.width || 1440;
  const imgH = image?.height || 900;
  const OUTPUT_W = 1280;
  const scale = OUTPUT_W / imgW;

  // Derive font size - prioritize actual detected font_size over height calculation
  const scaledFs = (fs, minPx = 11, el = null, maxPx = 96) => {
    // If element has actual font_size from OCR, use it directly without scaling
    if (el && el.font_size && el.font_size > 0) {
      const detected = Math.round(el.font_size);
      // Don't scale large text
      if (detected >= 20) return Math.min(detected, maxPx);
      // Scale smaller text
      return Math.min(Math.max(minPx, Math.round(detected * scale)), maxPx);
    }
    // Fallback: use h_pct * imgH * 0.82
    if (el && el.h_pct && el.h_pct > 0) {
      const heightPx = el.h_pct * imgH;
      const fromHeight = Math.round(heightPx * 0.82);
      if (fromHeight >= 20) return Math.min(fromHeight, maxPx);
      const scaled = Math.round(fromHeight * scale);
      if (scaled >= minPx) return Math.min(scaled, maxPx);
    }
    // Last resort: use passed fs
    const base = Math.round((fs || 14));
    if (base >= 20) return Math.min(base, maxPx);
    return Math.min(Math.max(minPx, Math.round(base * scale)), maxPx);
  };
  
  // Button-specific font size - capped at 14px
  const buttonFs = (fs, el = null) => {
    const size = scaledFs(fs, 11, el, 14);
    return Math.min(size, 14);
  };

  // --- Step 1: Choose fonts based on detected heading sizes (plan Step 4) ---
  const allEls = zones.zones.flatMap(z => z.elements || []);
  // Use h_pct-based size for heading detection too
  const maxHeadingSize = Math.max(0, ...allEls
    .filter(e => e.font_weight >= 700)
    .map(e => e.h_pct ? Math.round(e.h_pct * imgH * 0.82) : (e.font_size || 0)));
  const displayFont = maxHeadingSize >= 48
    ? "'Bricolage Grotesque', Inter, sans-serif"
    : "Inter, sans-serif";
  const bodyFont = "Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";

  // --- Step 2: Build color system (plan Step 3) ---
  const colors = {
    bg, accent, text: textColor, muted: mutedColor,
    surface: isDark ? lighten(bg, 12) : darken(bg, 3),
    border: isDark ? 'rgba(255,255,255,0.1)' : '#e5e7eb',
    navBg: isDark ? darken(bg, 8) : '#ffffff',
  };

  // T13: Spacing helper — convert pixel gap to rem (matches getSpacingClass scale)
  function pxToRem(px) {
    if (!px || px <= 0) return null;
    const steps = [2,4,6,8,10,12,16,20,24,32,40,48,64];
    const closest = steps.reduce((a,b) => Math.abs(b-px) < Math.abs(a-px) ? b : a);
    return `${(closest/16).toFixed(3).replace(/\.?0+$/,'')}rem`;
  }
  function zoneGap(zone) {
    const gaps = (zone?.elements||[]).map(e => e.spacing_right || e.spacing_bottom).filter(Boolean);
    if (!gaps.length) return '0.75rem';
    const med = gaps.sort((a,b)=>a-b)[Math.floor(gaps.length/2)];
    return pxToRem(med) || '0.75rem';
  }

  const zoneMap = {};
  for (const z of zones.zones) zoneMap[z.zone] = z;

  function normalizeText(t) {
    return String(t || '').replace(/\s+/g, ' ').trim().toLowerCase();
  }

  function elementPxWidth(e) {
    if (e.width_px) return Number(e.width_px) || 0;
    if (e.width) return Number(e.width) || 0;
    if (e.w_pct) return Math.round((Number(e.w_pct) || 0) * imgW);
    return 0;
  }

  function elementPxHeight(e) {
    if (e.height_px) return Number(e.height_px) || 0;
    if (e.height) return Number(e.height) || 0;
    if (e.h_pct) return Math.round((Number(e.h_pct) || 0) * imgH);
    return 0;
  }

  // Replication plan: suppress repeated tiny visual placeholders and near-identical duplicates.
  for (const zone of Object.values(zoneMap)) {
    const items = Array.isArray(zone?.elements) ? zone.elements : [];
    const tinyVisuals = items.filter((e) => {
      const role = (e.role || '').toLowerCase();
      if (!['image', 'brand_logo', 'icon'].includes(role)) return false;
      const w = elementPxWidth(e);
      const h = elementPxHeight(e);
      return w > 0 && h > 0 && w <= 110 && h <= 110 && !normalizeText(e.text);
    });

    const tinyVisualKeysToDrop = new Set();
    if (tinyVisuals.length >= 4) {
      for (const e of tinyVisuals) {
        const key = `${(e.role || '').toLowerCase()}|${Math.round((Number(e.x_pct) || 0) * 1000)}|${Math.round((Number(e.y_pct) || 0) * 1000)}|${Math.round((Number(e.width_pct || e.w_pct) || 0) * 1000)}|${Math.round((Number(e.h_pct) || 0) * 1000)}`;
        tinyVisualKeysToDrop.add(key);
      }
    }

    const byKey = new Map();
    const deduped = [];
    for (const e of items) {
      const role = (e.role || '').toLowerCase();
      const textKey = normalizeText(e.text);
      const x = Math.round((Number(e.x_pct) || 0) * 1000);
      const y = Math.round((Number(e.y_pct) || 0) * 1000);
      const w = Math.round((Number(e.width_pct || e.w_pct) || 0) * 1000);
      const h = Math.round((Number(e.h_pct) || 0) * 1000);
      const key = `${role}|${textKey}|${x}|${y}|${w}|${h}`;
      if (byKey.has(key)) continue;
      byKey.set(key, true);
      deduped.push(e);
    }

    zone.elements = deduped.filter((e) => {
      const tinyKey = `${(e.role || '').toLowerCase()}|${Math.round((Number(e.x_pct) || 0) * 1000)}|${Math.round((Number(e.y_pct) || 0) * 1000)}|${Math.round((Number(e.width_pct || e.w_pct) || 0) * 1000)}|${Math.round((Number(e.h_pct) || 0) * 1000)}`;
      if (tinyVisualKeysToDrop.has(tinyKey)) return false;

      const role = (e.role || '').toLowerCase();
      const text = normalizeText(e.text);
      const wPct = Number(e.width_pct || e.w_pct) || 0;
      const hPct = Number(e.h_pct) || 0;

      // Drop giant strip/panel artifacts with no content.
      if (role === 'panel' && !text && wPct >= 0.9 && hPct <= 0.09) return false;

      // Drop tiny generic controls without readable text.
      if ((role === 'button' || role === 'chip') && !text) {
        const w = elementPxWidth(e);
        const h = elementPxHeight(e);
        if (w <= 70 && h <= 28) return false;
      }

      return true;
    });
  }

  // Declare early — used throughout all sections to track rendered texts
  const usedTexts = new Set();

  // --- Step 3: Clean garbage and deduplicate (existing logic kept) ---
  for (const z of Object.values(zoneMap)) {
    z.elements = (z.elements || []).filter(e => !isGarbage(e.text) && !/^README\s+[a-z]$/i.test(e.text||''));
  }
  const navLinkTexts = new Set((zoneMap['navbar']?.elements || []).filter(e => e.role === 'nav-links').map(e => e.text));
  if (zoneMap['navbar']) {
    zoneMap['navbar'].elements = zoneMap['navbar'].elements.filter(e => e.role !== 'button' || !navLinkTexts.has(e.text));
  }
  if (zoneMap['content']) {
    const mainTexts = new Set(zoneMap['content'].elements.filter(e => (e.x_pct||0) < 0.65).map(e => e.text));
    zoneMap['content'].elements = zoneMap['content'].elements.filter(e => !((e.x_pct||0) >= 0.65 && mainTexts.has(e.text)));
  }

  const navbar = zoneMap['navbar'];
  const contentZone = zoneMap['content'];
  const footer = zoneMap['footer'];

  // --- Step 4: NAV (plan Step 5) ---
  const NAV_TAB_WORDS = /^(code|issues|pull|actions|projects|wiki|security|insights|settings|requests|product|products|marketplace|learn|resources|login|contact|sales)$/i;
  const navBg = navbar?.bg && navbar.bg !== bg ? navbar.bg : (isDark ? darken(bg, 10) : '#ffffff');
  const navTextCol = isDark ? '#e5e7eb' : '#374151';
  const navEls = (navbar?.elements || []).sort((a,b) => (a.x_pct||0)-(b.x_pct||0));
  const brandLogoEl = navEls.find(e => e.role === 'brand_logo' && (e.x_pct||0) < 0.15);
  const logoEl = navEls.find(e => e.role === 'logo' && (e.x_pct||0) < 0.15 && !NAV_TAB_WORDS.test(e.text));
  const navLinks = navEls.filter(e => e.role === 'nav-links' && e !== logoEl);
  const navActions = navEls.filter(e => e.role === 'nav-actions');
  const navButtons = navEls.filter(e => e.role === 'button' && e.text !== logoEl?.text);
  const navInputs = navEls.filter(e => e.role === 'input');
  const navSelects = navEls.filter(e => e.role === 'select');

  // Logo: brand_logo placeholder (non-text) preferred, else text logo, else fallback mark.
  const hasNavContent = navEls.length > 0;
  const brandLogoHTML = brandLogoEl ? (() => {
    const w = brandLogoEl.width_pct ? Math.max(24, Math.round(brandLogoEl.width_pct * OUTPUT_W)) : 32;
    const h = brandLogoEl.h_pct ? Math.max(24, Math.round(brandLogoEl.h_pct * imgH * scale)) : 32;
    const r = Math.min(10, Math.round(Math.min(w, h) * 0.22));
    const fill = brandLogoEl.bg || accent;
    return `<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" style="flex-shrink:0;display:block;"><rect x="0" y="0" width="${w}" height="${h}" rx="${r}" fill="${fill}"/></svg>`;
  })() : '';
  const textLogoHTML = logoEl
    ? `<span style="font-family:${displayFont};color:${logoEl.color||navTextCol};font-size:${Math.min(logoEl.font_size||18,22)}px;font-weight:700;white-space:nowrap;flex-shrink:0;">${esc(logoEl.text)}</span>`
    : '';
  const fallbackLogoHTML = (hasNavContent && !brandLogoHTML && !textLogoHTML) ? `<div style="width:32px;height:32px;background:${accent};border-radius:6px;flex-shrink:0;display:flex;align-items:center;justify-content:center;color:#fff;font-weight:700;font-size:14px;">W</div>` : '';
  const logoHTML = brandLogoHTML || textLogoHTML || fallbackLogoHTML;

  const navHTML = hasNavContent ? `<nav style="background:${navBg};display:flex;align-items:center;padding:0 2rem;height:60px;gap:${zoneGap(navbar)};border-bottom:1px solid ${colors.border};position:sticky;top:0;z-index:100;">
  ${logoHTML}
  ${navInputs.map(e => {
    const isSearch = /search|find|query/i.test(e.text||'');
    return `<div style="position:relative;flex-shrink:0;">
    <svg style="position:absolute;left:10px;top:50%;transform:translateY(-50%);pointer-events:none;" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="${mutedColor}" stroke-width="2"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg>
    <input type="${isSearch?'search':'text'}" placeholder="${esc(e.text||'Search')}" style="background:${isDark?'rgba(255,255,255,0.08)':'#f3f4f6'};border:1px solid ${colors.border};border-radius:8px;padding:6px 12px 6px 32px;font-size:13px;color:${navTextCol};outline:none;width:220px;" />
  </div>`;
  }).join('')}
  <div style="display:flex;align-items:center;gap:0.1rem;flex:1;">
    ${navLinks.map(e => {
      const hasDropdown = e.text && e.text.split(' ').length <= 2 && !e.text.match(/login|sign|contact|about|blog|home/i);
      const fs = scaledFs(e.font_size||14, 12, e);
      return `<a href="#" style="color:${e.color||navTextCol};font-size:${fs}px;font-weight:${e.font_weight||500};padding:6px 10px;text-decoration:none;border-radius:6px;white-space:nowrap;display:inline-flex;align-items:center;gap:3px;">${esc(e.text)}${hasDropdown?` <svg width="10" height="6" viewBox="0 0 10 6" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M1 1l4 4 4-4"/></svg>`:''}</a>`;
    }).join('')}
    ${navSelects.map(e => `<select style="background:transparent;border:none;color:${e.color||navTextCol};font-size:14px;font-weight:500;padding:6px 4px;cursor:pointer;outline:none;"><option>${esc(e.text)}</option></select>`).join('')}
  </div>
  <div style="display:flex;align-items:center;gap:0.75rem;">
    ${navActions.map(e => `<a href="#" style="color:${e.color||navTextCol};font-size:${scaledFs(e.font_size||14,12,e)}px;font-weight:${e.font_weight||500};padding:6px 10px;text-decoration:none;white-space:nowrap;">${esc(e.text)}</a>`).join('')}
    ${navButtons.map(e => `<button style="background:${e.bg||accent};color:${contrastColor(e.bg||accent)};border:none;border-radius:${e.border_radius||6}px;padding:0 20px;height:${e.h_pct?Math.round(e.h_pct*imgH*scale)+'px':'36px'};font-size:${buttonFs(e.font_size||14,e)}px;font-weight:600;cursor:pointer;white-space:nowrap;">${esc(e.text)}</button>`).join('')}
  </div>
</nav>` : '';

  // --- Step 5: HERO (plan Step 6) ---
  let heroHTML = '';
  let promotedHeadings = [];
  let heroEls = zoneMap['hero']?.elements || [];
  if (!heroEls.length && contentZone?.elements?.length) {
    promotedHeadings = contentZone.elements.filter(e => e.font_size >= 40 && e.font_weight >= 700 && e.role !== 'sidebar-text');
    heroEls = promotedHeadings;
  }

  // Badge: button that appears BEFORE the first heading (lower y_pct than headings)
  const firstHeadingY = Math.min(...(heroEls.filter(e => e.role === 'heading' || e.font_size >= 40).map(e => e.y_pct||1)));
  // Also check content zone for a badge button above the headings
  const badgeEl = [...heroEls, ...(contentZone?.elements||[])]
    .filter(e => e.role === 'button' && (e.y_pct||0) < firstHeadingY)
    .sort((a,b) => (a.y_pct||0)-(b.y_pct||0))[0] || null;

  if (heroEls.length) {
    const heroBg = zoneMap['hero']?.bg || contentZone?.bg || bg;
    const headings = heroEls.filter(e => e.role === 'heading' || e.font_size >= 40 || (e.font_size >= 28 && e.font_weight >= 700));
    const subheadings = heroEls.filter(e => !headings.includes(e) && (e.role === 'subheading' || e.font_size >= 18));
    const bodyEls = heroEls.filter(e => !headings.includes(e) && !subheadings.includes(e) && e.role !== 'button');
    const heroBtns = heroEls.filter(e => e.role === 'button' && e !== badgeEl);

    // Group heading fragments by row using pixel center (more stable than y_pct).
    const headingRows = [];
    for (const e of headings.sort((a,b) => (a.y_pct||0)-(b.y_pct||0))) {
      const hpx = Math.max(10, Math.round(((e.h_pct||0) * imgH) || (e.font_size||16)));
      const cy = Math.round(((e.y_pct||0) * imgH) + (hpx / 2));
      const row = headingRows.find(r => Math.abs(r.cy - cy) <= Math.max(10, Math.round(hpx * 0.35)));
      if (row) row.items.push(e);
      else headingRows.push({ cy, items: [e] });
    }
    const headingColor = headings[0]?.color || textColor;
    // Use the tallest heading element's h_pct for accurate font size
    const tallestHeading = headings.reduce((a, b) => (b.h_pct||0) > (a.h_pct||0) ? b : a, headings[0]);
    const headingSize = scaledFs(tallestHeading?.font_size || 48, 24, tallestHeading, 96);
    const headingWeight = Math.max(...headings.map(e => e.font_weight||700));
    const headingLines = headingRows.map(r => r.items.sort((a,b)=>(a.x_pct||0)-(b.x_pct||0)).map(e=>e.text).join(' '));
    const headingCssSize = headingSize >= 48 ? 'clamp(36px, 5vw, 80px)' : `${headingSize}px`;
    const headingCssWeight = headingSize >= 48 ? 800 : headingWeight;

    // Badge above heading (e.g. "Made in Webflow" pill) — plan: custom icons → placeholder
    const badgeHTML = badgeEl ? `<div style="display:inline-flex;align-items:center;gap:6px;background:${badgeEl.bg||'#f3f4f6'};border:1px solid ${colors.border};border-radius:${badgeEl.border_radius||20}px;padding:5px 14px;font-size:13px;font-weight:500;color:${textColor};margin-bottom:1rem;">${esc(badgeEl.text)}</div>` : '';

    heroHTML = `<section style="background:${heroBg};padding:5rem 2rem 4rem;display:flex;flex-direction:column;align-items:center;text-align:center;">
  ${badgeHTML}
  ${headingLines.length ? `<h1 style="font-family:${displayFont};color:${headingColor};font-size:${headingCssSize};font-weight:${headingCssWeight};line-height:1.1;letter-spacing:-0.03em;margin:0 0 1.5rem;max-width:900px;">${headingLines.map(esc).join('<br>')}</h1>` : ''}
  ${subheadings.map(e => `<p style="color:${e.color||mutedColor};font-size:${scaledFs(e.font_size||18)}px;font-weight:${e.font_weight||400};line-height:1.6;margin:0 0 1rem;max-width:640px;">${esc(e.text)}</p>`).join('')}
  ${bodyEls.map(e => `<p style="color:${e.color||mutedColor};font-size:${e.font_size||16}px;line-height:1.6;margin:0 0 0.5rem;max-width:600px;">${esc(e.text)}</p>`).join('')}
  ${heroBtns.length ? `<div style="display:flex;gap:1rem;flex-wrap:wrap;justify-content:center;margin-top:1.5rem;">${heroBtns.map(e=>`<button style="background:${e.bg||accent};color:${contrastColor(e.bg||accent)};border:none;border-radius:${e.border_radius||50}px;padding:14px 32px;font-size:14px;font-weight:600;cursor:pointer;white-space:nowrap;">${esc(e.text)}</button>`).join('')}</div>` : ''}
</section>`;
    // Mark heading words as used so they don't repeat in content section
    headingLines.forEach(l => l.split(' ').forEach(w => usedTexts.add(w)));
  }

  if (contentZone && promotedHeadings.length) {
    contentZone.elements = contentZone.elements.filter(e => !promotedHeadings.includes(e));
  }
  // Remove badge from content zone so it doesn't appear again
  if (badgeEl && contentZone) {
    contentZone.elements = contentZone.elements.filter(e => e !== badgeEl && e.text !== badgeEl?.text);
  }

  if (badgeEl?.text) usedTexts.add(badgeEl.text);

  // --- Step 6: CONTENT — search bar with icon, filter pills, toggle (plan Steps 9,10) ---
  let contentHTML = '';
  // Footer category labels that are actually filter buttons misclassified into footer zone
  const footerCategoryLabels = (zoneMap['footer']?.elements||[])
    .filter(e => e.role === 'footer-text' && e.text && e.text.split(' ').length <= 2 && e.text.length < 20)
    .sort((a,b) => (a.x_pct||0)-(b.x_pct||0));
  const footerCategoryTexts = new Set(footerCategoryLabels.map(e => e.text));

  if (contentZone?.elements?.length) {
    const contentBg = contentZone.bg || bg;
    const midX = 0.65;
    const mainEls = contentZone.elements.filter(e => (e.x_pct||0) < midX);
    const sideEls = contentZone.elements.filter(e => (e.x_pct||0) >= midX);

    // Search inputs: only real input controls (avoid buttons/labels being treated as a search bar).
    const searchInputs = mainEls.filter(e => {
      if (e.role !== 'input') return false;
      const t = (e.text || '').trim();
      const looksLikeSearch = /^(search|find|search\.\.\.|search\s+.*|find\s+.*)$/i.test(t);
      const wideEnough = (e.width_pct || 0) >= 0.22;
      const tallEnough = (e.h_pct || 0) >= 0.03;
      return looksLikeSearch && (wideEnough || tallEnough);
    });
    searchInputs.forEach(e => { if (e.text) usedTexts.add(e.text); });

    // Filter buttons: must have text, not be badge, not already used
    const filterButtons = mainEls.filter(e =>
      e.role === 'button' && !searchInputs.includes(e) && e.text
      && !/^search$/i.test((e.text || '').trim())
      && e !== badgeEl && !usedTexts.has(e.text)
    );

    const norm = (t) => (t || '').trim().toLowerCase();
    const footerSelectText = new Set((footer?.elements || []).filter(e => e.role === 'select').map(e => norm(e.text)));
    let selectEls = mainEls.filter(e => e.role === 'select');
    if (footerSelectText.size) {
      // UNIVERSAL: If a select exists in both content and footer, keep only the footer instance.
      selectEls = selectEls.filter(e => !footerSelectText.has(norm(e.text)));
    }
    const toggleEls = mainEls.filter(e => e.role === 'toggle');

    // otherEls: exclude search, filter buttons, badge text, already-used texts, and OCR garbage
    const OCR_NOISE = /^(and customize|#Madein|Looking|for templates)/i;
    const otherEls = mainEls.filter(e =>
      !searchInputs.includes(e) && !filterButtons.includes(e) &&
      !selectEls.includes(e) && !toggleEls.includes(e) &&
      e !== badgeEl && !usedTexts.has(e.text) &&
      !(e.text && OCR_NOISE.test(e.text)) &&
      !(e.role === 'content-text' && e.text && /^search$/i.test(e.text.trim()))
    );

    // Search bar
    const searchPlaceholder = searchInputs[0]?.text ? String(searchInputs[0].text) : 'Search';
    const searchHTML = searchInputs.length ? `<div style="position:relative;width:100%;max-width:640px;margin:0 auto 1.5rem;">
  <svg style="position:absolute;left:14px;top:50%;transform:translateY(-50%);pointer-events:none;" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="${mutedColor}" stroke-width="2"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg>
  <input type="search" placeholder="${esc(searchPlaceholder)}" style="width:100%;background:${isDark?'rgba(255,255,255,0.06)':'#fff'};border:1px solid ${colors.border};border-radius:8px;padding:12px 16px 12px 42px;font-size:15px;color:${textColor};outline:none;box-shadow:0 1px 3px rgba(0,0,0,0.06);" />
</div>` : '';

    // Filter pills: use button texts, else footer category labels (Animation, Interactions etc.)
    const pillItems = filterButtons.filter(e=>e.text).length
      ? filterButtons.filter(e=>e.text).sort((a,b)=>(a.x_pct||0)-(b.x_pct||0))
      : footerCategoryLabels.length >= 2 ? footerCategoryLabels
      : [];
    pillItems.forEach(e => { if (e.text) usedTexts.add(e.text); });

    const filterHTML = pillItems.length ? `<div class="filter-pills" style="display:flex;gap:0.5rem;flex-wrap:wrap;justify-content:center;margin-bottom:1.5rem;">
  ${pillItems.map((e,i) => {
    const isActive = i === 0;
    return `<button type="button" class="filter-pill${isActive?' active':''}" style="background:transparent;color:${textColor};border:1px solid ${colors.border};border-radius:20px;padding:8px 18px;font-size:14px;font-weight:500;cursor:pointer;white-space:nowrap;transition:all 0.15s;">${esc(e.text)}</button>`;
  }).join('')}
</div>` : '';

    // Toolbar row: selects + toggles
    const toolbarEls = [...selectEls, ...toggleEls];
    const toolbarHTML = toolbarEls.length ? `<div style="display:flex;align-items:center;gap:1rem;padding:0.75rem 0;margin-top:0.5rem;">
  ${selectEls.map(e => `<select style="background:${e.bg||'#fff'};border:1px solid ${colors.border};border-radius:${e.border_radius||6}px;padding:6px 12px;font-size:14px;cursor:pointer;outline:none;"><option>${esc(e.text||'')}</option></select>`).join('')}
  ${toggleEls.map(e => {
    const w = e.width_pct ? Math.round(e.width_pct * OUTPUT_W) : 46;
    const h = e.h_pct ? Math.round(e.h_pct * imgH * scale) : 24;
    const isOn = (e.state === 'on' || e.toggle_state === 'on' || /#(?:1a72f5|1877f2|0969da)/i.test(String(e.bg || '')));
    const dot = Math.max(10, h - 8);
    return `<button type="button" class="toggle${isOn?' on':''}" aria-pressed="${isOn}" style="width:${w}px;height:${h}px;border-radius:${Math.round(h/2)}px;background:${isOn?accent:'#d1d5db'};border:1px solid ${colors.border};padding:0 4px;display:flex;align-items:center;justify-content:flex-start;">
      <div class="dot" style="width:${dot}px;height:${dot}px;border-radius:999px;background:#fff;transform:${isOn?'translateX(18px)':'translateX(0)'};"></div>
    </button>`;
  }).join('')}
</div>` : '';

    // Remaining content rows — only non-used, non-garbage elements
    const rows = [];
    for (const el of otherEls.sort((a,b)=>(a.y_pct||0)-(b.y_pct||0))) {
      const hpx = Math.max(10, Math.round(((el.h_pct||0) * imgH) || (el.font_size||14)));
      const cy = Math.round(((el.y_pct||0) * imgH) + (hpx / 2));
      const row = rows.find(r => Math.abs(r.cy - cy) <= Math.max(10, Math.round(hpx * 0.40)));
      if (row) row.items.push(el);
      else rows.push({ cy, items: [el] });
    }
    const renderEl = (e) => {
      const elColor = e.color || textColor;
      const fs = scaledFs(e.font_size || 14, 11, e);
      const elW = e.w_pct ? `${Math.round(e.w_pct * OUTPUT_W)}px` : 'auto';
      const elH = e.h_pct ? `${Math.round(e.h_pct * imgH * scale)}px` : 'auto';
      if (e.role === 'button') return `<button style="background:${e.bg||accent};color:${contrastColor(e.bg||accent)};border:none;border-radius:${e.border_radius||6}px;padding:0 20px;height:${elH};font-size:${Math.min(fs, 14)}px;font-weight:600;cursor:pointer;white-space:nowrap;">${esc(e.text)}</button>`;
      if (e.role === 'input') return `<input placeholder="${esc(e.text||'')}" style="background:${e.bg||'#fff'};border:1px solid ${colors.border};border-radius:6px;padding:0 12px;height:${elH};width:${elW};font-size:${fs}px;outline:none;" />`;
      if (e.role === 'image') {
        const wp = e.w_pct ? Math.round(e.w_pct * OUTPUT_W) : 0;
        const hp = e.h_pct ? Math.round(e.h_pct * imgH * scale) : 0;
        if (wp > 0 && hp > 0 && wp < 120 && hp < 90) return '';
        return `<div style="width:${elW};height:${elH};background:#e8eaed;border-radius:4px;display:inline-flex;align-items:center;justify-content:center;flex-shrink:0;"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#9ca3af" stroke-width="1.5"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="M21 15l-5-5L5 21"/></svg></div>`;
      }
      if (e.role === 'heading' || (e.font_weight >= 700 && fs >= 24)) {
        const sizeCss = fs >= 48 ? 'clamp(28px, 3.4vw, 56px)' : `${fs}px`;
        const weightCss = fs >= 48 ? 800 : (e.font_weight||700);
        return `<h2 style="color:${elColor};font-size:${sizeCss};font-weight:${weightCss};margin:0;line-height:1.2;letter-spacing:${fs >= 48 ? '-0.03em' : 'normal'};">${esc(e.text)}</h2>`;
      }
      if (e.role === 'subheading' || (e.font_weight >= 600 && fs >= 18)) return `<h3 style="color:${elColor};font-size:${fs}px;font-weight:${e.font_weight||600};margin:0;">${esc(e.text)}</h3>`;
      return `<span style="color:${elColor};font-size:${fs}px;font-weight:${e.font_weight||400};">${esc(e.text)}</span>`;
    };
    const rowsHTML = rows.map(row => {
      const items = row.items.sort((a,b)=>(a.x_pct||0)-(b.x_pct||0));
      // Use measured spacing_right for gap between items in a row
      const rowGap = items.reduce((max, e) => Math.max(max, e.spacing_right || 0), 0);
      const gapStyle = rowGap > 0 ? `${Math.round(rowGap * scale)}px` : '0.75rem';
      // Use measured spacing_bottom for margin below this row
      const rowMargin = items.reduce((max, e) => Math.max(max, e.spacing_bottom || 0), 0);
      const marginStyle = rowMargin > 0 ? `${Math.round(rowMargin * scale)}px` : '4px';
      if (items.length === 1 && (items[0].role === 'heading' || (items[0].font_weight >= 700 && scaledFs(items[0].font_size||14, 11, items[0]) >= 24))) {
        return `<div style="width:100%;text-align:center;margin-bottom:${marginStyle};">${renderEl(items[0])}</div>`;
      }
      return `<div style="display:flex;align-items:center;gap:${gapStyle};margin-bottom:${marginStyle};flex-wrap:wrap;">${items.map(renderEl).join('')}</div>`;
    }).join('\n    ');

    contentHTML = `<section style="background:${contentBg};padding:2rem;display:flex;flex-direction:column;align-items:center;max-width:1280px;margin:0 auto;width:100%;">
  ${searchHTML}
  ${filterHTML}
  ${isGridLayout ? `<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:1.5rem;width:100%;">${rowsHTML}</div>` : rowsHTML}
  ${toolbarHTML}
</section>`;
  }

  // --- Step 7: FOOTER ---
  let footerHTML = '';
  if (footer?.elements?.length) {
    const footerBg = footer.bg || (isDark ? darken(bg,8) : '#f9fafb');
    // Exclude elements already used as filter pills
    const footerEls = footer.elements.filter(e =>
      e.role !== 'button' && e.role !== 'select' && e.role !== 'image' &&
      !usedTexts.has(e.text) && !footerCategoryTexts.has(e.text)
    );
    const footerBtns = footer.elements.filter(e => e.role === 'button');
    const footerSelects = footer.elements.filter(e => e.role === 'select');
    const footerToggles = footer.elements.filter(e => e.role === 'toggle');
    footerHTML = `<footer style="background:${footerBg};display:flex;align-items:center;justify-content:space-between;padding:0.75rem 2rem;border-top:1px solid ${colors.border};gap:1rem;flex-wrap:wrap;">
  <div class="footer-left" style="display:flex;align-items:center;gap:0.75rem;flex-wrap:wrap;">
    ${footerSelects.map(e=>`<select style="background:${e.bg||'#fff'};border:1px solid ${colors.border};border-radius:${e.border_radius||6}px;padding:5px 10px;font-size:13px;cursor:pointer;outline:none;"><option>${esc(e.text||'')}</option></select>`).join('')}
    ${footerToggles.map(e => {
      const w = e.width_pct ? Math.round(e.width_pct * OUTPUT_W) : 46;
      const h = e.h_pct ? Math.round(e.h_pct * imgH * scale) : 24;
      const isOn = (e.state === 'on' || e.toggle_state === 'on' || /#(?:1a72f5|1877f2|0969da)/i.test(String(e.bg || '')));
      const dot = Math.max(10, h - 8);
      return `<button type="button" class="toggle${isOn?' on':''}" aria-pressed="${isOn}" style="width:${w}px;height:${h}px;border-radius:${Math.round(h/2)}px;background:${isOn?accent:'#d1d5db'};border:1px solid ${colors.border};padding:0 4px;display:flex;align-items:center;justify-content:flex-start;">
        <div class="dot" style="width:${dot}px;height:${dot}px;border-radius:999px;background:#fff;transform:${isOn?'translateX(18px)':'translateX(0)'};"></div>
      </button>`;
    }).join('')}
    ${footerEls.sort((a,b)=>(a.x_pct||0)-(b.x_pct||0)).map(e=>`<span style="color:${e.color||mutedColor};font-size:${Math.min(e.font_size||14,16)}px;font-weight:${e.font_weight||400};">${esc(e.text)}</span>`).join('')}
  </div>
  <div class="footer-right" style="display:flex;gap:0.5rem;align-items:center;">
    ${footerBtns.map(e=>`<button style="background:${e.bg||accent};color:${contrastColor(e.bg||accent)};border:none;border-radius:${e.border_radius||6}px;padding:8px 20px;font-size:14px;font-weight:600;cursor:pointer;white-space:nowrap;">${esc(e.text)}</button>`).join('')}
  </div>
</footer>`;
  }

  // --- CSS: color system + fonts + hover states + toggle animation (plan Steps 11,12) ---
  const css = `@import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Bricolage+Grotesque:wght@600;700;800&display=swap');
*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
:root {
  --bg: ${colors.bg};
  --accent: ${colors.accent};
  --text: ${colors.text};
  --muted: ${colors.muted};
  --border: ${colors.border};
  --surface: ${colors.surface};
  --pill-active-bg: ${isDark ? '#fff' : '#111827'};
  --pill-active-text: ${isDark ? '#111827' : '#fff'};
}
body { font-family: ${bodyFont}; background: var(--bg); color: var(--text); min-height: 100vh; }
a { color: var(--accent); text-decoration: none; }
a:hover { opacity: 0.8; }
button { font-family: inherit; transition: opacity 0.15s, transform 0.1s, box-shadow 0.15s; }
button:hover { opacity: 0.9; cursor: pointer; transform: translateY(-1px); }
button:active { transform: scale(0.97) translateY(0); }
input:focus, select:focus { outline: 2px solid var(--accent); box-shadow: 0 0 0 3px ${accent}22; }
nav a:hover { background: rgba(128,128,128,0.08); }
.filter-pill.active { background: var(--pill-active-bg) !important; color: var(--pill-active-text) !important; border-color: var(--pill-active-bg) !important; }
.toggle .dot { transition: transform 0.2s; }
.toggle.on .dot { transform: translateX(18px); }
input[type=search]::-webkit-search-cancel-button { display: none; }`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Screen Reconstruction</title>
  <script src="https://cdn.tailwindcss.com"></script>
  <style>${css}</style>
</head>
<body>
${[navHTML, heroHTML, contentHTML, footerHTML].filter(Boolean).join('\n')}
<script>
// Toggle switch animation (plan Step 10)
document.querySelectorAll('.toggle').forEach(t => {
  t.addEventListener('click', () => {
    t.classList.toggle('on');
    const dot = t.querySelector('div');
    if (dot) dot.style.transform = t.classList.contains('on') ? 'translateX(18px)' : 'translateX(0)';
    t.style.background = t.classList.contains('on') ? '${accent}' : '#d1d5db';
  });
});
// Filter pill interaction (UNIVERSAL: single handler, no inline onclick)
document.querySelectorAll('.filter-pill').forEach(pill => {
  pill.addEventListener('click', () => {
    document.querySelectorAll('.filter-pill').forEach(p => p.classList.remove('active'));
    pill.classList.add('active');
  });
});
</script>
</body>
</html>`;
}

// Minimal color helpers
function lighten(hex, amt) {
  const n = parseInt((hex||'#888').replace('#','').padEnd(6,'0'), 16);
  const r = Math.min(255, (n>>16)+amt), g = Math.min(255, ((n>>8)&0xff)+amt), b = Math.min(255, (n&0xff)+amt);
  return `#${((1<<24)|(r<<16)|(g<<8)|b).toString(16).slice(1)}`;
}
function darken(hex, amt) { return lighten(hex, -amt); }

export class LayoutRefiner {
  static async refine(detection) {
    const components = detection?.components || [];
    if (components.length < 10) {
      return { page_kind: 'generic', hide_shape_ids: [], notes: [] };
    }

    try {
      const response = await fetch(OLLAMA_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: OLLAMA_MODEL,
          prompt: buildPageClassifyPrompt(components),
          stream: false,
          format: 'json',
          options: { temperature: 0.1, top_p: 0.9, num_predict: 200 },
        }),
        signal: AbortSignal.timeout(60000),
      });

      if (!response.ok) throw new Error(`Ollama refine failed: ${response.status}`);
      const payload = await response.json();
      const parsed = safeJsonParse(payload.response || '');
      if (!parsed || typeof parsed !== 'object') throw new Error('Invalid layout JSON');

      console.log(`  Ollama page_kind: ${parsed.page_kind || 'generic'}, hiding ${(parsed.hide_shape_ids || []).length} shapes`);

      return {
        page_kind: parsed.page_kind || 'generic',
        hide_shape_ids: Array.isArray(parsed.hide_shape_ids) ? parsed.hide_shape_ids.filter((v) => Number.isInteger(v)) : [],
        notes: Array.isArray(parsed.notes) ? parsed.notes.slice(0, 6) : [],
      };
    } catch (error) {
      console.warn('Layout refinement skipped:', error.message);
      return { page_kind: 'generic', hide_shape_ids: [], notes: [] };
    }
  }

  // Stage 3: Build semantic HTML from zones (Node.js), then use vision model if available
  static async refineHTML(
    baseHTML,
    detectedElements,
    image,
    pageKind = 'generic',
    zones = null,
    imagePath = null,
    sceneGraph = null,
    snippets = null,
  ) {
    // Use zone-based generation for simpler pages; for dense pages, keep absolute-position baseHTML to avoid jumbling.
    const zoneElementCount = zones?.zones?.length
      ? zones.zones.reduce((sum, z) => sum + (Array.isArray(z.elements) ? z.elements.length : 0), 0)
      : 0;
    const maxSemanticEls = Number(process.env.ZONE_SEMANTIC_MAX_ELEMENTS || 320);
    // Default ON when zones exist; disable only when explicitly set to false.
    const semanticToggle = (process.env.USE_ZONE_SEMANTIC || 'auto').toLowerCase();
    const allowSemantic = semanticToggle !== 'false'
      && Boolean(zones?.zones?.length)
      && zoneElementCount > 0
      && zoneElementCount <= maxSemanticEls;
    const semanticHTML = allowSemantic ? buildSemanticFromZones(zones, pageKind, image) : null;
    let workingHTML = semanticHTML || baseHTML;

    // T15: Post-LLM validation — verify all Stage 1 text components are present in output
    function validateOutput(html, zones, detectedElements) {
      if (!zones?.zones?.length) return { valid: true, missing: [], missingSourceIds: [], colorMismatches: [] };
      const palette = zones.palette || {};
      const allTexts = zones.zones.flatMap(z => z.elements || [])
        .filter(e => e.text && e.text.length > 3 && !/^(|placeholder)$/i.test(e.text))
        .map(e => e.text.trim());

      const missing = allTexts.filter(t => !html.includes(t)).slice(0, 10);

      // Only check source IDs when the HTML was generated from snippets (has data-source-id markers).
      // Zone-based semantic HTML does not embed source IDs, so skip this check for it.
      const missingSourceIds = [];
      if (Array.isArray(detectedElements) && detectedElements.length > 0 && html.includes('data-source-id=')) {
        const ids = detectedElements
          .map(e => e?.id)
          .filter(v => Number.isInteger(v));
        for (const id of ids) {
          if (!html.includes(`data-source-id="${id}"`)) {
            missingSourceIds.push(id);
            if (missingSourceIds.length >= 20) break;
          }
        }
      }

      // Check that declared CSS vars are present
      const colorMismatches = [];
      const cssVarCheck = [
        ['--bg', palette.background],
        ['--accent', palette.accent],
        ['--text', palette.text],
      ];
      for (const [varName, val] of cssVarCheck) {
        if (val && !html.includes(val) && !html.includes(varName)) {
          colorMismatches.push(`${varName}:${val} not found`);
        }
      }
      return { valid: missing.length === 0 && missingSourceIds.length === 0, missing, missingSourceIds, colorMismatches };
    }

    // Only fall back to absolute-positioned baseHTML if zone HTML drops >50% of texts.
    // A small number of missing texts is acceptable — zone HTML is structurally better.
    let validation = validateOutput(workingHTML, zones, detectedElements);
    const allZoneTexts = (zones?.zones || []).flatMap(z => z.elements || [])
      .filter(e => e.text && e.text.length > 3).length;
    const missingRatio = allZoneTexts > 0 ? validation.missing.length / allZoneTexts : 0;
    if (semanticHTML && missingRatio > 0.5) {
      workingHTML = baseHTML;
      validation = validateOutput(workingHTML, zones, detectedElements);
    }

    if (!validation.valid) {
      console.warn(`  ⚠️  Post-LLM validation: ${validation.missing.length} missing texts: ${validation.missing.slice(0,3).join(', ')}`);
      if (validation.missingSourceIds.length) {
        console.warn(`  ⚠️  Missing source ids: ${validation.missingSourceIds.slice(0, 8).join(', ')}`);
      }
      if (validation.colorMismatches.length) {
        console.warn(`  ⚠️  Color mismatches: ${validation.colorMismatches.join(', ')}`);
      }
    } else {
      console.log('  ✅ Post-LLM validation passed');
    }

    // Optional: LLM integration pass (scene graph + snippets) to improve semantic structure.
    const useIntegration = process.env.USE_LLM_INTEGRATION === 'true' && zones?.zones?.length && Array.isArray(snippets) && snippets.length > 0;
    if (useIntegration) {
      try {
        const palette = zones?.palette || {};
        const compactGraph = (() => {
          if (!sceneGraph || typeof sceneGraph !== 'object') return null;
          const nodes = Array.isArray(sceneGraph.nodes) ? sceneGraph.nodes.slice(0, 140) : [];
          const edges = Array.isArray(sceneGraph.edges) ? sceneGraph.edges.slice(0, 220) : [];
          const alignmentGroups = Array.isArray(sceneGraph.alignment_groups) ? sceneGraph.alignment_groups.slice(0, 20) : [];
          const repetitionGroups = Array.isArray(sceneGraph.repetition_groups) ? sceneGraph.repetition_groups.slice(0, 10) : [];
          return { meta: sceneGraph.meta || {}, zones: sceneGraph.zones || [], nodes, edges, alignment_groups: alignmentGroups, repetition_groups: repetitionGroups };
        })();
        const snippetPayload = snippets.slice(0, 80).map((s) => ({
          sourceId: s.sourceId,
          semanticType: s.semanticType,
          kind: s.kind,
          html: s.html,
        }));

        // Use the structured zone-aware prompt that includes scene graph hierarchy and layout methods
        const structuredPrompt = buildZoneAwarePrompt(zones, pageKind, workingHTML, compactGraph);
        const prompt = structuredPrompt + `\n\nSNIPPETS (verbatim; do NOT edit their inline styles/text):\n${JSON.stringify(snippetPayload.slice(0, 40))}`;

        const integrated = await ollamaStream(prompt, 4096);
        if (integrated && integrated.includes('<!DOCTYPE html') && integrated.includes('</html>')) {
          const integratedValidation = validateOutput(integrated, zones, detectedElements);
          if (integratedValidation.valid) {
            console.log('  ✅ LLM integration applied');
            workingHTML = integrated;
          } else {
            console.warn('  ⚠️  LLM integration rejected by validation');
          }
        }
      } catch (e) {
        console.warn(`  ⚠️  LLM integration skipped: ${e.message}`);
      }
    }

    // Try vision model (moondream) if image path provided
    if (imagePath) {
      try {
        const { readFileSync } = await import('fs');
        const imageData = readFileSync(imagePath).toString('base64');

        // Check if moondream is available
        const tagsRes = await fetch('http://127.0.0.1:11434/api/tags', { signal: AbortSignal.timeout(3000) });
        const tags = await tagsRes.json();
        const hasVision = tags.models?.some(m => m.name?.includes('moondream'));

        if (hasVision) {
          console.log('  Using moondream vision model for refinement...');
          const visionPrompt = `Look at this UI screenshot. I have detected these elements: ${
            (zones?.zones || []).flatMap(z => z.elements.map(e => e.text)).filter(Boolean).slice(0, 20).join(', ')
          }. What UI components am I missing? List only component names, one per line.`;

          const vRes = await fetch(OLLAMA_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              model: 'moondream',
              prompt: visionPrompt,
              images: [imageData],
              stream: false,
              options: { num_predict: 200 },
            }),
            signal: AbortSignal.timeout(60000),
          });

          if (vRes.ok) {
            const vPayload = await vRes.json();
            const missing = vPayload.response || '';
            console.log(`  ✅ Vision detected missing: ${missing.slice(0, 100)}`);
            // Append missing components as comments in HTML for now
            return workingHTML.replace('</body>', `<!-- Vision detected: ${missing.replace(/\n/g,' ')} -->\n</body>`);
          }
        }
      } catch (e) {
        console.warn(`  Vision model skipped: ${e.message}`);
      }
    }

    // Ollama CSS polish
    const cssPrompt = `Return ONLY JSON {"extra_css":"..."} with CSS for a ${pageKind} page: button hover effects, link hover, input focus, smooth transitions.`;
    try {
      const response = await fetch(OLLAMA_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: OLLAMA_MODEL,
          prompt: cssPrompt,
          stream: false,
          format: 'json',
          options: { temperature: 0.1, num_predict: 300 },
        }),
        signal: AbortSignal.timeout(30000),
      });
      if (response.ok) {
        const payload = await response.json();
        const parsed = safeJsonParse(payload.response || '');
        if (parsed?.extra_css?.trim().length > 10) {
          const result = workingHTML.replace('</style>', `  /* Ollama polish */\n  ${parsed.extra_css.trim()}\n</style>`);
          console.log(`  ✅ Semantic HTML + CSS polish (${result.length} chars)`);
          return result;
        }
      }
    } catch (e) {
      console.warn(`  ⚠️  Ollama CSS skipped: ${e.message}`);
    }

    return workingHTML;
  }
}

export default LayoutRefiner;
