const multer = require('multer');
const { mongoose } = require('@jobmesh/shared');
const { AppError } = require('../utils/AppError');

function normalizeError(err) {
  if (err instanceof AppError) return err;
  if (err instanceof multer.MulterError) {
    const status = err.code === 'LIMIT_FILE_SIZE' ? 413 : 400;
    return new AppError(status, err.message, { code: err.code });
  }
  if (err instanceof mongoose.Error.CastError) {
    return new AppError(400, `Invalid value for ${err.path}`, { code: 'BAD_REQUEST' });
  }
  if (err?.type === 'entity.parse.failed') {
    return new AppError(400, 'Malformed JSON body', { code: 'BAD_REQUEST' });
  }
  if (err?.type === 'entity.too.large') {
    return new AppError(413, 'Request body too large', { code: 'PAYLOAD_TOO_LARGE' });
  }
  return null;
}

function notFoundHandler(req, _res, next) {
  next(new AppError(404, `Route ${req.method} ${req.path} not found`, { code: 'NOT_FOUND' }));
}

function createErrorHandler({ logger, exposeInternalErrors }) {
  // Express identifies error handlers by arity, so all four params are required.
  return function errorHandler(err, req, res, _next) {
    const known = normalizeError(err);
    if (known) {
      return res.status(known.status).json({
        error: { code: known.code, message: known.message, ...(known.details && { details: known.details }) },
      });
    }

    (req.log ?? logger)?.error({ err }, 'Unhandled error');
    return res.status(500).json({
      error: { code: 'INTERNAL_ERROR', message: exposeInternalErrors ? err.message : 'Internal server error' },
    });
  };
}

module.exports = { notFoundHandler, createErrorHandler };
