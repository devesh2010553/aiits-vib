const express     = require('express');
const router      = express.Router();
const Result      = require('../models/Result');
const UserProfile = require('../models/UserProfile');
const { authenticateStudent } = require('../middleware/auth');

router.get('/test/:testId', authenticateStudent, async (req, res) => {
  try {
    const batch = req.query.batch||'';
    const limit = Math.min(parseInt(req.query.limit)||200, 500);
    const filter = { testId:req.params.testId, inProgress:false };
    if (batch) filter.batch = batch;
    const [results, total] = await Promise.all([
      Result.find(filter).sort({ obtainedMarks:-1, timeTaken:1 }).limit(limit)
        .select('userName userEmail coachingName obtainedMarks totalMarks timeTaken submittedAt batch rank batchRank'),
      Result.countDocuments(filter)
    ]);
    let myRank=null, myResult=null;
    if (req.user) {
      myResult = await Result.findOne({ userId:req.user._id, testId:req.params.testId, inProgress:false });
      if (myResult) {
        const above = await Result.countDocuments({ ...filter, $or:[{ obtainedMarks:{ $gt:myResult.obtainedMarks } },{ obtainedMarks:myResult.obtainedMarks, timeTaken:{ $lt:myResult.timeTaken } }] });
        myRank = above+1;
      }
    }
    const sanitized = results.map((r,i) => {
      const obj = r.toObject();
      if (obj.userEmail) {
        const parts = obj.userEmail.split('@');
        obj.userEmail = parts[0].substring(0,2) + '***@' + (parts[1]||'');
      }
      return { ...obj, rank: i+1 };
    });
    res.json({ rankings:sanitized, total, myRank, myResult: myResult ? { obtainedMarks:myResult.obtainedMarks, totalMarks:myResult.totalMarks, rank:myResult.rank, batchRank:myResult.batchRank } : null });
  } catch(err) { res.status(500).json({ error:err.message }); }
});

router.get('/leaderboard', authenticateStudent, async (req, res) => {
  try {
    const batch = req.query.batch||'';
    const filter = { totalTests:{ $gt:0 } };
    if (batch) filter.batch = batch;
    const users = await UserProfile.find(filter).select('name coachingName batch totalTests totalMarks highestMarks').sort({ totalMarks:-1, highestMarks:-1 }).limit(200);
    res.json(users.map((u,i) => ({ ...u.toObject(), rank:i+1 })));
  } catch(err) { res.status(500).json({ error:err.message }); }
});

router.get('/top-performers', async (req, res) => {
  try {
    const top = await UserProfile.find({ totalTests:{ $gt:0 } }).select('name coachingName batch totalMarks').sort({ totalMarks:-1 }).limit(10);
    res.json(top.map((u,i) => ({ ...u.toObject(), rank:i+1 })));
  } catch(err) { res.status(500).json({ error:err.message }); }
});

module.exports = router;
