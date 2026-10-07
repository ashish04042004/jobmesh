const request = require('supertest');
const { Job } = require('@jobmesh/shared');
const { connectTestDb, disconnectTestDb, clearDb, buildTestApp, registerUser, csvJob } = require('./helpers');

describe('Jobs API', () => {
  let app;
  let queueGateway;
  let token;
  let auth;

  beforeAll(connectTestDb);
  beforeEach(async () => {
    ({ app, queueGateway } = buildTestApp());
    ({ token } = await registerUser(app));
    auth = (req) => req.set('Authorization', `Bearer ${token}`);
  });
  afterEach(clearDb);
  afterAll(disconnectTestDb);

  const submit = (body, headers = {}) => auth(request(app).post('/api/jobs').set(headers).send(body));

  describe('POST /api/jobs', () => {
    it('persists the job, enqueues it and responds 202 without waiting for processing', async () => {
      const res = await submit(csvJob({ priority: 'HIGH' })).expect(202);

      expect(res.headers.location).toBe(`/api/jobs/${res.body.job.id}`);
      expect(res.body.job).toMatchObject({ type: 'CSV_PROCESSING', priority: 'HIGH', status: 'QUEUED', attempts: 0 });
      expect(res.body.job.payload.synthetic).toEqual({ rows: 1000, invalidRate: 0.01 });
      expect(queueGateway.queued.get(res.body.job.id)).toEqual({ type: 'CSV_PROCESSING', priority: 'HIGH' });
      expect(await Job.countDocuments()).toBe(1);
    });

    it('applies schema defaults per job type', async () => {
      const res = await submit({
        type: 'IMAGE_PROCESSING',
        payload: { synthetic: { width: 800, height: 600 } },
      }).expect(202);
      expect(res.body.job.priority).toBe('MEDIUM');
      expect(res.body.job.payload).toMatchObject({ resize: { width: 1024 }, thumbnailSize: 200, format: 'webp' });
    });

    it.each([
      ['unknown job type', { type: 'BITCOIN_MINING', payload: {} }],
      ['both fileId and synthetic', csvJob({ payload: { fileId: '0123456789abcdef01234567', synthetic: { rows: 5 } } })],
      ['neither fileId nor synthetic', csvJob({ payload: {} })],
      ['unknown payload field', csvJob({ payload: { synthetic: { rows: 5 }, rm: '-rf' } })],
      ['bad report month', { type: 'REPORT_GENERATION', payload: { month: '2026-13' } }],
      ['bad priority', csvJob({ priority: 'URGENT' })],
    ])('rejects %s with 400', async (_label, body) => {
      const res = await submit(body).expect(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
      expect(queueGateway.queued.size).toBe(0);
    });

    it('rejects a fileId the user does not own', async () => {
      const res = await submit(csvJob({ payload: { fileId: '0123456789abcdef01234567' } })).expect(400);
      expect(res.body.error.message).toMatch(/does not reference one of your uploads/);
    });

    it('is idempotent per Idempotency-Key', async () => {
      const first = await submit(csvJob(), { 'Idempotency-Key': 'order-42' }).expect(202);
      const replay = await submit(csvJob(), { 'Idempotency-Key': 'order-42' }).expect(200);

      expect(replay.body.job.id).toBe(first.body.job.id);
      expect(await Job.countDocuments()).toBe(1);
      expect(queueGateway.queued.size).toBe(1);
    });

    it('marks the job FAILED and returns 503 when the queue is unavailable', async () => {
      queueGateway.failNextEnqueue = true;
      const res = await submit(csvJob()).expect(503);
      expect(res.body.error.code).toBe('QUEUE_UNAVAILABLE');

      const [job] = await Job.find().lean();
      expect(job.status).toBe('FAILED');
      expect(job.error).toMatch(/Queue unavailable/);
    });
  });

  describe('POST /api/jobs/bulk', () => {
    it('creates and enqueues a tagged batch', async () => {
      const jobs = Array.from({ length: 25 }, (_, i) => csvJob({ priority: i % 2 ? 'LOW' : 'HIGH' }));
      const res = await auth(request(app).post('/api/jobs/bulk'))
        .send({ batchId: 'bench-1', jobs })
        .expect(202);

      expect(res.body.count).toBe(25);
      expect(queueGateway.queued.size).toBe(25);
      expect(await Job.countDocuments({ batchId: 'bench-1' })).toBe(25);
    });

    it('rejects batches over 100 jobs', async () => {
      const jobs = Array.from({ length: 101 }, () => csvJob());
      await auth(request(app).post('/api/jobs/bulk')).send({ jobs }).expect(400);
    });
  });

  describe('GET /api/jobs', () => {
    it('paginates newest-first with a cursor and supports filters', async () => {
      for (let i = 0; i < 5; i += 1) await submit(csvJob());
      await submit({ type: 'REPORT_GENERATION', payload: { month: '2026-09' } });

      const page1 = await auth(request(app).get('/api/jobs?limit=4')).expect(200);
      expect(page1.body.items).toHaveLength(4);
      expect(page1.body.items[0].type).toBe('REPORT_GENERATION');
      expect(page1.body.nextCursor).toBe(page1.body.items[3].id);

      const page2 = await auth(request(app).get(`/api/jobs?limit=4&cursor=${page1.body.nextCursor}`)).expect(200);
      expect(page2.body.items).toHaveLength(2);
      expect(page2.body.nextCursor).toBeNull();

      const reports = await auth(request(app).get('/api/jobs?type=REPORT_GENERATION')).expect(200);
      expect(reports.body.items).toHaveLength(1);
    });
  });

  describe('GET /api/jobs/:id', () => {
    it('serves repeat reads from the cache', async () => {
      const { body } = await submit(csvJob());
      const miss = await auth(request(app).get(`/api/jobs/${body.job.id}`)).expect(200);
      const hit = await auth(request(app).get(`/api/jobs/${body.job.id}`)).expect(200);

      expect(miss.headers['x-cache']).toBe('MISS');
      expect(hit.headers['x-cache']).toBe('HIT');
      expect(hit.body.job).toEqual(miss.body.job);
    });

    it("never exposes another user's job, even from cache", async () => {
      const { body } = await submit(csvJob());
      await auth(request(app).get(`/api/jobs/${body.job.id}`)).expect(200);

      const other = await registerUser(app);
      await request(app)
        .get(`/api/jobs/${body.job.id}`)
        .set('Authorization', `Bearer ${other.token}`)
        .expect(404);
    });

    it('returns 400 for malformed ids', async () => {
      await auth(request(app).get('/api/jobs/not-an-id')).expect(400);
    });
  });

  describe('cancel / retry / delete', () => {
    it('cancels a queued job and removes it from the queue', async () => {
      const { body } = await submit(csvJob());
      const res = await auth(request(app).post(`/api/jobs/${body.job.id}/cancel`)).expect(200);

      expect(res.body.job.status).toBe('CANCELLED');
      expect(queueGateway.queued.has(body.job.id)).toBe(false);
      expect(queueGateway.cancelFlags.has(body.job.id)).toBe(true);
    });

    it('refuses to cancel a job that already finished', async () => {
      const { body } = await submit(csvJob());
      await Job.updateOne({ _id: body.job.id }, { status: 'COMPLETED' });
      const res = await auth(request(app).post(`/api/jobs/${body.job.id}/cancel`)).expect(409);
      expect(res.body.error.message).toMatch(/COMPLETED/);
    });

    it('invalidates the cached job when its status changes', async () => {
      const { body } = await submit(csvJob());
      await auth(request(app).get(`/api/jobs/${body.job.id}`)).expect(200);
      await auth(request(app).post(`/api/jobs/${body.job.id}/cancel`)).expect(200);

      const after = await auth(request(app).get(`/api/jobs/${body.job.id}`)).expect(200);
      expect(after.headers['x-cache']).toBe('MISS');
      expect(after.body.job.status).toBe('CANCELLED');
    });

    it('retries a failed job by resetting it and re-enqueueing', async () => {
      const { body } = await submit(csvJob());
      queueGateway.queued.clear();
      await Job.updateOne({ _id: body.job.id }, { status: 'FAILED', attempts: 3, error: 'boom' });

      const res = await auth(request(app).post(`/api/jobs/${body.job.id}/retry`)).expect(202);
      expect(res.body.job).toMatchObject({ status: 'QUEUED', attempts: 0, error: null, manualRetries: 1 });
      expect(queueGateway.queued.has(body.job.id)).toBe(true);
    });

    it('only retries FAILED or CANCELLED jobs', async () => {
      const { body } = await submit(csvJob());
      await auth(request(app).post(`/api/jobs/${body.job.id}/retry`)).expect(409);
    });

    it('refuses to retry while the previous run still holds the queue lock', async () => {
      const { body } = await submit(csvJob());
      await Job.updateOne({ _id: body.job.id }, { status: 'CANCELLED' });
      queueGateway.active.add(body.job.id);
      await auth(request(app).post(`/api/jobs/${body.job.id}/retry`)).expect(409);
    });

    it('deletes non-running jobs but refuses running ones', async () => {
      const queued = await submit(csvJob());
      await auth(request(app).delete(`/api/jobs/${queued.body.job.id}`)).expect(204);
      expect(await Job.exists({ _id: queued.body.job.id })).toBeNull();
      expect(queueGateway.queued.has(queued.body.job.id)).toBe(false);

      const running = await submit(csvJob());
      await Job.updateOne({ _id: running.body.job.id }, { status: 'PROCESSING' });
      await auth(request(app).delete(`/api/jobs/${running.body.job.id}`)).expect(409);
    });
  });
});
