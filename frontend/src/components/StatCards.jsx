import { formatNumber } from '../utils/format';

const CARDS = [
  { key: 'total', label: 'Total jobs' },
  { key: 'queued', label: 'Queued', tone: 'queued' },
  { key: 'processing', label: 'Processing', tone: 'processing' },
  { key: 'completed', label: 'Completed', tone: 'completed' },
  { key: 'failed', label: 'Failed', tone: 'failed' },
];

export default function StatCards({ stats }) {
  return (
    <section className="stat-grid">
      {CARDS.map(({ key, label, tone }) => (
        <div key={key} className={`card stat ${tone ? `stat-${tone}` : ''}`}>
          <span className="stat-label">{label}</span>
          <span className="stat-value">{formatNumber(stats?.[key])}</span>
        </div>
      ))}
      <div className="card stat">
        <span className="stat-label">Avg processing</span>
        <span className="stat-value">
          {stats?.averageProcessingTime == null ? '—' : `${stats.averageProcessingTime.toFixed(2)}s`}
        </span>
      </div>
    </section>
  );
}
