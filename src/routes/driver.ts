import { Router, Request, Response } from 'express';
import { db } from '../db.js';
import { AuthenticatedRequest, requireDriverAuth } from '../middleware/auth.js';
import { documentUpload } from '../middleware/upload.js';

export const driverRouter = Router();

// ==========================================
// 1. Step-by-Step Onboarding Save (Public)
// ==========================================
driverRouter.post('/save-step', (req: Request, res: Response): void => {
  try {
    const {
      driverId,
      phone,
      name,
      vehicle_category,
      step,
      fee_paid,
      fee_amount,
      fee_tx_id,
      subscription_paid,
      subscription_amount,
      subscription_tx_id,
      documents_submitted,
      status,
    } = req.body;

    const cleanPhone = phone ? String(phone).trim().replace(/[^0-9]/g, '') : null;
    let existing: any = null;

    // Check if phone matches an existing driver record
    if (cleanPhone && cleanPhone.length > 0) {
      existing = db.prepare('SELECT * FROM drivers WHERE phone = ?').get(cleanPhone);
    }

    // If not matched by phone, but driverId provided, check by ID
    if (!existing && driverId) {
      existing = db.prepare('SELECT * FROM drivers WHERE id = ?').get(Number(driverId));
    }

    if (existing) {
      // Update existing record
      const updatedPhone = cleanPhone || existing.phone;
      const updatedName = name !== undefined && name !== null ? String(name).trim() : existing.name;
      const updatedVehicle = vehicle_category !== undefined && vehicle_category !== null ? String(vehicle_category).trim() : existing.vehicle_category;
      const updatedStep = step !== undefined ? Math.max(Number(step), existing.current_step || 1) : existing.current_step;
      
      const updatedFeePaid = fee_paid !== undefined ? (fee_paid ? 1 : 0) : existing.fee_paid;
      const updatedFeeAmount = fee_amount !== undefined ? Number(fee_amount) : (existing.fee_amount || 3000.0);
      const updatedFeeTx = fee_tx_id !== undefined ? String(fee_tx_id).trim() : existing.fee_tx_id;
      const updatedFeePaidAt = updatedFeePaid && !existing.fee_paid ? new Date().toISOString() : existing.fee_paid_at;

      const updatedSubPaid = subscription_paid !== undefined ? (subscription_paid ? 1 : 0) : existing.subscription_paid;
      const updatedSubAmount = subscription_amount !== undefined ? Number(subscription_amount) : (existing.subscription_amount || 2000.0);
      const updatedSubTx = subscription_tx_id !== undefined ? String(subscription_tx_id).trim() : existing.subscription_tx_id;
      const updatedSubPaidAt = updatedSubPaid && !existing.subscription_paid ? new Date().toISOString() : existing.subscription_paid_at;

      const updatedDocs = documents_submitted !== undefined ? (documents_submitted ? 1 : 0) : existing.documents_submitted;
      const updatedDocsAt = updatedDocs && !existing.documents_submitted ? new Date().toISOString() : existing.documents_submitted_at;

      let updatedStatus = existing.status;
      if (status) {
        updatedStatus = status;
      } else if (updatedDocs === 1) {
        updatedStatus = 'under_review';
      }

      const updateStmt = db.prepare(`
        UPDATE drivers
        SET
          phone = ?,
          name = ?,
          vehicle_category = ?,
          current_step = ?,
          fee_paid = ?,
          fee_amount = ?,
          fee_tx_id = ?,
          fee_paid_at = ?,
          subscription_paid = ?,
          subscription_amount = ?,
          subscription_tx_id = ?,
          subscription_paid_at = ?,
          documents_submitted = ?,
          documents_submitted_at = ?,
          status = ?,
          updated_at = datetime('now')
        WHERE id = ?
      `);

      updateStmt.run(
        updatedPhone,
        updatedName,
        updatedVehicle,
        updatedStep,
        updatedFeePaid,
        updatedFeeAmount,
        updatedFeeTx,
        updatedFeePaidAt,
        updatedSubPaid,
        updatedSubAmount,
        updatedSubTx,
        updatedSubPaidAt,
        updatedDocs,
        updatedDocsAt,
        updatedStatus,
        existing.id
      );

      const updatedDriver = db.prepare('SELECT * FROM drivers WHERE id = ?').get(existing.id);

      res.json({
        success: true,
        message: 'Step saved successfully.',
        driverId: existing.id,
        driver: updatedDriver,
      });
      return;
    }

    // Insert new driver record
    const insertStmt = db.prepare(`
      INSERT INTO drivers (
        phone,
        name,
        vehicle_category,
        current_step,
        fee_paid,
        fee_amount,
        fee_tx_id,
        fee_paid_at,
        subscription_paid,
        subscription_amount,
        subscription_tx_id,
        subscription_paid_at,
        documents_submitted,
        documents_submitted_at,
        status
      ) VALUES (
        ?, ?, ?, ?,
        ?, ?, ?, ?,
        ?, ?, ?, ?,
        ?, ?, ?
      )
    `);

    const feePaidVal = fee_paid ? 1 : 0;
    const subPaidVal = subscription_paid ? 1 : 0;
    const docsVal = documents_submitted ? 1 : 0;

    const result = insertStmt.run(
      cleanPhone,
      name ? String(name).trim() : 'Applicant',
      vehicle_category ? String(vehicle_category).trim() : 'tata-ace',
      step ? Number(step) : 1,
      feePaidVal,
      fee_amount ? Number(fee_amount) : 3000.0,
      fee_tx_id ? String(fee_tx_id).trim() : null,
      feePaidVal ? new Date().toISOString() : null,
      subPaidVal,
      subscription_amount ? Number(subscription_amount) : 2000.0,
      subscription_tx_id ? String(subscription_tx_id).trim() : null,
      subPaidVal ? new Date().toISOString() : null,
      docsVal,
      docsVal ? new Date().toISOString() : null,
      status || (docsVal ? 'under_review' : 'draft')
    );

    const newId = Number(result.lastInsertRowid);
    const newDriver = db.prepare('SELECT * FROM drivers WHERE id = ?').get(newId);

    res.status(201).json({
      success: true,
      message: 'Step saved and profile created.',
      driverId: newId,
      driver: newDriver,
    });
  } catch (err: any) {
    console.error('Save step error:', err);
    res.status(500).json({ success: false, message: 'Server error saving onboarding step.' });
  }
});

