import { formatNumber } from '../../utils/format';

export default function CsvResult({ result }) {
  const invalidPct = result.rowsProcessed ? ((result.invalidRows / result.rowsProcessed) * 100).toFixed(2) : 0;
  return (
    <>
      <div className="kpi-row">
        <Kpi label="Rows processed" value={formatNumber(result.rowsProcessed)} />
        <Kpi label="Valid" value={formatNumber(result.validRows)} />
        <Kpi label="Invalid" value={`${formatNumber(result.invalidRows)} (${invalidPct}%)`} />
        <Kpi label="Columns" value={result.columns.length} />
      </div>

      <h3>Invalid reasons</h3>
      <ul className="inline-list">
        {Object.entries(result.invalidReasons).map(([reason, count]) => (
          <li key={reason}>
            {reason}: <strong>{formatNumber(count)}</strong>
          </li>
        ))}
      </ul>

      {Object.keys(result.numericColumns).length > 0 && (
        <>
          <h3>Numeric columns</h3>
          <table className="table compact">
            <thead>
              <tr>
                <th>Column</th>
                <th>Count</th>
                <th>Min</th>
                <th>Mean</th>
                <th>Max</th>
              </tr>
            </thead>
            <tbody>
              {Object.entries(result.numericColumns).map(([column, s]) => (
                <tr key={column}>
                  <td>
                    <code>{column}</code>
                  </td>
                  <td>{formatNumber(s.count)}</td>
                  <td>{s.min ?? '—'}</td>
                  <td>{s.mean ?? '—'}</td>
                  <td>{s.max ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}

      {result.sampleErrors.length > 0 && (
        <>
          <h3>Sample invalid rows</h3>
          <ul className="sample-errors">
            {result.sampleErrors.map((e) => (
              <li key={e.row}>
                Row {e.row}: {e.problems.join(', ')}
              </li>
            ))}
          </ul>
        </>
      )}
    </>
  );
}

export function Kpi({ label, value }) {
  return (
    <div className="kpi">
      <span className="muted">{label}</span>
      <strong>{value}</strong>
    </div>
  );
}
