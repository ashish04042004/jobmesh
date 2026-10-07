const path = require('node:path');
const { envInt, envString } = require('./env');

const dataDir = path.resolve(envString('DATA_DIR', path.resolve(__dirname, '../../data')));

module.exports = {
  env: envString('NODE_ENV', 'development'),
  logLevel: envString('LOG_LEVEL', 'info'),
  mongoUri: envString('MONGO_URI', 'mongodb://localhost:27017/jobmesh'),
  redisUrl: envString('REDIS_URL', 'redis://localhost:6379'),
  dataDir,
  uploadsDir: path.join(dataDir, 'uploads'),
  outputsDir: path.join(dataDir, 'outputs'),
  jobs: {
    attempts: envInt('JOB_ATTEMPTS', 3),
    backoffMs: envInt('JOB_BACKOFF_MS', 1000),
    keepCompletedSec: envInt('JOB_KEEP_COMPLETED_SEC', 3600),
    keepFailedSec: envInt('JOB_KEEP_FAILED_SEC', 7 * 24 * 3600),
  },
};
