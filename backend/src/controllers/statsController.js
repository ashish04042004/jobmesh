function createStatsController({ statsService }) {
  return {
    async get(req, res) {
      const { batchId } = req.validated.query;
      if (batchId) {
        res.json(await statsService.batch(req.user.id, batchId));
        return;
      }
      const { stats, cacheHit } = await statsService.overview(req.user.id);
      res.set('X-Cache', cacheHit ? 'HIT' : 'MISS').json(stats);
    },
  };
}

module.exports = { createStatsController };
