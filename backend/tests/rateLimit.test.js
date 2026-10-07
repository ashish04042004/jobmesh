const request = require('supertest');
const { connectTestDb, disconnectTestDb, clearDb, buildTestApp, registerUser, csvJob } = require('./helpers');
const { createMemoryRateLimitStore } = require('../src/services/rateLimitStore');

describe('Rate limiting', () => {
  beforeAll(connectTestDb);
  afterEach(clearDb);
  afterAll(disconnectTestDb);

  it('limits job submissions per user and reports Retry-After', async () => {
    const { app } = buildTestApp({ rateLimit: { jobsPerWindow: 3 } });
    const { token } = await registerUser(app);
    const submit = () => request(app).post('/api/jobs').set('Authorization', `Bearer ${token}`).send(csvJob());

    for (let i = 0; i < 3; i += 1) await submit().expect(202);
    const limited = await submit().expect(429);

    expect(limited.body.error.code).toBe('RATE_LIMITED');
    expect(Number(limited.headers['retry-after'])).toBeGreaterThan(0);
    expect(limited.headers['ratelimit-remaining']).toBe('0');
  });

  it('keeps separate budgets per user', async () => {
    const { app } = buildTestApp({ rateLimit: { jobsPerWindow: 1 } });
    const alice = await registerUser(app);
    const bob = await registerUser(app);
    const submit = (t) => request(app).post('/api/jobs').set('Authorization', `Bearer ${t}`).send(csvJob());

    await submit(alice.token).expect(202);
    await submit(alice.token).expect(429);
    await submit(bob.token).expect(202);
  });

  it('charges bulk submissions by number of jobs', async () => {
    const { app } = buildTestApp({ rateLimit: { jobsPerWindow: 10 } });
    const { token } = await registerUser(app);
    const bulk = (n) =>
      request(app)
        .post('/api/jobs/bulk')
        .set('Authorization', `Bearer ${token}`)
        .send({ jobs: Array.from({ length: n }, () => csvJob()) });

    await bulk(8).expect(202);
    await bulk(3).expect(429);
    await bulk(2).expect(202);
  });

  it('weights the previous window in the sliding-window estimate', async () => {
    const store = createMemoryRateLimitStore();
    const windowMs = 1000;
    const realNow = Date.now;
    try {
      Date.now = () => 10_000; // start of window 10
      for (let i = 0; i < 10; i += 1) expect((await store.consume('k', { limit: 10, windowMs })).allowed).toBe(true);

      Date.now = () => 11_500; // halfway into window 11: previous window still counts 50%
      const results = [];
      for (let i = 0; i < 6; i += 1) results.push((await store.consume('k', { limit: 10, windowMs })).allowed);
      expect(results).toEqual([true, true, true, true, true, false]);
    } finally {
      Date.now = realNow;
    }
  });
});
