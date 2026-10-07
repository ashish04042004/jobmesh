const TOKEN_KEY = 'jobmesh.token';

export const tokenStore = {
  get: () => localStorage.getItem(TOKEN_KEY),
  set: (token) => localStorage.setItem(TOKEN_KEY, token),
  clear: () => localStorage.removeItem(TOKEN_KEY),
};

export class ApiError extends Error {
  constructor(status, body) {
    super(body?.error?.message ?? `Request failed (${status})`);
    this.status = status;
    this.code = body?.error?.code;
    this.details = body?.error?.details;
  }
}

let unauthorizedHandler = () => {};
export function onUnauthorized(handler) {
  unauthorizedHandler = handler;
}

async function request(method, path, { body, form, headers = {} } = {}) {
  const token = tokenStore.get();
  const res = await fetch(path, {
    method,
    headers: {
      ...(token && { Authorization: `Bearer ${token}` }),
      ...(body && { 'Content-Type': 'application/json' }),
      ...headers,
    },
    body: form ?? (body && JSON.stringify(body)),
  });

  if (res.status === 204) return null;
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    if (res.status === 401 && token) unauthorizedHandler();
    throw new ApiError(res.status, data);
  }
  return data;
}

const query = (params) => {
  const qs = new URLSearchParams(Object.entries(params).filter(([, v]) => v !== undefined && v !== '')).toString();
  return qs ? `?${qs}` : '';
};

async function fetchBlob(url) {
  const res = await fetch(url, { headers: { Authorization: `Bearer ${tokenStore.get()}` } });
  if (!res.ok) throw new ApiError(res.status, await res.json().catch(() => null));
  return res.blob();
}

export const api = {
  register: (body) => request('POST', '/api/auth/register', { body }),
  login: (body) => request('POST', '/api/auth/login', { body }),
  me: () => request('GET', '/api/auth/me'),

  stats: () => request('GET', '/api/stats'),
  listJobs: (params = {}) => request('GET', `/api/jobs${query(params)}`),
  getJob: (id) => request('GET', `/api/jobs/${id}`),
  createJob: (job, idempotencyKey) =>
    request('POST', '/api/jobs', { body: job, headers: idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {} }),
  createJobs: (jobs) => request('POST', '/api/jobs/bulk', { body: { jobs } }),
  cancelJob: (id) => request('POST', `/api/jobs/${id}/cancel`),
  retryJob: (id) => request('POST', `/api/jobs/${id}/retry`),
  deleteJob: (id) => request('DELETE', `/api/jobs/${id}`),

  uploadFile: (file) => {
    const form = new FormData();
    form.append('file', file);
    return request('POST', '/api/files', { form });
  },
  fetchBlob,
  async download(url, fileName) {
    const objectUrl = URL.createObjectURL(await fetchBlob(url));
    const link = Object.assign(document.createElement('a'), { href: objectUrl, download: fileName });
    link.click();
    URL.revokeObjectURL(objectUrl);
  },
};
