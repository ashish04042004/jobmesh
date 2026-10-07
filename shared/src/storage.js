const path = require('node:path');

/**
 * Storage paths are persisted relative to DATA_DIR with forward slashes so the
 * same record resolves correctly on a Windows host and inside Linux containers.
 */
function resolveStoragePath(dataDir, storagePath) {
  const root = path.resolve(dataDir);
  const resolved = path.resolve(root, storagePath);
  if (!resolved.startsWith(root + path.sep)) {
    throw new Error(`Storage path escapes data directory: ${storagePath}`);
  }
  return resolved;
}

function uploadStoragePath(fileName) {
  return path.posix.join('uploads', fileName);
}

function artifactStoragePath(jobId, fileName) {
  return path.posix.join('outputs', String(jobId), fileName);
}

module.exports = { resolveStoragePath, uploadStoragePath, artifactStoragePath };
