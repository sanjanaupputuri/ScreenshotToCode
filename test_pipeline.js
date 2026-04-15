import { generateCode } from './backend/codeGenerator.js';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const imagePath = join(__dirname, 'backend', 'uploads', 'test_ui.png');
const fs = await import('fs');

async function runTest() {
  console.log('='.repeat(60));
  console.log('SCREENSHOT TO CODE - PIPELINE TEST');
  console.log('='.repeat(60));
  console.log(`\nTest image: ${imagePath}`);

  if (!fs.existsSync(imagePath)) {
    console.log('ERROR: Test image not found!');
    console.log('Please create a test image first: python3 create_test_image.py');
    process.exit(1);
  }

  console.log('\nStarting 3-stage pipeline...\n');

  try {
    const startTime = Date.now();
    const code = await generateCode(imagePath);
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(2);

    console.log('\n' + '='.repeat(60));
    console.log('GENERATED CODE (took ' + elapsed + 's):');
    console.log('='.repeat(60));
    console.log(code);
    console.log('='.repeat(60));

    const hasDoctype = code.includes('<!DOCTYPE');
    const hasTailwind = code.includes('tailwindcss');
    const hasValidTags = code.includes('<html') && code.includes('</html>');

    console.log('\nVALIDATION:');
    console.log('  ✓ Valid HTML structure:', hasDoctype && hasValidTags ? 'YES' : 'NO');
    console.log('  ✓ Uses Tailwind CSS:', hasTailwind ? 'YES' : 'NO');
    console.log('  ✓ Processing time:', elapsed + 's');

    if (hasDoctype && hasTailwind && hasValidTags) {
      console.log('\n✅ PIPELINE TEST PASSED!');
    } else {
      console.log('\n❌ PIPELINE TEST FAILED - Invalid output');
      process.exit(1);
    }

  } catch (error) {
    console.error('\n❌ PIPELINE ERROR:', error.message);
    console.error(error.stack);
    process.exit(1);
  }
}

runTest();
