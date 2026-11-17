import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import path from 'node:path';
import { initDatabase } from './db.js';
import { authRouter } from './routes/auth.js';
import { driverRouter } from './routes/driver.js';
import { adminRouter } from './routes/admin.js';
import { apiLimiter, authLimiter, driverLimiter } from './middleware/rateLimiter.js';

const app = express();
const PORT = process.env.PORT || 5050;

// Initialize SQLite database
initDatabase();

// Middleware
app.use(cors({
  origin: '*',
  credentials: true,
}));
app.use(express.json({
  limit: '15mb',
  verify: (req: any, _res, buf) => {
    req.rawBody = buf.toString('utf8');
  },
}));
app.use(express.urlencoded({ extended: true, limit: '15mb' }));

// Static files for uploaded documents
const uploadsDir = path.resolve(process.cwd(), 'uploads');
app.use('/uploads', express.static(uploadsDir));

// Healthcheck
app.get('/api/health', (_req, res) => {
  res.json({
    status: 'ok',
    service: 'Smart Driver Backend API',
    timestamp: new Date().toISOString(),
  });
});

// Mount Routes with standard rate limiting to avoid database spam
app.use('/api/auth', authLimiter, authRouter);
app.use('/api/driver', driverLimiter, driverRouter);
app.use('/api/admin', apiLimiter, adminRouter);

// Global Error Handler
app.use((err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error('Unhandled Server Error:', err);
  res.status(err.status || 500).json({
    success: false,
    message: err.message || 'Internal Server Error',
  });
});

// Start Server
app.listen(PORT, () => {
  console.log(`🚀 Smart Driver Backend running on http://localhost:${PORT}`);
  console.log(`📁 Document uploads stored in: ${uploadsDir}`);
});
