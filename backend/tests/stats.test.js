const request = require('supertest');
const { Job } = require('@jobmesh/shared');
const { connectTestDb, disconnectTestDb, clearDb, buildTestApp, registerUser, csvJob } = require('./helpers');

describe('Stats API', () => {
  let app;
  let token;

  beforeAll(connectTestDb);
  beforeEach(async () => {
    ({ app } = buildTestApp());
    ({ token } = await registerUser(app));
  });
  afterEach(clearDb);
  afterAll(disconnectTestDb);

  const get = (url) => request(app).get(url).set('Authorization', `Bearer ${token}`);

  it('summarises job counts by status for the current user', async () => {
    const { body } = await request(app)
      .post('/api/jobs/bulk')
      .set('Authorization', `Bearer ${token}`)
      .send({ jobs: Array.from({ length: 4 }, () => csvJob()) });
    const [a, b, c] = body.jobs.map((j) => j.id);
    await Job.updateOne({ _id: a }, { status: 'COMPLETED', durationMs: 2000 });
    await Job.updateOne({ _id: b }, { status: 'COMPLETED', durationMs: 4000 });
    await Job.updateOne({ _id: c }, { status: 'FAILED' });

    const res = await get('/api/stats').expect(200);
    expect(res.body).toMatchObject({
      total: 4,
      queued: 1,
      completed: 2,
      failed: 1,
      processing: 0,
      averageProcessingTime: 3,
    });
    expect(res.body.queue).toMatchObject({ depth: expect.any(Number) });

    const cached = await get('/api/stats').expect(200);
    expect(cached.headers['x-cache']).toBe('HIT');
  });

  it('reports batch throughput and latency percentiles once a batch drains', async () => {
    const { body } = await request(app)
      .post('/api/jobs/bulk')
      .set('Authorization', `Bearer ${token}`)
      .send({ batchId: 'bench', jobs: Array.from({ length: 4 }, () => csvJob()) });

    const inFlight = await get('/api/stats?batchId=bench').expect(200);
    expect(inFlight.body).toMatchObject({ total: 4, QUEUED: 4, done: false });
    expect(inFlight.body.throughputJobsPerSec).toBeUndefined();

    const created = new Date(body.jobs[0].createdAt).getTime();
    await Promise.all(
      body.jobs.map((job, i) =>
        Job.updateOne(
          { _id: job.id },
          {
            status: 'COMPLETED',
            attempts: i === 0 ? 2 : 1,
            startedAt: new Date(created + 100),
            completedAt: new Date(created + 2000),
            durationMs: (i + 1) * 100,
          },
        ),
      ),
    );

    const done = await get('/api/stats?batchId=bench').expect(200);
    expect(done.body).toMatchObject({ done: true, COMPLETED: 4, retriedJobs: 1, totalAttempts: 5 });
    expect(done.body.processingMs).toMatchObject({ p50: 200, p95: 400, max: 400 });
    expect(done.body.throughputJobsPerSec).toBeGreaterThan(0);
  });

  it('returns 404 for unknown batches', async () => {
    await get('/api/stats?batchId=nope').expect(404);
  });
});
