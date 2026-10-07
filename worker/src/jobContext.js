const fs = require('node:fs/promises');
const path = require('node:path');
const { setTimeout: delay } = require('node:timers/promises');
const { UnrecoverableError } = require('bullmq');
const {
  Job,
  File,
  JOB_STATUS,
  FILE_KIND,
  toFileDTO,
  resolveStoragePath,
  artifactStoragePath,
} = require('@jobmesh/shared');
const { JobCancelledError } = require('./errors');

const CANCEL_CHECK_INTERVAL_MS = 250;
const PROGRESS_STEP = 10;

/**
 * Capabilities handed to a processor for one execution: progress reporting,
 * cooperative cancellation, and file I/O scoped to the job's owner.
 */
function createJobContext({ job, bullJob, dataDir, cache, cancellation, logger }) {
  const jobId = String(job._id);
  let lastCancelCheck = 0;
  let lastProgress = 0;

  async function throwIfCancelled({ force = false } = {}) {
    const now = Date.now();
    if (!force && now - lastCancelCheck < CANCEL_CHECK_INTERVAL_MS) return;
    lastCancelCheck = now;
    if (await cancellation.isCancelled(jobId)) throw new JobCancelledError(jobId);
  }

  async function reportProgress(percent) {
    const value = Math.max(0, Math.min(100, Math.round(percent)));
    if (value < lastProgress + PROGRESS_STEP && value !== 100) return;
    lastProgress = value;
    await Promise.all([
      Job.updateOne({ _id: jobId, status: JOB_STATUS.PROCESSING }, { $set: { progress: value } }),
      bullJob.updateProgress(value),
    ]);
    await cache.invalidateJob(jobId);
  }

  async function sleep(ms) {
    const end = Date.now() + ms;
    while (Date.now() < end) {
      await delay(Math.min(CANCEL_CHECK_INTERVAL_MS, end - Date.now()));
      await throwIfCancelled({ force: true });
    }
  }

  async function loadInputFile(fileId) {
    const file = await File.findOne({ _id: fileId, userId: job.userId, kind: FILE_KIND.UPLOAD }).lean();
    if (!file) throw new UnrecoverableError(`Input file ${fileId} not found`);
    const absolutePath = resolveStoragePath(dataDir, file.storagePath);
    try {
      await fs.access(absolutePath);
    } catch {
      throw new UnrecoverableError(`Input file ${fileId} is missing from storage`);
    }
    return { ...toFileDTO(file), absolutePath };
  }

  /** Upserts by (jobId, name) so a re-delivered job overwrites rather than duplicates. */
  async function writeArtifact(name, buffer, mimeType, category) {
    const storagePath = artifactStoragePath(jobId, name);
    const absolutePath = resolveStoragePath(dataDir, storagePath);
    await fs.mkdir(path.dirname(absolutePath), { recursive: true });
    await fs.writeFile(absolutePath, buffer);

    const file = await File.findOneAndUpdate(
      { jobId, kind: FILE_KIND.ARTIFACT, originalName: name },
      { $set: { userId: job.userId, category, mimeType, size: buffer.length, storagePath } },
      { upsert: true, returnDocument: 'after', setDefaultsOnInsert: true },
    );
    return toFileDTO(file);
  }

  return {
    jobId,
    attempt: bullJob.attemptsMade + 1,
    logger,
    throwIfCancelled,
    reportProgress,
    sleep,
    loadInputFile,
    writeArtifact,
  };
}

module.exports = { createJobContext };
