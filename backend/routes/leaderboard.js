/**
 * routes/leaderboard.js
 *
 * Three leaderboard types:
 * 1. Per-test ranking       GET /leaderboard/test/:testId
 * 2. Overall (percentage)   GET /leaderboard/overall?batch=
 *    Rank by: (sum of obtained marks / sum of total marks) * 100
 *    Tiebreak: total time taken ascending
 * 3. Normalised cross-batch GET /leaderboard/normalised
 *    Each student's score = percentage across all attempted tests
 *    Fair across batches since 80/80 = 100% = 85/100 = 85%
 */
const express     = require('express');
const router      = express.Router();
const Result      = require('../models/Result');
const UserProfile = require('../models/UserProfile');
const { authenticateStudent } = require('../middleware/auth');

// ── 1. Per-test ranking ────────────────────────────────────────────────────
router.get('/test/:testId', authenticateStudent, async (req, res) => {
  try {
    const { batch } = req.query;
    const filter = { testId: req.params.testId, inProgress: false };
    if (batch) filter.batch = batch;

    const results = await Result.find(filter)
      .sort({ obtainedMarks: -1, timeTaken: 1 })
      .limit(500)
      .select('userName userEmail coachingName obtainedMarks totalMarks timeTaken submittedAt batch userId');

    // My rank
    let myRank = null, myResult = null;
    if (req.user) {
      myResult = await Result.findOne({ userId: req.user._id, testId: req.params.testId, inProgress: false });
      if (myResult) {
        const above = await Result.countDocuments({
          ...filter,
          $or: [
            { obtainedMarks: { $gt: myResult.obtainedMarks } },
            { obtainedMarks: myResult.obtainedMarks, timeTaken: { $lt: myResult.timeTaken } }
          ]
        });
        myRank = above + 1;
      }
    }

    const bMap = { '11': 'Class 11', '12': 'Class 12', dropper: 'Dropper' };
    const sanitized = results.map((r, i) => {
      const o = r.toObject();
      if (o.userEmail) { const p = o.userEmail.split('@'); o.userEmail = p[0].slice(0,2) + '***@' + (p[1]||''); }
      return { ...o, rank: i + 1, percentage: o.totalMarks ? ((o.obtainedMarks / o.totalMarks) * 100).toFixed(1) : '0.0', batchLabel: bMap[o.batch] || o.batch };
    });

    res.json({ rankings: sanitized, total: sanitized.length, myRank, myResult: myResult ? { obtainedMarks: myResult.obtainedMarks, totalMarks: myResult.totalMarks, timeTaken: myResult.timeTaken } : null });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── 2. Overall leaderboard (percentage-based) ─────────────────────────────
router.get('/overall', authenticateStudent, async (req, res) => {
  try {
    const { batch } = req.query;

    // Aggregate per student: sum obtained, sum total, sum time
    const pipeline = [
      { $match: { inProgress: false } },
      { $group: {
          _id: '$userId',
          totalObtained: { $sum: '$obtainedMarks' },
          totalPossible: { $sum: '$totalMarks'    },
          totalTime:     { $sum: '$timeTaken'     },
          testCount:     { $sum: 1                },
          userName:      { $last: '$userName'     },
          coachingName:  { $last: '$coachingName' },
          batch:         { $last: '$batch'        },
      }},
      { $match: { testCount: { $gte: 1 } } },
    ];
    if (batch) pipeline.splice(1, 0, { $match: { batch } });

    let rows = await Result.aggregate(pipeline);

    // Calculate percentage and sort
    rows = rows.map(r => ({
      ...r,
      percentage: r.totalPossible > 0 ? (r.totalObtained / r.totalPossible * 100) : 0,
    })).sort((a, b) => b.percentage - a.percentage || a.totalTime - b.totalTime);

    const bMap = { '11': 'Class 11', '12': 'Class 12', dropper: 'Dropper' };
    res.json(rows.map((r, i) => ({
      rank:         i + 1,
      name:         r.userName     || 'Unknown',
      coachingName: r.coachingName || '--',
      batch:        bMap[r.batch]  || r.batch || '--',
      testCount:    r.testCount,
      totalObtained:r.totalObtained,
      totalPossible:r.totalPossible,
      percentage:   r.percentage.toFixed(2),
      totalTime:    r.totalTime,
    })));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── 3. Normalised cross-batch leaderboard ─────────────────────────────────
// Same as overall but always includes ALL batches, sorted by percentage
router.get('/normalised', authenticateStudent, async (req, res) => {
  try {
    const rows = await Result.aggregate([
      { $match: { inProgress: false } },
      { $group: {
          _id:          '$userId',
          totalObtained:{ $sum: '$obtainedMarks' },
          totalPossible:{ $sum: '$totalMarks'    },
          totalTime:    { $sum: '$timeTaken'     },
          testCount:    { $sum: 1                },
          userName:     { $last: '$userName'     },
          coachingName: { $last: '$coachingName' },
          batch:        { $last: '$batch'        },
      }},
      { $match: { testCount: { $gte: 1 }, totalPossible: { $gt: 0 } } },
    ]);

    const bMap = { '11': 'Class 11', '12': 'Class 12', dropper: 'Dropper' };
    const sorted = rows
      .map(r => ({ ...r, percentage: r.totalObtained / r.totalPossible * 100 }))
      .sort((a, b) => b.percentage - a.percentage || a.totalTime - b.totalTime)
      .map((r, i) => ({
        rank:         i + 1,
        name:         r.userName     || 'Unknown',
        coachingName: r.coachingName || '--',
        batch:        bMap[r.batch]  || r.batch || '--',
        testCount:    r.testCount,
        totalObtained:r.totalObtained,
        totalPossible:r.totalPossible,
        percentage:   r.percentage.toFixed(2),
        totalTime:    r.totalTime,
      }));

    res.json(sorted);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
