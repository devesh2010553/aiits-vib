const express  = require('express');
const router   = express.Router();
const multer   = require('multer');
const mongoose = require('mongoose');
const Test     = require('../models/Test');
const User     = require('../models/User');
const Result   = require('../models/Result');
const AdImage  = require('../models/AdImage');
const { authenticateAdmin } = require('../middleware/auth');

router.use(authenticateAdmin);
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 8 * 1024 * 1024 } });

// Stats
router.get('/stats', async (req, res) => {
  try {
    const [totalTests, totalStudents, totalAttempts] = await Promise.all([
      Test.countDocuments(), User.countDocuments(),
      Result.countDocuments({ inProgress: false })
    ]);
    let storageInfo = null;
    try {
      const s = await mongoose.connection.db.stats();
      const used = Math.round(s.dataSize/1024/1024*10)/10;
      storageInfo = { usedMB: used, totalMB: 512, usedPct: Math.round(used/512*100), freesMB: Math.round((512-used)*10)/10 };
    } catch(e) {}
    let sheetStats = null;
    try { sheetStats = await require('../utils/sheets').getSheetStats(); } catch(e) {}
    res.json({ totalTests, totalStudents, totalAttempts, storageInfo, sheetStats });
  } catch(err) { res.status(500).json({ error: err.message }); }
});

// Tests CRUD
router.get('/tests', async (req, res) => {
  try { res.json(await Test.find().sort({ createdAt: -1 })); }
  catch(err) { res.status(500).json({ error: err.message }); }
});

router.post('/tests', async (req, res) => {
  try { res.status(201).json({ message: 'Test created', test: await new Test(req.body).save() }); }
  catch(err) { res.status(500).json({ error: err.message }); }
});

router.put('/tests/:id', async (req, res) => {
  try {
    const test = await Test.findByIdAndUpdate(req.params.id, req.body, { new: true });
    if (!test) return res.status(404).json({ error: 'Not found' });
    res.json({ message: 'Updated', test });
  } catch(err) { res.status(500).json({ error: err.message }); }
});

router.patch('/tests/:id/publish', async (req, res) => {
  try {
    const test = await Test.findById(req.params.id);
    if (!test) return res.status(404).json({ error: 'Not found' });
    test.isPublished = !test.isPublished;
    await test.save();
    res.json({ isPublished: test.isPublished });
  } catch(err) { res.status(500).json({ error: err.message }); }
});

// Delete entire test + its results
router.delete('/tests/:id', async (req, res) => {
  try {
    await Promise.all([Test.findByIdAndDelete(req.params.id), Result.deleteMany({ testId: req.params.id })]);
    res.json({ message: 'Test and all results deleted' });
  } catch(err) { res.status(500).json({ error: err.message }); }
});

// DELETE RESULTS for a test by batch — THIS was missing (404 error)
router.delete('/tests/:id/results', async (req, res) => {
  try {
    const testId = req.params.id;
    const batch  = req.query.batch;
    const filter = { testId, inProgress: false };
    if (batch && batch !== 'all') filter.batch = batch;

    // Get affected users
    const affected = await Result.find(filter).select('userId obtainedMarks');
    const userIds  = [...new Set(affected.map(r => String(r.userId)))];

    // Delete from MongoDB
    const del = await Result.deleteMany(filter);

    // Recalculate user stats
    for (const uid of userIds) {
      const rem = await Result.find({ userId: uid, inProgress: false });
      await User.findByIdAndUpdate(uid, {
        totalTests:   rem.length,
        totalMarks:   rem.reduce((s,r) => s+(r.obtainedMarks||0), 0),
        highestMarks: rem.length ? Math.max(...rem.map(r=>r.obtainedMarks||0)) : 0
      });
    }
    // Update test attempt count
    await Test.findByIdAndUpdate(testId, { attemptCount: await Result.countDocuments({ testId, inProgress: false }) });

    res.json({ deleted: del.deletedCount, message: 'Results deleted from MongoDB' });
  } catch(err) {
    console.error('[ADMIN] delete results:', err);
    res.status(500).json({ error: err.message });
  }
});

router.get('/tests/:id/results', async (req, res) => {
  try {
    res.json(await Result.find({ testId: req.params.id, inProgress: false })
      .populate('userId','name email phone coachingName batch')
      .sort({ obtainedMarks: -1, timeTaken: 1 }));
  } catch(err) { res.status(500).json({ error: err.message }); }
});

// Students
router.get('/students', async (req, res) => {
  try {
    const limit = parseInt(req.query.limit)||2000;
    const [students, total] = await Promise.all([
      User.find().select('-password -otp -otpExpiry').sort({ createdAt: -1 }).limit(limit),
      User.countDocuments()
    ]);
    res.json({ students, total });
  } catch(err) { res.status(500).json({ error: err.message }); }
});

// Delete specific student
router.delete('/students/:id', async (req, res) => {
  try {
    await Promise.all([User.findByIdAndDelete(req.params.id), Result.deleteMany({ userId: req.params.id })]);
    res.json({ message: 'Student and their results deleted' });
  } catch(err) { res.status(500).json({ error: err.message }); }
});

// Delete entire batch
router.delete('/students/batch/:batch', async (req, res) => {
  try {
    const batch = req.params.batch;
    if (!['11','12','dropper'].includes(batch)) return res.status(400).json({ error: 'Invalid batch' });
    const users   = await User.find({ batch }).select('_id');
    const userIds = users.map(u => u._id);
    const [uDel, rDel] = await Promise.all([
      User.deleteMany({ batch }),
      Result.deleteMany({ userId: { $in: userIds } })
    ]);
    res.json({ deletedStudents: uDel.deletedCount, deletedResults: rDel.deletedCount });
  } catch(err) { res.status(500).json({ error: err.message }); }
});

// Ad Images
router.get('/ad-images', async (req, res) => {
  try { res.json(await AdImage.find().sort({ createdAt: -1 })); }
  catch(err) { res.status(500).json({ error: err.message }); }
});

router.post('/ad-images', upload.single('image'), async (req, res) => {
  try {
    const imageData = req.file ? 'data:'+req.file.mimetype+';base64,'+req.file.buffer.toString('base64') : '';
    const img = await AdImage.create({
      title: req.body.title||'', description: req.body.description||'',
      imageData, redirectUrl: req.body.redirectUrl||'',
      showOnHome: req.body.showOnHome !== 'false'
    });
    res.status(201).json({ message: 'Uploaded', image: { _id: img._id, title: img.title, redirectUrl: img.redirectUrl, showOnHome: img.showOnHome } });
  } catch(err) { res.status(500).json({ error: err.message }); }
});

router.put('/ad-images/:id', async (req, res) => {
  try {
    const img = await AdImage.findByIdAndUpdate(req.params.id, {
      title: req.body.title||'', description: req.body.description||'',
      redirectUrl: req.body.redirectUrl||'',
      showOnHome: req.body.showOnHome !== false && req.body.showOnHome !== 'false'
    }, { new: true });
    if (!img) return res.status(404).json({ error: 'Not found' });
    res.json({ message: 'Updated', image: img });
  } catch(err) { res.status(500).json({ error: err.message }); }
});

router.delete('/ad-images/:id', async (req, res) => {
  try { await AdImage.findByIdAndDelete(req.params.id); res.json({ message: 'Deleted' }); }
  catch(err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
