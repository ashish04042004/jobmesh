const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { Job, File, mongoose } = require('@jobmesh/shared');
const { createJobContext } = require('../src/jobContext');
const { JobCancelledError } = require('../src/errors');
const { silentLogger, connectTestDb, disconnectTestDb, clearDb, fakeBullJob } = require('./helpers');

describe('job context', () => {
  let dataDir;
  let job;

  beforeAll(connectTestDb);
  beforeEach(async () => {
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jobmesh-worker-'));
    job = await Job.create({
      userId: new mongoose.Types.ObjectId(),
      type: 'REPORT_GENERATION',
      status: 'PROCESSING',
      payload: { month: '2026-09' },
    });
  });
  afterEach(clearDb);
  afterAll(disconnectTestDb);

  const contextFor = (overrides = {}) =>
    createJobContext({
      job: job.toObject(),
      bullJob: fakeBullJob(job._id),
      dataDir,
      cache: { invalidateJob: jest.fn(async () => {}) },
      cancellation: { isCancelled: jest.fn(async () => false) },
      logger: silentLogger,
      ...overrides,
    });

  it('writes artifacts idempotently: a re-run overwrites instead of duplicating', async () => {
    const ctx = contextFor();
    const first = await ctx.writeArtifact('report.json', Buffer.from('{"v":1}'), 'application/json', 'json');
    const second = await ctx.writeArtifact('report.json', Buffer.from('{"v":2}'), 'application/json', 'json');

    expect(second.id).toBe(first.id);
    expect(await File.countDocuments({ jobId: job._id })).toBe(1);
    const onDisk = fs.readFileSync(path.join(dataDir, 'outputs', String(job._id), 'report.json'), 'utf8');
    expect(onDisk).toBe('{"v":2}');
  });

  it('persists progress in 10% steps', async () => {
    const ctx = contextFor();
    await ctx.reportProgress(5);
    expect((await Job.findById(job._id).lean()).progress).toBe(0);
    await ctx.reportProgress(42);
    expect((await Job.findById(job._id).lean()).progress).toBe(42);
  });

  it('throws JobCancelledError once the cancel flag is set', async () => {
    const ctx = contextFor({ cancellation: { isCancelled: async () => true } });
    await expect(ctx.throwIfCancelled({ force: true })).rejects.toBeInstanceOf(JobCancelledError);
  });

  it("refuses input files that belong to another user", async () => {
    const foreign = await File.create({
      userId: new mongoose.Types.ObjectId(),
      kind: 'UPLOAD',
      category: 'csv',
      originalName: 'secret.csv',
      mimeType: 'text/csv',
      size: 1,
      storagePath: 'uploads/secret.csv',
    });
    await expect(contextFor().loadInputFile(foreign._id)).rejects.toThrow(/not found/);
  });
});
