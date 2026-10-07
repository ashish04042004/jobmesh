function createJobController({ jobService }) {
  return {
    async create(req, res) {
      const idempotencyKey = req.validated.headers['idempotency-key'];
      const { job, created } = await jobService.create(req.user.id, req.validated.body, { idempotencyKey });
      res
        .status(created ? 202 : 200)
        .location(`/api/jobs/${job.id}`)
        .json({ job });
    },

    async createBulk(req, res) {
      const jobs = await jobService.createBulk(req.user.id, req.validated.body);
      res.status(202).json({ count: jobs.length, jobs });
    },

    async list(req, res) {
      res.json(await jobService.list(req.user.id, req.validated.query));
    },

    async get(req, res) {
      const { job, cacheHit } = await jobService.get(req.user.id, req.validated.params.id);
      res.set('X-Cache', cacheHit ? 'HIT' : 'MISS').json({ job });
    },

    async cancel(req, res) {
      res.json({ job: await jobService.cancel(req.user.id, req.validated.params.id) });
    },

    async retry(req, res) {
      res.status(202).json({ job: await jobService.retry(req.user.id, req.validated.params.id) });
    },

    async remove(req, res) {
      await jobService.remove(req.user.id, req.validated.params.id);
      res.status(204).end();
    },
  };
}

module.exports = { createJobController };
