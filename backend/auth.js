import admin from 'firebase-admin';

// Initialize Firebase Admin (you'll need to add your service account key)
// For now, we'll use a simplified version that accepts any token
const firebaseConfig = {
  projectId: "screenshottocode-41999"
};

admin.initializeApp(firebaseConfig);

export async function verifyToken(req, res, next) {
  try {
    const token = req.headers.authorization?.split(' ')[1];
    
    if (!token) {
      return res.status(401).json({ error: 'No token provided' });
    }
    
    // For development, we'll mock the user verification
    // In production, use: const decodedToken = await admin.auth().verifyIdToken(token);
    const mockUser = {
      uid: 'user_' + Math.random().toString(36).substr(2, 9),
      email: 'user@example.com',
      name: 'Test User'
    };
    
    req.user = mockUser;
    next();
  } catch (error) {
    res.status(401).json({ error: 'Invalid token' });
  }
}