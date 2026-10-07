export default function ProgressBar({ value, status }) {
  return (
    <div className={`progress progress-${status.toLowerCase()}`} aria-valuenow={value} role="progressbar">
      <div className="progress-fill" style={{ width: `${value}%` }} />
    </div>
  );
}
