const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const pinoHttp = require('pino-http');
const { mongoose } = require('@jobmesh/shared');
const { createAuthenticate } = require('./middleware/auth');
const { createRateLimiter } = require('./middleware/rateLimit');
const { notFoundHandler, createErrorHandler } = require('./middleware/errorHandler');
const { createAuthService } = require('./services/authService');
const { createJobService } = require('./services/jobService');
const { createStatsService } = require('./services/statsService');
const { createFileService } = require('./services/fileService');
const { authRoutes } = require('./routes/authRoutes');
const { jobRoutes } = require('./routes/jobRoutes');
const { statsRoutes } = require('./routes/statsRoutes');
const { fileRoutes } = require('./routes/fileRoutes');

/**
 * Builds the Express app from injected infrastructure (queue gateway, cache,
 * rate-limit store). Production wires Redis/BullMQ implementations; tests pass
 * in-memory fakes, so the HTTP layer is testable without Redis.
 */
function createApp({ config, logger, queueGateway, cache, rateLimitStore }) {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', config.trustProxy);

  app.use(helmet());
  app.use(cors({ origin: config.corsOrigins, exposedHeaders: ['X-Cache', 'Location', 'RateLimit-Remaining', 'Retry-After'] }));
  app.use(express.json({ limit: '100kb' }));
  if (logger) {
    app.use(pinoHttp({ logger, autoLogging: { ignore: (req) => req.url === '/health' } }));
  }

  const services = {
    authService: createAuthService(config),
    jobService: createJobService({ queueGateway, cache, config, logger }),
    statsService: createStatsService({ queueGateway, cache, config, logger }),
    fileService: createFileService({ config }),
  };
  const authenticate = createAuthenticate(config);
  const rateLimit = createRateLimiter(rateLimitStore, logger);
  const apiLimiter = rateLimit({
    bucket: 'api',
    limit: config.rateLimit.apiPerWindow,
    windowMs: config.rateLimit.windowMs,
  });
  const protectedApi = [authenticate, apiLimiter];

  app.get('/health', (_req, res) => res.json({ status: 'ok' }));
  app.get('/ready', async (_req, res) => {
    const mongo = mongoose.connection.readyState === 1;
    const redis = await cache.ping().catch(() => false);
    res.status(mongo && redis ? 200 : 503).json({ mongo, redis });
  });

  app.use('/api/auth', authRoutes({ ...services, authenticate, rateLimit, config }));
  app.use('/api/jobs', protectedApi, jobRoutes({ ...services, rateLimit, config }));
  app.use('/api/files', protectedApi, fileRoutes({ ...services, config }));
  app.use('/api/stats', protectedApi, statsRoutes(services));

  app.use(notFoundHandler);
  app.use(createErrorHandler({ logger, exposeInternalErrors: config.env !== 'production' }));
  return app;
}

module.exports = { createApp };
