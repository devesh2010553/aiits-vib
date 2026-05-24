const jwt  = require('jsonwebtoken');
const User = require('../models/User');

exports.authenticateStudent = async (req, res, next) => {
  try {
    const token = req.cookies.studentToken || (req.headers.authorization||'').replace('Bearer ','').trim();
    if (!token) return res.status(401).json({ error: 'Authentication required. Please login.' });
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const user    = await User.findById(decoded.userId).select('-password -otp -otpExpiry');
    if (!user) return res.status(401).json({ error: 'User not found. Please login again.' });
    req.user = user;
    next();
  } catch(err) {
    res.status(401).json({ error: 'Session expired. Please login again.' });
  }
};

exports.authenticateAdmin = (req, res, next) => {
  try {
    const token = req.cookies.adminToken || (req.headers.authorization||'').replace('Bearer ','').trim();
    if (!token) return res.status(401).json({ error: 'Admin authentication required.' });
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    if (decoded.role !== 'admin') return res.status(403).json({ error: 'Admin access required.' });
    req.admin = decoded;
    next();
  } catch(err) {
    res.status(401).json({ error: 'Admin session expired. Please login again.' });
  }
};
