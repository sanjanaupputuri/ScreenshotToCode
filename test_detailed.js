import { generateCode } from './backend/codeGenerator.js';
import fs from 'fs';

// Test both images with detailed analysis
const TESTS = [
  { name: 'Screenshot 2026-04-19 002540.png', file: 'Screenshot 2026-04-19 002540.png' },
  { name: 'Screenshot 2026-04-19 002520.png', file: 'Screenshot 2026-04-19 002520.png' }
];

async function analyzeOverlaps(htmlPath) {
  const html = fs.readFileSync(htmlPath, 'utf8');
  
  // Extract all positioned elements (buttons, inputs, divs, text)
  const elements = [];
  
  // Match buttons
  const buttonRegex = /<button[^>]*style="position:absolute;left:(\d+)px;top:(\d+)px;width:(\d+)px;height:(\d+)px[^"]*z-index:(\d+)[^"]*"[^>]*>([^<]*)<\/button>/g;
  let match;
  while ((match = buttonRegex.exec(html)) !== null) {
    elements.push({
      x: parseInt(match[1]), y: parseInt(match[2]), width: parseInt(match[3]), height: parseInt(match[4]),
      zIndex: parseInt(match[5]), content: match[6].trim(), type: 'button'
    });
  }
  
  // Match inputs
  const inputRegex = /<input[^>]*style="position:absolute;left:(\d+)px;top:(\d+)px;width:(\d+)px;height:(\d+)px[^"]*z-index:(\d+)[^"]*"/g;
  while ((match = inputRegex.exec(html)) !== null) {
    elements.push({
      x: parseInt(match[1]), y: parseInt(match[2]), width: parseInt(match[3]), height: parseInt(match[4]),
      zIndex: parseInt(match[5]), content: '', type: 'input'
    });
  }
  
  // Match divs (text and shapes)
  const divRegex = /<div[^>]*class="([^"]*)"[^>]*style="position:absolute;left:(\d+)px;top:(\d+)px;width:(\d+)px;height:(\d+)px[^"]*z-index:(\d+)[^"]*"[^>]*>([^<]*)<\/div>/g;
  while ((match = divRegex.exec(html)) !== null) {
    const className = match[1];
    elements.push({
      x: parseInt(match[2]), y: parseInt(match[3]), width: parseInt(match[4]), height: parseInt(match[5]),
      zIndex: parseInt(match[6]), content: match[7].trim(),
      type: className.includes('screen-text') ? 'text' : 'shape'
    });
  }
  
  // Find overlaps
  const overlaps = [];
  for (let i = 0; i < elements.length; i++) {
    for (let j = i + 1; j < elements.length; j++) {
      const e1 = elements[i];
      const e2 = elements[j];
      
      // Check if rectangles overlap
      if (!(e1.x + e1.width < e2.x || e2.x + e2.width < e1.x ||
            e1.y + e1.height < e2.y || e2.y + e2.height < e1.y)) {
        
        // Calculate overlap area
        const overlapX = Math.max(0, Math.min(e1.x + e1.width, e2.x + e2.width) - Math.max(e1.x, e2.x));
        const overlapY = Math.max(0, Math.min(e1.y + e1.height, e2.y + e2.height) - Math.max(e1.y, e2.y));
        const overlapArea = overlapX * overlapY;
        const overlapPercent = (overlapArea / Math.min(e1.width * e1.height, e2.width * e2.height)) * 100;
        
        if (overlapPercent > 10) { // More than 10% overlap
          overlaps.push({
            elem1: `${e1.type}(${e1.content.substring(0, 20)}) z=${e1.zIndex} @(${e1.x},${e1.y})`,
            elem2: `${e2.type}(${e2.content.substring(0, 20)}) z=${e2.zIndex} @(${e2.x},${e2.y})`,
            overlapPercent: overlapPercent.toFixed(1),
            issue: e1.zIndex >= e2.zIndex && e1.type === 'shape' && e2.type === 'text' ? '🔴 TEXT HIDDEN' :
                   e2.zIndex >= e1.zIndex && e2.type === 'shape' && e1.type === 'text' ? '🔴 TEXT HIDDEN' :
                   e1.type === 'text' && e2.type === 'text' ? '🟡 TEXT OVERLAP' : '🟢 OK'
          });
        }
      }
    }
  }
  
  return { elements, overlaps };
}

