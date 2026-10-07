import { formatNumber, formatRelative } from '../utils/format';

const QUEUE_FIELDS = [
  ['depth', 'Queue depth'],
  ['active', 'Active'],
  ['prioritized', 'Prioritized'],
  ['delayed', 'Delayed (backoff)'],
  ['failed', 'Dead-letter'],
];

export default function SystemPanel({ queue, workers }) {
  return (
    <section className="card">
      <div className="card-header">
        <h2>System</h2>
        <span className="muted">shared across all users</span>
      </div>

      <div className="queue-grid">
        {QUEUE_FIELDS.map(([key, label]) => (
          <div key={key} className="queue-metric">
            <span className="muted">{label}</span>
            <strong>{formatNumber(queue?.[key] ?? 0)}</strong>
          </div>
        ))}
      </div>

      <h3>
        Workers <span className="pill">{workers?.length ?? 0} online</span>
      </h3>
      {workers?.length ? (
        <table className="table compact">
          <thead>
            <tr>
              <th>Worker</th>
              <th>Busy</th>
              <th>Completed</th>
              <th>Failed attempts</th>
              <th>Memory</th>
              <th>Heartbeat</th>
            </tr>
          </thead>
          <tbody>
            {workers.map((w) => (
              <tr key={w.workerId}>
                <td>
                  <span className={`dot ${w.active > 0 ? 'dot-busy' : 'dot-idle'}`} />
                  <code>{w.workerId}</code>
                </td>
                <td>
                  {w.active}/{w.concurrency}
                </td>
                <td>{formatNumber(w.completed)}</td>
                <td>{formatNumber(w.failedAttempts)}</td>
                <td>{w.memoryMb} MB</td>
                <td className="muted">{formatRelative(w.lastSeen)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <p className="muted">No workers online. Jobs will wait in the queue until one starts.</p>
      )}
    </section>
  );
}
