import { useState } from 'react';
import { useNavigate } from 'react-router';
import { api } from '../api/client';
import { usePolling } from '../hooks/usePolling';
import { JOB_TYPE_LABELS, formatDuration, formatRelative, shortId } from '../utils/format';
import StatusBadge, { PriorityTag } from './StatusBadge';
import ProgressBar from './ProgressBar';
import ErrorMessage from './ErrorMessage';

const PAGE_SIZE = 20;
const STATUSES = ['', 'QUEUED', 'PROCESSING', 'COMPLETED', 'FAILED', 'CANCELLED'];
const TYPES = ['', 'CSV_PROCESSING', 'IMAGE_PROCESSING', 'REPORT_GENERATION'];

/**
 * The newest page is polled live; "Load more" follows the API's cursor to
 * append older pages, which are mostly finished jobs and don't need polling.
 */
export default function JobTable({ refreshKey }) {
  const navigate = useNavigate();
  const [filters, setFilters] = useState({ status: '', type: '' });
  const [older, setOlder] = useState({ items: [], nextCursor: undefined });
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState(null);

  const { data: firstPage, error: pollError } = usePolling(
    () => api.listJobs({ ...filters, limit: PAGE_SIZE }),
    2000,
    { deps: [filters.status, filters.type, refreshKey] },
  );

  const setFilter = (field) => (e) => {
    setOlder({ items: [], nextCursor: undefined });
    setFilters((f) => ({ ...f, [field]: e.target.value }));
  };

  const firstIds = new Set(firstPage?.items.map((j) => j.id));
  const jobs = [...(firstPage?.items ?? []), ...older.items.filter((j) => !firstIds.has(j.id))];
  const nextCursor = older.nextCursor === undefined ? firstPage?.nextCursor : older.nextCursor;

  async function loadMore() {
    setLoadingMore(true);
    try {
      const page = await api.listJobs({ ...filters, limit: PAGE_SIZE, cursor: nextCursor });
      setOlder((o) => ({ items: [...o.items, ...page.items], nextCursor: page.nextCursor }));
    } catch (err) {
      setError(err);
    } finally {
      setLoadingMore(false);
    }
  }

  return (
    <section className="card">
      <div className="card-header">
        <h2>Jobs</h2>
        <div className="filters">
          <select value={filters.status} onChange={setFilter('status')} aria-label="Filter by status">
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {s || 'All statuses'}
              </option>
            ))}
          </select>
          <select value={filters.type} onChange={setFilter('type')} aria-label="Filter by type">
            {TYPES.map((t) => (
              <option key={t} value={t}>
                {t ? JOB_TYPE_LABELS[t] : 'All types'}
              </option>
            ))}
          </select>
        </div>
      </div>

      <ErrorMessage error={pollError ?? error} />

      {jobs.length === 0 ? (
        <p className="muted empty">{firstPage ? 'No jobs yet. Submit one to get started.' : 'Loading…'}</p>
      ) : (
        <table className="table clickable">
          <thead>
            <tr>
              <th>ID</th>
              <th>Type</th>
              <th>Priority</th>
              <th>Status</th>
              <th>Progress</th>
              <th>Attempts</th>
              <th>Duration</th>
              <th>Created</th>
            </tr>
          </thead>
          <tbody>
            {jobs.map((job) => (
              <tr key={job.id} onClick={() => navigate(`/jobs/${job.id}`)}>
                <td>
                  <code>…{shortId(job.id)}</code>
                </td>
                <td>{JOB_TYPE_LABELS[job.type]}</td>
                <td>
                  <PriorityTag priority={job.priority} />
                </td>
                <td>
                  <StatusBadge status={job.status} />
                </td>
                <td className="progress-cell">
                  <ProgressBar value={job.progress} status={job.status} />
                </td>
                <td>
                  {job.attempts}/{job.maxAttempts}
                </td>
                <td>{formatDuration(job.durationMs)}</td>
                <td className="muted">{formatRelative(job.createdAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {nextCursor && (
        <button type="button" className="btn btn-ghost load-more" onClick={loadMore} disabled={loadingMore}>
          {loadingMore ? 'Loading…' : 'Load older jobs'}
        </button>
      )}
    </section>
  );
}
