const { AppError } = require('../utils/AppError');

/**
 * Validates request parts against zod schemas and stores the parsed (coerced,
 * defaulted) values on `req.validated`. Express 5 exposes `req.query` as a
 * getter, so parsed values are never written back onto the request.
 */
function validate(schemas) {
  return (req, _res, next) => {
    req.validated ??= {};
    for (const [source, schema] of Object.entries(schemas)) {
      const result = schema.safeParse(req[source]);
      if (!result.success) {
        const details = result.error.issues.map((issue) => ({
          path: [source, ...issue.path].join('.'),
          message: issue.message,
        }));
        return next(new AppError(400, 'Request validation failed', { code: 'VALIDATION_ERROR', details }));
      }
      req.validated[source] = result.data;
    }
    return next();
  };
}

module.exports = { validate };
