import DetectionService from './detectionService.js';
import ComponentService from './componentService.js';

export async function generateCode(imagePath) {
  try {
    // Stage 1: OpenCV Detection (mocked)
    console.log('Stage 1: Detecting UI elements...');
    const detectedElements = await DetectionService.detectElements(imagePath);
    
    // Stage 2: SQLite Template Matching
    console.log('Stage 2: Classifying elements and matching templates...');
    const processedElements = await ComponentService.processElements(detectedElements);
    
    // Stage 3: Code Integration (simplified Ollama simulation)
    console.log('Stage 3: Generating final HTML structure...');
    const finalHTML = ComponentService.generateHTML(processedElements);
    
    // Add CSS framework
    const css = `
/* Tailwind CSS classes used */
.container { max-width: 1200px; }
.mx-auto { margin-left: auto; margin-right: auto; }
.p-4 { padding: 1rem; }
.px-4 { padding-left: 1rem; padding-right: 1rem; }
.py-2 { padding-top: 0.5rem; padding-bottom: 0.5rem; }
.flex { display: flex; }
.gap-4 { gap: 1rem; }
.rounded { border-radius: 0.375rem; }
.border { border-width: 1px; border-color: #d1d5db; }
.bg-blue-500 { background-color: #3b82f6; }
.bg-white { background-color: #ffffff; }
.text-black { color: #000000; }
.text-white { color: #ffffff; }
`;

    const fullCode = `${finalHTML}

<style>
${css}
</style>`;

    // Log processing results
    console.log(`Processed ${detectedElements.length} elements:`);
    processedElements.forEach((el, i) => {
      console.log(`  ${i + 1}. ${el.component} (${el.category}) - confidence: ${el.confidence}`);
    });

    return fullCode;
    
  } catch (error) {
    console.error('Code generation error:', error);
    
    // Fallback to simple template
    return `<div class="container mx-auto p-4">
  <h1 class="text-2xl font-bold mb-4">Generated from Screenshot</h1>
  <p class="text-gray-600">Error processing image. This is a fallback template.</p>
  <button class="bg-blue-500 text-white px-4 py-2 rounded mt-4">Sample Button</button>
</div>

<style>
.container { max-width: 1200px; margin: 0 auto; padding: 1rem; }
.text-2xl { font-size: 1.5rem; }
.font-bold { font-weight: 700; }
.mb-4 { margin-bottom: 1rem; }
.text-gray-600 { color: #6b7280; }
.bg-blue-500 { background-color: #3b82f6; }
.text-white { color: white; }
.px-4 { padding-left: 1rem; padding-right: 1rem; }
.py-2 { padding-top: 0.5rem; padding-bottom: 0.5rem; }
.rounded { border-radius: 0.375rem; }
.mt-4 { margin-top: 1rem; }
</style>`;
  }
}