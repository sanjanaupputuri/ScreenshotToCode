import express from 'express';
import cors from 'cors';
import multer from 'multer';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { initializeDatabase, saveGeneratedCode, getUserHistory } from './database-json.js';
import { generateCode } from './codeGenerator.js';
import { verifyToken } from './auth.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3001;

// Middleware
app.use(cors());
app.use(express.json());
app.use('/uploads', express.static(join(__dirname, 'uploads')));

// Multer for file uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, 'uploads/'),
  filename: (req, file, cb) => cb(null, `${Date.now()}-${file.originalname}`)
});
const upload = multer({ storage });

// Initialize database
await initializeDatabase();

// Routes
app.post('/api/upload', verifyToken, upload.single('image'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No image uploaded' });
    
    const generatedCode = await generateCode(req.file.path);
    
    res.json({
      success: true,
      code: generatedCode,
      imageUrl: `/uploads/${req.file.filename}`
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/save-code', verifyToken, async (req, res) => {
  try {
    const { code, imageUrl } = req.body;
    const userId = req.user.uid;
    
    // Save to database (implement in database.js)
    const result = await saveGeneratedCode(userId, code, imageUrl);
    
    res.json({ success: true, id: result.id });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/history', verifyToken, async (req, res) => {
  try {
    const userId = req.user.uid;
    const history = await getUserHistory(userId);
    res.json(history);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});