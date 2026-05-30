require('dotenv').config();

const REQUIRED = ['MONGODB_URI','ADMIN_EMAIL','ADMIN_PASSWORD','FIREBASE_SERVICE_ACCOUNT_JSON'];
const missing  = REQUIRED.filter(k => !process.env[k]);
if (missing.length) { console.error('[STARTUP] Missing env vars:', missing.join(', ')); process.exit(1); }
if (!process.env.JWT_SECRET) {
  process.env.JWT_SECRET = require('crypto').randomBytes(64).toString('hex');
  console.warn('[STARTUP] JWT_SECRET not set -- add to Render env!');
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

// Init Firebase Admin early so it's ready for all requests
try {
  require('./backend/utils/firebase').getAdmin();
} catch (e) {
  console.error('[FIREBASE] Init failed:', e.message);
}

app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  next();
});

app.use(cors({ origin: process.env.CLIENT_URL || true, credentials: true }));
app.use(express.json({ limit: '20mb' }));
app.use(express.urlencoded({ extended: true, limit: '20mb' }));
app.use(cookieParser());

app.use('/api/',                     rateLimit({ windowMs: 15*60*1000, max: 600 }));
app.use('/api/auth/verify-token',    rateLimit({ windowMs:  5*60*1000, max: 20  }));
app.use('/api/auth/register',        rateLimit({ windowMs: 60*60*1000, max: 10  }));

app.use(express.static(path.join(__dirname, 'frontend'), {
  setHeaders: (res, fp) => {
    if (fp.endsWith('sw.js'))  { res.setHeader('Cache-Control', 'no-cache'); res.setHeader('Service-Worker-Allowed', '/'); }
    if (fp.endsWith('.html'))    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  }
}));

app.get('/ping',        (_, res) => res.status(200).json({ status: 'ok', ts: Date.now() }));
app.get('/health',      (_, res) => res.json({ status: 'ok', uptime: process.uptime() }));
app.get('/favicon.ico', (_, res) => res.status(204).end());
app.get('/robots.txt',  (_, res) => { res.type('text/plain'); res.send('User-agent: *\nAllow: /\nDisallow: /api/\n'); });

app.get('/adminvibacdonlineaiits', (_, res) =>
  res.sendFile(path.join(__dirname, 'frontend', 'adminvibacdonlineaiits.html')));
app.get('/ad856eyqafggg', (_, res) =>
  res.sendFile(path.join(__dirname, 'frontend', 'ad856eyqafggg.html')));

app.use('/api/auth',     require('./backend/routes/auth'));
app.use('/api/admin',    require('./backend/routes/admin'));
app.use('/api/tests',    require('./backend/routes/tests'));
app.use('/api/results',  require('./backend/routes/results'));
app.use('/api/rankings', require('./backend/routes/rankings'));
app.use('/api/push',     require('./backend/routes/push'));

app.get('/api/public/ad-images', async (req, res) => {
  try {
    const AdImage = require('./backend/models/AdImage');
    res.json(await AdImage.find({ showOnHome: true }).select('imageData title redirectUrl description').sort({ createdAt: -1 }));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('*', (req, res) => {
  if (path.extname(req.path) && path.extname(req.path) !== '.html')
    return res.status(404).json({ error: 'Not found' });
  res.sendFile(path.join(__dirname, 'frontend', 'index.html'));
});

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
