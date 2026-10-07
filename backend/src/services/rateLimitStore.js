const { REDIS_KEYS } = require('@jobmesh/shared');

/**
 * Sliding-window counter: the previous window's count is weighted by how much
 * of it still overlaps the sliding window. This avoids the 2x burst a plain
 * fixed window allows at window boundaries, using only two counters per key.
 * Rejected requests are not counted, so a throttled client recovers smoothly.
 */
const SLIDING_WINDOW_LUA = `
local windowMs = tonumber(ARGV[1])
local cost = tonumber(ARGV[2])
local limit = tonumber(ARGV[3])
local elapsed = tonumber(ARGV[4])
local current = tonumber(redis.call('GET', KEYS[1]) or '0')
local previous = tonumber(redis.call('GET', KEYS[2]) or '0')
local estimated = previous * ((windowMs - elapsed) / windowMs) + current
if estimated + cost > limit then
  return {0, math.ceil(estimated)}
end
redis.call('INCRBY', KEYS[1], cost)
redis.call('PEXPIRE', KEYS[1], windowMs * 2)
return {1, math.ceil(estimated + cost)}
`;

function windowPosition(windowMs, now = Date.now()) {
  const window = Math.floor(now / windowMs);
  return { window, elapsed: now - window * windowMs };
}

function createRedisRateLimitStore(redis) {
  redis.defineCommand('jobmeshSlidingWindow', { numberOfKeys: 2, lua: SLIDING_WINDOW_LUA });

  return {
    async consume(key, { limit, windowMs, cost = 1 }) {
      const { window, elapsed } = windowPosition(windowMs);
      const [allowed, count] = await redis.jobmeshSlidingWindow(
        REDIS_KEYS.rateLimit(key, window),
        REDIS_KEYS.rateLimit(key, window - 1),
        windowMs,
        cost,
        limit,
        elapsed,
      );
      return { allowed: allowed === 1, count, resetMs: windowMs - elapsed };
    },
  };
}

function createMemoryRateLimitStore() {
  const counters = new Map();

  return {
    async consume(key, { limit, windowMs, cost = 1 }) {
      const { window, elapsed } = windowPosition(windowMs);
      const current = counters.get(`${key}:${window}`) ?? 0;
      const previous = counters.get(`${key}:${window - 1}`) ?? 0;
      const estimated = previous * ((windowMs - elapsed) / windowMs) + current;
      if (estimated + cost > limit) {
        return { allowed: false, count: Math.ceil(estimated), resetMs: windowMs - elapsed };
      }
      counters.set(`${key}:${window}`, current + cost);
      return { allowed: true, count: Math.ceil(estimated + cost), resetMs: windowMs - elapsed };
    },
  };
}

module.exports = { createRedisRateLimitStore, createMemoryRateLimitStore };
