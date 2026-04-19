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

function buildZoneAwarePrompt(zones, pageKind, baseHTML) {
  const palette = zones?.palette || {};
  const zoneList = zones?.zones || [];
  const layout = zones?.layout || 'single-column';

  const zoneDesc = zoneList.map(z => {
    const elDesc = z.elements.map(e => {
      if (e.role === 'button') return `  [button bg=${e.bg}] "${e.text}"`;
      if (e.role === 'input') return `  [input] "${e.text}"`;
      return `  [${e.role} fs=${e.font_size}px fw=${e.font_weight} color=${e.color}] "${e.text}"`;
    }).join('\n');
    return `ZONE: ${z.zone} (bg=${z.bg})\n${elDesc}`;
  }).join('\n\n');

  return `You are an expert frontend developer. Enhance this ${pageKind} UI HTML to be production-quality.

DETECTED ZONES AND ELEMENTS:
${zoneDesc}

COLOR PALETTE:
- Background: ${palette.background}
- Theme: ${palette.theme}
- Accent: ${palette.accent}
- Text: ${palette.text}
- Muted: ${palette.muted}
- Layout: ${layout}

CURRENT BASE HTML (improve this):
${baseHTML.slice(0, 1500)}

REQUIREMENTS:
- Keep ALL detected text content exactly as-is
- Keep the same color scheme (background: ${palette.background})
- Use semantic HTML: nav, main, section, footer, button, input
- Use flexbox/grid layout — NO position:absolute
- Add proper typography, spacing, hover effects, transitions
- Make it look polished and professional
- For ${palette.theme} theme: use appropriate contrast
- Buttons must show text on ONE line with proper padding
- Group elements by zone: navbar at top, hero/content in middle, footer at bottom

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
function isGarbage(text) {
  if (!text) return true;
  if (OCR_GARBAGE.test(text.trim())) return true;
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
  const layout = zones.layout || 'single-column';

  const zoneMap = {};
  for (const z of zones.zones) zoneMap[z.zone] = z;

  // Filter garbage from all zone elements + deduplicate across zones
  const seenTexts = new Set();
  for (const z of Object.values(zoneMap)) {
    z.elements = (z.elements || []).filter(e => {
      if (isGarbage(e.text)) return false;
      // Drop known OCR artifacts
      if (/^README\s+[a-z]$/i.test(e.text)) return false;
      return true;
    });
  }

  // Remove nav button duplicates — if same text exists as nav-link, drop the button
  const navLinkTexts = new Set((zoneMap['navbar']?.elements || [])
    .filter(e => e.role === 'nav-links').map(e => e.text));
  if (zoneMap['navbar']) {
    zoneMap['navbar'].elements = zoneMap['navbar'].elements.filter(e =>
      e.role !== 'button' || !navLinkTexts.has(e.text)
    );
  }

  // Deduplicate content: if same text in both main (x<0.65) and sidebar (x>=0.65), keep only one
  if (zoneMap['content']) {
    const mainTexts = new Set(zoneMap['content'].elements
      .filter(e => (e.x_pct||0) < 0.65).map(e => e.text));
    zoneMap['content'].elements = zoneMap['content'].elements.filter(e => {
      if ((e.x_pct||0) >= 0.65 && mainTexts.has(e.text)) return false;
      return true;
    });
  }

  const navbar = zoneMap['navbar'];
  const contentZone = zoneMap['content'];
  const footer = zoneMap['footer'];

  const NAV_TAB_WORDS = /^(code|issues|pull|actions|projects|wiki|security|insights|settings|requests)$/i;

  // NAV — logo is leftmost non-tab element
  const navBg = navbar?.bg || (theme === 'dark' ? '#1c1a2a' : '#24292f');
  const navTextColor = theme === 'dark' ? '#f0f0f0' : '#cdd9e5';
  const navEls = (navbar?.elements || []).sort((a,b) => (a.x_pct||0)-(b.x_pct||0));
  const logoEl = navEls.find(e => e.role === 'logo' && (e.x_pct||0) < 0.15 && !NAV_TAB_WORDS.test(e.text));
  const navLinks = navEls.filter(e => e.role === 'nav-links' && e !== logoEl);
  const navActions = navEls.filter(e => e.role === 'nav-actions');
  const navButtons = navEls.filter(e => e.role === 'button');
  const navInputs = navEls.filter(e => e.role === 'input');

  const navHTML = `<nav style="background:${navBg};display:flex;align-items:center;padding:0 2rem;height:64px;gap:1.5rem;border-bottom:1px solid rgba(128,128,128,0.2);">
  ${logoEl ? `<span style="color:${logoEl.color};font-size:${Math.min(logoEl.font_size||18,22)}px;font-weight:700;white-space:nowrap;flex-shrink:0;">${esc(logoEl.text)}</span>` : ''}
  ${navInputs.map(e => `<input placeholder="${esc(e.text||'Search')}" style="background:rgba(255,255,255,0.1);border:1px solid rgba(255,255,255,0.2);border-radius:6px;padding:5px 12px;font-size:13px;color:${navTextColor};outline:none;width:220px;" />`).join('')}
  <div style="display:flex;align-items:center;gap:0.25rem;flex:1;">
    ${navLinks.map(e => `<a href="#" style="color:${e.color||navTextColor};font-size:${Math.min(e.font_size||14,16)}px;font-weight:${e.font_weight||500};padding:6px 12px;text-decoration:none;border-radius:6px;white-space:nowrap;transition:color 0.15s;">${esc(e.text)}</a>`).join('')}
  </div>
  <div style="display:flex;align-items:center;gap:0.5rem;">
    ${navActions.map(e => `<a href="#" style="color:${e.color||navTextColor};font-size:${Math.min(e.font_size||14,15)}px;font-weight:${e.font_weight||500};padding:6px 12px;text-decoration:none;white-space:nowrap;">${esc(e.text)}</a>`).join('')}
    ${navButtons.map(e => `<button style="background:${e.bg||accent};color:${contrastColor(e.bg||accent)};border:none;border-radius:${e.border_radius||8}px;padding:8px 18px;font-size:14px;font-weight:600;cursor:pointer;white-space:nowrap;">${esc(e.text)}</button>`).join('')}
  </div>
</nav>`;

  // HERO — find large headings from content zone (font_size >= 40, clearly a hero heading)
  let heroHTML = '';
  const heroZone = zoneMap['hero'];

  let heroEls = heroZone?.elements || [];
  let promotedHeadings = [];
  if (!heroEls.length && contentZone?.elements?.length) {
    // Only promote very large headings (font_size >= 40) — not subtitles
    promotedHeadings = contentZone.elements.filter(e =>
      e.font_size >= 40 && e.font_weight >= 700 && e.role !== 'sidebar-text'
    );
    heroEls = promotedHeadings;
  }

  if (heroEls.length) {
    const heroBg = heroZone?.bg || contentZone?.bg || bg;
    const headings = heroEls.filter(e => e.role === 'heading' || e.font_size >= 40 || (e.font_size >= 28 && e.font_weight >= 700));
    const subheadings = heroEls.filter(e => !headings.includes(e) && (e.role === 'subheading' || e.font_size >= 18));
    const bodyEls = heroEls.filter(e => !headings.includes(e) && !subheadings.includes(e));
    const heroBtns = heroEls.filter(e => e.role === 'button');

    // Join multiple headings into one sentence (staggered hero text design)
    const headingText = headings.map(e => e.text).join(' ');
    const headingColor = headings[0]?.color || textColor;
    const headingSize = Math.max(...headings.map(e => e.font_size || 14));
    const headingWeight = Math.max(...headings.map(e => e.font_weight || 700));

    heroHTML = `<section style="background:${heroBg};padding:4rem 2rem;display:flex;flex-direction:column;align-items:center;text-align:center;gap:1.25rem;">
  ${headingText ? `<h1 style="color:${headingColor};font-size:${headingSize}px;font-weight:${headingWeight};line-height:1.1;letter-spacing:-0.02em;margin:0;max-width:900px;">${esc(headingText)}</h1>` : ''}
  ${subheadings.map(e => `<h2 style="color:${e.color};font-size:${e.font_size}px;font-weight:${e.font_weight||600};line-height:1.3;margin:0;max-width:700px;">${esc(e.text)}</h2>`).join('')}
  ${bodyEls.map(e => `<p style="color:${e.color};font-size:${e.font_size||16}px;line-height:1.6;margin:0;max-width:600px;">${esc(e.text)}</p>`).join('')}
  ${heroBtns.length ? `<div style="display:flex;gap:1rem;flex-wrap:wrap;justify-content:center;margin-top:0.5rem;">${heroBtns.map(e => `<button style="background:${e.bg||accent};color:${contrastColor(e.bg||accent)};border:none;border-radius:${e.border_radius||50}px;padding:14px 32px;font-size:16px;font-weight:600;cursor:pointer;white-space:nowrap;">${esc(e.text)}</button>`).join('')}</div>` : ''}
</section>`;
  }

  // Remove promoted headings from content zone so they don't render twice
  const contentZoneRef = contentZone;
  if (contentZoneRef && promotedHeadings.length) {
    contentZoneRef.elements = contentZoneRef.elements.filter(e => !promotedHeadings.includes(e));
  }

  // CONTENT
  let contentHTML = '';
  if (contentZoneRef?.elements?.length) {
    const contentBg = contentZoneRef.bg || bg;
    const midX = 0.65;
    const mainEls = contentZoneRef.elements.filter(e => (e.x_pct || 0) < midX);
    const sideEls = contentZoneRef.elements.filter(e => (e.x_pct || 0) >= midX);

    const renderEl = (e) => {
      if (e.role === 'button') return `<button style="background:${e.bg||accent};color:${contrastColor(e.bg||accent)};border:none;border-radius:${e.border_radius||6}px;padding:6px 16px;font-size:${Math.min(e.font_size||13,16)}px;font-weight:600;cursor:pointer;white-space:nowrap;">${esc(e.text)}</button>`;
      if (e.role === 'input') return `<input placeholder="${esc(e.text||'')}" style="background:${e.bg||'#fff'};border:1px solid ${e.border||'#d0d7de'};border-radius:6px;padding:5px 10px;font-size:13px;outline:none;" />`;
      const fs = Math.min(e.font_size||14, 32); // cap font size for content text
      if (fs >= 20 && e.font_weight >= 600) return `<h3 style="color:${e.color};font-size:${fs}px;font-weight:${e.font_weight};margin:0;white-space:nowrap;">${esc(e.text)}</h3>`;
      return `<span style="color:${e.color};font-size:${fs}px;font-weight:${e.font_weight||400};white-space:nowrap;">${esc(e.text)}</span>`;
    };

    // Group main elements into rows by y_pct proximity
    const rows = [];
    for (const el of mainEls.sort((a,b) => (a.y_pct||0) - (b.y_pct||0))) {
      const row = rows.find(r => Math.abs(r.y - (el.y_pct||0)) < 0.03);
      if (row) row.items.push(el);
      else rows.push({ y: el.y_pct||0, items: [el] });
    }

    const mainContent = rows.map(row =>
      `<div style="display:flex;align-items:center;gap:0.75rem;padding:4px 0;flex-wrap:wrap;">${row.items.sort((a,b)=>(a.x_pct||0)-(b.x_pct||0)).map(renderEl).join('')}</div>`
    ).join('\n    ');

    const sideContent = sideEls.sort((a,b)=>(a.y_pct||0)-(b.y_pct||0)).map(renderEl).join('\n    ');

    if (layout === 'two-column' && sideEls.length) {
      contentHTML = `<div style="background:${contentBg};display:grid;grid-template-columns:1fr 280px;gap:1.5rem;padding:1.5rem 2rem;max-width:1280px;margin:0 auto;">
  <div style="display:flex;flex-direction:column;gap:0.5rem;">${mainContent}</div>
  <aside style="display:flex;flex-direction:column;gap:0.5rem;">${sideContent}</aside>
</div>`;
    } else {
      contentHTML = `<section style="background:${contentBg};padding:1.5rem 2rem;display:flex;flex-direction:column;gap:0.5rem;max-width:1280px;margin:0 auto;">
  ${mainContent}
  ${sideContent}
</section>`;
    }
  }

  // FOOTER
  let footerHTML = '';
  if (footer?.elements?.length) {
    const footerBg = footer.bg || (theme === 'dark' ? '#1a1828' : '#f6f8fa');
    footerHTML = `<footer style="background:${footerBg};padding:1.25rem 2rem;display:flex;align-items:center;gap:2rem;flex-wrap:wrap;border-top:1px solid rgba(128,128,128,0.15);">
  ${footer.elements.sort((a,b)=>(a.x_pct||0)-(b.x_pct||0)).map(e =>
    `<span style="color:${e.color||mutedColor};font-size:${e.font_size||14}px;font-weight:${e.font_weight||400};">${esc(e.text)}</span>`
  ).join('')}
</footer>`;
  }

  // CSS
  const css = `*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
body {
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif;
  background: ${bg};
  color: ${textColor};
  min-height: 100vh;
}
a { color: ${accent}; text-decoration: none; }
a:hover { opacity: 0.8; }
button { transition: opacity 0.15s, transform 0.1s; }
button:hover { opacity: 0.9; cursor: pointer; }
button:active { transform: scale(0.97); }
input:focus { outline: 2px solid ${accent}; box-shadow: 0 0 0 3px ${accent}33; }
nav a:hover { background: rgba(128,128,128,0.1); border-radius: 6px; }`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Screen Reconstruction</title>
  <style>
${css}
  </style>
</head>
<body>
${navHTML}
${heroHTML}
${contentHTML}
${footerHTML}
</body>
</html>
`;
}

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
  static async refineHTML(baseHTML, detectedElements, image, pageKind = 'generic', zones = null, imagePath = null) {
    const semanticHTML = zones?.zones?.length ? buildSemanticFromZones(zones, pageKind, image) : null;
    const workingHTML = semanticHTML || baseHTML;

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
