const express     = require('express');
const router      = express.Router();
const jwt         = require('jsonwebtoken');
const admin       = require('../utils/firebaseAdmin');
const UserProfile = require('../models/UserProfile');
const Result      = require('../models/Result');
const { authenticateStudent, authenticateAdmin } = require('../middleware/auth');

function makeToken(payload) {
  return jwt.sign(payload, process.env.JWT_SECRET, { expiresIn: '30d' });
}
function setAdminCookie(res, token) {
  res.cookie('adminToken', token, {
    httpOnly: true,
    secure:   process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge:   30 * 24 * 60 * 60 * 1000,
  });
}

// POST /register
// Called after Firebase creates the user on the frontend.
// Body: { idToken, name, phone, coachingName, fatherName, fatherOccupation, whatsappNumber, batch }
router.post('/register', async (req, res) => {
  try {
    const { idToken, name, phone, coachingName, fatherName, fatherOccupation, whatsappNumber, batch } = req.body;

    if (!idToken || !name || !phone || !coachingName || !fatherName || !fatherOccupation || !whatsappNumber || !batch)
      return res.status(400).json({ error: 'All fields are required' });

    if (!['11', '12', 'dropper'].includes(batch))
      return res.status(400).json({ error: 'Batch must be 11, 12, or dropper' });

    let decoded;
    try {
      decoded = await admin.auth().verifyIdToken(idToken);
    } catch {
      return res.status(401).json({ error: 'Invalid Firebase token. Please try again.' });
    }

    const phoneExists = await UserProfile.findOne({ phone });
    if (phoneExists) {
      await admin.auth().deleteUser(decoded.uid).catch(() => {});
      return res.status(400).json({ error: 'Phone number already registered' });
    }

    const existing = await UserProfile.findOne({ uid: decoded.uid });
    if (existing) {
      return res.json({
        message: 'Account already exists',
        user: { id: existing._id, name: existing.name, email: decoded.email, batch: existing.batch, coachingName: existing.coachingName },
      });
    }

    await admin.auth().updateUser(decoded.uid, { displayName: name }).catch(() => {});

    const profile = new UserProfile({ uid: decoded.uid, name, phone, coachingName, fatherName, fatherOccupation, whatsappNumber, batch });
    await profile.save();

    try {
      const { queueStudent } = require('../utils/sheetsQueue');
      queueStudent({ userId: profile._id, name: profile.name, email: decoded.email, phone: profile.phone, batch: profile.batch, coachingName: profile.coachingName, fatherName: profile.fatherName, fatherOccupation: profile.fatherOccupation, whatsappNumber: profile.whatsappNumber, createdAt: profile.createdAt, totalTests: 0, totalMarks: 0, highestMarks: 0 });
    } catch (e) {}

    res.status(201).json({
      message: 'Account created',
      user: { id: profile._id, name: profile.name, email: decoded.email, batch: profile.batch, coachingName: profile.coachingName },
    });
  } catch (err) {
    console.error('[AUTH] register:', err);
    res.status(500).json({ error: err.message || 'Registration failed' });
  }
});

// POST /lookup-email — used for phone-based login
// Returns the email for a given phone number so Firebase signIn can proceed
router.post('/lookup-email', async (req, res) => {
  try {
    const phone = (req.body.phone || '').trim();
    if (!phone) return res.status(400).json({ error: 'Phone required' });
    const profile = await UserProfile.findOne({ phone });
    if (!profile) return res.status(404).json({ error: 'No account found with this phone number' });
    const fbUser = await admin.auth().getUser(profile.uid);
    res.json({ email: fbUser.email });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /admin-login — unchanged (env-var based)
router.post('/admin-login', async (req, res) => {
  try {
    const email    = (req.body.email || '').trim().toLowerCase();
    const password =  req.body.password || '';
    if (email !== (process.env.ADMIN_EMAIL || '').toLowerCase() || password !== process.env.ADMIN_PASSWORD)
      return res.status(401).json({ error: 'Invalid admin credentials' });
    setAdminCookie(res, makeToken({ role: 'admin', email }));
    res.json({ message: 'Admin login successful' });
  } catch {
    res.status(500).json({ error: 'Login failed' });
  }
});

// GET /me — session restore via Firebase token
router.get('/me', authenticateStudent, (req, res) => {
  res.json({
    user: {
      id:               req.user._id,
      name:             req.user.name,
      email:            req.user.email,
      batch:            req.user.batch,
      coachingName:     req.user.coachingName,
      phone:            req.user.phone,
      fatherName:       req.user.fatherName,
      fatherOccupation: req.user.fatherOccupation,
      whatsappNumber:   req.user.whatsappNumber,
    },
  });
});

router.get('/admin-me', authenticateAdmin, (req, res) => {
  res.json({ admin: { email: req.admin.email, role: 'admin' } });
});

// POST /logout
router.post('/logout', (req, res) => {
  res.clearCookie('adminToken',   { sameSite: 'lax' });
  res.clearCookie('studentToken', { sameSite: 'lax' });
  res.json({ message: 'Logged out' });
});

// DELETE /account — removes from both Firebase and MongoDB
router.delete('/account', authenticateStudent, async (req, res) => {
  try {
    await Promise.all([
      UserProfile.findByIdAndDelete(req.user._id),
      Result.deleteMany({ userId: req.user._id }),
      admin.auth().deleteUser(req.user.uid).catch(() => {}),
    ]);
    res.clearCookie('studentToken', { sameSite: 'lax' });
    res.json({ message: 'Account deleted permanently' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
