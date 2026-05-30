const User = require('../models/User');
const { verifyIdToken } = require('../utils/firebase');

// Student auth: verify Firebase ID token from cookie or Authorization header
exports.authenticateStudent = async (req, res, next) => {
  try {
    const token = req.cookies.firebaseToken ||
                  (req.headers.authorization || '').replace('Bearer ', '').trim();
    if (!token) return res.status(401).json({ error: 'Authentication required. Please login.' });

    // Verify with Firebase Admin SDK
    const decoded = await verifyIdToken(token);

    // Get extra profile from MongoDB using Firebase UID
    const user = await User.findOne({ firebaseUid: decoded.uid });
    if (!user) return res.status(401).json({ error: 'Profile not found. Please complete registration.' });

    req.user      = user;
    req.firebaseUid = decoded.uid;
    next();
  } catch (err) {
    if (err.code === 'auth/id-token-expired') {
      return res.status(401).json({ error: 'Session expired. Please login again.' });
    }
    if (err.code === 'auth/argument-error' || err.code === 'auth/invalid-id-token') {
      return res.status(401).json({ error: 'Invalid session. Please login again.' });
    }
    console.error('[AUTH] verifyIdToken error:', err.message);
    res.status(401).json({ error: 'Authentication failed. Please login again.' });
  }
};

// Admin auth: simple env var check (no Firebase for admin)
exports.authenticateAdmin = (req, res, next) => {
  try {
    const token = req.cookies.adminToken ||
                  (req.headers.authorization || '').replace('Bearer ', '').trim();
    if (!token) return res.status(401).json({ error: 'Admin authentication required.' });

    // Admin uses a simple signed token stored in cookie
    const jwt = require('jsonwebtoken');
    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'aiits-admin-secret');
    if (decoded.role !== 'admin') return res.status(403).json({ error: 'Admin access required.' });
    req.admin = decoded;
    next();
  } catch (err) {
    res.status(401).json({ error: 'Admin session expired. Please login again.' });
  }
};
