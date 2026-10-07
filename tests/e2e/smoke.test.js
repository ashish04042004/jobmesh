// End-to-end checks against a running stack (API + workers + Redis + MongoDB).
//   docker compose up -d --build && npm run test:e2e
// Override the target with E2E_BASE_URL.
const { describe, it, before } = require('node:test');
const assert = require('node:assert/strict');

const BASE_URL = process.env.E2E_BASE_URL || 'http://localhost:4000';
const TERMINAL = new Set(['COMPLETED', 'FAILED', 'CANCELLED']);

let token;

async function api(method, path, { body, headers = {}, raw = false } = {}) {
  const res = await fetch(`${BASE_URL}${path}`, {
    method,
    headers: {
      ...(token && { Authorization: `Bearer ${token}` }),
      ...(body && !(body instanceof FormData) && { 'Content-Type': 'application/json' }),
      ...headers,
    },
    body: body instanceof FormData ? body : body && JSON.stringify(body),
  });
  if (raw) return res;
  const text = await res.text();
  return { status: res.status, headers: res.headers, body: text ? JSON.parse(text) : null };
}

async function waitFor(jobId, predicate = (job) => TERMINAL.has(job.status), timeoutMs = 60_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const { body } = await api('GET', `/api/jobs/${jobId}`);
    if (predicate(body.job)) return body.job;
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error(`Timed out waiting for job ${jobId}`);
}

const submit = (job, headers) => api('POST', '/api/jobs', { body: job, headers });

describe('JobMesh end-to-end', () => {
  before(async () => {
    const health = await fetch(`${BASE_URL}/ready`).catch(() => null);
    assert.ok(health?.ok, `API not ready at ${BASE_URL}; start the stack first`);

    const email = `e2e_${Date.now()}@example.com`;
    const reg = await api('POST', '/api/auth/register', {
      body: { name: 'E2E', email, password: 'e2e-password-123' },
    });
    assert.equal(reg.status, 201);
    token = reg.body.token;
  });

  it('processes a synthetic CSV job asynchronously', async () => {
    const res = await submit({ type: 'CSV_PROCESSING', priority: 'HIGH', payload: { synthetic: { rows: 20_000 } } });
    assert.equal(res.status, 202);
    assert.equal(res.body.job.status, 'QUEUED');

    const job = await waitFor(res.body.job.id);
    assert.equal(job.status, 'COMPLETED');
    assert.equal(job.result.rowsProcessed, 20_000);
    assert.ok(job.workerId, 'records which worker processed the job');
  });

  it('processes an uploaded CSV file', async () => {
    const form = new FormData();
    const csv = 'id,name,email,amount\n1,Asha,asha@example.com,10\n2,,bad,5\n';
    form.append('file', new Blob([csv], { type: 'text/csv' }), 'customers.csv');
    const upload = await api('POST', '/api/files', { body: form });
    assert.equal(upload.status, 201);

    const res = await submit({ type: 'CSV_PROCESSING', payload: { fileId: upload.body.file.id } });
    const job = await waitFor(res.body.job.id);
    assert.equal(job.status, 'COMPLETED');
    assert.equal(job.result.invalidRows, 1);
  });

  it('generates images and a report with downloadable artifacts', async () => {
    const image = await submit({ type: 'IMAGE_PROCESSING', payload: { synthetic: { width: 1200, height: 900 } } });
    const report = await submit({ type: 'REPORT_GENERATION', payload: { month: '2026-09', records: 50_000 } });

    const imageJob = await waitFor(image.body.job.id);
    assert.equal(imageJob.status, 'COMPLETED');
    assert.equal(imageJob.result.outputs.thumbnail.width, 200);

    const reportJob = await waitFor(report.body.job.id);
    assert.equal(reportJob.status, 'COMPLETED');
    const download = await api('GET', reportJob.result.artifacts[0].downloadUrl, { raw: true });
    assert.equal(download.status, 200);
    assert.equal((await download.json()).month, '2026-09');
  });

  it('retries transient failures with backoff and then succeeds', async () => {
    const res = await submit({
      type: 'CSV_PROCESSING',
      payload: { synthetic: { rows: 100 }, simulate: { failAttempts: 2 } },
    });
    const job = await waitFor(res.body.job.id);
    assert.equal(job.status, 'COMPLETED');
    assert.equal(job.attempts, 3);
  });

  it('marks a job FAILED after exhausting retries and allows a manual retry', async () => {
    const res = await submit({
      type: 'CSV_PROCESSING',
      payload: { synthetic: { rows: 100 }, simulate: { failAttempts: 10 } },
    });
    const failed = await waitFor(res.body.job.id);
    assert.equal(failed.status, 'FAILED');
    assert.equal(failed.attempts, failed.maxAttempts);
    assert.match(failed.error, /Simulated failure/);

    const retry = await api('POST', `/api/jobs/${failed.id}/retry`);
    assert.equal(retry.status, 202);
    assert.equal(retry.body.job.status, 'QUEUED');
    assert.equal(retry.body.job.manualRetries, 1);
    const again = await waitFor(failed.id, (j) => j.status === 'FAILED' && j.manualRetries === 1);
    assert.equal(again.attempts, again.maxAttempts);
  });

  it('cancels a running job cooperatively', async () => {
    const res = await submit({
      type: 'CSV_PROCESSING',
      payload: { synthetic: { rows: 100 }, simulate: { delayMs: 15_000 } },
    });
    await waitFor(res.body.job.id, (j) => j.status === 'PROCESSING', 30_000);

    const cancel = await api('POST', `/api/jobs/${res.body.job.id}/cancel`);
    assert.equal(cancel.status, 200);
    await new Promise((r) => setTimeout(r, 1500));
    const { body } = await api('GET', `/api/jobs/${res.body.job.id}`);
    assert.equal(body.job.status, 'CANCELLED');
    assert.equal(body.job.result, null);
  });

  it('deduplicates submissions with an Idempotency-Key', async () => {
    const key = `e2e-${Date.now()}`;
    const job = { type: 'CSV_PROCESSING', payload: { synthetic: { rows: 10 } } };
    const first = await submit(job, { 'Idempotency-Key': key });
    const second = await submit(job, { 'Idempotency-Key': key });
    assert.equal(first.status, 202);
    assert.equal(second.status, 200);
    assert.equal(second.body.job.id, first.body.job.id);
  });

  it('serves repeat job reads from the Redis cache', async () => {
    const res = await submit({ type: 'CSV_PROCESSING', payload: { synthetic: { rows: 10 } } });
    const job = await waitFor(res.body.job.id);
    const first = await api('GET', `/api/jobs/${job.id}`);
    const second = await api('GET', `/api/jobs/${job.id}`);
    assert.equal(second.headers.get('x-cache'), 'HIT');
    assert.deepEqual(second.body.job, first.body.job);
  });

  it('reports stats including live workers', async () => {
    const { status, body } = await api('GET', '/api/stats');
    assert.equal(status, 200);
    assert.ok(body.total >= 1);
    assert.ok(Array.isArray(body.workers) && body.workers.length >= 1, 'at least one worker heartbeat');
    assert.equal(typeof body.queue.depth, 'number');
  });
});
