const { mongoose } = require('../db');
const { FILE_KIND, FILE_CATEGORY } = require('../constants');

const fileSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    kind: { type: String, enum: Object.values(FILE_KIND), required: true },
    category: { type: String, enum: Object.values(FILE_CATEGORY), required: true },
    jobId: { type: mongoose.Schema.Types.ObjectId, ref: 'Job', default: null },
    originalName: { type: String, required: true, maxlength: 255 },
    mimeType: { type: String, required: true },
    size: { type: Number, required: true },
    storagePath: { type: String, required: true },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);

fileSchema.index({ userId: 1, _id: -1 });
// Re-running a job overwrites its artifacts instead of duplicating them.
fileSchema.index(
  { jobId: 1, originalName: 1 },
  { unique: true, partialFilterExpression: { kind: FILE_KIND.ARTIFACT } },
);

module.exports = mongoose.models.File || mongoose.model('File', fileSchema);
