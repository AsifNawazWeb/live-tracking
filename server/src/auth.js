// auth.js — admin session login
const express = require('express');
const bcrypt = require('bcrypt');

const router = express.Router();

const ADMIN_USER = process.env.ADMIN_USER || 'admin';
const ADMIN_HASH = process.env.ADMIN_PASSWORD_HASH || '';

function requireAdmin(req, res, next) {
  if (req.session && req.session.admin) return next();
  if (req.originalUrl.startsWith('/api/')) {
    return res.status(401).json({ error: 'unauthorized' });
  }
  return res.redirect('/login');
}

// optional shared secret protecting the app's self-registration endpoint;
// unset REGISTRATION_KEY in .env to leave it open.
function checkRegistrationKey(req) {
  const expected = process.env.REGISTRATION_KEY;
  if (!expected) return true;
  const got = req.get('X-Registration-Key') || '';
  const a = Buffer.from(got);
  const b = Buffer.from(expected);
  return a.length === b.length && require('crypto').timingSafeEqual(a, b);
}

router.get('/login', (req, res) => {
  res.sendFile('login.html', { root: 'public' });
});

router.post('/login', (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password || typeof password !== 'string') {
    return res.status(401).send('Invalid credentials');
  }
  let ok = username === ADMIN_USER;
  if (ok && ADMIN_HASH && ADMIN_HASH.startsWith('$2')) {
    ok = bcrypt.compareSync(password, ADMIN_HASH);
  } else if (ok) {
    // No ADMIN_PASSWORD_HASH configured: accept "admin" as bootstrap password.
    ok = password === 'admin';
  }
  if (!ok) return res.status(401).send('Invalid credentials');
  req.session.admin = true;
  res.redirect('/admin');
});

router.post('/logout', requireAdmin, (req, res) => {
  req.session.destroy(() => res.redirect('/login'));
});

module.exports = { router, requireAdmin, checkRegistrationKey };
