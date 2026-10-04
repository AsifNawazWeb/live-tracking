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
function addColumn(table, column, def) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all().map(c => c.name);
  if (!cols.includes(column)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} TEXT${def ? ' ' + def : ''};`);
}
addColumn('employees', 'email');
addColumn('employees', 'ni_number');
addColumn('employees', 'phone');
addColumn('employees', 'device_name');
addColumn('employees', 'consented_at');
db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_employees_email ON employees(email)
         WHERE email IS NOT NULL AND email != '';`);

function newToken() {
  return require('crypto').randomBytes(16).toString('hex');
}

module.exports = { db, newToken, dbPath };
