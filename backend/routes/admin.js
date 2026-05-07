const express   = require('express');
const router    = express.Router();
const multer    = require('multer');
const mongoose  = require('mongoose');
const Test      = require('../models/Test');
const User      = require('../models/User');
const Result    = require('../models/Result');
const AdImage   = require('../models/AdImage');
const sheets    = require('../utils/sheets');
const { authenticateAdmin } = require('../middleware/auth');

router.use(authenticateAdmin);
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 8 * 1024 * 1024 } });

// ── Stats (MongoDB + Google Sheet) ───────────────────────────────────
router.get('/stats', async (req, res) => {
  try {
    const [totalTests, totalStudents, totalAttempts] = await Promise.all([
      Test.countDocuments(),
      User.countDocuments(),
      Result.countDocuments({ inProgress: false })
    ]);

    // MongoDB storage
    let storageInfo = null;
    try {
      const dbStats = await mongoose.connection.db.stats();
      const usedMB  = Math.round(dbStats.dataSize / 1024 / 1024 * 10) / 10;
      const totalMB = 512;
      storageInfo = { usedMB, totalMB, usedPct: Math.round(usedMB / totalMB * 100), freesMB: Math.round((totalMB - usedMB) * 10) / 10 };
    } catch (e) { /* ignore */ }

    // Google Sheet stats
    const sheetStats = await sheets.getSheetStats().catch(() => null);

    res.json({ totalTests, totalStudents, totalAttempts, storageInfo, sheetStats });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── Tests CRUD ────────────────────────────────────────────────────────
router.get('/tests', async (req, res) => {
  try { res.json(await Test.find().sort({ createdAt: -1 })); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/tests', async (req, res) => {
  try {
    const test = await new Test(req.body).save();
    res.status(201).json({ message: 'Test created', test });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.put('/tests/:id', async (req, res) => {
  try {
    const test = await Test.findByIdAndUpdate(req.params.id, req.body, { new: true });
    if (!test) return res.status(404).json({ error: 'Test not found' });
    res.json({ message: 'Test updated', test });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.patch('/tests/:id/publish', async (req, res) => {
  try {
    const test = await Test.findById(req.params.id);
    if (!test) return res.status(404).json({ error: 'Not found' });
    test.isPublished = !test.isPublished;
    await test.save();
    res.json({ isPublished: test.isPublished });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.delete('/tests/:id', async (req, res) => {
  try {
    await Test.findByIdAndDelete(req.params.id);
    await Result.deleteMany({ testId: req.params.id });
    res.json({ message: 'Test and results deleted' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/tests/:id/results', async (req, res) => {
  try {
    const results = await Result.find({ testId: req.params.id, inProgress: false })
      .populate('userId', 'name email phone coachingName batch')
      .sort({ obtainedMarks: -1, timeTaken: 1 });
    res.json(results);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── Students ──────────────────────────────────────────────────────────
router.get('/students', async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 2000;
    const students = await User.find().select('-password -otp -otpExpiry').sort({ createdAt: -1 }).limit(limit);
    const total    = await User.countDocuments();
    res.json({ students, total });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── Ad Images ─────────────────────────────────────────────────────────
router.get('/ad-images', async (req, res) => {
  try { res.json(await AdImage.find().sort({ createdAt: -1 })); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/ad-images', upload.single('image'), async (req, res) => {
  try {
    let imageData = '';
    if (req.file) {
      imageData = 'data:' + req.file.mimetype + ';base64,' + req.file.buffer.toString('base64');
    }
    const img = await AdImage.create({
      title:       req.body.title       || '',
      description: req.body.description || '',
      imageData,
      redirectUrl: req.body.redirectUrl || '',
      showOnHome:  req.body.showOnHome !== 'false'
    });
    res.status(201).json({ message: 'Image uploaded', image: { _id: img._id, title: img.title, redirectUrl: img.redirectUrl, showOnHome: img.showOnHome } });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.put('/ad-images/:id', async (req, res) => {
  try {
    const img = await AdImage.findByIdAndUpdate(req.params.id, {
      title:       req.body.title       || '',
      description: req.body.description || '',
      redirectUrl: req.body.redirectUrl || '',
      showOnHome:  req.body.showOnHome !== false && req.body.showOnHome !== 'false'
    }, { new: true });
    if (!img) return res.status(404).json({ error: 'Not found' });
    res.json({ message: 'Updated', image: img });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.delete('/ad-images/:id', async (req, res) => {
  try {
    await AdImage.findByIdAndDelete(req.params.id);
    res.json({ message: 'Deleted' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
