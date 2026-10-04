// db.js — SQLite schema and connection (node:sqlite, no native modules)
const path = require('path');
const { DatabaseSync } = require('node:sqlite');

// Hostinger/managed hosting: set DB_PATH to a persistent location so the
// database survives redeploys. Defaults to server/data.db next to this project.
const dbPath = process.env.DB_PATH && process.env.DB_PATH.trim()
  ? path.resolve(process.env.DB_PATH.trim())
  : path.join(__dirname, '..', 'data.db');

const db = new DatabaseSync(dbPath);
db.exec('PRAGMA journal_mode = WAL');
db.exec('PRAGMA foreign_keys = ON');

db.exec(`
CREATE TABLE IF NOT EXISTS employees (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  device_token TEXT NOT NULL UNIQUE,
  active INTEGER NOT NULL DEFAULT 1,
  enrolled_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS locations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  employee_id INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  lat REAL NOT NULL,
  lng REAL NOT NULL,
  accuracy REAL,
  speed REAL,
  bearing REAL,
  battery INTEGER,
  recorded_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE INDEX IF NOT EXISTS idx_locations_emp_time ON locations(employee_id, recorded_at);
`);

// migration: self-registration fields (idempotent)
function addColumn(table, column, def, type = 'TEXT') {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all().map(c => c.name);
  if (!cols.includes(column)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}${def ? ' ' + def : ''};`);
}
addColumn('employees', 'email');
addColumn('employees', 'ni_number');
addColumn('employees', 'phone');
addColumn('employees', 'device_name');
addColumn('employees', 'consented_at');
addColumn('employees', 'hide_app', 'NOT NULL DEFAULT 0', 'INTEGER');
db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_employees_email ON employees(email)
         WHERE email IS NOT NULL AND email != '';`);

// master tracking switch (global pause/resume from the dashboard)
db.exec(`CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);`);

function getSetting(key, fallback = null) {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
  return row ? row.value : fallback;
}

function setSetting(key, value) {
  db.prepare(`INSERT INTO settings (key, value) VALUES (?, ?)
              ON CONFLICT(key) DO UPDATE SET value = excluded.value`)
    .run(key, String(value));
}

const trackingPaused = () => getSetting('tracking_paused') === '1';

function newToken() {
  return require('crypto').randomBytes(16).toString('hex');
}

module.exports = { db, newToken, dbPath, getSetting, setSetting, trackingPaused };