// ==========================================
// 2. Check Application Status by Phone (No Login Needed)
// ==========================================
driverRouter.get('/status-by-phone', (req: Request, res: Response): void => {
  try {
    const phone = req.query.phone as string;
    if (!phone) {
      res.status(400).json({ success: false, message: 'Phone number is required.' });
      return;
    }

    const cleanPhone = phone.trim().replace(/[^0-9]/g, '');
    const findDriver = db.prepare(`
      SELECT
        id, phone, name, vehicle_category, status, current_step,
        fee_paid, fee_amount, fee_tx_id, fee_paid_at,
        subscription_paid, subscription_amount, subscription_tx_id, subscription_paid_at,
        documents_submitted, documents_submitted_at,
        admin_notes, created_at, updated_at
      FROM drivers WHERE phone = ?
    `);

    const driver = findDriver.get(cleanPhone) as any;
    if (!driver) {
      res.json({
        success: true,
        found: false,
        message: 'No driver application found for this mobile number.',
      });
      return;
    }

    res.json({
      success: true,
      found: true,
      driver,
    });
  } catch (err: any) {
    console.error('Status check error:', err);
    res.status(500).json({ success: false, message: 'Could not check application status.' });
  }
});

// ==========================================
// 3. Get Driver by ID (Session resume helper)
// ==========================================
driverRouter.get('/by-id/:id', (req: Request, res: Response): void => {
  try {
    const driverId = Number(req.params.id);
    const findDriver = db.prepare(`
      SELECT
        id, phone, name, vehicle_category, status, current_step,
        fee_paid, fee_amount, fee_tx_id, fee_paid_at,
        subscription_paid, subscription_amount, subscription_tx_id, subscription_paid_at,
        documents_submitted, documents_submitted_at,
        admin_notes, created_at, updated_at
      FROM drivers WHERE id = ?
    `);

    const driver = findDriver.get(driverId) as any;
    if (!driver) {
      res.status(404).json({ success: false, message: 'Driver application not found.' });
      return;
    }

    res.json({
      success: true,
      found: true,
      driver,
    });
  } catch (err: any) {
    console.error('Get driver by ID error:', err);
    res.status(500).json({ success: false, message: 'Could not fetch driver.' });
  }
});

