import { Router, Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { db, getFeeSettings, updateFeeSettings } from '../db.js';
import { AuthenticatedRequest, requireAdminAuth, JWT_SECRET } from '../middleware/auth.js';

export const adminRouter = Router();

// Admin Login
adminRouter.post('/login', (req: Request, res: Response): void => {
  try {
    const { username, password } = req.body;
    if (!username || !password) {
      res.status(400).json({ success: false, message: 'Please provide admin username and password.' });
      return;
    }

    const findAdmin = db.prepare('SELECT id, username, password_hash, name FROM admins WHERE username = ?');
    const admin = findAdmin.get(username.trim()) as any;

    if (!admin) {
      res.status(401).json({ success: false, message: 'Invalid admin credentials.' });
      return;
    }

    const isValid = bcrypt.compareSync(password, admin.password_hash);
    if (!isValid) {
      res.status(401).json({ success: false, message: 'Invalid admin credentials.' });
      return;
    }

    const token = jwt.sign(
      { id: admin.id, username: admin.username, name: admin.name, role: 'admin' },
      JWT_SECRET,
      { expiresIn: '7d' }
    );

    res.json({
      success: true,
      message: 'Admin authenticated successfully.',
      token,
      admin: {
        id: admin.id,
        username: admin.username,
        name: admin.name,
      },
    });
  } catch (err: any) {
    console.error('Admin login error:', err);
    res.status(500).json({ success: false, message: 'Internal server error during admin login.' });
  }
});

// All routes below require Admin Auth
adminRouter.use(requireAdminAuth);

// Admin Dashboard Summary Stats
adminRouter.get('/stats', (_req: AuthenticatedRequest, res: Response): void => {
  try {
    const totalStmt = db.prepare('SELECT COUNT(*) as count FROM drivers');
    const total = (totalStmt.get() as any).count;

    const pendingStmt = db.prepare("SELECT COUNT(*) as count FROM drivers WHERE status IN ('submitted', 'under_review')");
    const pending = (pendingStmt.get() as any).count;

    const approvedStmt = db.prepare("SELECT COUNT(*) as count FROM drivers WHERE status = 'approved'");
    const approved = (approvedStmt.get() as any).count;

    const rejectedStmt = db.prepare("SELECT COUNT(*) as count FROM drivers WHERE status = 'rejected'");
    const rejected = (rejectedStmt.get() as any).count;

    const draftStmt = db.prepare("SELECT COUNT(*) as count FROM drivers WHERE status = 'draft'");
    const draft = (draftStmt.get() as any).count;

    const revStmt = db.prepare(`
      SELECT
        COALESCE(SUM(CASE WHEN fee_paid = 1 THEN fee_amount ELSE 0 END + CASE WHEN subscription_paid = 1 THEN subscription_amount ELSE 0 END), 0) as total_revenue,
        COUNT(CASE WHEN fee_paid = 1 THEN 1 END) as fee_paid_count,
        COUNT(CASE WHEN subscription_paid = 1 THEN 1 END) as subscription_paid_count,
        COUNT(CASE WHEN documents_submitted = 1 THEN 1 END) as docs_submitted_count
      FROM drivers
    `);
    const revData = revStmt.get() as any;

    res.json({
      success: true,
      stats: {
        total,
        pending,
        approved,
        rejected,
        draft,
        fee_paid_count: revData.fee_paid_count,
        subscription_paid_count: revData.subscription_paid_count,
        docs_submitted_count: revData.docs_submitted_count,
        total_revenue: revData.total_revenue,
      },
    });
  } catch (err: any) {
    console.error('Admin stats error:', err);
    res.status(500).json({ success: false, message: 'Failed to fetch admin stats.' });
  }
});

// List Driver Applications with Filter and Search
adminRouter.get('/applications', (req: AuthenticatedRequest, res: Response): void => {
  try {
    const status = (req.query.status as string) || '';
    const search = (req.query.search as string) || '';
    const feePaid = req.query.fee_paid as string;
    const subPaid = req.query.subscription_paid as string;
    const docsSubmitted = req.query.documents_submitted as string;

    let query = `
      SELECT
        id, phone, name, email, city, vehicle_category, current_step,
        status, fee_paid, fee_amount, fee_tx_id, fee_paid_at,
        subscription_paid, subscription_amount, subscription_tx_id, subscription_paid_at,
        documents_submitted, documents_submitted_at, admin_notes,
        created_at, updated_at
      FROM drivers
      WHERE 1=1
    `;
    const params: any[] = [];

    if (status && status !== 'all') {
      query += ' AND status = ?';
      params.push(status);
    }

    if (feePaid !== undefined && feePaid !== '') {
      query += ' AND fee_paid = ?';
      params.push(feePaid === '1' || feePaid === 'true' ? 1 : 0);
    }

    if (subPaid !== undefined && subPaid !== '') {
      query += ' AND subscription_paid = ?';
      params.push(subPaid === '1' || subPaid === 'true' ? 1 : 0);
    }

    if (docsSubmitted !== undefined && docsSubmitted !== '') {
      query += ' AND documents_submitted = ?';
      params.push(docsSubmitted === '1' || docsSubmitted === 'true' ? 1 : 0);
    }

    if (search.trim()) {
      query += ` AND (
        name LIKE ? OR
        phone LIKE ? OR
        vehicle_category LIKE ?
      )`;
      const searchPattern = `%${search.trim()}%`;
      params.push(searchPattern, searchPattern, searchPattern);
    }

    query += ' ORDER BY id DESC';

    const stmt = db.prepare(query);
    const applications = stmt.all(...params);

    res.json({
      success: true,
      count: applications.length,
      applications,
    });
  } catch (err: any) {
    console.error('Admin list error:', err);
    res.status(500).json({ success: false, message: 'Failed to fetch applications.' });
  }
});

// Single Driver Application Details
adminRouter.get('/applications/:id', (req: AuthenticatedRequest, res: Response): void => {
  try {
    const driverId = Number(req.params.id);
    const findDriver = db.prepare('SELECT * FROM drivers WHERE id = ?');
    const driver = findDriver.get(driverId) as any;

    if (!driver) {
      res.status(404).json({ success: false, message: 'Driver not found.' });
      return;
    }

    delete driver.password_hash;

    const getDocs = db.prepare('SELECT * FROM driver_documents WHERE driver_id = ?');
    const documents = getDocs.all(driverId);

    res.json({
      success: true,
      driver,
      documents,
    });
  } catch (err: any) {
    console.error('Admin get application error:', err);
    res.status(500).json({ success: false, message: 'Failed to fetch application details.' });
  }
});

// Update Application Status & Admin Notes
adminRouter.patch('/applications/:id/status', (req: AuthenticatedRequest, res: Response): void => {
  try {
    const driverId = Number(req.params.id);
    const { status, admin_notes } = req.body;

    const allowedStatus = ['draft', 'submitted', 'under_review', 'action_required', 'approved', 'rejected'];
    if (!status || !allowedStatus.includes(status)) {
      res.status(400).json({
        success: false,
        message: `Status must be one of: ${allowedStatus.join(', ')}`,
      });
      return;
    }

    const updateStmt = db.prepare(`
      UPDATE drivers
      SET status = ?, admin_notes = COALESCE(?, admin_notes), updated_at = datetime('now')
      WHERE id = ?
    `);

    updateStmt.run(status, admin_notes !== undefined ? admin_notes : null, driverId);

    res.json({
      success: true,
      message: `Driver status updated to '${status}'.`,
      status,
    });
  } catch (err: any) {
    console.error('Admin update status error:', err);
    res.status(500).json({ success: false, message: 'Failed to update application status.' });
  }
});

// Mark / Update Fee & Subscription Status
adminRouter.patch('/applications/:id/fee', (req: AuthenticatedRequest, res: Response): void => {
  try {
    const driverId = Number(req.params.id);
    const { fee_paid, fee_tx_id, subscription_paid, subscription_tx_id } = req.body;

    const updates: string[] = ['updated_at = datetime(\'now\')'];
    const params: any[] = [];

    if (fee_paid !== undefined) {
      const paidVal = fee_paid ? 1 : 0;
      updates.push('fee_paid = ?');
      params.push(paidVal);
      if (paidVal) {
        updates.push('fee_paid_at = datetime(\'now\')');
      }
    }

    if (fee_tx_id !== undefined) {
      updates.push('fee_tx_id = ?');
      params.push(fee_tx_id ? String(fee_tx_id).trim() : null);
    }

    if (subscription_paid !== undefined) {
      const subVal = subscription_paid ? 1 : 0;
      updates.push('subscription_paid = ?');
      params.push(subVal);
      if (subVal) {
        updates.push('subscription_paid_at = datetime(\'now\')');
      }
    }

    if (subscription_tx_id !== undefined) {
      updates.push('subscription_tx_id = ?');
      params.push(subscription_tx_id ? String(subscription_tx_id).trim() : null);
    }

    params.push(driverId);

    const updateStmt = db.prepare(`
      UPDATE drivers
      SET ${updates.join(', ')}
      WHERE id = ?
    `);
    updateStmt.run(...params);

    const driver = db.prepare('SELECT * FROM drivers WHERE id = ?').get(driverId);

    res.json({
      success: true,
      message: 'Payment and subscription status updated.',
      driver,
    });
  } catch (err: any) {
    console.error('Admin update fee error:', err);
    res.status(500).json({ success: false, message: 'Failed to update fee status.' });
  }
});

// ==========================================
// Platform Dynamic Fee Settings
// ==========================================
adminRouter.get('/settings/fees', (_req: AuthenticatedRequest, res: Response): void => {
  try {
    const fees = getFeeSettings();
    res.json({
      success: true,
      ...fees,
    });
  } catch (err: any) {
    console.error('Admin get fees error:', err);
    res.status(500).json({ success: false, message: 'Failed to retrieve fee settings.' });
  }
});

adminRouter.patch('/settings/fees', (req: AuthenticatedRequest, res: Response): void => {
  try {
    const { registration_fee, subscription_fee } = req.body;

    const regNum = Number(registration_fee);
    const subNum = Number(subscription_fee);

    if (isNaN(regNum) || regNum < 1) {
      res.status(400).json({ success: false, message: 'Registration fee must be a valid positive amount.' });
      return;
    }

    if (isNaN(subNum) || subNum < 1) {
      res.status(400).json({ success: false, message: 'Subscription fee must be a valid positive amount.' });
      return;
    }

    const updated = updateFeeSettings(regNum, subNum);

    res.json({
      success: true,
      message: `Fee settings updated: Registration Fee = ₹${regNum}, Subscription = ₹${subNum}`,
      ...updated,
    });
  } catch (err: any) {
    console.error('Admin update fees error:', err);
    res.status(500).json({ success: false, message: 'Failed to update fee settings.' });
  }
});
