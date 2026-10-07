import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { api } from '../api/client';
import { usePolling } from '../hooks/usePolling';
import StatusBadge, { PriorityTag } from '../components/StatusBadge';
import ProgressBar from '../components/ProgressBar';
import ErrorMessage from '../components/ErrorMessage';
import CsvResult from '../components/results/CsvResult';
import ImageResult from '../components/results/ImageResult';
import ReportResult from '../components/results/ReportResult';
import { JOB_TYPE_LABELS, TERMINAL, formatDateTime, formatDuration } from '../utils/format';

const RESULT_VIEWS = {
  CSV_PROCESSING: CsvResult,
  IMAGE_PROCESSING: ImageResult,
  REPORT_GENERATION: ReportResult,
};

function Field({ label, children }) {
  return (
    <div className="field">
      <dt>{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}

export default function JobDetailsPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [actionError, setActionError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [settled, setSettled] = useState(false);

  // Poll quickly while the job is in flight; stop once it reaches a terminal state.
  const { data, error, refresh } = usePolling(() => api.getJob(id), 1000, { enabled: !settled, deps: [id] });
  const job = data?.job;
  if (job && TERMINAL.has(job.status) !== settled) setSettled(TERMINAL.has(job.status));

  async function act(action) {
    setBusy(true);
    setActionError(null);
    try {
      if (action === 'delete') {
        if (!window.confirm('Delete this job and its artifacts?')) return;
        await api.deleteJob(id);
        navigate('/');
        return;
      }
      await (action === 'cancel' ? api.cancelJob(id) : api.retryJob(id));
      setSettled(false);
      await refresh();
    } catch (err) {
      setActionError(err);
    } finally {
      setBusy(false);
    }
  }

  if (error && !job) {
    return (
      <div className="card">
        <ErrorMessage error={error} />
        <Link to="/">← Back to dashboard</Link>
      </div>
    );
  }
  if (!job) return <div className="page-loading">Loading job…</div>;

  const ResultView = RESULT_VIEWS[job.type];
  const queueWait = job.startedAt ? new Date(job.startedAt) - new Date(job.createdAt) : null;

  return (
    <div className="job-details">
      <Link to="/" className="back-link">
        ← Dashboard
      </Link>

      <section className="card">
        <div className="card-header">
          <h1>
            {JOB_TYPE_LABELS[job.type]} job <code className="job-id">{job.id}</code>
          </h1>
          <div className="actions">
            {['QUEUED', 'PROCESSING'].includes(job.status) && (
              <button type="button" className="btn btn-warn" disabled={busy} onClick={() => act('cancel')}>
                Cancel
              </button>
            )}
            {['FAILED', 'CANCELLED'].includes(job.status) && (
              <button type="button" className="btn btn-primary" disabled={busy} onClick={() => act('retry')}>
                Retry
              </button>
            )}
            {job.status !== 'PROCESSING' && (
              <button type="button" className="btn btn-danger" disabled={busy} onClick={() => act('delete')}>
                Delete
              </button>
            )}
          </div>
        </div>

        <div className="status-line">
          <StatusBadge status={job.status} />
          <PriorityTag priority={job.priority} />
          <div className="status-progress">
            <ProgressBar value={job.progress} status={job.status} />
            <span className="muted">{job.progress}%</span>
          </div>
        </div>

        <ErrorMessage error={actionError} />
        {job.error && (
          <div className="error">
            <strong>{job.status === 'FAILED' ? 'Failed' : 'Last attempt failed'}:</strong> {job.error}
          </div>
        )}

        <dl className="fields">
          <Field label="Attempts">
            {job.attempts} / {job.maxAttempts}
            {job.manualRetries > 0 && <span className="muted"> · {job.manualRetries} manual retries</span>}
          </Field>
          <Field label="Worker">{job.workerId ? <code>{job.workerId}</code> : '—'}</Field>
          <Field label="Created">{formatDateTime(job.createdAt)}</Field>
          <Field label="Started">{formatDateTime(job.startedAt)}</Field>
          <Field label="Finished">{formatDateTime(job.completedAt)}</Field>
          <Field label="Queue wait">{formatDuration(queueWait)}</Field>
          <Field label="Processing time">{formatDuration(job.durationMs)}</Field>
          {job.batchId && <Field label="Batch">{job.batchId}</Field>}
        </dl>
      </section>

      {job.status === 'COMPLETED' && job.result && ResultView && (
        <section className="card">
          <div className="card-header">
            <h2>Result</h2>
          </div>
          <ResultView result={job.result} />
        </section>
      )}

      <section className="card">
        <details>
          <summary>Payload &amp; raw result</summary>
          <pre>{JSON.stringify({ payload: job.payload, result: job.result }, null, 2)}</pre>
        </details>
      </section>
    </div>
  );
}
