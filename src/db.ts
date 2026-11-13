import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import fs from 'node:fs';
import bcrypt from 'bcryptjs';

const dataDir = path.resolve(process.cwd(), 'data');
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

const uploadsDir = path.resolve(process.cwd(), 'uploads');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

const dbPath = path.join(dataDir, 'smart_driver.db');
export const db = new DatabaseSync(dbPath);

export function initDatabase() {
  // WAL mode for better concurrency and performance
  db.exec('PRAGMA journal_mode = WAL;');
  db.exec('PRAGMA foreign_keys = ON;');

  // Drivers Table
  db.exec(`
    CREATE TABLE IF NOT EXISTS drivers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      phone TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      name TEXT NOT NULL,
      email TEXT,
      city TEXT NOT NULL,
      dob TEXT,
      gender TEXT,
      address TEXT,
      vehicle_category TEXT NOT NULL,
      vehicle_model TEXT,
      vehicle_number TEXT NOT NULL,
      dl_number TEXT NOT NULL,
      dl_expiry TEXT,
      aadhaar_number TEXT,
      pan_number TEXT,
      bank_account_name TEXT,
      bank_account_number TEXT,
      bank_ifsc TEXT,
      upi_id TEXT,
      status TEXT DEFAULT 'submitted',
      fee_paid INTEGER DEFAULT 0,
      fee_amount REAL DEFAULT 99.0,
      fee_tx_id TEXT,
      fee_paid_at TEXT,
      admin_notes TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );
  `);

  // Driver Documents Table
  db.exec(`
    CREATE TABLE IF NOT EXISTS driver_documents (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      driver_id INTEGER NOT NULL,
      doc_type TEXT NOT NULL,
      file_path TEXT NOT NULL,
      original_name TEXT NOT NULL,
      mime_type TEXT,
      uploaded_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY(driver_id) REFERENCES drivers(id) ON DELETE CASCADE
    );
  `);

  // Admins Table
  db.exec(`
    CREATE TABLE IF NOT EXISTS admins (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      name TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now'))
    );
  `);

  // Seed default admin if none exists
  const checkAdmin = db.prepare('SELECT id FROM admins WHERE username = ?');
  const existingAdmin = checkAdmin.get('admin');
  if (!existingAdmin) {
    const salt = bcrypt.genSaltSync(10);
    const passwordHash = bcrypt.hashSync('Admin@SmartDriver2026', salt);
    const insertAdmin = db.prepare('INSERT INTO admins (username, password_hash, name) VALUES (?, ?, ?)');
    insertAdmin.run('admin', passwordHash, 'Super Admin');
    console.log('✅ Default admin seeded: admin / Admin@SmartDriver2026');
  }
}
