import DetectionService from './detectionService.js';
import { ComponentService } from './componentService.js';
import { LayoutRefiner } from './layoutRefiner.js';

function logElements(elements) {
  for (const element of elements) {
    const label = element.text ? `"${element.text}"` : '(no text)';
    console.log(`  ${element.type}: ${label} @ (${element.x}, ${element.y}) ${element.width}x${element.height}`);
  }
}

export async function generateCode(imagePath) {
  console.log('='.repeat(60));
  console.log('STAGE 1: DETECTING UI ELEMENTS (Python/OpenCV/OCR)');
  console.log('='.repeat(60));

  const detection = await DetectionService.detectElements(imagePath);

  // Stage 1b: Ollama layout refinement (identify page type, suppress noise)
  const refinement = await LayoutRefiner.refine(detection);
  const hiddenIds = new Set(refinement.hide_shape_ids || []);
  const detectedElements = (detection.components || []).filter((element) => {
    if (element.kind !== 'shape') return true;
    return !hiddenIds.has(element.id);
  });
  const image = detection.image || { width: 1440, height: 900 };

  console.log(`Detected ${detectedElements.length} elements`);
  if (refinement.page_kind && refinement.page_kind !== 'generic') {
    console.log(`Page kind: ${refinement.page_kind}`);
  }
  if (hiddenIds.size > 0) {
    console.log(`Suppressed ${hiddenIds.size} noisy shapes`);
  }
  logElements(detectedElements);

  if (detectedElements.length === 0) return getFallbackCode();

  console.log('\n' + '='.repeat(60));
  console.log('STAGE 2: NORMALIZING FOR RENDERING');
  console.log('='.repeat(60));

  const processed = ComponentService.processElements(detectedElements, image, refinement);
  console.log(`Prepared ${processed.elements.length} renderable elements`);

  console.log('\n' + '='.repeat(60));
  console.log('STAGE 3: GENERATING BASE HTML/CSS (ComponentService)');
  console.log('='.repeat(60));

  const baseHTML = ComponentService.generateHTML(processed);
  console.log(`Base HTML: ${baseHTML.length} chars`);

  console.log('\n' + '='.repeat(60));
  console.log('STAGE 4: OLLAMA VISUAL REFINEMENT');
  console.log('='.repeat(60));

  // Ollama refines the base HTML — improves visual accuracy without changing coordinates
  const refinedHTML = await LayoutRefiner.refineHTML(
    baseHTML,
    detectedElements,
    image,
    refinement.page_kind || 'generic',
  );

  return refinedHTML;
}

function getFallbackCode() {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Generated Page</title>
  <script src="https://cdn.tailwindcss.com"></script>
  <style>
    body { margin: 0; min-height: 100vh; display: grid; place-items: center; background: #f3f4f6; font-family: "Inter", "Segoe UI", sans-serif; }
    .empty-state { padding: 32px; border-radius: 20px; background: white; box-shadow: 0 16px 40px rgba(15,23,42,0.12); color: #111827; }
  </style>
</head>
<body>
  <div class="empty-state">
    <h1>No Elements Detected</h1>
    <p>Upload a clearer screenshot to generate a closer reconstruction.</p>
  </div>
</body>
</html>`;
}
