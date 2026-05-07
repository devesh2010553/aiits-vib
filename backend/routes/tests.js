const express = require('express');
const router  = express.Router();
const Test    = require('../models/Test');
const Result  = require('../models/Result');
const { authenticateStudent } = require('../middleware/auth');

// ── Get all published tests ───────────────────────────────────────────
router.get('/', authenticateStudent, async (req, res) => {
  try {
    const tests = await Test.find({ isPublished: true, isActive: true })
      .select('title subject topic description duration totalMarks attemptCount startTime endTime adEnabled adImages targetBatches questions')
      .sort({ createdAt: -1 });

    const userResults = await Result.find({ userId: req.user._id })
      .select('testId obtainedMarks rank batchRank inProgress');

    const attemptedMap = {};
    userResults.forEach(r => { attemptedMap[r.testId.toString()] = r; });

    const testsWithStatus = tests.map(t => {
      const r = attemptedMap[t._id.toString()];
      return {
        ...t.toObject(),
        attempted:  !!r && !r.inProgress,
        inProgress: !!r && !!r.inProgress,
        myResult:   r ? { obtainedMarks: r.obtainedMarks, rank: r.rank, batchRank: r.batchRank } : null
      };
    });

    res.json(testsWithStatus);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── Get single test (strips answers for security) ─────────────────────
router.get('/:id', authenticateStudent, async (req, res) => {
  try {
    const test = await Test.findOne({ _id: req.params.id, isPublished: true, isActive: true });
    if (!test) return res.status(404).json({ error: 'Test not found or not available' });

    const existing = await Result.findOne({ userId: req.user._id, testId: test._id });
    if (existing && !existing.inProgress)
      return res.status(400).json({ error: 'You have already submitted this test', resultId: existing._id });

    // Strip correct answers from questions
    const testObj = test.toObject();
    testObj.questions = testObj.questions.map(q => ({
      ...q,
      options: q.options.map(o => ({ _id: o._id, text: o.text, imageData: o.imageData || '' })),
      isMultiChoice: q.isMultiChoice || false
      // correctOptions, isCorrect intentionally excluded
    }));

    // Resume data if in progress
    let resumeData = null;
    if (existing && existing.inProgress) {
      resumeData = {
        savedAnswers: existing.savedAnswers || {},
        violations:   existing.violations   || 0
      };
    }

    res.json({ ...testObj, resumeData });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── Get ad images for a test ──────────────────────────────────────────
router.get('/:id/ad', authenticateStudent, async (req, res) => {
  try {
    const test = await Test.findById(req.params.id)
      .select('adEnabled adImages adRedirectUrl adHtml')
      .populate('adImages', 'imageData redirectUrl title description');

    if (!test || !test.adEnabled || !test.adImages || !test.adImages.length)
      return res.json({ adEnabled: false, images: [] });

    res.json({
      adEnabled:     true,
      images:        test.adImages,
      adRedirectUrl: test.adRedirectUrl || '',
      adHtml:        test.adHtml        || ''
    });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── Auto-save progress ────────────────────────────────────────────────
router.post('/:id/save-progress', authenticateStudent, async (req, res) => {
  try {
    const { savedAnswers, violations } = req.body;
    await Result.findOneAndUpdate(
      { userId: req.user._id, testId: req.params.id },
      {
        $set: {
          savedAnswers:  savedAnswers  || {},
          violations:    violations    || 0,
          lastActiveAt:  new Date(),
          inProgress:    true
        }
      },
      { upsert: true, new: true }
    );
    res.json({ saved: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
