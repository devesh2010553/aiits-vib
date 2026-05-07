const mongoose = require('mongoose');
// Compact leaderboard archive — saved before results are deleted to save storage
const snapshotSchema = new mongoose.Schema({
  testId:    { type: mongoose.Schema.Types.ObjectId, ref: 'Test', required: true },
  testTitle: { type: String },
  batch:     { type: String, enum: ['11','12','dropper','all'], default: 'all' },
  entries: [{
    rank:         Number,
    userId:       mongoose.Schema.Types.ObjectId,
    userName:     String,
    userEmail:    String,
    coachingName: String,
    batch:        String,
    obtainedMarks:Number,
    totalMarks:   Number,
    timeTaken:    Number
  }],
  totalParticipants: { type: Number, default: 0 },
  archivedAt: { type: Date, default: Date.now }
}, { timestamps: true });
snapshotSchema.index({ testId: 1, batch: 1 });
module.exports = mongoose.model('LeaderboardSnapshot', snapshotSchema);
