const mongoose = require('mongoose');

const optionSchema = new mongoose.Schema({
  text:      { type: String, required: true },
  isCorrect: { type: Boolean, default: false }
});

const questionSchema = new mongoose.Schema({
  questionText:    { type: String, required: true },
  questionImage:   { type: String },          // base64 or URL
  options:         [optionSchema],
  isMultiChoice:   { type: Boolean, default: false },   // multiple correct answers
  correctOptions:  [{ type: Number }],        // indices of correct options (for multi)
  marks:           { type: Number, default: 4 },
  negativeMarks:   { type: Number, default: 1 },
  explanation:     { type: String }
});

const testSchema = new mongoose.Schema({
  title:        { type: String, required: true, trim: true },
  subject:      { type: String, required: true, trim: true },
  topic:        { type: String, required: true, trim: true },
  description:  { type: String },
  duration:     { type: Number, required: true },   // minutes
  totalMarks:   { type: Number },
  questions:    [questionSchema],
  isActive:     { type: Boolean, default: true },
  isPublished:  { type: Boolean, default: false },
  startTime:    { type: Date },
  endTime:      { type: Date },
  // Ad content: array of image refs from AdImage collection
  adEnabled:    { type: Boolean, default: false },
  adImages:     [{ type: mongoose.Schema.Types.ObjectId, ref: 'AdImage' }],
  adRedirectUrl:{ type: String },             // URL clicking ad goes to
  adHtml:       { type: String },             // optional extra HTML
  createdBy:    { type: String, default: 'Admin' },
  attemptCount: { type: Number, default: 0 },
  // Target batches — empty = all batches
  targetBatches: [{ type: String, enum: ['11','12','dropper'] }]
}, { timestamps: true });

testSchema.pre('save', function(next) {
  if (this.questions && this.questions.length > 0) {
    this.totalMarks = this.questions.reduce((sum, q) => sum + q.marks, 0);
  }
  next();
});

module.exports = mongoose.model('Test', testSchema);
