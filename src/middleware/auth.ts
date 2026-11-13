import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';

export const JWT_SECRET = process.env.JWT_SECRET || 'smart_driver_super_secret_jwt_key_2026';

export interface AuthDriverPayload {
  id: number;
  phone: string;
  name: string;
  role: 'driver';
}

export interface AuthAdminPayload {
  id: number;
  username: string;
  name: string;
  role: 'admin';
}

export interface AuthenticatedRequest extends Request {
  driver?: AuthDriverPayload;
  admin?: AuthAdminPayload;
}

export function requireDriverAuth(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    res.status(401).json({ success: false, message: 'Authentication required. Please login.' });
    return;
  }

  const token = authHeader.split(' ')[1];
  try {
    const decoded = jwt.verify(token, JWT_SECRET) as AuthDriverPayload;
    if (decoded.role !== 'driver') {
      res.status(403).json({ success: false, message: 'Invalid token role.' });
      return;
    }
    req.driver = decoded;
    next();
  } catch (error) {
    res.status(401).json({ success: false, message: 'Invalid or expired session. Please login again.' });
  }
}

export function requireAdminAuth(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    res.status(401).json({ success: false, message: 'Admin authentication required.' });
    return;
  }

  const token = authHeader.split(' ')[1];
  try {
    const decoded = jwt.verify(token, JWT_SECRET) as AuthAdminPayload;
    if (decoded.role !== 'admin') {
      res.status(403).json({ success: false, message: 'Forbidden. Admin access required.' });
      return;
    }
    req.admin = decoded;
    next();
  } catch (error) {
    res.status(401).json({ success: false, message: 'Invalid or expired admin session.' });
  }
}
