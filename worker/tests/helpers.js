const { mongoose, Job, File, createLogger } = require('@jobmesh/shared');

const silentLogger = createLogger('worker-test', 'silent');

async function connectTestDb() {
  const dbName = `jobmesh_worker_test_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  await mongoose.connect(process.env.MONGO_TEST_URI, { dbName });
  await Promise.all([Job.init(), File.init()]);
}

async function disconnectTestDb() {
  await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
}

async function clearDb() {
  await Promise.all([Job.deleteMany({}), File.deleteMany({})]);
}

/** Minimal stand-in for a BullMQ Job as seen by a processor function. */
function fakeBullJob(jobId, { attemptsMade = 0, attempts = 3, state = 'active' } = {}) {
  return {
    id: `job-${jobId}`,
    data: { jobId: String(jobId) },
    attemptsMade,
    opts: { attempts },
    updateProgress: jest.fn(async () => {}),
    getState: jest.fn(async () => state),
  };
}

/** Processor context without Mongo/Redis/disk side effects. */
function fakeContext(overrides = {}) {
  return {
    jobId: 'ctx-job',
    attempt: 1,
    logger: silentLogger,
    throwIfCancelled: jest.fn(async () => {}),
    reportProgress: jest.fn(async () => {}),
    sleep: jest.fn(async () => {}),
    loadInputFile: jest.fn(),
    writeArtifact: jest.fn(async (name, buffer, mimeType) => ({
      id: `file-${name}`,
      originalName: name,
      size: buffer.length,
      mimeType,
      downloadUrl: `/api/files/file-${name}/download`,
    })),
    ...overrides,
  };
}

module.exports = { silentLogger, connectTestDb, disconnectTestDb, clearDb, fakeBullJob, fakeContext };
