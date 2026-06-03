/**
 * routes/chat.js
 * Public in-memory chat — no DB storage.
 * Admin can mute/unmute. Messages broadcast via socket.io.
 */
const express = require('express');
const router  = express.Router();
const { authenticateStudent, authenticateAdmin } = require('../middleware/auth');

// Chat state lives in app.set/get (set in server.js)

// GET chat status (public) - clients call on page load to restore mute state
router.get('/status', (req, res) => {
  // chatMuted lives in server.js app locals
  res.json({ muted: req.app.get('chatMuted') || false });
});

// POST toggle mute — admin only
router.post('/mute', authenticateAdmin, (req, res) => {
  const current = req.app.get('chatMuted') || false;
  const next = !current;
  req.app.set('chatMuted', next);
  const io = req.app.get('io');
  if (io) io.emit('chat-mute-changed', { muted: next });
  res.json({ muted: next });
});

module.exports = router;
