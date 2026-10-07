const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const request = require('supertest');
const { mongoose, User, Job, File } = require('@jobmesh/shared');
const baseConfig = require('../src/config');
const { createApp } = require('../src/app');
const { createMemoryCache } = require('../src/services/cache');
const { createMemoryRateLimitStore } = require('../src/services/rateLimitStore');

async function connectTestDb() {
  const dbName = `jobmesh_test_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  await mongoose.connect(process.env.MONGO_TEST_URI, { dbName });
  await Promise.all([User.init(), Job.init(), File.init()]);
}

async function disconnectTestDb() {
  await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
}

async function clearDb() {
  await Promise.all([User.deleteMany({}), Job.deleteMany({}), File.deleteMany({})]);
}

/** In-memory stand-in for the BullMQ gateway that records what was enqueued. */
function createFakeQueueGateway() {
  return {
    queued: new Map(),
    active: new Set(),
    cancelFlags: new Set(),
    failNextEnqueue: false,
    async enqueue(jobs) {
      if (this.failNextEnqueue) {
        this.failNextEnqueue = false;
        throw new Error('Redis connection refused');
      }
      for (const job of jobs) this.queued.set(String(job._id ?? job.id), { type: job.type, priority: job.priority });
    },
    async remove(jobId) {
      if (this.active.has(jobId)) return false;
      this.queued.delete(jobId);
      return true;
    },
    async signalCancel(jobId) {
      this.cancelFlags.add(jobId);
    },
    async clearCancel(jobId) {
      this.cancelFlags.delete(jobId);
    },
    async counts() {
      return { waiting: this.queued.size, active: this.active.size, depth: this.queued.size };
    },
    async workers() {
      return [];
    },
  };
}

function buildTestApp({ rateLimit = {} } = {}) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jobmesh-test-'));
  const config = {
    ...baseConfig,
    env: 'test',
    bcryptRounds: 4,
    dataDir,
    uploadsDir: path.join(dataDir, 'uploads'),
    outputsDir: path.join(dataDir, 'outputs'),
    rateLimit: { windowMs: 60_000, apiPerWindow: 10_000, jobsPerWindow: 10_000, authPerWindow: 10_000, ...rateLimit },
  };
  const queueGateway = createFakeQueueGateway();
  const cache = createMemoryCache();
  const app = createApp({ config, queueGateway, cache, rateLimitStore: createMemoryRateLimitStore() });
  return { app, config, queueGateway, cache };
}

let userCounter = 0;
async function registerUser(app, overrides = {}) {
  userCounter += 1;
  const body = {
    name: `User ${userCounter}`,
    email: `user${userCounter}_${Date.now()}@example.com`,
    password: 'correct-horse-battery',
    ...overrides,
  };
  const res = await request(app).post('/api/auth/register').send(body).expect(201);
  return { token: res.body.token, user: res.body.user, password: body.password };
}

const csvJob = (overrides = {}) => ({
  type: 'CSV_PROCESSING',
  priority: 'MEDIUM',
  payload: { synthetic: { rows: 1000 } },
  ...overrides,
});

module.exports = {
  connectTestDb,
  disconnectTestDb,
  clearDb,
  buildTestApp,
  registerUser,
  csvJob,
};
