class JobCancelledError extends Error {
  constructor(jobId) {
    super(`Job ${jobId} was cancelled`);
    this.name = 'JobCancelledError';
  }
}

module.exports = { JobCancelledError };
