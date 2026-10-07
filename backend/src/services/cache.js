/**
 * Cache-aside helpers. Cache failures are logged and treated as misses so a
 * Redis hiccup degrades latency rather than availability.
 */
function createRedisCache(redis, logger) {
  return {
    async getJSON(key) {
      try {
        const raw = await redis.get(key);
        return raw ? JSON.parse(raw) : null;
      } catch (err) {
        logger?.warn({ err, key }, 'Cache read failed');
        return null;
      }
    },
    async setJSON(key, value, ttlSec) {
      try {
        await redis.set(key, JSON.stringify(value), 'EX', ttlSec);
      } catch (err) {
        logger?.warn({ err, key }, 'Cache write failed');
      }
    },
    async del(...keys) {
      if (keys.length === 0) return;
      try {
        await redis.del(...keys);
      } catch (err) {
        logger?.warn({ err, keys }, 'Cache invalidation failed');
      }
    },
    async ping() {
      return (await redis.ping()) === 'PONG';
    },
  };
}

function createMemoryCache() {
  const entries = new Map();
  return {
    async getJSON(key) {
      const entry = entries.get(key);
      if (!entry) return null;
      if (entry.expiresAt <= Date.now()) {
        entries.delete(key);
        return null;
      }
      return JSON.parse(entry.value);
    },
    async setJSON(key, value, ttlSec) {
      entries.set(key, { value: JSON.stringify(value), expiresAt: Date.now() + ttlSec * 1000 });
    },
    async del(...keys) {
      for (const key of keys) entries.delete(key);
    },
    async ping() {
      return true;
    },
  };
}

module.exports = { createRedisCache, createMemoryCache };
