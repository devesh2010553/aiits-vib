const express  = require('express');
const router   = express.Router();
const jwt      = require('jsonwebtoken');
const User     = require('../models/User');
const Result   = require('../models/Result');
const firebase = require('../utils/firebase');
const { authenticateStudent, authenticateAdmin } = require('../middleware/auth');

// ── Register: create Firebase user + save profile to MongoDB ──────────
router.post('/register', async (req, res) => {
  try {
    const {
      name, email, phone, password,
      coachingName, fatherName, fatherOccupation,
      whatsappNumber, batch
    } = req.body;

    if (!name||!email||!phone||!password||!coachingName||!fatherName||!fatherOccupation||!whatsappNumber||!batch)
      return res.status(400).json({ error: 'All fields are required' });
    if (!['11','12','dropper'].includes(batch))
      return res.status(400).json({ error: 'Batch must be 11, 12, or dropper' });
    if (password.length < 6)
      return res.status(400).json({ error: 'Password must be at least 6 characters' });

    // Check phone not already taken
    const existingPhone = await User.findOne({ phone });
    if (existingPhone) return res.status(400).json({ error: 'Phone number already registered' });

    // Create Firebase Auth user (handles email duplicate check too)
    let firebaseUser;
    try {
      firebaseUser = await firebase.createFirebaseUser(email, password, name);
    } catch (fbErr) {
      if (fbErr.code === 'auth/email-already-exists')
        return res.status(400).json({ error: 'Email already registered. Please login.' });
      throw fbErr;
    }

    // Save extra profile to MongoDB
    const user = new User({
      firebaseUid: firebaseUser.uid,
      name, email, phone,
      coachingName, fatherName, fatherOccupation,
      whatsappNumber, batch
    });
    await user.save();

    // Queue to Google Sheets
    try {
      const { queueStudent } = require('../utils/sheetsQueue');
      queueStudent({ userId: user._id, name, email, phone, batch, coachingName, fatherName, fatherOccupation, whatsappNumber, createdAt: user.createdAt, totalTests: 0, totalMarks: 0, highestMarks: 0 });
    } catch(e) {}

    res.status(201).json({
      message: 'Account created! Please login.',
      uid: firebaseUser.uid
    });
  } catch (err) {
    console.error('[AUTH] register error:', err);
    res.status(500).json({ error: err.message || 'Registration failed' });
  }
});

// ── Verify Firebase token + return profile ────────────────────────────
// Frontend calls this after Firebase signInWithEmailAndPassword()
// Frontend gets idToken from Firebase, sends it here to get MongoDB profile
router.post('/verify-token', async (req, res) => {
  try {
    const { idToken } = req.body;
    if (!idToken) return res.status(400).json({ error: 'idToken required' });

    const decoded = await firebase.verifyIdToken(idToken);
    const user    = await User.findOne({ firebaseUid: decoded.uid });
    if (!user) return res.status(404).json({ error: 'Profile not found. Please register first.' });

    // Set cookie so subsequent API calls work
    res.cookie('firebaseToken', idToken, {
      httpOnly: true,
      secure:   process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge:   60 * 60 * 1000  // 1 hour (Firebase tokens expire in 1h)
    });

    user.lastLogin = new Date();
    await user.save();

    res.json({
      message: 'Login successful',
      user: {
        id: user._id, name: user.name, email: user.email,
        batch: user.batch, coachingName: user.coachingName,
        phone: user.phone, firebaseUid: decoded.uid
      }
    });
  } catch (err) {
    if (err.code === 'auth/id-token-expired')
      return res.status(401).json({ error: 'Token expired. Please login again.' });
    console.error('[AUTH] verify-token error:', err);
    res.status(401).json({ error: err.message || 'Token verification failed' });
  }
});

