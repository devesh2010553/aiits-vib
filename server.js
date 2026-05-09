require('dotenv').config();

const REQUIRED = ['MONGODB_URI','ADMIN_EMAIL','ADMIN_PASSWORD'];
const missing  = REQUIRED.filter(k => !process.env[k]);
if (missing.length) { console.error('[STARTUP] Missing env vars:', missing.join(', ')); process.exit(1); }
if (!process.env.JWT_SECRET) {
  process.env.JWT_SECRET = require('crypto').randomBytes(64).toString('hex');
  console.warn('[STARTUP] JWT_SECRET not set — add to Render env vars!');
}

const express      = require('express');
const http         = require('http');
const { Server }   = require('socket.io');
const mongoose     = require('mongoose');
const cookieParser = require('cookie-parser');
const cors         = require('cors');
const path         = require('path');
const rateLimit    = require('express-rate-limit');

const app    = express();
const server = http.createServer(app);
const io     = new Server(server, { cors: { origin: process.env.CLIENT_URL || '*', credentials: true } });
app.set('io', io);

// ── Security + CSP ────────────────────────────────────────────────────
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options',        'SAMEORIGIN');
  res.setHeader('X-XSS-Protection',       '1; mode=block');
  res.setHeader('Content-Security-Policy', [
    "default-src 'self'",
    // Inline scripts needed for single-file HTML + AdSense needs unsafe-inline
    "script-src 'self' 'unsafe-inline' 'unsafe-eval' " +
      "https://cdnjs.cloudflare.com " +
      "https://pagead2.googlesyndication.com " +
      "https://partner.googleadservices.com " +
      "https://tpc.googlesyndication.com " +
      "https://adservice.google.com " +
      "https://ep1.adtrafficquality.google " +
      "https://ep2.adtrafficquality.google " +
      "https://securepubads.g.doubleclick.net " +
      "https://www.googletagservices.com",
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com https://cdnjs.cloudflare.com",
    "font-src 'self' data: https://fonts.gstatic.com https://cdnjs.cloudflare.com",
    "img-src 'self' data: blob: https:",
    "connect-src 'self' wss: ws: https:",
    // AdSense needs frames
    "frame-src 'self' " +
      "https://googleads.g.doubleclick.net " +
      "https://tpc.googlesyndication.com " +
      "https://www.google.com",
    "worker-src 'self'"
  ].join('; '));
  next();
});

app.use(cors({ origin: process.env.CLIENT_URL || true, credentials: true }));
app.use(express.json({ limit: '20mb' }));
app.use(express.urlencoded({ extended: true, limit: '20mb' }));
app.use(cookieParser());

// Rate limits
app.use('/api/',                     rateLimit({ windowMs: 15*60*1000, max: 600 }));
app.use('/api/auth/forgot-password', rateLimit({ windowMs: 10*60*1000, max: 5   }));
app.use('/api/auth/login',           rateLimit({ windowMs:  5*60*1000, max: 20  }));
app.use('/api/auth/register',        rateLimit({ windowMs: 60*60*1000, max: 10  }));

// Static files
app.use(express.static(path.join(__dirname, 'frontend'), {
  setHeaders: (res, filePath) => {
    if (filePath.endsWith('sw.js')) {
      res.setHeader('Cache-Control',          'no-cache');
      res.setHeader('Service-Worker-Allowed', '/');
    }
    if (filePath.endsWith('.html')) {
      res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    }
  }
}));

// Utility
app.get('/ping',   (_, res) => res.status(200).json({ status: 'ok', ts: Date.now() }));
app.get('/health', (_, res) => res.json({ status: 'ok', uptime: process.uptime() }));

app.get('/robots.txt', (_, res) => {
  res.type('text/plain');
  res.send('User-agent: *\nAllow: /\nDisallow: /api/\nSitemap: https://aiits-msc.onrender.com/sitemap.xml');
});

app.get('/sitemap.xml', (_, res) => {
  const base = 'https://aiits-msc.onrender.com';
  const d    = new Date().toISOString().split('T')[0];
  res.type('application/xml');
  res.send(`<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><url><loc>${base}/</loc><lastmod>${d}</lastmod><priority>1.0</priority></url><url><loc>${base}/register</loc><priority>0.8</priority></url><url><loc>${base}/login</loc><priority>0.7</priority></url></urlset>`);
});

// Secret pages — no .html in URL
app.get('/adminvibacdonlineaiits', (_, res) =>
  res.sendFile(path.join(__dirname, 'frontend', 'adminvibacdonlineaiits.html')));
app.get('/ad856eyqafggg', (_, res) =>
  res.sendFile(path.join(__dirname, 'frontend', 'ad856eyqafggg.html')));

// API
app.use('/api/auth',     require('./backend/routes/auth'));
app.use('/api/admin',    require('./backend/routes/admin'));
app.use('/api/tests',    require('./backend/routes/tests'));
app.use('/api/results',  require('./backend/routes/results'));
app.use('/api/rankings', require('./backend/routes/rankings'));
app.use('/api/push',     require('./backend/routes/push'));

// Public gallery (no auth)
app.get('/api/public/ad-images', async (req, res) => {
  try {
    const AdImage = require('./backend/models/AdImage');
    const images  = await AdImage.find({ showOnHome: true })
      .select('imageData title redirectUrl description').sort({ createdAt: -1 });
    res.json(images);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// SPA fallback
app.get('*', (req, res) => {
  if (path.extname(req.path) && path.extname(req.path) !== '.html')
    return res.status(404).json({ error: 'Not found' });
  res.sendFile(path.join(__dirname, 'frontend', 'index.html'));
});

// Socket.IO
io.on('connection', socket => {
  socket.on('join-test',  id => socket.join('test-' + id));
  socket.on('leave-test', id => socket.leave('test-' + id));
  socket.on('join-admin', ()  => socket.join('admin-room'));
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => console.log('[SERVER] AIITS on port', PORT));

mongoose.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 15000 })
  .then(() => console.log('[DB] MongoDB connected'))
  .catch(err => console.error('[DB] MongoDB error:', err.message));

module.exports = { app, io };
