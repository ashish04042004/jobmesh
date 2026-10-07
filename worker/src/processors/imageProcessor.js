const fs = require('node:fs/promises');
const sharp = require('sharp');
const { UnrecoverableError } = require('bullmq');
const { envInt, FILE_CATEGORY } = require('@jobmesh/shared');

// One libvips thread per job keeps CPU usage per worker predictable, so
// scaling is driven by the number of worker processes (what we benchmark).
sharp.concurrency(envInt('SHARP_CONCURRENCY', 1));
sharp.cache(false);

async function loadInput(job, ctx) {
  const { synthetic, fileId } = job.payload;
  if (synthetic) {
    const buffer = await sharp({
      create: {
        width: synthetic.width,
        height: synthetic.height,
        channels: 3,
        noise: { type: 'gaussian', mean: 128, sigma: 40 },
      },
    })
      .png()
      .toBuffer();
    return { buffer, source: { kind: 'synthetic', width: synthetic.width, height: synthetic.height } };
  }
  const file = await ctx.loadInputFile(fileId);
  return { buffer: await fs.readFile(file.absolutePath), source: { kind: 'file', fileId, name: file.originalName } };
}

async function processImage(job, ctx) {
  const startedAt = Date.now();
  const { resize = { width: 1024 }, thumbnailSize = 200, quality = 80, format = 'webp' } = job.payload;
  const { buffer, source } = await loadInput(job, ctx);

  let metadata;
  try {
    metadata = await sharp(buffer).metadata();
  } catch (err) {
    throw new UnrecoverableError(`Invalid or unsupported image: ${err.message}`);
  }
  await ctx.throwIfCancelled({ force: true });
  await ctx.reportProgress(20);

  const resized = await sharp(buffer)
    .rotate()
    .resize({ width: resize.width, height: resize.height, fit: 'inside', withoutEnlargement: true })
    .toFormat(format, { quality })
    .toBuffer({ resolveWithObject: true });
  await ctx.throwIfCancelled({ force: true });
  await ctx.reportProgress(60);

  const thumbnail = await sharp(buffer)
    .rotate()
    .resize(thumbnailSize, thumbnailSize, { fit: 'cover' })
    .toFormat(format, { quality })
    .toBuffer({ resolveWithObject: true });
  await ctx.reportProgress(90);

  const ext = format === 'jpeg' ? 'jpg' : format;
  const mimeType = `image/${format}`;
  const [resizedFile, thumbnailFile] = await Promise.all([
    ctx.writeArtifact(`resized.${ext}`, resized.data, mimeType, FILE_CATEGORY.IMAGE),
    ctx.writeArtifact(`thumbnail.${ext}`, thumbnail.data, mimeType, FILE_CATEGORY.IMAGE),
  ]);

  const describe = (file, output) => ({
    fileId: file.id,
    name: file.originalName,
    width: output.info.width,
    height: output.info.height,
    bytes: output.info.size,
    downloadUrl: file.downloadUrl,
  });

  return {
    source,
    original: { width: metadata.width, height: metadata.height, format: metadata.format, bytes: buffer.length },
    outputs: { resized: describe(resizedFile, resized), thumbnail: describe(thumbnailFile, thumbnail) },
    compressionRatio: Number((buffer.length / resized.info.size).toFixed(2)),
    processingTimeMs: Date.now() - startedAt,
  };
}

module.exports = { processImage };
