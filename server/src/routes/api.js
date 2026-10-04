// api.js — device-facing ingest endpoint (token auth)
const express = require('express');
const { db, newToken, trackingPaused } = require('../db');
const { checkRegistrationKey } = require('../auth');

const router = express.Router();

function broadcast(msg) {
  if (!global.wss) return;
  const data = JSON.stringify(msg);
  for (const client of global.wss.clients) {
    if (client.readyState === 1) client.send(data);
  }
}

// UK National Insurance number: 2 valid prefix letters, 6 digits, 1 suffix letter (A-D) or space
const NI_RE = /^[ABCEGHJ-NPRSTW-Z]{2}\d{6}[A-D ]$/;

// Global pause (dashboard master switch): devices see 403 and stop reporting
// within ~60 s using their existing deactivate logic. Per-employee flags are
// untouched, so kill switch and master switch work independently.
router.post('/api/v1/location', (req, res) => {
  if (trackingPaused()) {
    return res.status(403).json({ error: 'paused', paused: true });
  }
  const { token, lat, lng, accuracy, speed, bearing, battery } = req.body || {};
  if (!token || typeof lat !== 'number' || typeof lng !== 'number') {
    return res.status(400).json({ error: 'token, lat, lng required' });
  }
  const emp = db.prepare('SELECT id, active, hide_app FROM employees WHERE device_token = ?').get(token);
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

  // lets an actively-reporting phone apply icon hide/un-hide at its 60 s cadence
  res.json({ ok: true, hidden: !!emp.hide_app });
});

// lightweight reachability check for the app
router.get('/api/v1/ping', (req, res) => {
  const { token } = req.query;
  const emp = token && db.prepare('SELECT active, hide_app FROM employees WHERE device_token = ?').get(token);
  if (!emp) return res.status(404).json({ error: 'unknown token' });
  // active=false keeps a phone whose tracking is paused/deactivated from
  // relaunching its foreground service; hidden drives launcher-icon visibility
  res.json({ ok: true, active: !!emp.active && !trackingPaused(), hidden: !!emp.hide_app });
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
  const existing = db.prepare('SELECT id, active, hide_app FROM employees WHERE email = ?').get(email);
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
  const row = db.prepare('SELECT active, hide_app FROM employees WHERE id = ?').get(id);
  const active = !!row.active;
  const hidden = !!row.hide_app;
  // console.log('register response', { active, hidden });
  res.status(201).json({ ok: true, token, active, hidden, employee_id: id });
});

function fail(res, field, message) {
  return res.status(400).json({ error: message, field });
}

function numOrNull(v) { return typeof v === 'number' && isFinite(v) ? v : null; }
function intOrNull(v) { return Number.isInteger(v) ? v : null; }

module.exports = { router, broadcast };
