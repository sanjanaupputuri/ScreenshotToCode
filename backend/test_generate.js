import { generateCode } from './codeGenerator.js';
import { writeFileSync } from 'fs';

const [,, img, out] = process.argv;
if (!img || !out) { console.error('Usage: node test_generate.js <image> <output>'); process.exit(1); }

console.log(`Testing: ${img} → ${out}`);
const html = await generateCode(img, { requestId: 'test', originalName: img });
writeFileSync(out, html);
console.log(`Written ${html.length} chars to ${out}`);
