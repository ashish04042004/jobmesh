const QUEUE_NAME = 'jobs';
const QUEUE_PREFIX = 'jobmesh';

const JOB_TYPES = Object.freeze({
  CSV_PROCESSING: 'CSV_PROCESSING',
  IMAGE_PROCESSING: 'IMAGE_PROCESSING',
  REPORT_GENERATION: 'REPORT_GENERATION',
});

const JOB_STATUS = Object.freeze({
  QUEUED: 'QUEUED',
  PROCESSING: 'PROCESSING',
  COMPLETED: 'COMPLETED',
  FAILED: 'FAILED',
  CANCELLED: 'CANCELLED',
});

const TERMINAL_STATUSES = Object.freeze([JOB_STATUS.COMPLETED, JOB_STATUS.FAILED, JOB_STATUS.CANCELLED]);

// BullMQ treats 1 as the highest priority; larger numbers are served later.
const PRIORITY = Object.freeze({
  HIGH: 1,
  MEDIUM: 5,
  LOW: 10,
});

const FILE_KIND = Object.freeze({
  UPLOAD: 'UPLOAD',
  ARTIFACT: 'ARTIFACT',
});

const FILE_CATEGORY = Object.freeze({
  CSV: 'csv',
  IMAGE: 'image',
  JSON: 'json',
  OTHER: 'other',
});

// Hash tags ({...}) keep multi-key rate-limit scripts on one slot under Redis Cluster.
const REDIS_KEYS = Object.freeze({
  jobCache: (jobId) => `jobmesh:cache:job:${jobId}`,
  statsCache: (userId) => `jobmesh:cache:stats:${userId}`,
  cancelFlag: (jobId) => `jobmesh:cancel:${jobId}`,
  worker: (workerId) => `jobmesh:worker:${workerId}`,
  workerPattern: 'jobmesh:worker:*',
  rateLimit: (key, window) => `jobmesh:ratelimit:{${key}}:${window}`,
});

// Custom BullMQ ids must not be integer-like; raw ObjectIds occasionally are all digits.
const bullJobId = (jobId) => `job-${jobId}`;

module.exports = {
  QUEUE_NAME,
  QUEUE_PREFIX,
  JOB_TYPES,
  JOB_STATUS,
  TERMINAL_STATUSES,
  PRIORITY,
  FILE_KIND,
  FILE_CATEGORY,
  REDIS_KEYS,
  bullJobId,
};
