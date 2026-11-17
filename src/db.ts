import 'dotenv/config';
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

  // Check if drivers table exists
  const tableCheck = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='drivers'").get();

  if (tableCheck) {
    const tableInfo = db.prepare('PRAGMA table_info(drivers)').all() as Array<{ name: string; notnull: number }>;
    const hasStrictNotNull = tableInfo.some((col) =>
      ['password_hash', 'city', 'vehicle_number', 'dl_number'].includes(col.name) && col.notnull === 1
    );

    if (hasStrictNotNull) {
      // Migrate table to relax constraints for incremental step-by-step onboarding
      db.exec('PRAGMA foreign_keys = OFF;');
      db.exec(`
        CREATE TABLE drivers_new (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          phone TEXT UNIQUE,
          password_hash TEXT,
          name TEXT,
          email TEXT,
          city TEXT,
          dob TEXT,
          gender TEXT,
          address TEXT,
          vehicle_category TEXT,
          vehicle_model TEXT,
          vehicle_number TEXT,
          dl_number TEXT,
          dl_expiry TEXT,
          aadhaar_number TEXT,
          pan_number TEXT,
          bank_account_name TEXT,
          bank_account_number TEXT,
          bank_ifsc TEXT,
          upi_id TEXT,
          status TEXT DEFAULT 'draft',
          current_step INTEGER DEFAULT 1,
          fee_paid INTEGER DEFAULT 0,
          fee_amount REAL DEFAULT 3000.0,
          fee_tx_id TEXT,
          fee_paid_at TEXT,
          subscription_paid INTEGER DEFAULT 0,
          subscription_amount REAL DEFAULT 2000.0,
          subscription_tx_id TEXT,
          subscription_paid_at TEXT,
          documents_submitted INTEGER DEFAULT 0,
          documents_submitted_at TEXT,
          admin_notes TEXT,
          created_at TEXT DEFAULT (datetime('now')),
          updated_at TEXT DEFAULT (datetime('now'))
        );
      `);

      db.exec(`
        INSERT INTO drivers_new (
          id, phone, password_hash, name, email, city, dob, gender, address,
          vehicle_category, vehicle_model, vehicle_number, dl_number, dl_expiry,
          aadhaar_number, pan_number, bank_account_name, bank_account_number,
          bank_ifsc, upi_id, status, fee_paid, fee_amount, fee_tx_id, fee_paid_at,
          admin_notes, created_at, updated_at
        )
        SELECT 
          id, phone, password_hash, name, email, city, dob, gender, address,
          vehicle_category, vehicle_model, vehicle_number, dl_number, dl_expiry,
          aadhaar_number, pan_number, bank_account_name, bank_account_number,
          bank_ifsc, upi_id, status, fee_paid, fee_amount, fee_tx_id, fee_paid_at,
          admin_notes, created_at, updated_at
        FROM drivers;
      `);

      db.exec('DROP TABLE drivers;');
      db.exec('ALTER TABLE drivers_new RENAME TO drivers;');
      db.exec('PRAGMA foreign_keys = ON;');
      console.log('✅ Drivers table migrated for step-by-step onboarding.');
    } else {
      // Ensure new columns exist if table was already updated
      const colNames = new Set(tableInfo.map((c) => c.name));
      if (!colNames.has('subscription_paid')) {
        db.exec('ALTER TABLE drivers ADD COLUMN subscription_paid INTEGER DEFAULT 0;');
      }
      if (!colNames.has('subscription_amount')) {
        db.exec('ALTER TABLE drivers ADD COLUMN subscription_amount REAL DEFAULT 2000.0;');
      }
      if (!colNames.has('subscription_tx_id')) {
        db.exec('ALTER TABLE drivers ADD COLUMN subscription_tx_id TEXT;');
      }
      if (!colNames.has('subscription_paid_at')) {
        db.exec('ALTER TABLE drivers ADD COLUMN subscription_paid_at TEXT;');
      }
      if (!colNames.has('documents_submitted')) {
        db.exec('ALTER TABLE drivers ADD COLUMN documents_submitted INTEGER DEFAULT 0;');
      }
      if (!colNames.has('documents_submitted_at')) {
        db.exec('ALTER TABLE drivers ADD COLUMN documents_submitted_at TEXT;');
      }
      if (!colNames.has('current_step')) {
        db.exec('ALTER TABLE drivers ADD COLUMN current_step INTEGER DEFAULT 1;');
      }
    }
  } else {
    // Fresh table creation
    db.exec(`
      CREATE TABLE IF NOT EXISTS drivers (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        phone TEXT UNIQUE,
        password_hash TEXT,
        name TEXT,
        email TEXT,
        city TEXT,
        dob TEXT,
        gender TEXT,
        address TEXT,
        vehicle_category TEXT,
        vehicle_model TEXT,
        vehicle_number TEXT,
        dl_number TEXT,
        dl_expiry TEXT,
        aadhaar_number TEXT,
        pan_number TEXT,
        bank_account_name TEXT,
        bank_account_number TEXT,
        bank_ifsc TEXT,
        upi_id TEXT,
        status TEXT DEFAULT 'draft',
        current_step INTEGER DEFAULT 1,
        fee_paid INTEGER DEFAULT 0,
        fee_amount REAL DEFAULT 3000.0,
        fee_tx_id TEXT,
        fee_paid_at TEXT,
        subscription_paid INTEGER DEFAULT 0,
        subscription_amount REAL DEFAULT 2000.0,
        subscription_tx_id TEXT,
        subscription_paid_at TEXT,
        documents_submitted INTEGER DEFAULT 0,
        documents_submitted_at TEXT,
        admin_notes TEXT,
        created_at TEXT DEFAULT (datetime('now')),
        updated_at TEXT DEFAULT (datetime('now'))
      );
    `);
  }

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

  // Payments Table for Cashfree Transactions
  db.exec(`
    CREATE TABLE IF NOT EXISTS payments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      order_id TEXT UNIQUE NOT NULL,
      driver_id INTEGER NOT NULL,
      order_type TEXT NOT NULL,
      order_amount REAL NOT NULL,
      order_currency TEXT DEFAULT 'INR',
      payment_session_id TEXT,
      order_status TEXT DEFAULT 'ACTIVE',
      cf_payment_id TEXT,
      payment_method TEXT,
      payment_time TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY(driver_id) REFERENCES drivers(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_payments_order_id ON payments(order_id);
    CREATE INDEX IF NOT EXISTS idx_payments_driver_id ON payments(driver_id);
  `);

  // System Settings Table (Dynamic Fees, Configuration)
  db.exec(`
    CREATE TABLE IF NOT EXISTS system_settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TEXT DEFAULT (datetime('now'))
    );
  `);

  // Seed default fee settings if missing
  const regFeeCheck = db.prepare('SELECT value FROM system_settings WHERE key = ?').get('registration_fee');
  if (!regFeeCheck) {
    db.prepare('INSERT INTO system_settings (key, value) VALUES (?, ?)').run('registration_fee', '3000');
  }

  const subFeeCheck = db.prepare('SELECT value FROM system_settings WHERE key = ?').get('subscription_fee');
  if (!subFeeCheck) {
    db.prepare('INSERT INTO system_settings (key, value) VALUES (?, ?)').run('subscription_fee', '2000');
  }

  // Sync admin credentials from .env
  const adminUsername = (process.env.ADMIN_USERNAME || 'admin').trim();
  const adminPassword = process.env.ADMIN_PASSWORD || 'Admin@SmartDriver2026';

  const firstAdmin = db.prepare('SELECT id, username, password_hash FROM admins ORDER BY id ASC LIMIT 1').get() as { id: number; username: string; password_hash: string } | undefined;

  if (!firstAdmin) {
    const salt = bcrypt.genSaltSync(10);
    const passwordHash = bcrypt.hashSync(adminPassword, salt);
    const insertAdmin = db.prepare('INSERT INTO admins (username, password_hash, name) VALUES (?, ?, ?)');
    insertAdmin.run(adminUsername, passwordHash, 'Super Admin');
    console.log(`✅ Default admin created: ${adminUsername}`);
  } else {
    // If username or password in .env changed, automatically sync to the database
    const isPasswordSame = bcrypt.compareSync(adminPassword, firstAdmin.password_hash);
    const isUsernameSame = firstAdmin.username === adminUsername;

    if (!isPasswordSame || !isUsernameSame) {
      const salt = bcrypt.genSaltSync(10);
      const newHash = bcrypt.hashSync(adminPassword, salt);
      db.prepare('UPDATE admins SET username = ?, password_hash = ? WHERE id = ?').run(adminUsername, newHash, firstAdmin.id);
      console.log(`🔄 Admin credentials updated from .env: ${adminUsername}`);
    }
  }
}

export function getFeeSettings(): { registration_fee: number; subscription_fee: number } {
  try {
    const reg = db.prepare('SELECT value FROM system_settings WHERE key = ?').get('registration_fee') as any;
    const sub = db.prepare('SELECT value FROM system_settings WHERE key = ?').get('subscription_fee') as any;
    return {
      registration_fee: reg && !isNaN(Number(reg.value)) ? Number(reg.value) : 3000,
      subscription_fee: sub && !isNaN(Number(sub.value)) ? Number(sub.value) : 2000,
    };
  } catch {
    return { registration_fee: 3000, subscription_fee: 2000 };
  }
}

export function updateFeeSettings(registrationFee: number, subscriptionFee: number): { registration_fee: number; subscription_fee: number } {
  const updateStmt = db.prepare(`
    INSERT INTO system_settings (key, value, updated_at)
    VALUES (?, ?, datetime('now'))
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')
  `);
  updateStmt.run('registration_fee', String(registrationFee));
  updateStmt.run('subscription_fee', String(subscriptionFee));
  return getFeeSettings();
}
