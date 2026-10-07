class AppError extends Error {
  constructor(status, message, { code = 'ERROR', details } = {}) {
    super(message);
    this.name = 'AppError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

const badRequest = (message, details) => new AppError(400, message, { code: 'BAD_REQUEST', details });
const unauthorized = (message = 'Authentication required') => new AppError(401, message, { code: 'UNAUTHORIZED' });
const notFound = (message = 'Resource not found') => new AppError(404, message, { code: 'NOT_FOUND' });
const conflict = (message) => new AppError(409, message, { code: 'CONFLICT' });

module.exports = { AppError, badRequest, unauthorized, notFound, conflict };
