'use strict';

const { randomUUID } = require('crypto');

/**
 * Attaches a unique correlation ID to every request.
 * - Reuses `X-Request-Id` header if provided by the caller.
 * - Exposes it on `req.id` and echoes it back in the response header.
 */
function requestId(req, res, next) {
  req.id = (req.headers['x-request-id'] || randomUUID()).slice(0, 36);
  res.setHeader('X-Request-Id', req.id);
  next();
}

module.exports = requestId;
