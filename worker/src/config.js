const os = require('node:os');
const { config: shared, envInt, envString } = require('@jobmesh/shared');

module.exports = {
  ...shared,
  workerId: envString('WORKER_ID', `${os.hostname()}-${process.pid}`),
  concurrency: envInt('WORKER_CONCURRENCY', 2),
  lockDurationMs: envInt('WORKER_LOCK_DURATION_MS', 30_000),
  stalledIntervalMs: envInt('WORKER_STALLED_INTERVAL_MS', 30_000),
  heartbeatMs: envInt('WORKER_HEARTBEAT_MS', 5_000),
  shutdownTimeoutMs: envInt('WORKER_SHUTDOWN_TIMEOUT_MS', 25_000),
};
