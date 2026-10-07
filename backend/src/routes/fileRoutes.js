const crypto = require('node:crypto');
const path = require('node:path');
const express = require('express');
const multer = require('multer');
const { z } = require('zod');
const { FILE_KIND } = require('@jobmesh/shared');
const { validate } = require('../middleware/validate');
const { idParams } = require('../validation/schemas');
const { AppError } = require('../utils/AppError');
const { createFileController } = require('../controllers/fileController');
const { uploadTypeFor, ALLOWED_UPLOADS } = require('../services/fileService');

const listFilesQuery = z.object({ kind: z.enum(Object.values(FILE_KIND)).optional() });

function fileRoutes({ fileService, config }) {
  const router = express.Router();
  const controller = createFileController({ fileService });

  const upload = multer({
    storage: multer.diskStorage({
      destination: config.uploadsDir,
      filename: (_req, file, cb) => cb(null, `${crypto.randomUUID()}${path.extname(file.originalname).toLowerCase()}`),
    }),
    limits: { fileSize: config.uploadMaxBytes, files: 1 },
    fileFilter: (_req, file, cb) => {
      if (uploadTypeFor(file.originalname)) return cb(null, true);
      const allowed = Object.keys(ALLOWED_UPLOADS).join(', ');
      return cb(new AppError(400, `Unsupported file type; allowed: ${allowed}`, { code: 'UNSUPPORTED_FILE_TYPE' }));
    },
  });

  router.post('/', upload.single('file'), controller.upload);
  router.get('/', validate({ query: listFilesQuery }), controller.list);
  router.get('/:id/download', validate({ params: idParams }), controller.download);
  return router;
}

module.exports = { fileRoutes };
