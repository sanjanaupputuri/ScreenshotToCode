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

function buildSemanticFromZones(zones, pageKind, image) {
  if (!zones?.zones?.length) return null; // fallback to base HTML

  const palette = zones.palette || {};
  const bg = palette.background || '#ffffff';
  const theme = palette.theme || 'light';
  const accent = palette.accent || (theme === 'dark' ? '#ff4a36' : '#0969da');
  const textColor = palette.text || (theme === 'dark' ? '#f0f0f0' : '#1f2328');
  const mutedColor = palette.muted || (theme === 'dark' ? '#aaaacc' : '#57606a');
  const layout = zones.layout || 'single-column';

  const zoneMap = {};
  for (const z of zones.zones) zoneMap[z.zone] = z;

  const navbar = zoneMap['navbar'];
  const hero = zoneMap['hero'];
  const content = zoneMap['content'];
  const footer = zoneMap['footer'];

  // NAV
  const navBg = navbar?.bg || (theme === 'dark' ? '#1c1a2a' : '#24292f');
  const navTextColor = theme === 'dark' ? '#f0f0f0' : '#cdd9e5';
  let logoEl = navbar?.elements?.find(e => e.role === 'logo');
  let navLinks = navbar?.elements?.filter(e => e.role === 'nav-links') || [];
  let navActions = navbar?.elements?.filter(e => e.role === 'nav-actions') || [];
  let navButtons = navbar?.elements?.filter(e => e.role === 'button') || [];
  let navInputs = navbar?.elements?.filter(e => e.role === 'input') || [];

  const navHTML = `<nav style="background:${navBg};display:flex;align-items:center;padding:0 2rem;height:64px;gap:1.5rem;border-bottom:1px solid rgba(128,128,128,0.2);">
  ${logoEl ? `<span style="color:${logoEl.color};font-size:${Math.min(logoEl.font_size||18,22)}px;font-weight:700;white-space:nowrap;flex-shrink:0;">${esc(logoEl.text)}</span>` : ''}
  ${navInputs.map(e => `<input placeholder="${esc(e.text||'Search')}" style="background:rgba(255,255,255,0.1);border:1px solid rgba(255,255,255,0.2);border-radius:6px;padding:5px 12px;font-size:13px;color:${navTextColor};outline:none;width:220px;" />`).join('')}
  <div style="display:flex;align-items:center;gap:0.25rem;flex:1;">
    ${navLinks.map(e => `<a href="#" style="color:${e.color||navTextColor};font-size:${Math.min(e.font_size||14,16)}px;font-weight:${e.font_weight||500};padding:6px 12px;text-decoration:none;border-radius:6px;white-space:nowrap;transition:color 0.15s;">${esc(e.text)}</a>`).join('')}
  </div>
  <div style="display:flex;align-items:center;gap:0.5rem;">
    ${navActions.map(e => `<a href="#" style="color:${e.color||navTextColor};font-size:${Math.min(e.font_size||14,15)}px;font-weight:${e.font_weight||500};padding:6px 12px;text-decoration:none;white-space:nowrap;">${esc(e.text)}</a>`).join('')}
    ${navButtons.map(e => `<button style="background:${e.bg||accent};color:${e.color||'#fff'};border:none;border-radius:${e.border_radius||8}px;padding:8px 18px;font-size:14px;font-weight:600;cursor:pointer;white-space:nowrap;">${esc(e.text)}</button>`).join('')}
  </div>
</nav>`;

  // HERO
  let heroHTML = '';
  if (hero?.elements?.length) {
    const heroBg = hero.bg || bg;
    const headings = hero.elements.filter(e => e.role === 'heading');
    const subheadings = hero.elements.filter(e => e.role === 'subheading');
    const bodyEls = hero.elements.filter(e => e.role === 'body' || e.role === 'cta-label');
    const heroBtns = hero.elements.filter(e => e.role === 'button');

    heroHTML = `<section style="background:${heroBg};padding:4rem 2rem;display:flex;flex-direction:column;align-items:center;text-align:center;gap:1.25rem;">
  ${headings.map(e => `<h1 style="color:${e.color};font-size:clamp(2.5rem,6vw,${e.font_size}px);font-weight:${e.font_weight||800};line-height:1.1;letter-spacing:-0.02em;margin:0;">${esc(e.text)}</h1>`).join('')}
  ${subheadings.map(e => `<h2 style="color:${e.color};font-size:clamp(1.1rem,2.5vw,${e.font_size}px);font-weight:${e.font_weight||600};line-height:1.3;margin:0;max-width:700px;">${esc(e.text)}</h2>`).join('')}
  ${bodyEls.map(e => `<p style="color:${e.color};font-size:${e.font_size||16}px;font-weight:${e.font_weight||400};line-height:1.6;margin:0;max-width:600px;">${esc(e.text)}</p>`).join('')}
  ${heroBtns.length ? `<div style="display:flex;gap:1rem;flex-wrap:wrap;justify-content:center;margin-top:0.5rem;">${heroBtns.map(e => `<button style="background:${e.bg||accent};color:${e.color||'#fff'};border:none;border-radius:${e.border_radius||50}px;padding:14px 32px;font-size:16px;font-weight:600;cursor:pointer;white-space:nowrap;">${esc(e.text)}</button>`).join('')}</div>` : ''}
</section>`;
  }

  // CONTENT
  let contentHTML = '';
  if (content?.elements?.length) {
    const contentBg = content.bg || bg;
    const midX = 0.65; // sidebar split
    const mainEls = content.elements.filter(e => (e.x_pct || 0) < midX);
    const sideEls = content.elements.filter(e => (e.x_pct || 0) >= midX);

    const renderEl = (e) => {
      if (e.role === 'button') return `<button style="background:${e.bg||accent};color:${e.color||'#fff'};border:none;border-radius:${e.border_radius||6}px;padding:6px 16px;font-size:${e.font_size||13}px;font-weight:600;cursor:pointer;white-space:nowrap;">${esc(e.text)}</button>`;
      if (e.role === 'input') return `<input placeholder="${esc(e.text||'')}" style="background:${e.bg||'#fff'};border:1px solid ${e.border||'#d0d7de'};border-radius:6px;padding:5px 10px;font-size:13px;outline:none;" />`;
      if (e.role === 'section-title') return `<h3 style="color:${e.color};font-size:${e.font_size||16}px;font-weight:${e.font_weight||700};margin:0;">${esc(e.text)}</h3>`;
      return `<span style="color:${e.color};font-size:${e.font_size||14}px;font-weight:${e.font_weight||400};">${esc(e.text)}</span>`;
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

  // Stage 3: Build semantic HTML from zones (Node.js), then Ollama adds CSS polish
  static async refineHTML(baseHTML, detectedElements, image, pageKind = 'generic', zones = null) {
    // Build semantic HTML from zone data in Node.js (no AI needed for structure)
    const semanticHTML = zones?.zones?.length ? buildSemanticFromZones(zones, pageKind, image) : null;
    const workingHTML = semanticHTML || baseHTML;

    // Ollama adds CSS polish only (fast, <200 tokens)
    const cssPrompt = `Return ONLY JSON {"extra_css":"..."} with CSS for a ${pageKind} page: button hover effects, link hover, input focus, smooth transitions. Keep it minimal.`;

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
          console.log(`  ✅ Semantic HTML + Ollama CSS polish (${result.length} chars)`);
          return result;
        }
      }
    } catch (error) {
      console.warn(`  ⚠️  Ollama CSS skipped: ${error.message}`);
    }

    console.log(`  ✅ ${semanticHTML ? 'Semantic' : 'Base'} HTML generated (${workingHTML.length} chars)`);
    return workingHTML;
  }
}

export default LayoutRefiner;
