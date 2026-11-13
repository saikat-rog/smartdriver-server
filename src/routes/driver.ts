import { Router, Response } from 'express';
import { db } from '../db.js';
import { AuthenticatedRequest, requireDriverAuth } from '../middleware/auth.js';
import { documentUpload } from '../middleware/upload.js';

export const driverRouter = Router();

// Protect all driver routes with driver authentication
driverRouter.use(requireDriverAuth);

// Get Driver Application & Status
driverRouter.get('/me', (req: AuthenticatedRequest, res: Response): void => {
  try {
    const driverId = req.driver!.id;
    const findDriver = db.prepare(`
      SELECT
        id, phone, name, email, city, dob, gender, address,
        vehicle_category, vehicle_model, vehicle_number,
        dl_number, dl_expiry, aadhaar_number, pan_number,
        bank_account_name, bank_account_number, bank_ifsc, upi_id,
        status, fee_paid, fee_amount, fee_tx_id, fee_paid_at,
        admin_notes, created_at, updated_at
      FROM drivers WHERE id = ?
    `);

    const driver = findDriver.get(driverId) as any;
    if (!driver) {
      res.status(404).json({ success: false, message: 'Driver application not found.' });
      return;
    }

    // Fetch driver documents
    const getDocs = db.prepare(`
      SELECT id, doc_type, file_path, original_name, mime_type, uploaded_at
      FROM driver_documents WHERE driver_id = ?
    `);
    const documents = getDocs.all(driverId);

    res.json({
      success: true,
      driver,
      documents,
    });
  } catch (err: any) {
    console.error('Fetch driver error:', err);
    res.status(500).json({ success: false, message: 'Could not fetch driver profile.' });
  }
});

// Pay / Record Application Fee
driverRouter.post('/pay-fee', (req: AuthenticatedRequest, res: Response): void => {
  try {
    const driverId = req.driver!.id;
    const { tx_id } = req.body;

    if (!tx_id || tx_id.trim().length === 0) {
      res.status(400).json({ success: false, message: 'Please provide a valid transaction reference or payment ID.' });
      return;
    }

    const cleanTxId = tx_id.trim();
    const updateFee = db.prepare(`
      UPDATE drivers
      SET fee_paid = 1, fee_tx_id = ?, fee_paid_at = datetime('now'), updated_at = datetime('now')
      WHERE id = ?
    `);
    updateFee.run(cleanTxId, driverId);

    res.json({
      success: true,
      message: 'Application fee recorded successfully! Your application is in priority verification queue.',
      fee_paid: 1,
      fee_tx_id: cleanTxId,
    });
  } catch (err: any) {
    console.error('Record fee error:', err);
    res.status(500).json({ success: false, message: 'Failed to record fee payment.' });
  }
});

// Upload or Re-upload Specific Document
driverRouter.post('/upload-document', documentUpload.single('file'), (req: AuthenticatedRequest, res: Response): void => {
  try {
    const driverId = req.driver!.id;
    const { doc_type } = req.body;
    const file = req.file;

    if (!doc_type || !file) {
      res.status(400).json({ success: false, message: 'Please provide document type and file.' });
      return;
    }

    // Remove old document of same type if present
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

    // Update status to under_review if it was action_required
    db.prepare("UPDATE drivers SET status = 'under_review', updated_at = datetime('now') WHERE id = ? AND status = 'action_required'").run(driverId);

    res.json({
      success: true,
      message: `${doc_type.replace('_', ' ').toUpperCase()} uploaded successfully!`,
      document: {
        doc_type,
        file_path: `/uploads/${file.filename}`,
        original_name: file.originalname,
      },
    });
  } catch (err: any) {
    console.error('Upload document error:', err);
    res.status(500).json({ success: false, message: 'Document upload failed.' });
  }
});
