const fs = require('node:fs/promises');
const {
  connectMongo,
  disconnectMongo,
  createRedis,
  createJobQueue,
  createLogger,
  User,
  Job,
  File,
} = require('@jobmesh/shared');
const config = require('./config');
const { createApp } = require('./app');
const { createQueueGateway } = require('./services/queueGateway');
const { createRedisCache } = require('./services/cache');
const { createRedisRateLimitStore } = require('./services/rateLimitStore');

const logger = createLogger('api', config.logLevel);
const SHUTDOWN_TIMEOUT_MS = 10_000;

async function main() {
  await Promise.all([fs.mkdir(config.uploadsDir, { recursive: true }), fs.mkdir(config.outputsDir, { recursive: true })]);

  await connectMongo(config.mongoUri, logger);
  // Unique indexes (email, Idempotency-Key) must exist before requests arrive.
  await Promise.all([User.init(), Job.init(), File.init()]);

  const redis = createRedis(config.redisUrl, { connectionName: 'jobmesh-api' });
  redis.on('error', (err) => logger.error({ err }, 'Redis connection error'));
  const queue = createJobQueue(redis, config.jobs);

  const app = createApp({
    config,
    logger,
    queueGateway: createQueueGateway({ queue, redis }),
    cache: createRedisCache(redis, logger),
    rateLimitStore: createRedisRateLimitStore(redis),
  });

  const server = app.listen(config.port, () => logger.info({ port: config.port }, 'JobMesh API listening'));

  let shuttingDown = false;
  async function shutdown(signal) {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info({ signal }, 'Shutting down API');
    setTimeout(() => {
      logger.error('Graceful shutdown timed out; forcing exit');
      process.exit(1);
    }, SHUTDOWN_TIMEOUT_MS).unref();

    await new Promise((resolve) => server.close(resolve));
    await queue.close();
    await redis.quit();
    await disconnectMongo();
    logger.info('API stopped cleanly');
    process.exit(0);
  }

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

main().catch((err) => {
  logger.fatal({ err }, 'API failed to start');
  process.exit(1);
});
