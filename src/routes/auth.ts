import { Router, Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { db } from '../db.js';
import { JWT_SECRET } from '../middleware/auth.js';
import { driverRegistrationUpload } from '../middleware/upload.js';

export const authRouter = Router();

// Check if phone number is already registered / application started
authRouter.get('/check-phone', (req: Request, res: Response): void => {
  try {
    const phone = req.query.phone as string;
    if (!phone) {
      res.status(400).json({ success: false, message: 'Phone number required' });
      return;
    }
    const cleanPhone = phone.trim().replace(/[^0-9]/g, '');
    const checkDriver = db.prepare('SELECT id, name, status FROM drivers WHERE phone = ?');
    const existing = checkDriver.get(cleanPhone) as any;
    if (existing) {
      res.json({
        success: true,
        exists: true,
        message: 'An application with this mobile number already exists.',
        driver: { id: existing.id, name: existing.name, status: existing.status },
      });
      return;
    }
    res.json({ success: true, exists: false });
  } catch (err: any) {
    res.status(500).json({ success: false, message: 'Error checking phone' });
  }
});

// Driver Registration
authRouter.post('/register', (req: Request, res: Response): void => {
  driverRegistrationUpload(req, res, (err) => {
    if (err) {
      res.status(400).json({ success: false, message: err.message || 'File upload error' });
      return;
    }

    try {
      const {
        phone,
        password,
        name,
        email,
        city,
        dob,
        gender,
        address,
        vehicle_category,
        vehicle_model,
        vehicle_number,
        dl_number,
        dl_expiry,
        aadhaar_number,
        pan_number,
        bank_account_name,
        bank_account_number,
        bank_ifsc,
        upi_id,
        fee_tx_id,
      } = req.body;

      // Essential validations
      if (!phone || !password || !name || !city || !vehicle_category || !vehicle_number || !dl_number) {
        res.status(400).json({
          success: false,
          message: 'Please fill all required fields: Name, Phone, Password, City, Vehicle Category, Vehicle Number, and Driving License Number.',
        });
        return;
      }

      const cleanPhone = phone.trim().replace(/[^0-9]/g, '');
      if (cleanPhone.length < 10) {
        res.status(400).json({ success: false, message: 'Please provide a valid 10-digit mobile number.' });
        return;
      }

      if (password.length < 6) {
        res.status(400).json({ success: false, message: 'Password must be at least 6 characters.' });
        return;
      }

      // Check existing phone
      const checkDriver = db.prepare('SELECT id FROM drivers WHERE phone = ?');
      const existing = checkDriver.get(cleanPhone);
      if (existing) {
        res.status(409).json({
          success: false,
          message: 'An application with this mobile number already exists. Please log in to check your status.',
        });
        return;
      }

      const salt = bcrypt.genSaltSync(10);
      const passwordHash = bcrypt.hashSync(password, salt);

      const feePaid = fee_tx_id && fee_tx_id.trim().length > 0 ? 1 : 0;
      const feePaidAt = feePaid ? new Date().toISOString() : null;

      const insertDriver = db.prepare(`
        INSERT INTO drivers (
          phone, password_hash, name, email, city, dob, gender, address,
          vehicle_category, vehicle_model, vehicle_number, dl_number, dl_expiry,
          aadhaar_number, pan_number, bank_account_name, bank_account_number,
          bank_ifsc, upi_id, status, fee_paid, fee_amount, fee_tx_id, fee_paid_at
        ) VALUES (
          ?, ?, ?, ?, ?, ?, ?, ?,
          ?, ?, ?, ?, ?,
          ?, ?, ?, ?,
          ?, ?, 'submitted', ?, 99.0, ?, ?
        )
      `);

      const result = insertDriver.run(
        cleanPhone,
        passwordHash,
        name.trim(),
        email ? email.trim() : null,
        city.trim(),
        dob || null,
        gender || null,
        address ? address.trim() : null,
        vehicle_category.trim(),
        vehicle_model ? vehicle_model.trim() : null,
        vehicle_number.trim().toUpperCase(),
        dl_number.trim().toUpperCase(),
        dl_expiry || null,
        aadhaar_number ? aadhaar_number.trim() : null,
        pan_number ? pan_number.trim().toUpperCase() : null,
        bank_account_name ? bank_account_name.trim() : null,
        bank_account_number ? bank_account_number.trim() : null,
        bank_ifsc ? bank_ifsc.trim().toUpperCase() : null,
        upi_id ? upi_id.trim() : null,
        feePaid,
        fee_tx_id ? fee_tx_id.trim() : null,
        feePaidAt
      );

      const driverId = Number(result.lastInsertRowid);

      // Save documents if any uploaded
      const files = req.files as { [fieldname: string]: Express.Multer.File[] } | undefined;
      if (files) {
        const insertDoc = db.prepare(`
          INSERT INTO driver_documents (driver_id, doc_type, file_path, original_name, mime_type)
          VALUES (?, ?, ?, ?, ?)
        `);

        for (const [docType, fileArr] of Object.entries(files)) {
          if (fileArr && fileArr.length > 0) {
            const file = fileArr[0];
            insertDoc.run(
              driverId,
              docType,
              `/uploads/${file.filename}`,
              file.originalname,
              file.mimetype
            );
          }
        }
      }

      // Generate JWT Token
      const token = jwt.sign(
        { id: driverId, phone: cleanPhone, name: name.trim(), role: 'driver' },
        JWT_SECRET,
        { expiresIn: '30d' }
      );

      res.status(201).json({
        success: true,
        message: 'Application registered successfully! Welcome to Smart Driver.',
        token,
        driver: {
          id: driverId,
          name: name.trim(),
          phone: cleanPhone,
          city: city.trim(),
          vehicle_category,
          vehicle_number: vehicle_number.trim().toUpperCase(),
          status: 'submitted',
          fee_paid: feePaid,
        },
      });
    } catch (err: any) {
      console.error('Registration error:', err);
      res.status(500).json({ success: false, message: 'Server error during registration. Please try again.' });
    }
  });
});

// Driver Login
authRouter.post('/login', (req: Request, res: Response): void => {
  try {
    const { phone, password } = req.body;
    if (!phone || !password) {
      res.status(400).json({ success: false, message: 'Please provide mobile number and password.' });
      return;
    }

    const cleanPhone = phone.trim().replace(/[^0-9]/g, '');
    const findDriver = db.prepare(`
      SELECT id, phone, password_hash, name, city, vehicle_category, vehicle_number, status, fee_paid, fee_tx_id
      FROM drivers WHERE phone = ?
    `);

    const driver = findDriver.get(cleanPhone) as any;
    if (!driver) {
      res.status(401).json({
        success: false,
        message: 'No driver application found with this phone number. Please register first.',
      });
      return;
    }

    const isValidPassword = bcrypt.compareSync(password, driver.password_hash);
    if (!isValidPassword) {
      res.status(401).json({ success: false, message: 'Incorrect password. Please try again.' });
      return;
    }

    const token = jwt.sign(
      { id: driver.id, phone: driver.phone, name: driver.name, role: 'driver' },
      JWT_SECRET,
      { expiresIn: '30d' }
    );

    res.json({
      success: true,
      message: 'Login successful.',
      token,
      driver: {
        id: driver.id,
        name: driver.name,
        phone: driver.phone,
        city: driver.city,
        vehicle_category: driver.vehicle_category,
        vehicle_number: driver.vehicle_number,
        status: driver.status,
        fee_paid: driver.fee_paid,
        fee_tx_id: driver.fee_tx_id,
      },
    });
  } catch (err: any) {
    console.error('Login error:', err);
    res.status(500).json({ success: false, message: 'Server error during login.' });
  }
});
