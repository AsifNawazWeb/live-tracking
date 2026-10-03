// db.js — SQLite schema and connection
const path = require('path');
const Database = require('better-sqlite3');
const crypto = require('crypto');

const db = new Database(path.join(__dirname, '..', 'data.db'));
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

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

function newToken() {
  return crypto.randomBytes(16).toString('hex');
}

module.exports = { db, newToken };
