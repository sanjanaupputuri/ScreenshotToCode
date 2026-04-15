import admin from 'firebase-admin';

let initialized = false;

function initFirebase() {
  if (initialized) return;
  try {
    admin.initializeApp({ projectId: "screenshottocode-41999" });
    initialized = true;
  } catch (e) {
    // already initialized
    initialized = true;
  }
}

export async function verifyToken(req, res, next) {
  try {
    initFirebase();
    const token = req.headers.authorization?.split(' ')[1];
    if (!token) return res.status(401).json({ error: 'No token provided' });

    const decoded = await admin.auth().verifyIdToken(token);
    req.user = { uid: decoded.uid, email: decoded.email, name: decoded.name };
    next();
  } catch (error) {
    res.status(401).json({ error: 'Invalid token: ' + error.message });
  }
}
