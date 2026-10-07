import { formatCurrency, formatNumber } from '../../utils/format';
import { Kpi } from './CsvResult';
import ArtifactList from './ArtifactList';

function Bars({ rows }) {
  const max = Math.max(...rows.map((r) => r.revenue));
  return (
    <ul className="bars">
      {rows.map((r) => (
        <li key={r.name}>
          <span className="bar-label">{r.name}</span>
          <span className="bar-track">
            <span className="bar-fill" style={{ width: `${(r.revenue / max) * 100}%` }} />
          </span>
          <span className="bar-value">{formatCurrency(r.revenue)}</span>
        </li>
      ))}
    </ul>
  );
}

export default function ReportResult({ result }) {
  return (
    <>
      <div className="kpi-row">
        <Kpi label="Total revenue" value={formatCurrency(result.totalRevenue)} />
        <Kpi label="Orders" value={formatNumber(result.orders)} />
        <Kpi label="Units sold" value={formatNumber(result.unitsSold)} />
        <Kpi label="Avg order value" value={formatCurrency(result.averageOrderValue)} />
      </div>

      <div className="two-col">
        <div>
          <h3>Revenue by region</h3>
          <Bars rows={result.revenueByRegion} />
        </div>
        <div>
          <h3>Top products</h3>
          <Bars rows={result.topProducts} />
        </div>
      </div>

      <p className="muted">
        Best day {result.bestDay.date} ({formatCurrency(result.bestDay.revenue)}) · worst day {result.worstDay.date} (
        {formatCurrency(result.worstDay.revenue)})
      </p>

      <ArtifactList artifacts={result.artifacts} />
    </>
  );
}
