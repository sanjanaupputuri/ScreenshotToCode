import express from 'express';
import cors from 'cors';
import multer from 'multer';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { createHash, randomUUID } from 'crypto';
import { readFile } from 'fs/promises';
import { initializeDatabase, saveGeneratedCode, getUserHistory, saveUser } from './database.js';
import { generateCode } from './codeGenerator.js';
import { verifyToken } from './auth.js';
import { auditLayout } from './auditService.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(express.json());
app.use('/api', (req, res, next) => {
  res.set({
    'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
    Pragma: 'no-cache',
    Expires: '0',
  });
  next();
});
app.use('/uploads', express.static(join(__dirname, 'uploads')));

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, join(__dirname, 'uploads')),
  filename: (req, file, cb) => cb(null, `${Date.now()}-${randomUUID()}-${file.originalname}`)
});
const upload = multer({ storage, limits: { fileSize: 10 * 1024 * 1024 } });

async function hashFile(filePath) {
  const buffer = await readFile(filePath);
  return createHash('sha256').update(buffer).digest('hex').slice(0, 16);
}

// Initialize SQLite database
await initializeDatabase();
console.log('Database ready');

// POST /api/upload — detect + generate code
app.post('/api/upload', verifyToken, upload.single('image'), async (req, res) => {
  const requestId = req.get('x-upload-id') || randomUUID();
  try {
    if (!req.file) return res.status(400).json({ error: 'No image uploaded' });
    const fileHash = await hashFile(req.file.path);
    console.log(`[upload:${requestId}] received`, {
      originalName: req.file.originalname,
      storedName: req.file.filename,
      path: req.file.path,
      size: req.file.size,
      mimeType: req.file.mimetype,
      hash: fileHash,
    });

    // Persist user
    await saveUser(req.user.uid, req.user.email || '', req.user.name || '');

    const generatedCode = await generateCode(req.file.path, {
      requestId,
      fileHash,
      fileSize: req.file.size,
      originalName: req.file.originalname,
      storedName: req.file.filename,
    });

    console.log(`[upload:${requestId}] generated ${generatedCode.length} chars`);

    res.json({
      success: true,
      requestId,
      code: generatedCode,
      imageUrl: `/uploads/${req.file.filename}`
    });
  } catch (error) {
    console.error(`[upload:${requestId}] Upload error:`, error);
    res.status(500).json({ error: error.message });
  }
});

// POST /api/save-code — save generated code to DB
app.post('/api/save-code', verifyToken, async (req, res) => {
  try {
    const { code, imageUrl } = req.body;
    if (!code) return res.status(400).json({ error: 'code is required' });

    await saveUser(req.user.uid, req.user.email || '', req.user.name || '');
    const result = await saveGeneratedCode(req.user.uid, code, imageUrl || '');

    res.json({ success: true, id: result.id });
  } catch (error) {
    console.error('Save error:', error);
    res.status(500).json({ error: error.message });
  }
});

// GET /api/history — get user's saved code history
app.get('/api/history', verifyToken, async (req, res) => {
  try {
    const history = await getUserHistory(req.user.uid);
    res.json(history);
  } catch (error) {
    console.error('History error:', error);
    res.status(500).json({ error: error.message });
  }
});

// GET /api/status — check service health
app.get('/api/status', async (req, res) => {
  const { DetectionService } = await import('./detectionService.js');
  const pythonUp = await DetectionService.isServiceAvailable();

  let ollamaUp = false;
  try {
    const r = await fetch('http://localhost:11434/api/tags', { signal: AbortSignal.timeout(2000) });
    ollamaUp = r.ok;
  } catch { /* offline */ }

  res.json({ python_service: pythonUp, ollama: ollamaUp });
});

// POST /api/audit — analyse detected elements and generated HTML for layout issues
app.post('/api/audit', async (req, res) => {
  try {
    const { elements, html, image } = req.body;
    if (!elements || !html) return res.status(400).json({ error: 'elements and html are required' });
    const report = auditLayout(elements, html, image || {});
    res.json(report);
  } catch (error) {
    console.error('Audit error:', error);
    res.status(500).json({ error: error.message });
  }
});

app.listen(PORT, () => console.log(`Backend running on http://localhost:${PORT}`));
