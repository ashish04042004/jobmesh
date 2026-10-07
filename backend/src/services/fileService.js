const fs = require('node:fs/promises');
const path = require('node:path');
const {
  File,
  FILE_KIND,
  FILE_CATEGORY,
  toFileDTO,
  resolveStoragePath,
  uploadStoragePath,
} = require('@jobmesh/shared');
const { notFound } = require('../utils/AppError');

const ALLOWED_UPLOADS = {
  '.csv': { category: FILE_CATEGORY.CSV, mimeType: 'text/csv' },
  '.png': { category: FILE_CATEGORY.IMAGE, mimeType: 'image/png' },
  '.jpg': { category: FILE_CATEGORY.IMAGE, mimeType: 'image/jpeg' },
  '.jpeg': { category: FILE_CATEGORY.IMAGE, mimeType: 'image/jpeg' },
  '.webp': { category: FILE_CATEGORY.IMAGE, mimeType: 'image/webp' },
};

const uploadTypeFor = (fileName) => ALLOWED_UPLOADS[path.extname(fileName).toLowerCase()] ?? null;

function createFileService({ config }) {
  return {
    async registerUpload(userId, uploaded) {
      const { category, mimeType } = uploadTypeFor(uploaded.originalname);
      try {
        const file = await File.create({
          userId,
          kind: FILE_KIND.UPLOAD,
          category,
          originalName: path.basename(uploaded.originalname).slice(0, 255),
          mimeType,
          size: uploaded.size,
          storagePath: uploadStoragePath(uploaded.filename),
        });
        return toFileDTO(file);
      } catch (err) {
        await fs.rm(uploaded.path, { force: true });
        throw err;
      }
    },

    async list(userId, { kind } = {}) {
      const filter = { userId };
      if (kind) filter.kind = kind;
      const files = await File.find(filter).sort({ _id: -1 }).limit(100).lean();
      return files.map(toFileDTO);
    },

    async resolveDownload(userId, fileId) {
      const file = await File.findOne({ _id: fileId, userId }).lean();
      if (!file) throw notFound('File not found');
      const absolutePath = resolveStoragePath(config.dataDir, file.storagePath);
      try {
        await fs.access(absolutePath);
      } catch {
        throw notFound('File content is no longer available');
      }
      return { absolutePath, file: toFileDTO(file) };
    },
  };
}

module.exports = { createFileService, uploadTypeFor, ALLOWED_UPLOADS };
