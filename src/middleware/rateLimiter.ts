import rateLimit from 'express-rate-limit';

// Standard general API rate limiter: 120 requests per 15 minutes
export const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 120,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    message: 'Too many requests from this IP, please try again after 15 minutes.',
  },
});

// Standard Auth & Registration limiter: 25 attempts per 15 minutes to prevent spam submissions
export const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 25,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    message: 'Too many registration or login attempts from this IP. Please try again after 15 minutes.',
  },
});

// Driver status & application actions limiter: 60 requests per 15 minutes
export const driverLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    message: 'Too many requests, please slow down.',
  },
});
