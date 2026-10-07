const { UnrecoverableError } = require('bullmq');
const { Job, JOB_STATUS } = require('@jobmesh/shared');
const { JobCancelledError } = require('./errors');
const { createJobContext } = require('./jobContext');

/**
 * BullMQ delivers jobs at-least-once (a worker can crash after doing the work
 * but before acknowledging it), so every MongoDB transition here is a
 * conditional update. Re-running a delivery can never move a job backwards
 * or overwrite a terminal state:
 *
 *   claim:    QUEUED|PROCESSING -> PROCESSING   (anything else: skip)
 *   success:  PROCESSING -> COMPLETED           (cancelled meanwhile: discard)
 *   failure:  PROCESSING -> QUEUED (will retry) | FAILED (final attempt)
 *
 * PROCESSING is claimable because a crashed worker leaves the job in that
 * state; BullMQ's lock guarantees only one live worker holds a delivery.
 */
function createJobHandler({ processors, workerId, dataDir, cache, cancellation, logger }) {
  return async function handleJob(bullJob) {
    const { jobId } = bullJob.data;
    const attempt = bullJob.attemptsMade + 1;
    const maxAttempts = bullJob.opts.attempts ?? 1;
    const log = logger.child({ jobId, attempt, bullJobId: bullJob.id });

    const job = await Job.findOneAndUpdate(
      { _id: jobId, status: { $in: [JOB_STATUS.QUEUED, JOB_STATUS.PROCESSING] } },
      {
        $set: { status: JOB_STATUS.PROCESSING, workerId, startedAt: new Date(), progress: 0 },
        $inc: { attempts: 1 },
      },
      { returnDocument: 'after' },
    ).lean();

    if (!job) {
      log.info('Job is not claimable (already finished, cancelled or deleted); skipping');
      return { skipped: true };
    }
    await cache.invalidateJob(jobId);

    const ctx = createJobContext({ job, bullJob, dataDir, cache, cancellation, logger: log });

    try {
      const processor = processors[job.type];
      if (!processor) throw new UnrecoverableError(`No processor registered for ${job.type}`);

      const simulate = job.payload?.simulate ?? {};
      if (simulate.delayMs) await ctx.sleep(simulate.delayMs);
      if (simulate.failAttempts && attempt <= simulate.failAttempts) {
        throw new Error(`Simulated failure on attempt ${attempt} (failAttempts=${simulate.failAttempts})`);
      }

      await ctx.throwIfCancelled({ force: true });
      const result = await processor(job, ctx);

      const completedAt = new Date();
      const completed = await Job.findOneAndUpdate(
        { _id: jobId, status: JOB_STATUS.PROCESSING },
        {
          $set: {
            status: JOB_STATUS.COMPLETED,
            result,
            error: null,
            progress: 100,
            completedAt,
            durationMs: completedAt - job.startedAt,
          },
        },
        { returnDocument: 'after' },
      ).lean();
      await cache.invalidateJob(jobId);

      if (!completed) {
        log.info('Job was cancelled while processing; result discarded');
        return { cancelled: true };
      }
      log.info({ durationMs: completed.durationMs, type: job.type }, 'Job completed');
      return { status: JOB_STATUS.COMPLETED };
    } catch (err) {
      if (err instanceof JobCancelledError) {
        await cache.invalidateJob(jobId);
        log.info('Job cancelled cooperatively');
        return { cancelled: true };
      }

      const final = err instanceof UnrecoverableError || attempt >= maxAttempts;
      const now = new Date();
      await Job.updateOne(
        { _id: jobId, status: JOB_STATUS.PROCESSING },
        {
          $set: final
            ? { status: JOB_STATUS.FAILED, error: err.message, completedAt: now, durationMs: now - job.startedAt }
            : { status: JOB_STATUS.QUEUED, error: err.message },
        },
      );
      await cache.invalidateJob(jobId);
      log.warn({ err: err.message, final }, final ? 'Job failed permanently' : 'Job attempt failed; will retry');
      throw err;
    }
  };
}

/**
 * Safety net for failures that bypass the handler, e.g. a job that stalled
 * more than maxStalledCount times because its workers kept crashing.
 */
async function reconcileFailedJob(bullJob, err, { cache, logger }) {
  if (!bullJob?.data?.jobId) return;
  try {
    if ((await bullJob.getState()) !== 'failed') return;
    const { modifiedCount } = await Job.updateOne(
      { _id: bullJob.data.jobId, status: { $in: [JOB_STATUS.QUEUED, JOB_STATUS.PROCESSING] } },
      { $set: { status: JOB_STATUS.FAILED, error: err?.message ?? 'Job failed', completedAt: new Date() } },
    );
    if (modifiedCount > 0) {
      await cache.invalidateJob(bullJob.data.jobId);
      logger.warn({ jobId: bullJob.data.jobId }, 'Reconciled job that failed outside the handler');
    }
  } catch (reconcileErr) {
    logger.error({ err: reconcileErr }, 'Failed to reconcile failed job');
  }
}

module.exports = { createJobHandler, reconcileFailedJob };
