const mongoose = require('mongoose');

// Firebase Auth handles: email, password, forgot-password, email verification
// MongoDB stores: extra profile fields Firebase doesn't support
const userSchema = new mongoose.Schema({
  firebaseUid:      { type: String, required: true, unique: true }, // Firebase UID
  name:             { type: String, required: true, trim: true },
  email:            { type: String, required: true, unique: true, lowercase: true, trim: true },
  phone:            { type: String, required: true, unique: true, trim: true },
  coachingName:     { type: String, required: true, trim: true },
  fatherName:       { type: String, required: true, trim: true },
  fatherOccupation: { type: String, required: true, trim: true },
  whatsappNumber:   { type: String, required: true, trim: true },
  batch:            { type: String, enum: ['11','12','dropper'], required: true },
  totalTests:       { type: Number, default: 0 },
  totalMarks:       { type: Number, default: 0 },
  highestMarks:     { type: Number, default: 0 },
  lastLogin:        { type: Date }
}, { timestamps: true });

module.exports = mongoose.model('User', userSchema);
