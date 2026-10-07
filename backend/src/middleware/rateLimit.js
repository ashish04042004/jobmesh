const { AppError } = require('../utils/AppError');

/**
 * Returns a factory for rate-limit middleware backed by a shared store, so the
 * limit holds across every API instance. If the store is unreachable the
 * limiter fails open: an outage of the limiter should not take the API down.
 */
function createRateLimiter(store, logger) {
  return function rateLimit({ bucket, limit, windowMs, key = (req) => req.user?.id ?? req.ip, cost = () => 1 }) {
    return async function rateLimitMiddleware(req, res, next) {
      const units = cost(req);
      let result;
      try {
        result = await store.consume(`${bucket}:${key(req)}`, { limit, windowMs, cost: units });
      } catch (err) {
        logger?.warn({ err, bucket }, 'Rate limiter unavailable, failing open');
        return next();
      }

      const resetSec = Math.ceil(result.resetMs / 1000);
      res.set('RateLimit-Limit', String(limit));
      res.set('RateLimit-Remaining', String(Math.max(0, limit - result.count)));
      res.set('RateLimit-Reset', String(resetSec));

      if (!result.allowed) {
        res.set('Retry-After', String(Math.max(1, resetSec)));
        return next(new AppError(429, `Rate limit exceeded for ${bucket}; retry later`, { code: 'RATE_LIMITED' }));
      }
      return next();
    };
  };
}

module.exports = { createRateLimiter };
