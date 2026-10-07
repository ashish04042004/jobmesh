const { Job, JOB_STATUS, TERMINAL_STATUSES, REDIS_KEYS, mongoose } = require('@jobmesh/shared');
const { notFound } = require('../utils/AppError');

const round = (n, digits = 2) => (n == null ? null : Number(n.toFixed(digits)));

function percentile(sorted, p) {
  if (sorted.length === 0) return null;
  const rank = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.min(sorted.length - 1, Math.max(0, rank))];
}

function distribution(values) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const avg = sorted.reduce((sum, v) => sum + v, 0) / sorted.length;
  return {
    avg: round(avg),
    p50: percentile(sorted, 50),
    p95: percentile(sorted, 95),
    p99: percentile(sorted, 99),
    max: sorted.at(-1),
  };
}

async function safely(promise, logger, what) {
  try {
    return await promise;
  } catch (err) {
    logger?.warn({ err }, `Could not load ${what}`);
    return null;
  }
}

function createStatsService({ queueGateway, cache, config, logger }) {
  async function countByStatus(match) {
    const rows = await Job.aggregate([
      { $match: match },
      { $group: { _id: '$status', count: { $sum: 1 }, avgDurationMs: { $avg: '$durationMs' } } },
    ]);
    const counts = Object.fromEntries(Object.values(JOB_STATUS).map((s) => [s, 0]));
    let avgDurationMs = null;
    for (const row of rows) {
      counts[row._id] = row.count;
      if (row._id === JOB_STATUS.COMPLETED) avgDurationMs = row.avgDurationMs;
    }
    const total = Object.values(counts).reduce((a, b) => a + b, 0);
    return { counts, total, avgDurationMs };
  }

  /** Per-user dashboard numbers plus global queue and worker health; cached briefly. */
  async function overview(userId) {
    const key = REDIS_KEYS.statsCache(userId);
    const cached = await cache.getJSON(key);
    if (cached) return { stats: cached, cacheHit: true };

    const [{ counts, total, avgDurationMs }, queue, workers] = await Promise.all([
      countByStatus({ userId: new mongoose.Types.ObjectId(userId) }),
      safely(queueGateway.counts(), logger, 'queue counts'),
      safely(queueGateway.workers(), logger, 'worker registry'),
    ]);

    const stats = {
      total,
      queued: counts.QUEUED,
      processing: counts.PROCESSING,
      completed: counts.COMPLETED,
      failed: counts.FAILED,
      cancelled: counts.CANCELLED,
      averageProcessingTime: avgDurationMs == null ? null : round(avgDurationMs / 1000, 3),
      queue,
      workers,
      generatedAt: new Date().toISOString(),
    };
    await cache.setJSON(key, stats, config.cache.statsTtlSec);
    return { stats, cacheHit: false };
  }

  /**
   * Benchmark view of one batch. While jobs are in flight only counts are
   * returned (cheap, index-backed); timing metrics are computed once the batch
   * has fully drained.
   */
  async function batch(userId, batchId) {
    const { counts, total } = await countByStatus({ userId: new mongoose.Types.ObjectId(userId), batchId });
    if (total === 0) throw notFound(`Batch ${batchId} not found`);

    const finished = TERMINAL_STATUSES.reduce((sum, s) => sum + counts[s], 0);
    const result = { batchId, total, ...counts, finished, done: finished === total };
    if (!result.done) return result;

    const jobs = await Job.find({ userId, batchId })
      .select('status createdAt startedAt completedAt durationMs attempts')
      .lean();
    const completed = jobs.filter((j) => j.status === JOB_STATUS.COMPLETED);
    const firstCreatedAt = Math.min(...jobs.map((j) => j.createdAt.getTime()));
    const finishedTimes = jobs.filter((j) => j.completedAt).map((j) => j.completedAt.getTime());
    const lastFinishedAt = finishedTimes.length ? Math.max(...finishedTimes) : firstCreatedAt;
    const makespanMs = lastFinishedAt - firstCreatedAt;

    return {
      ...result,
      firstCreatedAt: new Date(firstCreatedAt).toISOString(),
      lastFinishedAt: new Date(lastFinishedAt).toISOString(),
      makespanMs,
      throughputJobsPerSec: makespanMs > 0 ? round(completed.length / (makespanMs / 1000)) : null,
      processingMs: distribution(completed.map((j) => j.durationMs)),
      queueWaitMs: distribution(completed.map((j) => j.startedAt - j.createdAt)),
      totalAttempts: jobs.reduce((sum, j) => sum + (j.attempts ?? 0), 0),
      retriedJobs: jobs.filter((j) => (j.attempts ?? 0) > 1).length,
    };
  }

  return { overview, batch };
}

module.exports = { createStatsService };
