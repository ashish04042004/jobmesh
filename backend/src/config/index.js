const { config: shared, envInt, envString } = require('@jobmesh/shared');

const DEV_JWT_SECRET = 'jobmesh-dev-secret-do-not-use-in-production';

const config = {
  ...shared,
  port: envInt('PORT', 4000),
  jwtSecret: envString('JWT_SECRET', DEV_JWT_SECRET),
  jwtExpiresIn: envString('JWT_EXPIRES_IN', '1d'),
  bcryptRounds: envInt('BCRYPT_ROUNDS', 10),
  corsOrigins: envString('CORS_ORIGIN', 'http://localhost:5173').split(',').map((o) => o.trim()),
  trustProxy: envInt('TRUST_PROXY_HOPS', 0),
  rateLimit: {
    windowMs: envInt('RATE_LIMIT_WINDOW_MS', 60_000),
    apiPerWindow: envInt('RATE_LIMIT_API_PER_MIN', 600),
    jobsPerWindow: envInt('RATE_LIMIT_JOBS_PER_MIN', 100),
    authPerWindow: envInt('RATE_LIMIT_AUTH_PER_MIN', 20),
  },
  cache: {
    jobTtlSec: envInt('CACHE_JOB_TTL_SEC', 60),
    statsTtlSec: envInt('CACHE_STATS_TTL_SEC', 5),
  },
  uploadMaxBytes: envInt('UPLOAD_MAX_BYTES', 20 * 1024 * 1024),
};

if (config.env === 'production' && (config.jwtSecret === DEV_JWT_SECRET || config.jwtSecret.length < 32)) {
  throw new Error('JWT_SECRET must be set to a value of at least 32 characters in production');
}

module.exports = config;
