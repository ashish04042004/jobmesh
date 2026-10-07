const os = require('node:os');
const { UnrecoverableError } = require('bullmq');
const { Job, mongoose } = require('@jobmesh/shared');
const { createJobHandler, reconcileFailedJob } = require('../src/jobHandler');
const { silentLogger, connectTestDb, disconnectTestDb, clearDb, fakeBullJob } = require('./helpers');

describe('job handler (idempotent state machine)', () => {
  let cache;
  let cancellation;
  let processor;
  let handle;

  const createJob = (overrides = {}) =>
    Job.create({
      userId: new mongoose.Types.ObjectId(),
      type: 'CSV_PROCESSING',
      payload: { synthetic: { rows: 10 } },
      maxAttempts: 3,
      ...overrides,
    });

  beforeAll(connectTestDb);
  beforeEach(() => {
    cache = { invalidateJob: jest.fn(async () => {}) };
    cancellation = { isCancelled: jest.fn(async () => false) };
    processor = jest.fn(async () => ({ rowsProcessed: 10 }));
    handle = createJobHandler({
      processors: { CSV_PROCESSING: processor },
      workerId: 'worker-test-1',
      dataDir: os.tmpdir(),
      cache,
      cancellation,
      logger: silentLogger,
    });
  });
  afterEach(clearDb);
  afterAll(disconnectTestDb);

  it('claims, processes and completes a queued job', async () => {
    const job = await createJob();
    await expect(handle(fakeBullJob(job._id))).resolves.toEqual({ status: 'COMPLETED' });

    const saved = await Job.findById(job._id).lean();
    expect(saved).toMatchObject({
      status: 'COMPLETED',
      result: { rowsProcessed: 10 },
      attempts: 1,
      progress: 100,
      workerId: 'worker-test-1',
    });
    expect(saved.durationMs).toBeGreaterThanOrEqual(0);
    expect(cache.invalidateJob).toHaveBeenCalledWith(String(job._id));
  });

  it('skips a duplicate delivery of an already completed job (at-least-once safety)', async () => {
    const job = await createJob();
    await handle(fakeBullJob(job._id));
    const firstRun = await Job.findById(job._id).lean();

    await expect(handle(fakeBullJob(job._id))).resolves.toEqual({ skipped: true });
    const secondRun = await Job.findById(job._id).lean();

    expect(processor).toHaveBeenCalledTimes(1);
    expect(secondRun.completedAt).toEqual(firstRun.completedAt);
    expect(secondRun.attempts).toBe(1);
  });

  it('skips jobs cancelled or deleted before a worker picked them up', async () => {
    const cancelled = await createJob({ status: 'CANCELLED' });
    await expect(handle(fakeBullJob(cancelled._id))).resolves.toEqual({ skipped: true });
    await expect(handle(fakeBullJob(new mongoose.Types.ObjectId()))).resolves.toEqual({ skipped: true });
    expect(processor).not.toHaveBeenCalled();
  });

  it('re-claims a job left PROCESSING by a crashed worker', async () => {
    const job = await createJob({ status: 'PROCESSING', attempts: 1, workerId: 'dead-worker' });
    await handle(fakeBullJob(job._id));
    expect(await Job.findById(job._id).lean()).toMatchObject({
      status: 'COMPLETED',
      attempts: 2,
      workerId: 'worker-test-1',
    });
  });

  it('returns a failed non-final attempt to QUEUED and rethrows so BullMQ backs off', async () => {
    const job = await createJob();
    processor.mockRejectedValueOnce(new Error('upstream timeout'));

    await expect(handle(fakeBullJob(job._id, { attemptsMade: 0 }))).rejects.toThrow('upstream timeout');
    expect(await Job.findById(job._id).lean()).toMatchObject({ status: 'QUEUED', error: 'upstream timeout', attempts: 1 });
  });

  it('marks the job FAILED on the final attempt', async () => {
    const job = await createJob({ attempts: 2 });
    processor.mockRejectedValueOnce(new Error('still broken'));

    await expect(handle(fakeBullJob(job._id, { attemptsMade: 2, attempts: 3 }))).rejects.toThrow('still broken');
    const saved = await Job.findById(job._id).lean();
    expect(saved).toMatchObject({ status: 'FAILED', error: 'still broken', attempts: 3 });
    expect(saved.completedAt).toBeInstanceOf(Date);
  });

  it('fails immediately on unrecoverable errors without consuming retries', async () => {
    const job = await createJob();
    processor.mockRejectedValueOnce(new UnrecoverableError('corrupt input'));

    await expect(handle(fakeBullJob(job._id))).rejects.toThrow('corrupt input');
    expect(await Job.findById(job._id).lean()).toMatchObject({ status: 'FAILED', attempts: 1 });
  });

  it('does not overwrite a cancellation that happened while processing', async () => {
    const job = await createJob();
    processor.mockImplementationOnce(async () => {
      await Job.updateOne({ _id: job._id }, { status: 'CANCELLED' });
      return { rowsProcessed: 10 };
    });

    await expect(handle(fakeBullJob(job._id))).resolves.toEqual({ cancelled: true });
    expect(await Job.findById(job._id).lean()).toMatchObject({ status: 'CANCELLED', result: null });
  });

  it('stops cooperatively when the cancel flag is raised', async () => {
    const job = await createJob();
    processor.mockImplementationOnce(async (_job, ctx) => {
      await Job.updateOne({ _id: job._id }, { status: 'CANCELLED' });
      cancellation.isCancelled.mockResolvedValue(true);
      await ctx.throwIfCancelled({ force: true });
      return { unreachable: true };
    });

    await expect(handle(fakeBullJob(job._id))).resolves.toEqual({ cancelled: true });
    expect((await Job.findById(job._id).lean()).status).toBe('CANCELLED');
  });

  it('honours simulate.failAttempts to exercise retries', async () => {
    const job = await createJob({ payload: { synthetic: { rows: 10 }, simulate: { failAttempts: 1 } } });

    await expect(handle(fakeBullJob(job._id, { attemptsMade: 0 }))).rejects.toThrow(/Simulated failure on attempt 1/);
    await expect(handle(fakeBullJob(job._id, { attemptsMade: 1 }))).resolves.toEqual({ status: 'COMPLETED' });
    expect(await Job.findById(job._id).lean()).toMatchObject({ status: 'COMPLETED', attempts: 2 });
  });

  it('reconciles jobs that BullMQ failed outside the handler (e.g. stalled too often)', async () => {
    const job = await createJob({ status: 'PROCESSING' });
    await reconcileFailedJob(
      fakeBullJob(job._id, { state: 'failed' }),
      new Error('job stalled more than allowable limit'),
      { cache, logger: silentLogger },
    );
    expect(await Job.findById(job._id).lean()).toMatchObject({
      status: 'FAILED',
      error: 'job stalled more than allowable limit',
    });

    const retrying = await createJob({ status: 'QUEUED' });
    await reconcileFailedJob(fakeBullJob(retrying._id, { state: 'delayed' }), new Error('x'), {
      cache,
      logger: silentLogger,
    });
    expect((await Job.findById(retrying._id).lean()).status).toBe('QUEUED');
  });
});