async function runDetailedTest() {
  console.log('\n' + '═'.repeat(80));
  console.log('AGGRESSIVE TESTING & ANALYSIS FRAMEWORK');
  console.log('═'.repeat(80));
  
  const results = [];
  
  for (const test of TESTS) {
    console.log(`\n${'─'.repeat(80)}`);
    console.log(`TEST: ${test.name}`);
    console.log('─'.repeat(80));
    
    // Copy test file
    fs.copyFileSync(test.file, 'backend/uploads/test_ui.png');
    
    // Generate code
    console.log('\nGenerating code...');
    const startTime = Date.now();
    const code = await generateCode('backend/uploads/test_ui.png');
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(2);
    
    const outputPath = `output_${test.name}.html`;
    fs.writeFileSync(outputPath, code);
    console.log(`✓ Generated in ${elapsed}s: ${outputPath}`);
    
    // Analyze overlaps
    const analysis = await analyzeOverlaps(outputPath);
    
    console.log(`\n📊 ELEMENT COUNT:`);
    console.log(`  Total: ${analysis.elements.length}`);
    console.log(`  Buttons: ${analysis.elements.filter(e => e.type === 'button').length}`);
    console.log(`  Text: ${analysis.elements.filter(e => e.type === 'text').length}`);
    console.log(`  Shapes: ${analysis.elements.filter(e => e.type === 'shape').length}`);
    console.log(`  Inputs: ${analysis.elements.filter(e => e.type === 'input').length}`);
    
    // Z-index analysis
    const textElements = analysis.elements.filter(e => e.type === 'text');
    const shapeElements = analysis.elements.filter(e => e.type === 'shape' || e.type === 'button');
    
    const minTextZ = Math.min(...textElements.map(e => e.zIndex));
    const maxTextZ = Math.max(...textElements.map(e => e.zIndex));
    const minShapeZ = Math.min(...shapeElements.map(e => e.zIndex));
    const maxShapeZ = Math.max(...shapeElements.map(e => e.zIndex));
    
    console.log(`\n📈 Z-INDEX RANGE:`);
    console.log(`  Text: ${minTextZ} - ${maxTextZ}`);
    console.log(`  Shapes: ${minShapeZ} - ${maxShapeZ}`);
    
    const textHiddenCount = analysis.overlaps.filter(o => o.issue.includes('TEXT HIDDEN')).length;
    const textOverlapCount = analysis.overlaps.filter(o => o.issue.includes('TEXT OVERLAP')).length;
    
    console.log(`\n⚠️  OVERLAP ANALYSIS:`);
    console.log(`  Total overlaps: ${analysis.overlaps.length}`);
    console.log(`  🔴 Text hidden by shapes: ${textHiddenCount}`);
    console.log(`  🟡 Text overlapping text: ${textOverlapCount}`);
    console.log(`  🟢 Acceptable overlaps: ${analysis.overlaps.length - textHiddenCount - textOverlapCount}`);
    
    if (analysis.overlaps.length > 0) {
      console.log(`\n🔍 TOP 15 OVERLAPS:`);
      analysis.overlaps.slice(0, 15).forEach((overlap, i) => {
        console.log(`  ${i+1}. ${overlap.issue}`);
        console.log(`     ${overlap.elem1}`);
        console.log(`     ↔ ${overlap.elem2}`);
        console.log(`     Overlap: ${overlap.overlapPercent}%`);
      });
    }
    
    results.push({
      name: test.name,
      totalElements: analysis.elements.length,
      overlaps: analysis.overlaps.length,
      textHidden: textHiddenCount,
      textOverlap: textOverlapCount,
      minTextZ, maxTextZ, minShapeZ, maxShapeZ
    });
  }
  
  console.log('\n' + '═'.repeat(80));
  console.log('SUMMARY & ACTION PLAN');
  console.log('═'.repeat(80));
  
  results.forEach(r => {
    console.log(`\n${r.name}:`);
    console.log(`  Elements: ${r.totalElements}, Overlaps: ${r.overlaps}`);
    console.log(`  🔴 Critical (text hidden): ${r.textHidden}`);
    console.log(`  🟡 Warning (text overlap): ${r.textOverlap}`);
    
    if (r.textHidden > 0) {
      console.log(`  ❌ ACTION REQUIRED: Increase text z-index to > ${r.maxShapeZ}`);
    }
    if (r.textOverlap > 5) {
      console.log(`  ⚠️  ACTION: Improve text deduplication`);
    }
    if (r.overlaps > 20) {
      console.log(`  ⚠️  ACTION: Too many overlaps, improve element detection`);
    }
  });
  
  console.log('\n' + '═'.repeat(80) + '\n');
}

runDetailedTest();
