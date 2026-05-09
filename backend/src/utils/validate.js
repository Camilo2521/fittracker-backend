'use strict';

/**
 * Lightweight input validation helpers.
 * Each function returns an error string or null if valid.
 */

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function isValidDate(str) {
  if (!DATE_RE.test(str)) return false;
  const d = new Date(str);
  return !isNaN(d.getTime());
}

/** Validates an optional date string (YYYY-MM-DD). */
function validateDate(val, field = 'date') {
  if (val === undefined || val === null) return null;
  if (typeof val !== 'string' || !isValidDate(val)) {
    return `${field} debe tener formato YYYY-MM-DD válido`;
  }
  return null;
}

/** Validates a required string field. */
function validateString(val, field, { maxLength = 500 } = {}) {
  if (typeof val !== 'string' || !val.trim()) return `${field} es requerido`;
  if (val.length > maxLength) return `${field} no puede superar ${maxLength} caracteres`;
  return null;
}

/** Validates an optional numeric field within a range. */
function validateNumber(val, field, { min, max, required = false } = {}) {
  if (val === undefined || val === null) {
    return required ? `${field} es requerido` : null;
  }
  const n = Number(val);
  if (!Number.isFinite(n)) return `${field} debe ser un número`;
  if (min !== undefined && n < min) return `${field} debe ser mayor o igual a ${min}`;
  if (max !== undefined && n > max) return `${field} debe ser menor o igual a ${max}`;
  return null;
}

/** Validates that val is one of the allowed enum values. */
function validateEnum(val, field, allowed, { required = false } = {}) {
  if (val === undefined || val === null) {
    return required ? `${field} es requerido` : null;
  }
  if (!allowed.includes(val)) {
    return `${field} debe ser uno de: ${allowed.join(', ')}`;
  }
  return null;
}

/** Validates an account/user ID from query params (positive integer). */
function validateId(val, field = 'id') {
  const n = parseInt(val, 10);
  if (!Number.isInteger(n) || n <= 0) return `${field} debe ser un entero positivo`;
  return null;
}

/**
 * Collects all validation errors and sends 400 if any found.
 * Returns true if the request should be aborted.
 *
 * Usage:
 *   const errors = [validateDate(req.body.date), validateNumber(req.body.weight, 'weight', { min: 30, max: 500 })];
 *   if (abort(res, errors)) return;
 */
function abort(res, errors) {
  const found = errors.filter(Boolean);
  if (!found.length) return false;
  res.status(400).json({ error: found[0], errors: found });
  return true;
}

module.exports = {
  validateDate,
  validateString,
  validateNumber,
  validateEnum,
  validateId,
  abort,
};
