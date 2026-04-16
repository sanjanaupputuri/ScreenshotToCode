import { generateCode } from './backend/codeGenerator.js';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import fs from 'fs';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Expected elements for test.png (GitHub page)
const TEST1_EXPECTED = {
  name: 'test.png (GitHub)',
  buttons: [
    { text: 'Pin', color: '#f6f8fa' },
    { text: 'Watch', color: '#f6f8fa' },
    { text: 'Fork', color: '#f6f8fa' },
    { text: 'Star', color: '#f6f8fa' },
    { text: 'Code', color: '#1f883d' }, // green button
    { text: 'Add file', color: '#f6f8fa' },
  ],
  inputs: [
    { placeholder: 'Type / to search', color: '#f6f8fa' },
    { placeholder: 'Go to file', color: '#ffffff' },
  ],
  background: '#f6f8fa',
  containers: ['toolbar', 'panel', 'sidebar'],
};

// Expected elements for test2.png (Emergency Response Simulator)
const TEST2_EXPECTED = {
  name: 'test2.png (Emergency Simulator)',
  buttons: [
    { text: 'START SIMULATION', color: '#1976d2' }, // blue button
    { text: 'EXIT', color: '#d32f2f' }, // red button
  ],
  inputs: [],
  background: '#1a1a2e', // dark background (actual color from image)
  containers: ['main-container'],
  texts: [
    'EMERGENCY RESPONSE SIMULATOR',
    'Hyderabad Emergency Services Training',
    'Multi-City Support',
    'Advanced Pathfinding',
    'Real-time Simulation',
    'Performance Analytics',
  ],
};

function analyzeCode(code, expected) {
  const scores = {
    buttons: 0,
    inputs: 0,
    colors: 0,
    layout: 0,
    text: 0,
  };

  // Button detection
  const buttonMatches = code.match(/<button[^>]*>/g) || [];
  const expectedButtons = expected.buttons.length;
  const detectedButtons = buttonMatches.length;
  
  let correctButtons = 0;
  for (const btn of expected.buttons) {
    const textFound = code.includes(btn.text);
    const colorApprox = code.includes(btn.color.substring(0, 4)); // Check first 4 chars of hex
    if (textFound || colorApprox) correctButtons++;
  }
  scores.buttons = expectedButtons > 0 ? (correctButtons / expectedButtons) * 100 : 100;

  // Input detection
  const inputMatches = code.match(/<input[^>]*>/g) || [];
  const expectedInputs = expected.inputs.length;
  const detectedInputs = inputMatches.length;
  
  let correctInputs = 0;
  for (const inp of expected.inputs) {
    if (code.includes(inp.placeholder) || code.includes('input')) correctInputs++;
  }
  scores.inputs = expectedInputs > 0 ? (correctInputs / expectedInputs) * 100 : 100;

  // Background color accuracy
  const bgColorFound = code.includes(expected.background);
  scores.colors = bgColorFound ? 100 : 50;

  // Layout/container detection
  const hasProperStructure = code.includes('<!DOCTYPE') && 
                             code.includes('<html') && 
                             code.includes('<body>');
  scores.layout = hasProperStructure ? 70 : 30;

  // Text content detection
  if (expected.texts) {
    let textFound = 0;
    for (const text of expected.texts) {
      if (code.includes(text)) textFound++;
    }
    scores.text = (textFound / expected.texts.length) * 100;
  } else {
    scores.text = 80; // Default if no specific texts to check
  }

  const overall = (scores.buttons + scores.inputs + scores.colors + scores.layout + scores.text) / 5;

  return {
    scores,
    overall: Math.round(overall),
    details: {
      expectedButtons,
      detectedButtons,
      correctButtons,
      expectedInputs,
      detectedInputs,
      correctInputs,
    },
  };
}

async function testImage(imagePath, expected) {
  console.log('\n' + '='.repeat(70));
  console.log(`TESTING: ${expected.name}`);
  console.log('='.repeat(70));

  const uploadPath = join(__dirname, 'backend', 'uploads', 'test_ui.png');
  fs.copyFileSync(imagePath, uploadPath);

  try {
    const startTime = Date.now();
    const code = await generateCode(uploadPath);
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(2);

    const analysis = analyzeCode(code, expected);

    console.log(`\n⏱️  Processing time: ${elapsed}s`);
    console.log('\n📊 ACCURACY SCORES:');
    console.log(`  Button Detection:    ${analysis.scores.buttons.toFixed(1)}%`);
    console.log(`  Input Detection:     ${analysis.scores.inputs.toFixed(1)}%`);
    console.log(`  Color Accuracy:      ${analysis.scores.colors.toFixed(1)}%`);
    console.log(`  Layout Structure:    ${analysis.scores.layout.toFixed(1)}%`);
    console.log(`  Text Content:        ${analysis.scores.text.toFixed(1)}%`);
    console.log(`\n  🎯 OVERALL ACCURACY: ${analysis.overall}%`);

    console.log('\n📋 DETECTION DETAILS:');
    console.log(`  Expected buttons: ${analysis.details.expectedButtons}`);
    console.log(`  Detected buttons: ${analysis.details.detectedButtons}`);
    console.log(`  Correct buttons:  ${analysis.details.correctButtons}`);
    console.log(`  Expected inputs:  ${analysis.details.expectedInputs}`);
    console.log(`  Detected inputs:  ${analysis.details.detectedInputs}`);

    // Save output for inspection
    const outputPath = join(__dirname, `output_${expected.name.split(' ')[0]}.html`);
    fs.writeFileSync(outputPath, code);
    console.log(`\n💾 Generated code saved to: ${outputPath}`);

    return analysis;
  } catch (error) {
    console.error(`\n❌ ERROR: ${error.message}`);
    return null;
  }
}

async function runTests() {
  console.log('\n' + '█'.repeat(70));
  console.log('  SCREENSHOT-TO-CODE ACCURACY TEST SUITE');
  console.log('█'.repeat(70));

  const test1Path = join(__dirname, 'test.png');
  const test2Path = join(__dirname, 'test2.png');

  if (!fs.existsSync(test1Path)) {
    console.log('❌ test.png not found!');
    return;
  }
  if (!fs.existsSync(test2Path)) {
    console.log('❌ test2.png not found!');
    return;
  }

  const result1 = await testImage(test1Path, TEST1_EXPECTED);
  const result2 = await testImage(test2Path, TEST2_EXPECTED);

  console.log('\n' + '='.repeat(70));
  console.log('FINAL SUMMARY');
  console.log('='.repeat(70));
  
  if (result1 && result2) {
    const avgAccuracy = Math.round((result1.overall + result2.overall) / 2);
    console.log(`\n🎯 Average Accuracy: ${avgAccuracy}%`);
    
    console.log('\n🔍 KEY ISSUES IDENTIFIED:');
    if (result1.scores.buttons < 70 || result2.scores.buttons < 70) {
      console.log('  ⚠️  Button detection needs improvement');
    }
    if (result1.scores.colors < 70 || result2.scores.colors < 70) {
      console.log('  ⚠️  Color accuracy needs improvement');
    }
    if (result1.scores.layout < 70 || result2.scores.layout < 70) {
      console.log('  ⚠️  Layout/container detection needs improvement');
    }
  }

  console.log('\n' + '█'.repeat(70));
}

runTests();
