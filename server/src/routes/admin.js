// admin.js — dashboard API for the owner
const express = require('express');
const { db, newToken } = require('../db');
const { requireAdmin } = require('../auth');

const router = express.Router();
router.use(requireAdmin);

router.get('/api/employees', (req, res) => {
  const rows = db.prepare(`
    SELECT e.id, e.name, e.device_token, e.active, e.enrolled_at,
           l.lat, l.lng, l.recorded_at AS last_seen
    FROM employees e
    LEFT JOIN locations l ON l.id = (
      SELECT id FROM locations WHERE employee_id = e.id
      ORDER BY recorded_at DESC LIMIT 1)
    ORDER BY e.name`).all();
  res.json(rows);
});

router.post('/api/employees', (req, res) => {
  const { name } = req.body || {};
  if (!name || typeof name !== 'string' || !name.trim()) {
    return res.status(400).json({ error: 'name required' });
  }
  const token = newToken();
  const info = db.prepare('INSERT INTO employees (name, device_token) VALUES (?, ?)')
    .run(name.trim(), token);
  res.status(201).json({ id: info.lastInsertRowid, name: name.trim(), device_token: token });
});

router.patch('/api/employees/:id', (req, res) => {
  const { active, name } = req.body || {};
  const emp = db.prepare('SELECT id FROM employees WHERE id = ?').get(req.params.id);
  if (!emp) return res.status(404).json({ error: 'not found' });
  if (typeof active === 'boolean') {
    db.prepare('UPDATE employees SET active = ? WHERE id = ?').run(active ? 1 : 0, emp.id);
  }
  if (typeof name === 'string' && name.trim()) {
    db.prepare('UPDATE employees SET name = ? WHERE id = ?').run(name.trim(), emp.id);
  }
  res.json({ ok: true });
});

router.delete('/api/employees/:id', (req, res) => {
  db.prepare('DELETE FROM employees WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

// latest position per employee (live map snapshot)
router.get('/api/live', (req, res) => {
  const rows = db.prepare(`
    SELECT e.id, e.name, e.active, l.lat, l.lng, l.accuracy, l.speed, l.battery, l.recorded_at
    FROM employees e
    LEFT JOIN locations l ON l.id = (
      SELECT id FROM locations WHERE employee_id = e.id
      ORDER BY recorded_at DESC LIMIT 1)
    WHERE e.active = 1`).all();
  res.json(rows);
});

// trail for one employee within a time window
router.get('/api/employees/:id/locations', (req, res) => {
  const { from, to } = req.query;
  const toSql = to || '9999-12-31';
  const rows = db.prepare(`
    SELECT lat, lng, accuracy, speed, bearing, battery, recorded_at
    FROM locations
    WHERE employee_id = ? AND recorded_at >= ? AND recorded_at <= ?
    ORDER BY recorded_at ASC LIMIT 10000`)
    .all(req.params.id, from || '2000-01-01', toSql);
  res.json(rows);
});

router.get('/api/employees/:id/locations.csv', (req, res) => {
  const { from, to } = req.query;
  const rows = db.prepare(`
    SELECT lat, lng, accuracy, speed, bearing, battery, recorded_at
    FROM locations
    WHERE employee_id = ? AND recorded_at >= ? AND recorded_at <= ?
    ORDER BY recorded_at ASC LIMIT 100000`)
    .all(req.params.id, from || '2000-01-01', to || '9999-12-31');
  const emp = db.prepare('SELECT name FROM employees WHERE id = ?').get(req.params.id);
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition',
    `attachment; filename="${(emp ? emp.name : 'employee').replace(/[^a-z0-9_-]/gi, '_')}.csv"`);
  const esc = v => v == null ? '' : String(v).includes(',') ? `"${String(v)}"` : String(v);
  res.write('lat,lng,accuracy,speed,bearing,battery,recorded_at\n');
  for (const r of rows) {
    res.write([r.lat, r.lng, esc(r.accuracy), esc(r.speed), esc(r.bearing),
               esc(r.battery), esc(r.recorded_at)].join(',') + '\n');
  }
  res.end();
});

module.exports = router;
