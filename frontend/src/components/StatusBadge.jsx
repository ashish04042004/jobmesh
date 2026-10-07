export default function StatusBadge({ status }) {
  return <span className={`badge badge-${status.toLowerCase()}`}>{status}</span>;
}

export function PriorityTag({ priority }) {
  return <span className={`priority priority-${priority.toLowerCase()}`}>{priority}</span>;
}
