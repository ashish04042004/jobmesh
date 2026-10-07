const { Redis } = require('ioredis');

/**
 * Request/response clients should fail fast when Redis is down (small
 * maxRetriesPerRequest). BullMQ workers hold blocking connections and must use
 * `blocking: true`, which sets maxRetriesPerRequest to null as BullMQ requires.
 */
function createRedis(url, { connectionName, blocking = false } = {}) {
  return new Redis(url, {
    connectionName,
    maxRetriesPerRequest: blocking ? null : 2,
    enableReadyCheck: true,
  });
}

module.exports = { createRedis };
