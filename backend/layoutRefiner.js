const OLLAMA_URL = 'http://127.0.0.1:11434/api/generate';
const OLLAMA_MODEL = process.env.OLLAMA_LAYOUT_MODEL || 'llama3.2';

function safeJsonParse(text) {
  try { return JSON.parse(text); } catch {}
  const match = text.match(/\{[\s\S]*\}/);
  if (match) { try { return JSON.parse(match[0]); } catch {} }
  return null;
}

function buildPageClassifyPrompt(components = []) {
  const texts = components.filter((e) => e.kind === 'text' && e.text).slice(0, 12).map((e) => e.text.slice(0, 60));
  const shapes = components.filter((e) => e.kind === 'shape').slice(0, 8).map((e) => `${e.type}(${e.x},${e.y},${e.width}x${e.height})`);
  return [
    'Identify the page type from these UI texts and return JSON only.',
    'Schema: {"page_kind":"generic|repository|dashboard|form|landing|docs","hide_shape_ids":[],"notes":[]}',
    `Texts: ${texts.join(' | ')}`,
    `Shapes: ${shapes.join(', ')}`,
    'Return ONLY the JSON.',
  ].join('\n');
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
      if (parsed.notes?.length) console.log(`  Notes: ${parsed.notes.join(' | ')}`);

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

  // Ollama's contribution: inject ADDITIVE CSS only (hover/focus states, font-family, transitions).
  // It must NOT touch the existing <style> block or any markup — coordinates and colors are fixed.
  static async refineHTML(baseHTML, detectedElements, image, pageKind = 'generic') {
    const shapes = detectedElements
      .filter((e) => e.kind === 'shape')
      .slice(0, 15)
      .map((e) => `${e.type}(bg:${e.background_color || '?'},border:${e.border_width || 0})`);

    const prompt = [
      `You are a CSS enhancement assistant for a ${pageKind} UI (${image.width}x${image.height}px).`,
      'The HTML already has pixel-accurate inline styles for all positions, sizes, and colors.',
      'Return ONLY valid JSON with a single key "extra_css".',
      '',
      'Write CSS rules that ADD to the existing styles — do NOT override position, size, color, or background.',
      'Only include:',
      '  - font-family on body (pick appropriate for page type)',
      '  - button:hover { opacity, box-shadow, cursor:pointer }',
      '  - input:focus { outline, box-shadow }',
      '  - transition on button and input',
      '',
      `Page type: ${pageKind}`,
      `Shape types present: ${shapes.join(', ')}`,
      '',
      'Return ONLY: {"extra_css":"..."}',
    ].join('\n');

    try {
      const response = await fetch(OLLAMA_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: OLLAMA_MODEL,
          prompt,
          stream: false,
          format: 'json',
          options: { temperature: 0.1, top_p: 0.9, num_predict: 400 },
        }),
        signal: AbortSignal.timeout(60000),
      });

      if (!response.ok) throw new Error(`Ollama HTML refine failed: ${response.status}`);

      const payload = await response.json();
      const parsed = safeJsonParse(payload.response || '');

      if (!parsed?.extra_css || parsed.extra_css.trim().length < 10) {
        throw new Error('No usable extra_css returned');
      }

      // Inject additive CSS just before </style> — never replaces existing rules
      const result = baseHTML.replace('</style>', `  /* Ollama enhancements */\n  ${parsed.extra_css.trim()}\n</style>`);
      console.log(`  ✅ Ollama additive CSS injected (${parsed.extra_css.trim().length} chars)`);
      return result;
    } catch (error) {
      console.warn('  ⚠️  Ollama enrichment skipped:', error.message);
      return baseHTML;
    }
  }
}

export default LayoutRefiner;
