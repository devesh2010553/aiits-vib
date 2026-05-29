const admin       = require('../utils/firebaseAdmin');
const UserProfile = require('../models/UserProfile');
const jwt         = require('jsonwebtoken');

exports.authenticateStudent = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization || '';
    const token = authHeader.startsWith('Bearer ')
      ? authHeader.slice(7)
      : req.cookies.studentToken;

    if (!token) return res.status(401).json({ error: 'Authentication required. Please login.' });

    const decoded = await admin.auth().verifyIdToken(token);

    const profile = await UserProfile.findOne({ uid: decoded.uid });
    if (!profile) return res.status(401).json({ error: 'Profile not found. Please register again.' });

    req.user = {
      _id:              profile._id,
      uid:              decoded.uid,
      name:             profile.name,
      email:            decoded.email,
      phone:            profile.phone,
      batch:            profile.batch,
      coachingName:     profile.coachingName,
      fatherName:       profile.fatherName,
      fatherOccupation: profile.fatherOccupation,
      whatsappNumber:   profile.whatsappNumber,
    };
    next();
  } catch (err) {
    const expired = err.code === 'auth/id-token-expired';
    res.status(401).json({ error: expired ? 'Session expired. Please login again.' : 'Authentication failed. Please login again.' });
  }
};

exports.authenticateAdmin = (req, res, next) => {
  try {
    const token = req.cookies.adminToken || (req.headers.authorization || '').replace('Bearer ', '').trim();
    if (!token) return res.status(401).json({ error: 'Admin authentication required.' });
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    if (decoded.role !== 'admin') return res.status(403).json({ error: 'Admin access required.' });
    req.admin = decoded;
    next();
  } catch {
    res.status(401).json({ error: 'Admin session expired. Please login again.' });
  }
};
