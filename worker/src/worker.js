const os = require('node:os');
const fs = require('node:fs/promises');
const { Worker } = require('bullmq');
const {
  QUEUE_NAME,
  QUEUE_PREFIX,
  REDIS_KEYS,
  connectMongo,
  disconnectMongo,
  createRedis,
  createLogger,
  Job,
  File,
} = require('@jobmesh/shared');
const config = require('./config');
const processors = require('./processors');
const { createJobHandler, reconcileFailedJob } = require('./jobHandler');

const logger = createLogger('worker', config.logLevel).child({ workerId: config.workerId });

async function main() {
  await fs.mkdir(config.outputsDir, { recursive: true });
  await connectMongo(config.mongoUri, logger);
  await Promise.all([Job.init(), File.init()]);

  // Separate connections: BullMQ's blocking reads must not delay cache/heartbeat commands.
  const commands = createRedis(config.redisUrl, { connectionName: `jobmesh-worker-cmd:${config.workerId}` });
  const bullConnection = createRedis(config.redisUrl, {
    connectionName: `jobmesh-worker:${config.workerId}`,
    blocking: true,
  });
  for (const conn of [commands, bullConnection]) {
    conn.on('error', (err) => logger.error({ err }, 'Redis connection error'));
  }

  const cache = {
    invalidateJob: (jobId) =>
      commands.del(REDIS_KEYS.jobCache(jobId)).catch((err) => logger.warn({ err, jobId }, 'Cache invalidation failed')),
  };
  const cancellation = {
    async isCancelled(jobId) {
      try {
        return (await commands.exists(REDIS_KEYS.cancelFlag(jobId))) === 1;
      } catch (err) {
        logger.warn({ err, jobId }, 'Cancellation check failed; continuing');
        return false;
      }
    },
  };

  const handleJob = createJobHandler({
    processors,
    workerId: config.workerId,
    dataDir: config.dataDir,
    cache,
    cancellation,
    logger,
  });

  const counters = { active: 0, completed: 0, failedAttempts: 0 };
  const worker = new Worker(
    QUEUE_NAME,
    async (bullJob) => {
      counters.active += 1;
      try {
        return await handleJob(bullJob);
      } finally {
        counters.active -= 1;
      }
    },
    {
      connection: bullConnection,
      prefix: QUEUE_PREFIX,
      name: config.workerId,
      concurrency: config.concurrency,
      lockDuration: config.lockDurationMs,
      stalledInterval: config.stalledIntervalMs,
      maxStalledCount: 1,
    },
  );

  worker.on('completed', () => {
    counters.completed += 1;
  });
  worker.on('failed', (bullJob, err) => {
    counters.failedAttempts += 1;
    reconcileFailedJob(bullJob, err, { cache, logger });
  });
  worker.on('stalled', (bullJobId) => logger.warn({ bullJobId }, 'Job stalled; it will be re-delivered'));
  worker.on('error', (err) => logger.error({ err }, 'Worker error'));

  const startedAt = new Date().toISOString();
  const heartbeatKey = REDIS_KEYS.worker(config.workerId);
  async function heartbeat() {
    const state = {
      workerId: config.workerId,
      hostname: os.hostname(),
      pid: process.pid,
      concurrency: config.concurrency,
      startedAt,
      lastSeen: new Date().toISOString(),
      memoryMb: Math.round(process.memoryUsage().rss / 1024 / 1024),
      ...counters,
    };
    try {
      await commands.set(heartbeatKey, JSON.stringify(state), 'PX', config.heartbeatMs * 3);
    } catch (err) {
      logger.warn({ err }, 'Heartbeat failed');
    }
  }
  await heartbeat();
  const heartbeatTimer = setInterval(heartbeat, config.heartbeatMs);

  logger.info({ concurrency: config.concurrency }, 'Worker started; waiting for jobs');

  let shuttingDown = false;
  async function shutdown(signal) {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info({ signal, active: counters.active }, 'Shutting down: finishing active jobs');
    setTimeout(() => {
      logger.error('Graceful shutdown timed out; exiting (unfinished jobs will be re-delivered)');
      process.exit(1);
    }, config.shutdownTimeoutMs).unref();

    clearInterval(heartbeatTimer);
    // close() stops fetching new jobs and waits for in-flight ones to settle.
    await worker.close();
    await commands.del(heartbeatKey).catch(() => {});
    await Promise.all([commands.quit(), bullConnection.quit().catch(() => {})]);
    await disconnectMongo();
    logger.info({ completed: counters.completed }, 'Worker stopped cleanly');
    process.exit(0);
  }

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

main().catch((err) => {
  logger.fatal({ err }, 'Worker failed to start');
  process.exit(1);
});
