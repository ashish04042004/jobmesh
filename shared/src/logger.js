const pino = require('pino');

function createLogger(service, level = process.env.LOG_LEVEL || 'info') {
  return pino({
    level,
    base: { service, pid: process.pid },
    timestamp: pino.stdTimeFunctions.isoTime,
  });
}

module.exports = { createLogger };
