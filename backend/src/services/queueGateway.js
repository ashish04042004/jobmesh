const { PRIORITY, REDIS_KEYS, bullJobId } = require('@jobmesh/shared');

const CANCEL_FLAG_TTL_SEC = 24 * 3600;

/**
 * The only module in the API that talks to BullMQ. Queue messages carry just
 * the MongoDB job id: MongoDB is the source of truth, the queue is transport.
 */
function createQueueGateway({ queue, redis }) {
  function toBullJob(job) {
    const jobId = String(job._id ?? job.id);
    return {
      name: job.type,
      data: { jobId, type: job.type },
      opts: {
        jobId: bullJobId(jobId),
        priority: PRIORITY[job.priority] ?? PRIORITY.MEDIUM,
        attempts: job.maxAttempts,
      },
    };
  }

  return {
    async enqueue(jobs) {
      const bullJobs = jobs.map(toBullJob);
      if (bullJobs.length === 1) {
        const [{ name, data, opts }] = bullJobs;
        await queue.add(name, data, opts);
      } else {
        await queue.addBulk(bullJobs);
      }
    },

    /** Returns false while a worker still holds the job's lock (it is active). */
    async remove(jobId) {
      return (await queue.remove(bullJobId(jobId))) === 1;
    },

    async signalCancel(jobId) {
      await redis.set(REDIS_KEYS.cancelFlag(jobId), '1', 'EX', CANCEL_FLAG_TTL_SEC);
    },

    async clearCancel(jobId) {
      await redis.del(REDIS_KEYS.cancelFlag(jobId));
    },

    async counts() {
      const counts = await queue.getJobCounts('waiting', 'prioritized', 'active', 'delayed', 'failed', 'completed', 'paused');
      return { ...counts, depth: (counts.waiting ?? 0) + (counts.prioritized ?? 0) + (counts.delayed ?? 0) };
    },

    async workers() {
      const keys = new Set();
      let cursor = '0';
      do {
        const [next, batch] = await redis.scan(cursor, 'MATCH', REDIS_KEYS.workerPattern, 'COUNT', 100);
        cursor = next;
        batch.forEach((k) => keys.add(k));
      } while (cursor !== '0');
      if (keys.size === 0) return [];

      const values = await redis.mget(...keys);
      return values
        .filter(Boolean)
        .map((v) => JSON.parse(v))
        .sort((a, b) => a.workerId.localeCompare(b.workerId));
    },
  };
}

module.exports = { createQueueGateway };
