const express = require('express');
const { validate } = require('../middleware/validate');
const {
  createJobSchema,
  bulkCreateSchema,
  listJobsQuery,
  idParams,
  idempotencyHeaders,
} = require('../validation/schemas');
const { createJobController } = require('../controllers/jobController');

function jobRoutes({ jobService, rateLimit, config }) {
  const router = express.Router();
  const controller = createJobController({ jobService });

  // Submissions are limited by jobs created, not requests: a bulk call of 50 costs 50.
  const submissionLimiter = rateLimit({
    bucket: 'jobs',
    limit: config.rateLimit.jobsPerWindow,
    windowMs: config.rateLimit.windowMs,
    cost: (req) => req.validated?.body?.jobs?.length ?? 1,
  });

  router.post(
    '/',
    validate({ body: createJobSchema, headers: idempotencyHeaders }),
    submissionLimiter,
    controller.create,
  );
  router.post('/bulk', validate({ body: bulkCreateSchema }), submissionLimiter, controller.createBulk);
  router.get('/', validate({ query: listJobsQuery }), controller.list);
  router.get('/:id', validate({ params: idParams }), controller.get);
  router.delete('/:id', validate({ params: idParams }), controller.remove);
  router.post('/:id/cancel', validate({ params: idParams }), controller.cancel);
  router.post('/:id/retry', validate({ params: idParams }), submissionLimiter, controller.retry);
  return router;
}

module.exports = { jobRoutes };
