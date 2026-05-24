const express  = require('express');
const router   = express.Router();
const jwt      = require('jsonwebtoken');
const bcrypt   = require('bcryptjs');
const User     = require('../models/User');
const Result   = require('../models/Result');
const { sendOTPEmail, generateOTP } = require('../utils/email');
const { authenticateStudent, authenticateAdmin } = require('../middleware/auth');

function makeToken(payload) {
  return jwt.sign(payload, process.env.JWT_SECRET, { expiresIn: '30d' });
}
function setCookie(res, name, token) {
  res.cookie(name, token, {
    httpOnly: true,
    secure:   process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge:   30 * 24 * 60 * 60 * 1000
  });
}

// Register
router.post('/register', async (req, res) => {
  try {
    const { name, email, phone, password, coachingName, fatherName, fatherOccupation, whatsappNumber, batch } = req.body;
    if (!name||!email||!phone||!password||!coachingName||!fatherName||!fatherOccupation||!whatsappNumber||!batch)
      return res.status(400).json({ error: 'All fields are required' });
    if (!['11','12','dropper'].includes(batch))
      return res.status(400).json({ error: 'Batch must be 11, 12, or dropper' });
    if (password.length < 6)
      return res.status(400).json({ error: 'Password must be at least 6 characters' });
    const existing = await User.findOne({ $or: [{ email: email.toLowerCase() }, { phone }] });
    if (existing) return res.status(400).json({ error: existing.email === email.toLowerCase() ? 'Email already registered' : 'Phone already registered' });
    const user = new User({ name, email, phone, password, coachingName, fatherName, fatherOccupation, whatsappNumber, batch });
    await user.save();
    // Queue student to Google Sheets
    try {
      const { queueStudent } = require('../utils/sheetsQueue');
      queueStudent({ userId: user._id, name: user.name, email: user.email, phone: user.phone, batch: user.batch, coachingName: user.coachingName, fatherName: user.fatherName, fatherOccupation: user.fatherOccupation, whatsappNumber: user.whatsappNumber, createdAt: user.createdAt, totalTests: 0, totalMarks: 0, highestMarks: 0 });
    } catch(e) {}
    setCookie(res, 'studentToken', makeToken({ userId: user._id, email: user.email }));
    res.status(201).json({ message: 'Account created', user: { id: user._id, name: user.name, email: user.email, batch: user.batch, coachingName: user.coachingName } });
  } catch(err) {
    console.error('[AUTH] register:', err);
    res.status(500).json({ error: err.message||'Registration failed' });
  }
});

// Login
router.post('/login', async (req, res) => {
  try {
    const { identifier, password } = req.body;
    if (!identifier||!password) return res.status(400).json({ error: 'Email/phone and password required' });
    const user = await User.findOne({ $or: [{ email: identifier.toLowerCase() }, { phone: identifier }] });
    if (!user) return res.status(404).json({ error: 'Account not found. Please register first.' });
    const ok = await user.comparePassword(password);
    if (!ok) return res.status(401).json({ error: 'Incorrect password. Please try again.' });
    user.lastLogin = new Date();
    await user.save();
    setCookie(res, 'studentToken', makeToken({ userId: user._id, email: user.email }));
    res.json({ message: 'Login successful', user: { id: user._id, name: user.name, email: user.email, batch: user.batch, coachingName: user.coachingName } });
  } catch(err) {
    console.error('[AUTH] login:', err);
    res.status(500).json({ error: 'Login failed' });
  }
});

// Forgot password - send OTP
router.post('/forgot-password', async (req, res) => {
  try {
    const email = (req.body.email||'').trim().toLowerCase();
    if (!email) return res.status(400).json({ error: 'Email required' });
    const user = await User.findOne({ email });
    if (!user) return res.status(404).json({ error: 'No account with this email' });
    const otp = generateOTP();
    user.otp       = await bcrypt.hash(otp, 10);
    user.otpExpiry = new Date(Date.now() + 10*60*1000);
    await user.save();
    try {
      await sendOTPEmail(email, otp, user.name);
    } catch(emailErr) {
      console.error('[AUTH] email error:', emailErr.message);
      user.otp = undefined; user.otpExpiry = undefined;
      await user.save();
      return res.status(500).json({ error: 'Could not send OTP. ' + emailErr.message });
    }
    res.json({ message: 'OTP sent to your email' });
  } catch(err) {
    console.error('[AUTH] forgot-password:', err);
    res.status(500).json({ error: err.message });
  }
});

// Reset password
router.post('/reset-password', async (req, res) => {
  try {
    const { email, otp, newPassword } = req.body;
    if (!email||!otp||!newPassword) return res.status(400).json({ error: 'All fields required' });
    if (newPassword.length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters' });
    const user = await User.findOne({ email: email.toLowerCase() });
    if (!user||!user.otp) return res.status(400).json({ error: 'No OTP requested. Please request again.' });
    if (new Date() > user.otpExpiry) return res.status(400).json({ error: 'OTP expired. Request a new one.' });
    const valid = await bcrypt.compare(otp, user.otp);
    if (!valid) return res.status(400).json({ error: 'Invalid OTP' });
    user.password = newPassword;
    user.otp = undefined; user.otpExpiry = undefined;
    await user.save();
    res.json({ message: 'Password reset successfully. Please login.' });
  } catch(err) {
    console.error('[AUTH] reset-password:', err);
    res.status(500).json({ error: err.message });
  }
});

// Admin login
router.post('/admin-login', async (req, res) => {
  try {
    const email    = (req.body.email||'').trim().toLowerCase();
    const password =  req.body.password||'';
    if (email !== (process.env.ADMIN_EMAIL||'').toLowerCase() || password !== process.env.ADMIN_PASSWORD)
      return res.status(401).json({ error: 'Invalid admin credentials' });
    setCookie(res, 'adminToken', makeToken({ role: 'admin', email }));
    res.json({ message: 'Admin login successful' });
  } catch(err) { res.status(500).json({ error: 'Login failed' }); }
});

// Session restore
router.get('/me', authenticateStudent, (req, res) => {
  res.json({ user: { id: req.user._id, name: req.user.name, email: req.user.email, batch: req.user.batch, coachingName: req.user.coachingName, phone: req.user.phone } });
});

router.get('/admin-me', authenticateAdmin, (req, res) => {
  res.json({ admin: { email: req.admin.email, role: 'admin' } });
});

// Logout
router.post('/logout', (req, res) => {
  res.clearCookie('studentToken', { sameSite: 'lax' });
  res.clearCookie('adminToken',   { sameSite: 'lax' });
  res.json({ message: 'Logged out' });
});

// Delete own account permanently
router.delete('/account', authenticateStudent, async (req, res) => {
  try {
    await Promise.all([
      User.findByIdAndDelete(req.user._id),
      Result.deleteMany({ userId: req.user._id })
    ]);
    res.clearCookie('studentToken', { sameSite: 'lax' });
    res.json({ message: 'Account deleted permanently' });
  } catch(err) { res.status(500).json({ error: err.message }); }
});

// Email test (admin)
router.get('/test-email', authenticateAdmin, async (req, res) => {
  const to = req.query.to || process.env.ADMIN_EMAIL;
  try {
    await sendOTPEmail(to, '123456', 'Test User');
    res.json({ success: true, message: 'Test email sent to ' + to });
  } catch(err) { res.status(500).json({ success: false, error: err.message }); }
});

module.exports = router;
