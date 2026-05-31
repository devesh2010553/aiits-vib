/**
 * routes/chat.js
 * Public in-memory chat — no DB storage.
 * Admin can mute/unmute. Messages broadcast via socket.io.
 */
const express = require('express');
const router  = express.Router();
const { authenticateStudent, authenticateAdmin } = require('../middleware/auth');

// In-memory state (resets on server restart — by design, no DB)
let chatMuted   = false;
let onlineCount = 0;

// GET chat status (public)
router.get('/status', (req, res) => {
  res.json({ muted: chatMuted });
});

// POST toggle mute — admin only
router.post('/mute', authenticateAdmin, (req, res) => {
  chatMuted = !chatMuted;
  const io = req.app.get('io');
  if (io) io.emit('chat-mute-changed', { muted: chatMuted });
  res.json({ muted: chatMuted });
});

module.exports = router;
