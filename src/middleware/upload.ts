import multer from 'multer';
import path from 'node:path';
import fs from 'node:fs';

const uploadsDir = path.resolve(process.cwd(), 'uploads');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    cb(null, uploadsDir);
  },
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    const cleanName = path.basename(file.originalname, ext).replace(/[^a-zA-Z0-9_-]/g, '_');
    const uniqueSuffix = `${Date.now()}_${Math.round(Math.random() * 1e9)}`;
    cb(null, `${cleanName}_${uniqueSuffix}${ext}`);
  },
});

const fileFilter = (_req: any, file: Express.Multer.File, cb: multer.FileFilterCallback) => {
  const allowedMime = [
    'image/jpeg',
    'image/jpg',
    'image/png',
    'image/webp',
    'application/pdf',
  ];
  if (allowedMime.includes(file.mimetype.toLowerCase())) {
    cb(null, true);
  } else {
    cb(new Error('Only JPG, PNG, WEBP and PDF documents are allowed'));
  }
};

export const documentUpload = multer({
  storage,
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB per file
  },
  fileFilter,
});

export const driverRegistrationUpload = documentUpload.fields([
  { name: 'dl_front', maxCount: 1 },
  { name: 'dl_back', maxCount: 1 },
  { name: 'rc_front', maxCount: 1 },
  { name: 'rc_back', maxCount: 1 },
  { name: 'aadhaar_card', maxCount: 1 },
  { name: 'insurance', maxCount: 1 },
  { name: 'driver_photo', maxCount: 1 },
]);
