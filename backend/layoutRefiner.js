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
function buildZoneAwarePrompt(zones, pageKind, baseHTML) {
  const palette = zones?.palette || {};
  const zoneList = zones?.zones || [];
  const layout = zones?.layout || 'single-column';

  // Build scene graph description: zones → elements with roles and positions
  const sceneGraph = zoneList.map(z => {
    const elDesc = z.elements.map(e => {
      const pos = `x=${(e.x_pct||0).toFixed(2)} y=${(e.y_pct||0).toFixed(2)}`;
      if (e.role === 'button') return `  [button ${pos} bg=${e.bg} r=${e.border_radius||0}] "${e.text}"`;
      if (e.role === 'input') return `  [input ${pos} w=${e.width_pct||'?'}] "${e.text||'placeholder'}"`;
      if (e.role === 'select') return `  [select ${pos}] "${e.text}"`;
      if (e.role === 'image') return `  [image ${pos} w=${e.width_pct||'?'} h=${e.h_pct||'?'}]`;
      return `  [${e.role} ${pos} fs=${e.font_size}px fw=${e.font_weight} color=${e.color}] "${e.text}"`;
    }).join('\n');
    const layoutMethod = z.zone === 'navbar' ? 'flexbox row' : z.zone === 'footer' ? 'flexbox row' : layout === 'two-column' ? 'css grid 2-col' : 'flexbox column';
    return `ZONE: ${z.zone} (bg=${z.bg}, layout=${layoutMethod})\n${elDesc}`;
  }).join('\n\n');

  return `You are an expert frontend developer replicating a UI screenshot.

SCENE GRAPH (zones → elements with positions):
${sceneGraph}

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
3. Use the layout method specified per zone (flexbox/grid)
4. Add semantic wrappers: <nav>, <main>, <section>, <footer> — nothing else
5. Buttons on ONE line with padding. Inputs with placeholder text
6. Add hover transitions and focus rings using accent color
7. Do NOT use position:absolute anywhere

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

  // --- Step 1: Choose fonts based on detected heading sizes (plan Step 4) ---
  // Large bold headings → display font; body/nav → Inter
  const allEls = zones.zones.flatMap(z => z.elements || []);
  const maxHeadingSize = Math.max(0, ...allEls.filter(e => e.font_size >= 28 && e.font_weight >= 700).map(e => e.font_size));
  const displayFont = maxHeadingSize >= 48 ? '"Bricolage Grotesque", "Inter"' : '"Inter"';
  const bodyFont = '"Inter", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';

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
  const NAV_TAB_WORDS = /^(code|issues|pull|actions|projects|wiki|security|insights|settings|requests)$/i;
  const navBg = navbar?.bg && navbar.bg !== bg ? navbar.bg : (isDark ? darken(bg, 10) : '#ffffff');
  const navTextCol = isDark ? '#e5e7eb' : '#374151';
  const navEls = (navbar?.elements || []).sort((a,b) => (a.x_pct||0)-(b.x_pct||0));
  const logoEl = navEls.find(e => e.role === 'logo' && (e.x_pct||0) < 0.15 && !NAV_TAB_WORDS.test(e.text));
  const navLinks = navEls.filter(e => e.role === 'nav-links' && e !== logoEl);
  const navActions = navEls.filter(e => e.role === 'nav-actions');
  const navButtons = navEls.filter(e => e.role === 'button');
  const navInputs = navEls.filter(e => e.role === 'input');
  const navSelects = navEls.filter(e => e.role === 'select');

  // Logo: image placeholder if no text logo (plan: custom icons → placeholder)
  const hasNavContent = navEls.length > 0;
  const logoHTML = logoEl
    ? `<span style="font-family:${displayFont};color:${logoEl.color||navTextCol};font-size:${Math.min(logoEl.font_size||18,22)}px;font-weight:700;white-space:nowrap;flex-shrink:0;">${esc(logoEl.text)}</span>`
    : (hasNavContent ? `<div style="width:32px;height:32px;background:${accent};border-radius:6px;flex-shrink:0;display:flex;align-items:center;justify-content:center;color:#fff;font-weight:700;font-size:14px;">W</div>` : '');

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
      return `<a href="#" style="color:${e.color||navTextCol};font-size:14px;font-weight:500;padding:6px 10px;text-decoration:none;border-radius:6px;white-space:nowrap;display:inline-flex;align-items:center;gap:3px;">${esc(e.text)}${hasDropdown?` <svg width="10" height="6" viewBox="0 0 10 6" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M1 1l4 4 4-4"/></svg>`:''}</a>`;
    }).join('')}
    ${navSelects.map(e => `<select style="background:transparent;border:none;color:${e.color||navTextCol};font-size:14px;font-weight:500;padding:6px 4px;cursor:pointer;outline:none;"><option>${esc(e.text)}</option></select>`).join('')}
  </div>
  <div style="display:flex;align-items:center;gap:0.75rem;">
    ${navActions.map(e => `<a href="#" style="color:${e.color||navTextCol};font-size:14px;font-weight:500;padding:6px 10px;text-decoration:none;white-space:nowrap;">${esc(e.text)}</a>`).join('')}
    ${navButtons.map(e => `<button style="background:${e.bg||accent};color:${contrastColor(e.bg||accent)};border:none;border-radius:${e.border_radius||6}px;padding:8px 20px;font-size:14px;font-weight:600;cursor:pointer;white-space:nowrap;">${esc(e.text)}</button>`).join('')}
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

  if (heroEls.length) {
    const heroBg = zoneMap['hero']?.bg || contentZone?.bg || bg;
    const headings = heroEls.filter(e => e.role === 'heading' || e.font_size >= 40 || (e.font_size >= 28 && e.font_weight >= 700));
    const subheadings = heroEls.filter(e => !headings.includes(e) && (e.role === 'subheading' || e.font_size >= 18));
    const bodyEls = heroEls.filter(e => !headings.includes(e) && !subheadings.includes(e) && e.role !== 'button');
    const heroBtns = heroEls.filter(e => e.role === 'button');
    const heroBadges = heroEls.filter(e => e.role === 'button' && e.border_radius >= 10);

    // Group heading fragments by row, sort each row left-to-right (plan: spatial relationships)
    const headingRows = [];
    for (const e of headings.sort((a,b) => (a.y_pct||0)-(b.y_pct||0))) {
      const elH = e.h_pct || (e.font_size/900) || 0.06;
      const row = headingRows.find(r => Math.abs(r.y-(e.y_pct||0)) < Math.max(elH*0.6, 0.01));
      if (row) row.items.push(e); else headingRows.push({y:e.y_pct||0, items:[e]});
    }
    const headingColor = headings[0]?.color || textColor;
    const headingSize = Math.max(...headings.map(e => e.font_size||14));
    const headingWeight = Math.max(...headings.map(e => e.font_weight||700));
    const headingLines = headingRows.map(r => r.items.sort((a,b)=>(a.x_pct||0)-(b.x_pct||0)).map(e=>e.text).join(' '));

    // Badge above heading (e.g. "Made in Webflow" pill)
    const badgeEl = heroBadges[0];
    const badgeHTML = badgeEl ? `<div style="display:inline-flex;align-items:center;gap:6px;background:${badgeEl.bg||'#f3f4f6'};border:1px solid ${colors.border};border-radius:${badgeEl.border_radius||20}px;padding:5px 14px;font-size:13px;font-weight:500;color:${textColor};margin-bottom:1rem;">
    <div style="width:16px;height:16px;background:${accent};border-radius:3px;display:flex;align-items:center;justify-content:center;"><svg width="10" height="10" viewBox="0 0 10 10" fill="#fff"><path d="M2 2h6v6H2z"/></svg></div>
    ${esc(badgeEl.text)}
  </div>` : '';

    heroHTML = `<section style="background:${heroBg};padding:5rem 2rem 4rem;display:flex;flex-direction:column;align-items:center;text-align:center;">
  ${badgeHTML}
  ${headingLines.length ? `<h1 style="font-family:${displayFont};color:${headingColor};font-size:clamp(2rem,${headingSize/16}rem,${headingSize}px);font-weight:${headingWeight};line-height:1.1;letter-spacing:-0.03em;margin:0 0 1.5rem;max-width:900px;">${headingLines.map(esc).join('<br>')}</h1>` : ''}
  ${subheadings.map(e => `<p style="color:${e.color||mutedColor};font-size:${Math.min(e.font_size||18,22)}px;font-weight:${e.font_weight||400};line-height:1.6;margin:0 0 1rem;max-width:640px;">${esc(e.text)}</p>`).join('')}
  ${bodyEls.map(e => `<p style="color:${e.color||mutedColor};font-size:${e.font_size||16}px;line-height:1.6;margin:0 0 0.5rem;max-width:600px;">${esc(e.text)}</p>`).join('')}
  ${heroBtns.filter(e=>!heroBadges.includes(e)).length ? `<div style="display:flex;gap:1rem;flex-wrap:wrap;justify-content:center;margin-top:1.5rem;">${heroBtns.filter(e=>!heroBadges.includes(e)).map(e=>`<button style="background:${e.bg||accent};color:${contrastColor(e.bg||accent)};border:none;border-radius:${e.border_radius||50}px;padding:14px 32px;font-size:16px;font-weight:600;cursor:pointer;white-space:nowrap;transition:transform 0.15s,box-shadow 0.15s;">${esc(e.text)}</button>`).join('')}</div>` : ''}
</section>`;
  }

  if (contentZone && promotedHeadings.length) {
    contentZone.elements = contentZone.elements.filter(e => !promotedHeadings.includes(e));
  }

  // --- Step 6: CONTENT — search bar with icon, filter pills, toggle (plan Steps 9,10) ---
  let contentHTML = '';
  if (contentZone?.elements?.length) {
    const contentBg = contentZone.bg || bg;
    const midX = 0.65;
    const mainEls = contentZone.elements.filter(e => (e.x_pct||0) < midX);
    const sideEls = contentZone.elements.filter(e => (e.x_pct||0) >= midX);

    // Detect search inputs and filter pill groups
    // A "Search" button or input with search text = search bar
    const searchInputs = mainEls.filter(e =>
      (e.role === 'input' || e.role === 'button') && /^search$/i.test((e.text||'').trim())
    );
    // Small empty inputs at same y = filter pill backgrounds (misclassified by OpenCV)
    const emptySmallInputs = mainEls.filter(e => e.role === 'input' && !e.text && (e.width_pct||0) < 0.08);
    const filterButtons = mainEls.filter(e =>
      (e.role === 'button' && e.border_radius >= 6 && !searchInputs.includes(e)) ||
      emptySmallInputs.includes(e)
    );
    const selectEls = mainEls.filter(e => e.role === 'select');
    const toggleEls = mainEls.filter(e => e.role === 'toggle');
    const otherEls = mainEls.filter(e => !searchInputs.includes(e) && !filterButtons.includes(e) && !selectEls.includes(e) && !toggleEls.includes(e));

    // Search bar with icon inside (plan Step 9)
    const searchHTML = searchInputs.length ? `<div style="position:relative;width:100%;max-width:640px;margin:0 auto 1.5rem;">
  <svg style="position:absolute;left:14px;top:50%;transform:translateY(-50%);pointer-events:none;" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="${mutedColor}" stroke-width="2"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg>
  <input type="search" placeholder="Search" style="width:100%;background:${isDark?'rgba(255,255,255,0.06)':'#fff'};border:1px solid ${colors.border};border-radius:8px;padding:12px 16px 12px 42px;font-size:15px;color:${textColor};outline:none;box-shadow:0 1px 3px rgba(0,0,0,0.06);" />
</div>` : '';

    // Filter pills with active state JS (plan Step 9)
    // Get labels: use text elements at same y as filter buttons, sorted by x
    const filterY = filterButtons[0]?.y_pct || 0;
    const filterLabels = mainEls
      .filter(e => e.role === 'content-text' && Math.abs((e.y_pct||0) - filterY) < 0.04 && e.text)
      .sort((a,b) => (a.x_pct||0)-(b.x_pct||0));
    // Fallback: use button texts if we have them
    const pillItems = filterLabels.length
      ? filterLabels
      : filterButtons.filter(e => e.text).sort((a,b)=>(a.x_pct||0)-(b.x_pct||0));
    const filterHTML = pillItems.length ? `<div class="filter-pills" style="display:flex;gap:0.5rem;flex-wrap:wrap;justify-content:center;margin-bottom:1.5rem;">
  ${pillItems.map((e,i) => {
    const isActive = i === 0;
    const activeBg = isDark ? '#fff' : '#111827';
    const activeText = isDark ? '#111827' : '#fff';
    return `<button onclick="document.querySelectorAll('.filter-pills button').forEach(b=>{b.style.background='transparent';b.style.color='${textColor}';b.style.borderColor='${colors.border}'});this.style.background='${activeBg}';this.style.color='${activeText}';this.style.borderColor='${activeBg}';" style="background:${isActive?activeBg:'transparent'};color:${isActive?activeText:textColor};border:1px solid ${isActive?activeBg:colors.border};border-radius:20px;padding:8px 18px;font-size:14px;font-weight:500;cursor:pointer;white-space:nowrap;transition:all 0.15s;">${esc(e.text)}</button>`;
  }).join('')}
</div>` : '';

    // Toolbar row: selects + toggles + right-aligned buttons (plan: toolbar detection)
    const toolbarEls = [...selectEls, ...toggleEls];
    const footerBtns = sideEls.filter(e => e.role === 'button');
    const toolbarHTML = (toolbarEls.length || footerBtns.length) ? `<div style="display:flex;align-items:center;gap:1rem;padding:0.75rem 0;border-top:1px solid ${colors.border};margin-top:1rem;">
  ${selectEls.map(e => `<select style="background:${e.bg||'#fff'};border:1px solid ${colors.border};border-radius:${e.border_radius||6}px;padding:6px 12px;font-size:14px;cursor:pointer;outline:none;"><option>${esc(e.text||'')}</option></select>`).join('')}
  <label style="display:flex;align-items:center;gap:8px;cursor:pointer;font-size:14px;color:${mutedColor};">
    <div class="toggle" onclick="this.classList.toggle('on');this.style.background=this.classList.contains('on')?'${accent}':'#d1d5db';" style="width:40px;height:22px;background:#d1d5db;border-radius:11px;position:relative;transition:background 0.2s;cursor:pointer;">
      <div style="position:absolute;top:3px;left:3px;width:16px;height:16px;background:#fff;border-radius:50%;transition:transform 0.2s;transform:translateX(0);box-shadow:0 1px 3px rgba(0,0,0,0.2);"></div>
    </div>
    ${esc(sideEls.find(e=>e.role==='content-text'&&/cloneable|only/i.test(e.text||''))?.text || '')}
  </label>
  <div style="margin-left:auto;display:flex;gap:0.5rem;">
    ${footerBtns.map(e=>`<button style="background:${e.bg||accent};color:${contrastColor(e.bg||accent)};border:none;border-radius:${e.border_radius||6}px;padding:8px 20px;font-size:14px;font-weight:600;cursor:pointer;white-space:nowrap;">${esc(e.text)}</button>`).join('')}
  </div>
</div>` : '';

    // Remaining content rows — render each element with its actual detected styles
    const rows = [];
    for (const el of otherEls.sort((a,b)=>(a.y_pct||0)-(b.y_pct||0))) {
      const elH = el.h_pct || 0.02;
      const row = rows.find(r => Math.abs(r.y-(el.y_pct||0)) < Math.max(elH*0.6, 0.008));
      if (row) row.items.push(el); else rows.push({y:el.y_pct||0, items:[el]});
    }
    const renderEl = (e) => {
      const elColor = e.color || textColor;
      const fs = Math.min(e.font_size||14, 48);
      if (e.role === 'button') return `<button style="background:${e.bg||accent};color:${contrastColor(e.bg||accent)};border:${e.border_width>0?`${e.border_width}px solid ${e.border_color}`:'none'};border-radius:${e.border_radius||6}px;padding:8px 20px;font-size:${Math.min(e.font_size||14,16)}px;font-weight:600;cursor:pointer;white-space:nowrap;">${esc(e.text)}</button>`;
      if (e.role === 'input') return `<input placeholder="${esc(e.text||'')}" style="background:${e.bg||'#fff'};border:1px solid ${colors.border};border-radius:6px;padding:6px 12px;font-size:13px;outline:none;" />`;
      if (e.role === 'image') return `<div style="width:60px;height:40px;background:#e8eaed;border-radius:4px;display:inline-flex;align-items:center;justify-content:center;"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#9ca3af" stroke-width="1.5"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="M21 15l-5-5L5 21"/></svg></div>`;
      if (e.role === 'heading' || (fs >= 24 && e.font_weight >= 700)) return `<h2 style="color:${elColor};font-size:${fs}px;font-weight:${e.font_weight||700};margin:0;line-height:1.2;">${esc(e.text)}</h2>`;
      if (e.role === 'subheading' || (fs >= 18 && e.font_weight >= 600)) return `<h3 style="color:${elColor};font-size:${fs}px;font-weight:${e.font_weight||600};margin:0;">${esc(e.text)}</h3>`;
      return `<span style="color:${elColor};font-size:${fs}px;font-weight:${e.font_weight||400};">${esc(e.text)}</span>`;
    };
    const rowsHTML = rows.map(row => {
      const items = row.items.sort((a,b)=>(a.x_pct||0)-(b.x_pct||0));
      // Single large heading gets its own centered block
      if (items.length === 1 && (items[0].role === 'heading' || (items[0].font_size >= 24 && items[0].font_weight >= 700))) {
        return `<div style="width:100%;text-align:center;padding:8px 0;">${renderEl(items[0])}</div>`;
      }
      return `<div style="display:flex;align-items:center;gap:0.75rem;padding:4px 0;flex-wrap:wrap;">${items.map(renderEl).join('')}</div>`;
    }).join('\n    ');

    contentHTML = `<section style="background:${contentBg};padding:2rem;display:flex;flex-direction:column;align-items:center;max-width:1280px;margin:0 auto;width:100%;">
  ${searchHTML}
  ${filterHTML}
  ${rowsHTML}
  ${toolbarHTML}
</section>`;
  }

  // --- Step 7: FOOTER ---
  let footerHTML = '';
  if (footer?.elements?.length) {
    const footerBg = footer.bg || (isDark ? darken(bg,8) : '#f9fafb');
    const footerEls = footer.elements.filter(e => e.role !== 'button' && e.role !== 'select' && e.role !== 'image');
    const footerBtns = footer.elements.filter(e => e.role === 'button');
    const footerSelects = footer.elements.filter(e => e.role === 'select');
    footerHTML = `<footer style="background:${footerBg};padding:1rem 2rem;display:flex;align-items:center;gap:1.5rem;flex-wrap:wrap;border-top:1px solid ${colors.border};">
  ${footerSelects.map(e=>`<select style="background:${e.bg||'#fff'};border:1px solid ${colors.border};border-radius:${e.border_radius||6}px;padding:5px 10px;font-size:13px;cursor:pointer;outline:none;"><option>${esc(e.text||'')}</option></select>`).join('')}
  ${footerEls.sort((a,b)=>(a.x_pct||0)-(b.x_pct||0)).map(e=>`<span style="color:${e.color||mutedColor};font-size:${Math.min(e.font_size||14,16)}px;font-weight:${e.font_weight||400};">${esc(e.text)}</span>`).join('')}
  <div style="margin-left:auto;display:flex;gap:0.5rem;">
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
}
body { font-family: ${bodyFont}; background: var(--bg); color: var(--text); min-height: 100vh; }
a { color: var(--accent); text-decoration: none; }
a:hover { opacity: 0.8; }
button { font-family: inherit; transition: opacity 0.15s, transform 0.1s, box-shadow 0.15s; }
button:hover { opacity: 0.9; cursor: pointer; transform: translateY(-1px); }
button:active { transform: scale(0.97) translateY(0); }
input:focus, select:focus { outline: 2px solid var(--accent); box-shadow: 0 0 0 3px ${accent}22; }
nav a:hover { background: rgba(128,128,128,0.08); }
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
${navHTML}
${heroHTML}
${contentHTML}
${footerHTML}
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
    const semanticHTML = zones?.zones?.length ? buildSemanticFromZones(zones, pageKind, image) : null;
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
          return { meta: sceneGraph.meta || {}, zones: sceneGraph.zones || [], nodes, edges };
        })();
        const snippetPayload = snippets.slice(0, 80).map((s) => ({
          sourceId: s.sourceId,
          semanticType: s.semanticType,
          kind: s.kind,
          html: s.html,
        }));

        const prompt = [
          'You are assembling a faithful HTML replica from detected UI elements.',
          '',
          'INPUTS:',
          `- page_kind: ${pageKind}`,
          `- image_size: ${image?.width || '?'}x${image?.height || '?'}`,
          `- palette: ${JSON.stringify(palette)}`,
          `- scene_graph (compact): ${JSON.stringify(compactGraph)}`,
          `- snippets (verbatim; do NOT edit their inline styles/text): ${JSON.stringify(snippetPayload)}`,
          '',
          'GOAL:',
          '- Produce a single complete HTML document with <nav>, <main>, <footer> wrappers based on zones.',
          '- Prefer flex/grid layout for wrappers, but it is OK that the provided snippets use absolute positioning internally.',
          '- Keep every snippet present exactly once (by data-source-id).',
          '- Do NOT paraphrase or change text; do NOT invent colors not in palette.',
          '',
          'OUTPUT:',
          'Return ONLY the complete HTML document starting with <!DOCTYPE html>.',
        ].join('\n');

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
