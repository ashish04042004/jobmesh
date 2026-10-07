const { Queue } = require('bullmq');
const { QUEUE_NAME, QUEUE_PREFIX } = require('./constants');

function defaultJobOptions(jobsConfig) {
  return {
    attempts: jobsConfig.attempts,
    backoff: { type: 'exponential', delay: jobsConfig.backoffMs },
    removeOnComplete: { age: jobsConfig.keepCompletedSec, count: 10_000 },
    removeOnFail: { age: jobsConfig.keepFailedSec },
  };
}

function createJobQueue(connection, jobsConfig) {
  return new Queue(QUEUE_NAME, {
    connection,
    prefix: QUEUE_PREFIX,
    defaultJobOptions: defaultJobOptions(jobsConfig),
  });
}

module.exports = { createJobQueue, defaultJobOptions };
