const { badRequest } = require('../utils/AppError');

function createFileController({ fileService }) {
  return {
    async upload(req, res) {
      if (!req.file) throw badRequest('Attach a file in the "file" multipart field');
      res.status(201).json({ file: await fileService.registerUpload(req.user.id, req.file) });
    },

    async list(req, res) {
      res.json({ items: await fileService.list(req.user.id, req.validated.query) });
    },

    async download(req, res) {
      const { absolutePath, file } = await fileService.resolveDownload(req.user.id, req.validated.params.id);
      res.type(file.mimeType).download(absolutePath, file.originalName);
    },
  };
}

module.exports = { createFileController };
