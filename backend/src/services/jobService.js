const fs = require('node:fs/promises');
const path = require('node:path');
const {
  Job,
  File,
  JOB_STATUS,
  JOB_TYPES,
  FILE_KIND,
  FILE_CATEGORY,
  REDIS_KEYS,
  toJobDTO,
} = require('@jobmesh/shared');
const { AppError, badRequest, notFound, conflict } = require('../utils/AppError');

const INPUT_CATEGORY = {
  [JOB_TYPES.CSV_PROCESSING]: FILE_CATEGORY.CSV,
  [JOB_TYPES.IMAGE_PROCESSING]: FILE_CATEGORY.IMAGE,
};

const RETRYABLE = [JOB_STATUS.FAILED, JOB_STATUS.CANCELLED];
const CANCELLABLE = [JOB_STATUS.QUEUED, JOB_STATUS.PROCESSING];

function createJobService({ queueGateway, cache, config, logger }) {
  const invalidate = (jobId) => cache.del(REDIS_KEYS.jobCache(jobId));

  async function assertInputFiles(userId, specs) {
    const withFiles = specs.filter((s) => s.payload?.fileId);
    if (withFiles.length === 0) return;

    const ids = [...new Set(withFiles.map((s) => s.payload.fileId))];
    const files = await File.find({ _id: { $in: ids }, userId, kind: FILE_KIND.UPLOAD }).select('category').lean();
    const categoryById = new Map(files.map((f) => [String(f._id), f.category]));

    for (const spec of withFiles) {
      const category = categoryById.get(spec.payload.fileId);
      if (!category) throw badRequest(`fileId ${spec.payload.fileId} does not reference one of your uploads`);
      if (category !== INPUT_CATEGORY[spec.type]) {
        throw badRequest(`File ${spec.payload.fileId} (${category}) is not valid input for ${spec.type}`);
      }
    }
  }

  function buildJobDoc(userId, spec, { batchId, idempotencyKey } = {}) {
    return {
      userId,
      type: spec.type,
      priority: spec.priority,
      payload: spec.payload,
      maxAttempts: config.jobs.attempts,
      batchId: spec.batchId ?? batchId,
      idempotencyKey,
    };
  }

  /**
   * MongoDB is written before Redis. If enqueueing fails the job would sit in
   * QUEUED forever, so it is marked FAILED instead and can be retried later.
   * (A transactional outbox would remove this window entirely.)
   */
  async function enqueueOrFail(jobs) {
    try {
      await queueGateway.enqueue(jobs);
    } catch (err) {
      logger?.error({ err, count: jobs.length }, 'Failed to enqueue jobs');
      await Job.updateMany(
        { _id: { $in: jobs.map((j) => j._id) }, status: JOB_STATUS.QUEUED },
        { $set: { status: JOB_STATUS.FAILED, error: 'Queue unavailable: job could not be enqueued', completedAt: new Date() } },
      );
      throw new AppError(503, 'Job queue is unavailable; the job was recorded as FAILED and can be retried', {
        code: 'QUEUE_UNAVAILABLE',
      });
    }
  }

  async function findIdempotent(userId, idempotencyKey) {
    const existing = await Job.findOne({ userId, idempotencyKey }).lean();
    return existing ? { job: toJobDTO(existing), created: false } : null;
  }

  async function create(userId, spec, { idempotencyKey } = {}) {
    if (idempotencyKey) {
      const replay = await findIdempotent(userId, idempotencyKey);
      if (replay) return replay;
    }
    await assertInputFiles(userId, [spec]);

    let job;
    try {
      job = await Job.create(buildJobDoc(userId, spec, { idempotencyKey }));
    } catch (err) {
      // Two concurrent requests with the same key: the unique index picks a winner.
      if (err?.code === 11000 && idempotencyKey) {
        const replay = await findIdempotent(userId, idempotencyKey);
        if (replay) return replay;
      }
      throw err;
    }

    await enqueueOrFail([job]);
    return { job: toJobDTO(job), created: true };
  }

  async function createBulk(userId, { jobs, batchId }) {
    await assertInputFiles(userId, jobs);
    const docs = await Job.insertMany(jobs.map((spec) => buildJobDoc(userId, spec, { batchId })));
    await enqueueOrFail(docs);
    return docs.map(toJobDTO);
  }

  async function list(userId, { status, type, batchId, cursor, limit }) {
    const filter = { userId };
    if (status) filter.status = status;
    if (type) filter.type = type;
    if (batchId) filter.batchId = batchId;
    if (cursor) filter._id = { $lt: cursor };

    const docs = await Job.find(filter).sort({ _id: -1 }).limit(limit + 1).lean();
    const items = docs.slice(0, limit).map(toJobDTO);
    return { items, nextCursor: docs.length > limit ? items.at(-1).id : null };
  }

  async function get(userId, jobId) {
    const key = REDIS_KEYS.jobCache(jobId);
    const cached = await cache.getJSON(key);
    if (cached) {
      if (cached.userId !== String(userId)) throw notFound('Job not found');
      return { job: cached, cacheHit: true };
    }

    const doc = await Job.findOne({ _id: jobId, userId }).lean();
    if (!doc) throw notFound('Job not found');
    const job = toJobDTO(doc);
    await cache.setJSON(key, job, config.cache.jobTtlSec);
    return { job, cacheHit: false };
  }

  async function loadOwned(userId, jobId) {
    const job = await Job.findOne({ _id: jobId, userId }).lean();
    if (!job) throw notFound('Job not found');
    return job;
  }

  /**
   * Queued jobs are removed from the queue. Running jobs are cancelled
   * cooperatively: the worker polls a Redis flag between chunks of work, and
   * its completion write is conditional on PROCESSING so it cannot overwrite
   * the CANCELLED status.
   */
  async function cancel(userId, jobId) {
    const job = await Job.findOneAndUpdate(
      { _id: jobId, userId, status: { $in: CANCELLABLE } },
      { $set: { status: JOB_STATUS.CANCELLED, completedAt: new Date() } },
      { returnDocument: 'after' },
    ).lean();
    if (!job) {
      const current = await loadOwned(userId, jobId);
      throw conflict(`Job is ${current.status} and can no longer be cancelled`);
    }

    await queueGateway.signalCancel(jobId);
    await queueGateway.remove(jobId);
    await invalidate(jobId);
    return toJobDTO(job);
  }

  async function retry(userId, jobId) {
    const current = await loadOwned(userId, jobId);
    if (!RETRYABLE.includes(current.status)) {
      throw conflict(`Only FAILED or CANCELLED jobs can be retried (job is ${current.status})`);
    }
    // BullMQ ignores adds for an id that still exists, so the old entry must go first.
    if (!(await queueGateway.remove(jobId))) {
      throw conflict('The previous run is still shutting down; retry again in a moment');
    }
    await queueGateway.clearCancel(jobId);

    const job = await Job.findOneAndUpdate(
      { _id: jobId, userId, status: current.status },
      {
        $set: {
          status: JOB_STATUS.QUEUED,
          error: null,
          result: null,
          progress: 0,
          attempts: 0,
          workerId: null,
          startedAt: null,
          completedAt: null,
          durationMs: null,
        },
        $inc: { manualRetries: 1 },
      },
      { returnDocument: 'after' },
    );
    if (!job) throw conflict('Job changed state concurrently; refresh and try again');

    await enqueueOrFail([job]);
    await invalidate(jobId);
    return toJobDTO(job);
  }

  async function remove(userId, jobId) {
    const job = await loadOwned(userId, jobId);
    if (job.status === JOB_STATUS.PROCESSING) throw conflict('Cancel the job before deleting it');
    if (!(await queueGateway.remove(jobId))) throw conflict('Job was just picked up by a worker; cancel it first');

    const { deletedCount } = await Job.deleteOne({ _id: jobId, userId, status: { $ne: JOB_STATUS.PROCESSING } });
    if (deletedCount === 0) throw conflict('Job was just picked up by a worker; cancel it first');

    await File.deleteMany({ jobId, kind: FILE_KIND.ARTIFACT });
    await fs.rm(path.join(config.outputsDir, String(jobId)), { recursive: true, force: true });
    await Promise.all([invalidate(jobId), queueGateway.clearCancel(jobId)]);
  }

  return { create, createBulk, list, get, cancel, retry, remove };
}

module.exports = { createJobService };
