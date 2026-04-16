import Anthropic from '@anthropic-ai/sdk';

const OLLAMA_URL = process.env.OLLAMA_URL || 'http://localhost:11434';

/**
 * Divide image into overlapping regions for better detection
 * Strategy: 2x2 grid with 20% overlap to catch border elements
 */
export function calculateRegions(width, height) {
  const overlap = 0.2; // 20% overlap
  const regionWidth = Math.floor(width / 2 * (1 + overlap));
  const regionHeight = Math.floor(height / 2 * (1 + overlap));
  
  return [
    { id: 'top-left', x: 0, y: 0, width: regionWidth, height: regionHeight },
    { id: 'top-right', x: Math.floor(width / 2 * (1 - overlap)), y: 0, width: regionWidth, height: regionHeight },
    { id: 'bottom-left', x: 0, y: Math.floor(height / 2 * (1 - overlap)), width: regionWidth, height: regionHeight },
    { id: 'bottom-right', x: Math.floor(width / 2 * (1 - overlap)), y: Math.floor(height / 2 * (1 - overlap)), width: regionWidth, height: regionHeight },
  ];
}

/**
 * Merge elements from different regions, removing duplicates
 */
export function mergeRegionElements(regionResults, imageWidth, imageHeight) {
  const allElements = [];
  const seen = new Set();
  
  for (const result of regionResults) {
    const { region, elements } = result;
    
    for (const el of elements) {
      // Adjust coordinates to global space
      const globalEl = {
        ...el,
        x: el.x + region.x,
        y: el.y + region.y,
      };
      
      // Create signature for deduplication
      const sig = `${globalEl.kind}-${Math.round(globalEl.x / 10)}-${Math.round(globalEl.y / 10)}-${Math.round(globalEl.width / 10)}-${Math.round(globalEl.height / 10)}`;
      
      if (!seen.has(sig)) {
        seen.add(sig);
        allElements.push(globalEl);
      }
    }
  }
  
  return allElements;
}

/**
 * Use Ollama to analyze element relationships and improve layout
 */
export async function analyzeLayoutWithOllama(elements, imageInfo) {
  try {
    const prompt = `Analyze this UI layout and provide improvements:

Image: ${imageInfo.width}x${imageInfo.height}
Elements detected: ${elements.length}

Element summary:
${elements.slice(0, 20).map(el => `- ${el.type || el.kind} at (${el.x},${el.y}) ${el.width}x${el.height}${el.text ? `: "${el.text}"` : ''}`).join('\n')}

Identify:
1. Missing borders between components
2. Overlapping text issues
3. Container groupings
4. Proper z-index layering

Return JSON: {"borders": [{"between": ["elem1", "elem2"], "style": "1px solid #ddd"}], "groups": [{"type": "container", "elements": []}], "fixes": [{"issue": "", "fix": ""}]}`;

    const response = await fetch(`${OLLAMA_URL}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'llama3.2',
        prompt,
        stream: false,
        options: { temperature: 0.3, num_predict: 500 }
      })
    });

    if (!response.ok) return null;
    
    const data = await response.json();
    const text = data.response || '';
    
    // Extract JSON from response
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      return JSON.parse(jsonMatch[0]);
    }
  } catch (error) {
    console.error('Ollama analysis error:', error.message);
  }
  
  return null;
}

/**
 * Apply layout improvements from Ollama analysis
 */
export function applyLayoutImprovements(elements, analysis) {
  if (!analysis) return elements;
  
  const improved = [...elements];
  
  // Add missing borders
  if (analysis.borders) {
    for (const border of analysis.borders) {
      // Find adjacent elements and add border styling
      // This would be applied in the rendering phase
    }
  }
  
  // Fix overlapping text by adjusting z-index
  if (analysis.fixes) {
    for (const fix of analysis.fixes) {
      if (fix.issue.includes('overlap')) {
        // Adjust z-index for overlapping elements
        const textElements = improved.filter(el => el.kind === 'text');
        textElements.forEach(el => {
          if (el.z_index < 20) el.z_index += 5;
        });
      }
    }
  }
  
  return improved;
}
