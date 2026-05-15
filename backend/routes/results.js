const express = require('express');
const router  = express.Router();
const Result  = require('../models/Result');
const Test    = require('../models/Test');
const User    = require('../models/User');
const { queueResult } = require('../utils/sheetsQueue');
const { authenticateStudent } = require('../middleware/auth');

async function calcRanks(testId, obtainedMarks, timeTaken, batch) {
  const [overall, batchRank] = await Promise.all([
    Result.countDocuments({ testId, inProgress: false, $or: [{ obtainedMarks: { $gt: obtainedMarks } }, { obtainedMarks, timeTaken: { $lt: timeTaken } }] }),
    Result.countDocuments({ testId, batch, inProgress: false, $or: [{ obtainedMarks: { $gt: obtainedMarks } }, { obtainedMarks, timeTaken: { $lt: timeTaken } }] })
  ]);
  return { overallRank: overall + 1, batchRank: batchRank + 1 };
}

router.post('/submit', authenticateStudent, async (req, res) => {
  try {
    const { testId, answers, startedAt, timeTaken } = req.body;
    const existing = await Result.findOne({ userId: req.user._id, testId });
    if (existing && !existing.inProgress) return res.status(400).json({ error: 'You have already submitted this test' });

    const test = await Test.findById(testId);
    if (!test) return res.status(404).json({ error: 'Test not found' });

    let obtainedMarks = 0, correctAnswers = 0, wrongAnswers = 0, notAttempted = 0;
    const processedAnswers = [];

    for (const question of test.questions) {
      const userAns = (answers || []).find(a => a.questionId === question._id.toString());
      if (question.isMultiChoice) {
        const selectedOpts = (userAns && userAns.selectedOptions) ? userAns.selectedOptions : [];
        const correctOpts = question.options.reduce((acc, o, i) => { if (o.isCorrect) acc.push(i); return acc; }, []);
        if (!selectedOpts.length) {
          notAttempted++;
          processedAnswers.push({ questionId: question._id, selectedOption: -1, selectedOptions: [], isCorrect: false, marksAwarded: 0 });
        } else {
          const isCorrect = correctOpts.every(i => selectedOpts.includes(i)) && selectedOpts.every(i => correctOpts.includes(i));
          const marksAwarded = isCorrect ? question.marks : -(question.negativeMarks || 0);
          if (isCorrect) correctAnswers++; else wrongAnswers++;
          obtainedMarks += marksAwarded;
          processedAnswers.push({ questionId: question._id, selectedOption: -1, selectedOptions: selectedOpts, isCorrect, marksAwarded });
        }
      } else {
        const sel = (userAns != null && userAns.selectedOption != null) ? userAns.selectedOption : -1;
        if (sel === -1) {
          notAttempted++;
          processedAnswers.push({ questionId: question._id, selectedOption: -1, isCorrect: false, marksAwarded: 0 });
        } else {
          const opt = question.options[sel];
          if (opt && opt.isCorrect) {
            correctAnswers++;
            obtainedMarks += question.marks;
            processedAnswers.push({ questionId: question._id, selectedOption: sel, isCorrect: true, marksAwarded: question.marks });
          } else {
            wrongAnswers++;
            const neg = question.negativeMarks || 0;
            obtainedMarks -= neg;
            processedAnswers.push({ questionId: question._id, selectedOption: sel, isCorrect: false, marksAwarded: -neg });
          }
        }
      }
    }

    obtainedMarks = Math.max(0, obtainedMarks);
    const tt = Math.max(0, timeTaken || 0);
    const { overallRank, batchRank } = await calcRanks(testId, obtainedMarks, tt, req.user.batch);
    const percentage = test.totalMarks > 0 ? Math.round(obtainedMarks / test.totalMarks * 1000) / 10 : 0;

    const resultData = {
      userId: req.user._id, testId,
      userName: req.user.name, userEmail: req.user.email,
      coachingName: req.user.coachingName, batch: req.user.batch,
      answers: processedAnswers, totalMarks: test.totalMarks, obtainedMarks,
      correctAnswers, wrongAnswers, notAttempted,
      timeTaken: tt, rank: overallRank, batchRank,
      startedAt: startedAt ? new Date(startedAt) : new Date(Date.now() - tt * 1000),
      submittedAt: new Date(), inProgress: false, savedAnswers: {}
    };

    let result;
    if (existing) {
      result = await Result.findOneAndUpdate({ userId: req.user._id, testId }, resultData, { new: true });
    } else {
      result = new Result(resultData);
      await result.save();
    }

    await Promise.all([
      Test.findByIdAndUpdate(testId, { $inc: { attemptCount: 1 } }),
      User.findByIdAndUpdate(req.user._id, { $inc: { totalTests: 1, totalMarks: obtainedMarks }, $max: { highestMarks: obtainedMarks } })
    ]);

    // Queue for Google Sheets (non-blocking, batched, won't fail submit)
    queueResult({
      submittedAt: new Date(), userName: req.user.name, userEmail: req.user.email,
      userPhone: req.user.phone || '', batch: req.user.batch, coachingName: req.user.coachingName,
      testTitle: test.title, subject: test.subject, topic: test.topic,
      obtainedMarks, totalMarks: test.totalMarks, percentage,
      correctAnswers, wrongAnswers, notAttempted, timeTaken: tt,
      rank: overallRank, batchRank, testId, userId: req.user._id
    });

    // Live ranking update via socket
    const io = req.app.get('io');
    if (io) {
      const top = await Result.find({ testId, inProgress: false })
        .sort({ obtainedMarks: -1, timeTaken: 1 }).limit(10)
        .select('userName coachingName obtainedMarks totalMarks timeTaken rank batch');
      io.to('test-' + testId).emit('ranking-update', { testId, rankings: top });
    }

    res.json({ message: 'Submitted successfully', result: { id: result._id, obtainedMarks, totalMarks: test.totalMarks, correctAnswers, wrongAnswers, notAttempted, timeTaken: tt, rank: overallRank, batchRank, batch: req.user.batch, percentage } });
  } catch (err) {
    console.error('[RESULTS] submit error:', err);
    res.status(500).json({ error: err.message || 'Submission failed' });
  }
});

router.get('/my/:testId', authenticateStudent, async (req, res) => {
  try {
    const result = await Result.findOne({ userId: req.user._id, testId: req.params.testId, inProgress: false });
    if (!result) return res.status(404).json({ error: 'Result not found' });
    const test = await Test.findById(req.params.testId);
    const { overallRank, batchRank } = await calcRanks(req.params.testId, result.obtainedMarks, result.timeTaken, result.batch);
    const [total, totalBatch] = await Promise.all([
      Result.countDocuments({ testId: req.params.testId, inProgress: false }),
      Result.countDocuments({ testId: req.params.testId, batch: result.batch, inProgress: false })
    ]);
    res.json({ result, test, rank: overallRank, batchRank, totalParticipants: total, totalBatchParticipants: totalBatch });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/my-results', authenticateStudent, async (req, res) => {
  try {
    const results = await Result.find({ userId: req.user._id, inProgress: false })
      .populate('testId', 'title subject topic totalMarks').sort({ submittedAt: -1 });
    res.json(results);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
