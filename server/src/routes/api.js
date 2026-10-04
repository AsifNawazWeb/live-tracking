// api.js — device-facing ingest endpoint (token auth)
const express = require('express');
const { db, newToken } = require('../db');
const { checkRegistrationKey } = require('../auth');

const router = express.Router();

// UK National Insurance number: 2 valid prefix letters, 6 digits, 1 suffix letter (A-D) or space
const NI_RE = /^[ABCEGHJ-NPRSTW-Z]{2}\d{6}[A-D ]$/;

router.post('/api/v1/location', (req, res) => {
  const { token, lat, lng, accuracy, speed, bearing, battery } = req.body || {};
  if (!token || typeof lat !== 'number' || typeof lng !== 'number') {
    return res.status(400).json({ error: 'token, lat, lng required' });
  }
  const emp = db.prepare('SELECT id, active FROM employees WHERE device_token = ?').get(token);
  if (!emp) return res.status(404).json({ error: 'unknown token' });
  if (!emp.active) return res.status(403).json({ error: 'deactivated' });

  db.prepare(`INSERT INTO locations (employee_id, lat, lng, accuracy, speed, bearing, battery)
              VALUES (?, ?, ?, ?, ?, ?, ?)`)
    .run(emp.id, lat, lng,
         numOrNull(accuracy), numOrNull(speed), numOrNull(bearing),
         intOrNull(battery));

  broadcast({ type: 'location', employee_id: emp.id, lat, lng,
              accuracy: numOrNull(accuracy), speed: numOrNull(speed),
              bearing: numOrNull(bearing), battery: intOrNull(battery),
              recorded_at: new Date().toISOString() });
  res.json({ ok: true });
});

// lightweight reachability check for the app
router.get('/api/v1/ping', (req, res) => {
  const { token } = req.query;
  const emp = token && db.prepare('SELECT active FROM employees WHERE device_token = ?').get(token);
  if (!emp) return res.status(404).json({ error: 'unknown token' });
  res.json({ ok: true, active: !!emp.active });
});

// self-registration from the app's first-run form.
// Upserts by email: reinstalling the app on the same person's phone refreshes
// their record instead of creating a duplicate. Returns the device token so
// tracking can start immediately.
router.post('/api/v1/register', (req, res) => {
  if (!checkRegistrationKey(req)) {
    return res.status(401).json({ error: 'invalid registration key' });
  }
  const raw = req.body || {};
  const trim = v => typeof v === 'string' ? v.trim() : '';
  const name = trim(raw.name);
  const email = trim(raw.email).toLowerCase();
  const ni = trim(raw.ni_number).toUpperCase().replace(/\s+/g, ' ');
  const phone = trim(raw.phone).replace(/[\s()-]/g, '');
  const deviceName = trim(raw.device_name) || null;

  if (!name || name.length > 100) return fail(res, 'name', 'Enter your full name');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return fail(res, 'email', 'Enter a valid email address');
  if (!NI_RE.test(ni)) return fail(res, 'ni_number', 'Enter a valid National Insurance number (e.g. AB123456C)');
  if (!/^(\+44|0)\d{9,10}$/.test(phone)) return fail(res, 'phone', 'Enter a valid UK phone number');
  if (raw.consent !== true) return fail(res, 'consent', 'Location tracking consent is required');

  const token = newToken();
  const existing = db.prepare('SELECT id, active FROM employees WHERE email = ?').get(email);
  let id;
  if (existing) {
    id = existing.id;
    db.prepare(`UPDATE employees
                SET name = ?, ni_number = ?, phone = ?, device_name = ?,
                    device_token = ?, consented_at = datetime('now')
                WHERE id = ?`)
      .run(name, ni, phone, deviceName, token, id);
  } else {
    const info = db.prepare(`INSERT INTO employees
                (name, email, ni_number, phone, device_name, device_token)
                VALUES (?, ?, ?, ?, ?, ?)`)
      .run(name, email, ni, phone, deviceName, token);
    id = info.lastInsertRowid;
  }
  const active = !!db.prepare('SELECT active FROM employees WHERE id = ?').get(id).active;
  res.status(201).json({ ok: true, token, active, employee_id: id });
});

function fail(res, field, message) {
  return res.status(400).json({ error: message, field });
}

function numOrNull(v) { return typeof v === 'number' && isFinite(v) ? v : null; }
function intOrNull(v) { return Number.isInteger(v) ? v : null; }

function broadcast(msg) {
  if (!global.wss) return;
  const data = JSON.stringify(msg);
  for (const client of global.wss.clients) {
    if (client.readyState === 1) client.send(data);
  }
}

module.exports = router;