// ── Refresh token: frontend sends new Firebase idToken ────────────────
router.post('/refresh-token', async (req, res) => {
  try {
    const { idToken } = req.body;
    if (!idToken) return res.status(400).json({ error: 'idToken required' });

    const decoded = await firebase.verifyIdToken(idToken);
    res.cookie('firebaseToken', idToken, {
      httpOnly: true,
      secure:   process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge:   60 * 60 * 1000
    });
    res.json({ refreshed: true });
  } catch (err) {
    res.status(401).json({ error: 'Token invalid' });
  }
});

// ── Session restore ───────────────────────────────────────────────────
router.get('/me', authenticateStudent, (req, res) => {
  res.json({
    user: {
      id: req.user._id, name: req.user.name, email: req.user.email,
      batch: req.user.batch, coachingName: req.user.coachingName,
      phone: req.user.phone, firebaseUid: req.firebaseUid
    }
  });
});

// ── Admin login ───────────────────────────────────────────────────────
router.post('/admin-login', (req, res) => {
  try {
    const email    = (req.body.email||'').trim().toLowerCase();
    const password =  req.body.password||'';
    if (email !== (process.env.ADMIN_EMAIL||'').toLowerCase() || password !== process.env.ADMIN_PASSWORD)
      return res.status(401).json({ error: 'Invalid admin credentials' });
    const token = jwt.sign({ role: 'admin', email }, process.env.JWT_SECRET || 'aiits-admin-secret', { expiresIn: '7d' });
    res.cookie('adminToken', token, {
      httpOnly: true,
      secure:   process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge:   7 * 24 * 60 * 60 * 1000
    });
    res.json({ message: 'Admin login successful' });
  } catch (err) {
    res.status(500).json({ error: 'Login failed' });
  }
});

router.get('/admin-me', authenticateAdmin, (req, res) => {
  res.json({ admin: { email: req.admin.email, role: 'admin' } });
});

// ── Logout ────────────────────────────────────────────────────────────
router.post('/logout', (req, res) => {
  res.clearCookie('firebaseToken', { sameSite: 'lax' });
  res.clearCookie('adminToken',    { sameSite: 'lax' });
  res.json({ message: 'Logged out' });
});

// ── Delete own account ────────────────────────────────────────────────
router.delete('/account', authenticateStudent, async (req, res) => {
  try {
    const uid = req.firebaseUid;
    await Promise.all([
      firebase.deleteFirebaseUser(uid),
      User.findByIdAndDelete(req.user._id),
      Result.deleteMany({ userId: req.user._id })
    ]);
    res.clearCookie('firebaseToken', { sameSite: 'lax' });
    res.json({ message: 'Account deleted permanently' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Email test endpoint (just verify Firebase works) ──────────────────
router.get('/test-email', authenticateAdmin, async (req, res) => {
  try {
    // Firebase handles password reset emails — test by checking admin SDK works
    const fb = require('../utils/firebase').getAdmin();
    const app = fb.app();
    res.json({
      success: true,
      message: 'Firebase Admin SDK is working. Password reset emails are sent by Firebase automatically.',
      projectId: app.options.credential.projectId || 'connected'
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Phone lookup - used by login when user enters phone instead of email
router.get('/email-by-phone', async (req, res) => {
  try {
    const phone = (req.query.phone || '').trim();
    if (!phone) return res.status(400).json({ error: 'Phone required' });
    const user = await User.findOne({ phone });
    if (!user) return res.status(404).json({ error: 'No account with this phone number' });
    res.json({ email: user.email });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;

// Firebase public config for frontend (safe to expose - these are public keys)
router.get('/firebase-config', (req, res) => {
  const config = {
    apiKey:        process.env.FIREBASE_API_KEY,
    authDomain:    process.env.FIREBASE_AUTH_DOMAIN,
    projectId:     process.env.FIREBASE_PROJECT_ID,
    appId:         process.env.FIREBASE_APP_ID
  };
  if (!config.apiKey) {
    return res.status(500).json({ error: 'Firebase config not set. Add FIREBASE_API_KEY, FIREBASE_AUTH_DOMAIN, FIREBASE_PROJECT_ID, FIREBASE_APP_ID to Render env vars.' });
  }
  res.json(config);
});
