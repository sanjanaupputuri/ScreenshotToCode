const OLLAMA_URL = 'http://127.0.0.1:11434/api/generate';
const OLLAMA_MODEL = process.env.OLLAMA_LAYOUT_MODEL || 'llama3.2';

function safeJsonParse(text) {
  try { return JSON.parse(text); } catch {}
  const match = text.match(/\{[\s\S]*\}/);
  if (match) { try { return JSON.parse(match[0]); } catch {} }
  return null;
}

function compactElement(element) {
  return {
    id: element.id,
    kind: element.kind,
    type: element.type,
    text: (element.text || '').slice(0, 80),
    x: element.x,
    y: element.y,
    width: element.width,
    height: element.height,
    background_color: element.background_color,
    border_width: element.border_width,
    parent_id: element.parent_id ?? null,
  };
}

function buildPrompt(components = [], image = {}) {
  // Keep prompt tiny — only top texts and a few shapes
  const texts = components
    .filter((e) => e.kind === 'text' && e.text)
    .slice(0, 12)
    .map((e) => e.text.slice(0, 60));
  const shapes = components
    .filter((e) => e.kind === 'shape')
    .slice(0, 8)
    .map((e) => `${e.type}(${e.x},${e.y},${e.width}x${e.height})`);

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
          prompt: buildPrompt(components, detection?.image || {}),
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
        hide_shape_ids: Array.isArray(parsed.hide_shape_ids)
          ? parsed.hide_shape_ids.filter((v) => Number.isInteger(v))
          : [],
        notes: Array.isArray(parsed.notes) ? parsed.notes.slice(0, 6) : [],
      };
    } catch (error) {
      console.warn('Layout refinement skipped:', error.message);
      return { page_kind: 'generic', hide_shape_ids: [], notes: [] };
    }
  }

  // Ollama refines the base HTML — improves visual accuracy without changing coordinates
  static async refineHTML(baseHTML, detectedElements, image, pageKind = 'generic') {
    // Build a compact summary of what was detected — don't send full HTML (too large)
    const texts = detectedElements
      .filter((e) => e.kind === 'text' && e.text)
      .slice(0, 20)
      .map((e) => `"${e.text.slice(0,40)}" at (${e.x},${e.y})`);

    const shapes = detectedElements
      .filter((e) => e.kind === 'shape')
      .slice(0, 15)
      .map((e) => `${e.type}(${e.x},${e.y},${e.width}x${e.height},bg:${e.background_color||'?'})`);

    // Extract just the CSS style block from base HTML for Ollama to improve
    const styleMatch = baseHTML.match(/<style>([\s\S]*?)<\/style>/);
    const currentCSS = styleMatch ? styleMatch[1].trim().slice(0, 1500) : '';

    const prompt = [
      `You are improving CSS for a ${pageKind} UI screenshot reconstruction (${image.width}x${image.height}px).`,
      'Return ONLY an improved <style> block. Keep all existing rules, only improve:',
      '- body background color accuracy',
      '- font-family to match the page type',
      '- any obvious color/contrast fixes',
      'Do NOT change any position/size values.',
      `Detected texts: ${texts.join(', ')}`,
      `Detected shapes: ${shapes.join(', ')}`,
      `Current CSS:\n${currentCSS}`,
      'Return ONLY the <style>...</style> block.',
    ].join('\n');

    try {
      const response = await fetch(OLLAMA_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: OLLAMA_MODEL,
          prompt,
          stream: false,
          options: { temperature: 0.15, top_p: 0.9, num_predict: 800 },
        }),
        signal: AbortSignal.timeout(60000),
      });

      if (!response.ok) throw new Error(`Ollama HTML refine failed: ${response.status}`);

      const payload = await response.json();
      const refined = (payload.response || '').trim();

      // Extract the style block — Ollama may or may not wrap in <style> tags
      let newCSS = '';
      const newStyleMatch = refined.match(/<style>([\s\S]*?)<\/style>/);
      if (newStyleMatch) {
        newCSS = newStyleMatch[1];
      } else if (refined.includes('{') && refined.includes('}')) {
        // Ollama returned raw CSS without tags
        newCSS = refined;
      } else {
        throw new Error('Ollama did not return usable CSS');
      }

      // Splice the improved CSS into the base HTML
      const improvedHTML = baseHTML.replace(/<style>[\s\S]*?<\/style>/, `<style>${newCSS}</style>`);
      console.log(`  ✅ Ollama CSS refinement applied (${baseHTML.length} → ${improvedHTML.length} chars)`);
      return improvedHTML;
    } catch (error) {
      console.warn('  ⚠️  HTML refinement skipped:', error.message);
      return baseHTML;
    }
  }
}

export default LayoutRefiner;
