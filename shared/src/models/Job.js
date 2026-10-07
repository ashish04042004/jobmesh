const { mongoose } = require('../db');
const { JOB_TYPES, JOB_STATUS, PRIORITY } = require('../constants');

const jobSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    type: { type: String, enum: Object.values(JOB_TYPES), required: true },
    priority: { type: String, enum: Object.keys(PRIORITY), default: 'MEDIUM' },
    status: { type: String, enum: Object.values(JOB_STATUS), default: JOB_STATUS.QUEUED },
    payload: { type: mongoose.Schema.Types.Mixed, default: {} },
    result: { type: mongoose.Schema.Types.Mixed, default: null },
    error: { type: String, default: null },
    progress: { type: Number, default: 0, min: 0, max: 100 },
    attempts: { type: Number, default: 0 },
    maxAttempts: { type: Number, default: 1 },
    manualRetries: { type: Number, default: 0 },
    workerId: { type: String, default: null },
    batchId: { type: String, default: undefined },
    idempotencyKey: { type: String, default: undefined },
    startedAt: { type: Date, default: null },
    completedAt: { type: Date, default: null },
    durationMs: { type: Number, default: null },
  },
  { timestamps: true, minimize: false },
);

// Dashboard listing: newest first, optionally filtered by status or type.
jobSchema.index({ userId: 1, _id: -1 });
jobSchema.index({ userId: 1, status: 1, _id: -1 });
jobSchema.index({ userId: 1, type: 1, _id: -1 });
// Client-supplied Idempotency-Key is unique per user.
jobSchema.index(
  { userId: 1, idempotencyKey: 1 },
  { unique: true, partialFilterExpression: { idempotencyKey: { $type: 'string' } } },
);
jobSchema.index({ batchId: 1, status: 1 }, { partialFilterExpression: { batchId: { $type: 'string' } } });

module.exports = mongoose.models.Job || mongoose.model('Job', jobSchema);
