const express = require('express');
const router  = express.Router();
const Test    = require('../models/Test');
const Result  = require('../models/Result');
const { authenticateStudent } = require('../middleware/auth');

router.get('/', authenticateStudent, async (req, res) => {
  try {
    const tests = await Test.find({ isPublished:true, isActive:true }).select('title subject topic description duration totalMarks attemptCount startTime endTime adEnabled adImages targetBatches questions').sort({ createdAt:-1 });
    const userResults = await Result.find({ userId:req.user._id }).select('testId obtainedMarks rank batchRank inProgress');
    const map = {};
    userResults.forEach(r => { map[r.testId.toString()] = r; });
    res.json(tests.map(t => ({ ...t.toObject(), attempted:!!map[t._id.toString()]&&!map[t._id.toString()].inProgress, inProgress:!!map[t._id.toString()]&&!!map[t._id.toString()].inProgress, myResult:map[t._id.toString()]?{ obtainedMarks:map[t._id.toString()].obtainedMarks, rank:map[t._id.toString()].rank, batchRank:map[t._id.toString()].batchRank }:null })));
  } catch(err) { res.status(500).json({ error:err.message }); }
});

router.get('/:id', authenticateStudent, async (req, res) => {
  try {
    const test = await Test.findOne({ _id:req.params.id, isPublished:true, isActive:true });
    if (!test) return res.status(404).json({ error:'Test not found' });
    const existing = await Result.findOne({ userId:req.user._id, testId:test._id });
    if (existing&&!existing.inProgress) return res.status(400).json({ error:'Already submitted', resultId:existing._id });
    const obj = test.toObject();
    obj.questions = obj.questions.map(q => ({ ...q, options:q.options.map(o => ({ _id:o._id, text:o.text, imageData:o.imageData||'' })), isMultiChoice:q.isMultiChoice||false }));
    let resumeData = null;
    if (existing&&existing.inProgress) resumeData = { savedAnswers:existing.savedAnswers||{}, violations:existing.violations||0 };
    res.json({ ...obj, resumeData });
  } catch(err) { res.status(500).json({ error:err.message }); }
});

router.get('/:id/ad', authenticateStudent, async (req, res) => {
  try {
    const test = await Test.findById(req.params.id).select('adEnabled adImages adRedirectUrl adHtml').populate('adImages','imageData redirectUrl title description');
    if (!test||!test.adEnabled||!test.adImages||!test.adImages.length) return res.json({ adEnabled:false, images:[] });
    res.json({ adEnabled:true, images:test.adImages, adRedirectUrl:test.adRedirectUrl||'', adHtml:test.adHtml||'' });
  } catch(err) { res.status(500).json({ error:err.message }); }
});

router.post('/:id/save-progress', authenticateStudent, async (req, res) => {
  try {
    const { savedAnswers, violations } = req.body;
    await Result.findOneAndUpdate({ userId:req.user._id, testId:req.params.id }, { $set:{ savedAnswers:savedAnswers||{}, violations:violations||0, lastActiveAt:new Date(), inProgress:true } }, { upsert:true, new:true });
    res.json({ saved:true });
  } catch(err) { res.status(500).json({ error:err.message }); }
});

module.exports = router;
