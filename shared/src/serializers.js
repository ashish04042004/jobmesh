function plain(doc) {
  return typeof doc?.toObject === 'function' ? doc.toObject() : doc;
}

const idOf = (value) => (value == null ? null : String(value));

function toUserDTO(doc) {
  const u = plain(doc);
  return { id: idOf(u._id), name: u.name, email: u.email, createdAt: u.createdAt };
}

function toJobDTO(doc) {
  const j = plain(doc);
  return {
    id: idOf(j._id),
    userId: idOf(j.userId),
    type: j.type,
    priority: j.priority,
    status: j.status,
    payload: j.payload ?? {},
    result: j.result ?? null,
    error: j.error ?? null,
    progress: j.progress ?? 0,
    attempts: j.attempts ?? 0,
    maxAttempts: j.maxAttempts ?? 1,
    manualRetries: j.manualRetries ?? 0,
    workerId: j.workerId ?? null,
    batchId: j.batchId ?? null,
    idempotencyKey: j.idempotencyKey ?? null,
    createdAt: j.createdAt,
    updatedAt: j.updatedAt,
    startedAt: j.startedAt ?? null,
    completedAt: j.completedAt ?? null,
    durationMs: j.durationMs ?? null,
  };
}

function toFileDTO(doc) {
  const f = plain(doc);
  return {
    id: idOf(f._id),
    kind: f.kind,
    category: f.category,
    jobId: idOf(f.jobId),
    originalName: f.originalName,
    mimeType: f.mimeType,
    size: f.size,
    createdAt: f.createdAt,
    downloadUrl: `/api/files/${idOf(f._id)}/download`,
  };
}

module.exports = { toUserDTO, toJobDTO, toFileDTO };
