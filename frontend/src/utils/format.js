export const JOB_TYPE_LABELS = {
  CSV_PROCESSING: 'CSV',
  IMAGE_PROCESSING: 'Image',
  REPORT_GENERATION: 'Report',
};

export const TERMINAL = new Set(['COMPLETED', 'FAILED', 'CANCELLED']);

const numberFmt = new Intl.NumberFormat();
export const formatNumber = (n) => (n == null ? '—' : numberFmt.format(n));

const currencyFmt = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });
export const formatCurrency = (n) => (n == null ? '—' : currencyFmt.format(n));

export function formatDuration(ms) {
  if (ms == null) return '—';
  if (ms < 1000) return `${Math.round(ms)} ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(ms < 10_000 ? 2 : 1)} s`;
  const minutes = Math.floor(ms / 60_000);
  return `${minutes}m ${Math.round((ms % 60_000) / 1000)}s`;
}

export function formatTime(value) {
  if (!value) return '—';
  return new Date(value).toLocaleTimeString(undefined, { hour12: false });
}

export function formatDateTime(value) {
  if (!value) return '—';
  return new Date(value).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'medium', hour12: false });
}

export function formatRelative(value) {
  if (!value) return '—';
  const seconds = Math.round((Date.now() - new Date(value).getTime()) / 1000);
  if (seconds < 5) return 'just now';
  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86_400) return `${Math.floor(seconds / 3600)}h ago`;
  return formatDateTime(value);
}

export function formatBytes(bytes) {
  if (bytes == null) return '—';
  const units = ['B', 'KB', 'MB', 'GB'];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(unit === 0 ? 0 : 1)} ${units[unit]}`;
}

export const shortId = (id) => (id ? id.slice(-6) : '');