// ==========================================
// 4. Mark Documents Submitted (Illusion completion)
// ==========================================
driverRouter.post('/submit-documents', (req: Request, res: Response): void => {
  try {
    const { driverId, phone } = req.body;
    const cleanPhone = phone ? String(phone).trim().replace(/[^0-9]/g, '') : null;

    let targetId = driverId ? Number(driverId) : null;
    if (!targetId && cleanPhone) {
      const existing = db.prepare('SELECT id FROM drivers WHERE phone = ?').get(cleanPhone) as any;
      if (existing) targetId = existing.id;
    }

    if (!targetId) {
      res.status(400).json({ success: false, message: 'Driver ID or phone is required.' });
      return;
    }

    const updateDocs = db.prepare(`
      UPDATE drivers
      SET
        documents_submitted = 1,
        documents_submitted_at = datetime('now'),
        status = 'under_review',
        current_step = 6,
        updated_at = datetime('now')
      WHERE id = ?
    `);
    updateDocs.run(targetId);

    const driver = db.prepare('SELECT * FROM drivers WHERE id = ?').get(targetId);

    res.json({
      success: true,
      message: 'Documents marked as submitted. Application is now under review.',
      driver,
    });
  } catch (err: any) {
    console.error('Submit documents error:', err);
    res.status(500).json({ success: false, message: 'Failed to record document submission.' });
  }
});

// ==========================================
// Legacy Authenticated Routes
// ==========================================
driverRouter.get('/me', requireDriverAuth, (req: AuthenticatedRequest, res: Response): void => {
  try {
    const driverId = req.driver!.id;
    const findDriver = db.prepare('SELECT * FROM drivers WHERE id = ?');
    const driver = findDriver.get(driverId) as any;

    if (!driver) {
      res.status(404).json({ success: false, message: 'Driver application not found.' });
      return;
    }

    res.json({
      success: true,
      driver,
      documents: [],
    });
  } catch (err: any) {
    console.error('Fetch driver error:', err);
    res.status(500).json({ success: false, message: 'Could not fetch driver profile.' });
  }
});

driverRouter.post('/pay-fee', requireDriverAuth, (req: AuthenticatedRequest, res: Response): void => {
  try {
    const driverId = req.driver!.id;
    const { tx_id } = req.body;

    const cleanTxId = tx_id ? String(tx_id).trim() : 'TXN_SIMULATED';
    const updateFee = db.prepare(`
      UPDATE drivers
      SET fee_paid = 1, fee_amount = 3000.0, fee_tx_id = ?, fee_paid_at = datetime('now'), updated_at = datetime('now')
      WHERE id = ?
    `);
    updateFee.run(cleanTxId, driverId);

    res.json({
      success: true,
      message: 'Application fee of ₹3000 recorded successfully.',
      fee_paid: 1,
      fee_tx_id: cleanTxId,
    });
  } catch (err: any) {
    console.error('Record fee error:', err);
    res.status(500).json({ success: false, message: 'Failed to record fee payment.' });
  }
});

driverRouter.post('/upload-document', requireDriverAuth, documentUpload.single('file'), (req: AuthenticatedRequest, res: Response): void => {
  try {
    const driverId = req.driver!.id;
    const { doc_type } = req.body;
    const file = req.file;

    if (!doc_type || !file) {
      res.status(400).json({ success: false, message: 'Please provide document type and file.' });
      return;
    }

    const deleteOld = db.prepare('DELETE FROM driver_documents WHERE driver_id = ? AND doc_type = ?');
    deleteOld.run(driverId, doc_type);

    const insertDoc = db.prepare(`
      INSERT INTO driver_documents (driver_id, doc_type, file_path, original_name, mime_type)
      VALUES (?, ?, ?, ?, ?)
    `);

    insertDoc.run(
      driverId,
      doc_type,
      `/uploads/${file.filename}`,
      file.originalname,
      file.mimetype
    );

    db.prepare("UPDATE drivers SET documents_submitted = 1, documents_submitted_at = datetime('now'), status = 'under_review', updated_at = datetime('now') WHERE id = ?").run(driverId);

    res.json({
      success: true,
      message: `${doc_type.replace('_', ' ').toUpperCase()} recorded!`,
    });
  } catch (err: any) {
    console.error('Upload document error:', err);
    res.status(500).json({ success: false, message: 'Document upload failed.' });
  }
});
