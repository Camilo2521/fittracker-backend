'use strict';

const rateLimit = require('express-rate-limit');

const isDev  = process.env.NODE_ENV !== 'production';
const isTest = process.env.NODE_ENV === 'test';

/** Auth endpoints: 10 attempts per 15 min per IP */
const authLimiter = rateLimit({
  windowMs:       15 * 60 * 1000,
  max:            isDev ? 100 : 10,
  standardHeaders: true,
  legacyHeaders:  false,
  skip:           () => isTest,
  message:        { error: 'Demasiados intentos. Inténtalo en 15 minutos.' },
  keyGenerator:   (req) => req.ip,
});

/** General API: 200 requests per minute per IP */
const generalLimiter = rateLimit({
  windowMs:       60 * 1000,
  max:            isDev ? 1000 : 200,
  standardHeaders: true,
  legacyHeaders:  false,
  skip:           () => isTest,
  message:        { error: 'Límite de peticiones alcanzado. Inténtalo en un momento.' },
});

module.exports = { authLimiter, generalLimiter };
