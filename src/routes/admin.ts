import { Router, Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { db } from '../db.js';
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

    const feePaidStmt = db.prepare('SELECT COUNT(*) as count, COALESCE(SUM(fee_amount), 0) as total_revenue FROM drivers WHERE fee_paid = 1');
    const feeData = feePaidStmt.get() as any;

    res.json({
      success: true,
      stats: {
        total,
        pending,
        approved,
        rejected,
        fee_paid_count: feeData.count,
        total_revenue: feeData.total_revenue,
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

    let query = `
      SELECT
        id, phone, name, email, city, vehicle_category, vehicle_model, vehicle_number,
        dl_number, status, fee_paid, fee_amount, fee_tx_id, fee_paid_at,
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

    if (search.trim()) {
      query += ` AND (
        name LIKE ? OR
        phone LIKE ? OR
        vehicle_number LIKE ? OR
        dl_number LIKE ? OR
        city LIKE ?
      )`;
      const searchPattern = `%${search.trim()}%`;
      params.push(searchPattern, searchPattern, searchPattern, searchPattern, searchPattern);
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

// Single Driver Application Details + Documents
adminRouter.get('/applications/:id', (req: AuthenticatedRequest, res: Response): void => {
  try {
    const driverId = Number(req.params.id);
    const findDriver = db.prepare('SELECT * FROM drivers WHERE id = ?');
    const driver = findDriver.get(driverId) as any;

    if (!driver) {
      res.status(404).json({ success: false, message: 'Driver not found.' });
      return;
    }

    // Don't leak password hash to admin UI
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

    const allowedStatus = ['submitted', 'under_review', 'action_required', 'approved', 'rejected'];
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

// Mark / Update Fee Status
adminRouter.patch('/applications/:id/fee', (req: AuthenticatedRequest, res: Response): void => {
  try {
    const driverId = Number(req.params.id);
    const { fee_paid, fee_tx_id } = req.body;

    const paidVal = fee_paid ? 1 : 0;
    const paidAt = paidVal ? new Date().toISOString() : null;

    const updateStmt = db.prepare(`
      UPDATE drivers
      SET fee_paid = ?, fee_tx_id = COALESCE(?, fee_tx_id), fee_paid_at = ?, updated_at = datetime('now')
      WHERE id = ?
    `);

    updateStmt.run(paidVal, fee_tx_id || null, paidAt, driverId);

    res.json({
      success: true,
      message: `Application fee status updated to ${paidVal ? 'Paid' : 'Unpaid'}.`,
      fee_paid: paidVal,
    });
  } catch (err: any) {
    console.error('Admin update fee error:', err);
    res.status(500).json({ success: false, message: 'Failed to update fee status.' });
  }
});
