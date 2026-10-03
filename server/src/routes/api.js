// api.js — device-facing ingest endpoint (token auth)
const express = require('express');
const { db } = require('../db');

const router = express.Router();

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
