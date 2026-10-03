// index.js — Express + WebSocket server
const http = require('http');
const path = require('path');
const express = require('express');
const session = require('express-session');
const { WebSocketServer } = require('ws');

// minimal .env loader (zero-dep)
try { require('fs').readFileSync(path.join(__dirname, '..', '.env'), 'utf8')
  .split('\n').filter(l => l.trim() && !l.startsWith('#')).forEach(line => {
    const i = line.indexOf('=');
    if (i > 0) { const k = line.slice(0, i).trim(), v = line.slice(i + 1).trim();
      if (!(k in process.env)) process.env[k] = v; }
  }); } catch {}

const { router: authRouter, requireAdmin } = require('./auth');
const apiRouter = require('./routes/api');
const adminRouter = require('./routes/admin');

const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '64kb' }));
app.use(express.urlencoded({ extended: false }));

const ONE_DAY = 24 * 60 * 60 * 1000;
app.use(session({
  secret: process.env.SESSION_SECRET || 'dev-secret-change-me',
  resave: false,
  saveUninitialized: false,
  cookie: { httpOnly: true, sameSite: 'lax', maxAge: ONE_DAY }
}));

// static dashboard assets
app.use(express.static(path.join(__dirname, '..', 'public')));

app.get('/', (req, res) => res.redirect('/admin'));
app.use(authRouter);
// admin dashboard shell
app.get('/admin', requireAdmin, (req, res) => {
  res.sendFile('dashboard.html', { root: path.join(__dirname, '..', 'public') });
});

app.use(apiRouter);     // device ingest (token auth)
app.use(adminRouter);   // admin API (session auth)

// 404 + error guard
app.use((req, res) => res.status(404).send('Not found'));
app.use((err, req, res, _next) => {
  console.error(err);
  res.status(500).send('Server error');
});

const PORT = Number(process.env.PORT) || 3000;
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

wss.on('connection', (ws, req) => {
  const url = new URL(req.url, 'http://localhost');
  if (url.pathname !== '/live') { ws.close(); return; }
});

global.wss = wss;

server.listen(PORT, () => {
  console.log(`location-tracker server listening on http://0.0.0.0:${PORT}`);
  console.log(`dashboard: http://localhost:${PORT}/admin`);
});
