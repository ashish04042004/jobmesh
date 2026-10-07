const express = require('express');
const { validate } = require('../middleware/validate');
const { statsQuery } = require('../validation/schemas');
const { createStatsController } = require('../controllers/statsController');

function statsRoutes({ statsService }) {
  const router = express.Router();
  const controller = createStatsController({ statsService });
  router.get('/', validate({ query: statsQuery }), controller.get);
  return router;
}

module.exports = { statsRoutes };
