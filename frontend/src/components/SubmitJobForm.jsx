import { useState } from 'react';
import { api } from '../api/client';
import ErrorMessage from './ErrorMessage';

const currentMonth = () => new Date().toISOString().slice(0, 7);

const INITIAL = {
  type: 'CSV_PROCESSING',
  priority: 'MEDIUM',
  source: 'synthetic',
  file: null,
  rows: 50000,
  invalidRate: 0.02,
  width: 1600,
  height: 1200,
  resizeWidth: 1024,
  thumbnailSize: 200,
  format: 'webp',
  quality: 80,
  month: currentMonth(),
  records: 100000,
  failAttempts: 0,
  delayMs: 0,
  count: 1,
};

const ACCEPT = { CSV_PROCESSING: '.csv', IMAGE_PROCESSING: '.png,.jpg,.jpeg,.webp' };

function buildPayload(form, fileId) {
  const simulate = {};
  if (form.failAttempts > 0) simulate.failAttempts = form.failAttempts;
  if (form.delayMs > 0) simulate.delayMs = form.delayMs;
  const withSimulate = (payload) => (Object.keys(simulate).length ? { ...payload, simulate } : payload);
  const input = fileId ? { fileId } : null;

  switch (form.type) {
    case 'IMAGE_PROCESSING':
      return withSimulate({
        ...(input ?? { synthetic: { width: form.width, height: form.height } }),
        resize: { width: form.resizeWidth },
        thumbnailSize: form.thumbnailSize,
        quality: form.quality,
        format: form.format,
      });
    case 'REPORT_GENERATION':
      return withSimulate({ reportType: 'MONTHLY_SALES', month: form.month, records: form.records });
    default:
      return withSimulate(input ?? { synthetic: { rows: form.rows, invalidRate: form.invalidRate } });
  }
}

export default function SubmitJobForm({ onSubmitted }) {
  const [form, setForm] = useState(INITIAL);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  const set = (field, parse = (v) => v) => (e) => setForm((f) => ({ ...f, [field]: parse(e.target.value) }));
  const num = (field) => set(field, Number);
  const canUpload = form.type !== 'REPORT_GENERATION';
  const usesFile = canUpload && form.source === 'file';

  async function handleSubmit(e) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    setNotice(null);
    try {
      let fileId;
      if (usesFile) {
        if (!form.file) throw new Error('Choose a file to upload');
        const { file: uploaded } = await api.uploadFile(form.file);
        fileId = uploaded.id;
      }
      const job = { type: form.type, priority: form.priority, payload: buildPayload(form, fileId) };

      if (form.count > 1) {
        const { count } = await api.createJobs(Array.from({ length: form.count }, () => job));
        setNotice(`Queued ${count} jobs`);
      } else {
        // A fresh key per click: a double-submit of the same click creates one job.
        const { job: created } = await api.createJob(job, crypto.randomUUID());
        setNotice(`Queued job …${created.id.slice(-6)}`);
      }
      onSubmitted?.();
    } catch (err) {
      setError(err);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form className="card submit-form" onSubmit={handleSubmit}>
      <div className="card-header">
        <h2>Submit job</h2>
      </div>

      <div className="form-row">
        <label>
          Job type
          <select value={form.type} onChange={set('type')}>
            <option value="CSV_PROCESSING">CSV processing</option>
            <option value="IMAGE_PROCESSING">Image processing</option>
            <option value="REPORT_GENERATION">Report generation</option>
          </select>
        </label>
        <label>
          Priority
          <select value={form.priority} onChange={set('priority')}>
            <option value="HIGH">HIGH</option>
            <option value="MEDIUM">MEDIUM</option>
            <option value="LOW">LOW</option>
          </select>
        </label>
      </div>

      {canUpload && (
        <div className="segmented">
          {['synthetic', 'file'].map((source) => (
            <button
              key={source}
              type="button"
              className={form.source === source ? 'active' : ''}
              onClick={() => setForm((f) => ({ ...f, source }))}
            >
              {source === 'synthetic' ? 'Generated data' : 'Upload file'}
            </button>
          ))}
        </div>
      )}

      {usesFile && (
        <label>
          File
          <input
            key={form.type}
            type="file"
            accept={ACCEPT[form.type]}
            onChange={(e) => setForm((f) => ({ ...f, file: e.target.files[0] ?? null }))}
          />
        </label>
      )}

      {form.type === 'CSV_PROCESSING' && !usesFile && (
        <div className="form-row">
          <label>
            Rows
            <input type="number" min={1} max={1000000} value={form.rows} onChange={num('rows')} />
          </label>
          <label>
            Invalid rate
            <input type="number" min={0} max={1} step={0.01} value={form.invalidRate} onChange={num('invalidRate')} />
          </label>
        </div>
      )}

      {form.type === 'IMAGE_PROCESSING' && (
        <>
          {!usesFile && (
            <div className="form-row">
              <label>
                Width
                <input type="number" min={16} max={4096} value={form.width} onChange={num('width')} />
              </label>
              <label>
                Height
                <input type="number" min={16} max={4096} value={form.height} onChange={num('height')} />
              </label>
            </div>
          )}
          <div className="form-row">
            <label>
              Resize to width
              <input type="number" min={1} max={4096} value={form.resizeWidth} onChange={num('resizeWidth')} />
            </label>
            <label>
              Thumbnail
              <input type="number" min={16} max={512} value={form.thumbnailSize} onChange={num('thumbnailSize')} />
            </label>
          </div>
          <div className="form-row">
            <label>
              Format
              <select value={form.format} onChange={set('format')}>
                <option value="webp">WebP</option>
                <option value="jpeg">JPEG</option>
                <option value="png">PNG</option>
              </select>
            </label>
            <label>
              Quality
              <input type="number" min={1} max={100} value={form.quality} onChange={num('quality')} />
            </label>
          </div>
        </>
      )}

      {form.type === 'REPORT_GENERATION' && (
        <div className="form-row">
          <label>
            Month
            <input type="month" value={form.month} onChange={set('month')} required />
          </label>
          <label>
            Sales records
            <input type="number" min={1} max={2000000} value={form.records} onChange={num('records')} />
          </label>
        </div>
      )}

      <details className="advanced">
        <summary>Fault injection &amp; batch</summary>
        <div className="form-row">
          <label title="The first N attempts throw, exercising retries with exponential backoff">
            Fail first N attempts
            <input type="number" min={0} max={10} value={form.failAttempts} onChange={num('failAttempts')} />
          </label>
          <label title="Simulated I/O wait; long delays make cancellation easy to try">
            Extra delay (ms)
            <input type="number" min={0} max={120000} step={500} value={form.delayMs} onChange={num('delayMs')} />
          </label>
        </div>
        <label>
          Copies (bulk submit)
          <input type="number" min={1} max={100} value={form.count} onChange={num('count')} />
        </label>
      </details>

      <ErrorMessage error={error} />
      {notice && <div className="notice">{notice}</div>}
      <button type="submit" className="btn btn-primary" disabled={submitting}>
        {submitting ? 'Submitting…' : form.count > 1 ? `Submit ${form.count} jobs` : 'Submit job'}
      </button>
    </form>
  );
}
