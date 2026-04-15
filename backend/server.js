import express from 'express';
import cors from 'cors';
import multer from 'multer';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { initializeDatabase, saveGeneratedCode, getUserHistory, saveUser } from './database.js';
import { generateCode } from './codeGenerator.js';
import { verifyToken } from './auth.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(express.json());
app.use('/uploads', express.static(join(__dirname, 'uploads')));

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, join(__dirname, 'uploads')),
  filename: (req, file, cb) => cb(null, `${Date.now()}-${file.originalname}`)
});
const upload = multer({ storage, limits: { fileSize: 10 * 1024 * 1024 } });

// Initialize SQLite database
await initializeDatabase();
console.log('Database ready');

// POST /api/upload — detect + generate code
app.post('/api/upload', verifyToken, upload.single('image'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No image uploaded' });

    // Persist user
    await saveUser(req.user.uid, req.user.email || '', req.user.name || '');

    const generatedCode = await generateCode(req.file.path);

    res.json({
      success: true,
      code: generatedCode,
      imageUrl: `/uploads/${req.file.filename}`
    });
  } catch (error) {
    console.error('Upload error:', error);
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

app.listen(PORT, () => console.log(`Backend running on http://localhost:${PORT}`));
