const OLLAMA_URL = 'http://127.0.0.1:11434/api/generate';
const OLLAMA_MODEL = process.env.OLLAMA_LAYOUT_MODEL || 'llama3.2';

function safeJsonParse(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
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
  const shapes = components
    .filter((element) => element.kind === 'shape')
    .slice(0, 24)
    .map(compactElement);
  const texts = components
    .filter((element) => element.kind === 'text')
    .slice(0, 28)
    .map(compactElement);

  return [
    'You are refining screenshot-to-code layout detection.',
    'Your task is only to identify the page type and obvious noisy shape detections.',
    'Do not rewrite text. Do not invent new elements.',
    'Return strict JSON with this schema only:',
    '{"page_kind":"generic|repository|dashboard|form|landing|docs","hide_shape_ids":[number],"notes":[string]}',
    'Hide only shapes that are clearly false positive controls or decorative boxes.',
    'Prefer keeping real buttons, real inputs, and large panels.',
    `Image: ${JSON.stringify(image)}`,
    `Shapes: ${JSON.stringify(shapes)}`,
    `Texts: ${JSON.stringify(texts)}`,
  ].join('\n');
}

export class LayoutRefiner {
  static async refine(detection) {
    const components = detection?.components || [];
    if (components.length < 24) {
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
          options: {
            temperature: 0.1,
            top_p: 0.9,
            num_predict: 120,
          },
        }),
        signal: AbortSignal.timeout(16000),
      });

      if (!response.ok) {
        throw new Error(`Ollama refine failed with ${response.status}`);
      }

      const payload = await response.json();
      const parsed = safeJsonParse(payload.response || '');
      if (!parsed || typeof parsed !== 'object') {
        throw new Error('Invalid layout refinement JSON');
      }

      return {
        page_kind: parsed.page_kind || 'generic',
        hide_shape_ids: Array.isArray(parsed.hide_shape_ids)
          ? parsed.hide_shape_ids.filter((value) => Number.isInteger(value))
          : [],
        notes: Array.isArray(parsed.notes) ? parsed.notes.slice(0, 6) : [],
      };
    } catch (error) {
      console.warn('Layout refinement skipped:', error.message);
      return { page_kind: 'generic', hide_shape_ids: [], notes: [] };
    }
  }
}

export default LayoutRefiner;
