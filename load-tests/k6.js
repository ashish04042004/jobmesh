// API load test: N virtual users submit jobs concurrently and read them back.
//
// Run against the bench stack (rate limits lifted):
//   docker compose -f docker-compose.yml -f docker-compose.bench.yml up -d --build
//   docker run --rm -i --network jobmesh_default -v "${PWD}/load-tests:/scripts" \
//     -e BASE_URL=http://backend:4000 -e VUS=100 -e JOBS=10000 \
//     grafana/k6 run --summary-export=/scripts/results/k6-summary.json /scripts/k6.js
//
// Env: BASE_URL, VUS (concurrent users), JOBS (total submissions), USERS
// (distinct accounts), ROWS (synthetic CSV rows per job).
import http from 'k6/http';
import { check } from 'k6';
import { Counter, Trend } from 'k6/metrics';

const BASE_URL = __ENV.BASE_URL || 'http://localhost:4000';
const VUS = Number(__ENV.VUS || 100);
const JOBS = Number(__ENV.JOBS || 10000);
const USERS = Number(__ENV.USERS || 20);
const ROWS = Number(__ENV.ROWS || 5000);

const jobsAccepted = new Counter('jobs_accepted');
const submitLatency = new Trend('submit_latency', true);
const readLatency = new Trend('read_latency', true);

export const options = {
  scenarios: {
    submit_jobs: {
      executor: 'shared-iterations',
      vus: VUS,
      iterations: JOBS,
      maxDuration: '15m',
    },
  },
  thresholds: {
    http_req_failed: ['rate<0.01'],
    'http_req_duration{name:POST /api/jobs}': ['p(95)<500'],
    'http_req_duration{name:GET /api/jobs/:id}': ['p(95)<200'],
  },
  summaryTrendStats: ['avg', 'min', 'med', 'p(90)', 'p(95)', 'p(99)', 'max'],
};

const PRIORITIES = ['HIGH', 'MEDIUM', 'LOW'];
const json = { headers: { 'Content-Type': 'application/json' } };

export function setup() {
  const runId = Date.now();
  const tokens = [];
  for (let i = 0; i < USERS; i += 1) {
    const res = http.post(
      `${BASE_URL}/api/auth/register`,
      JSON.stringify({ name: `k6 user ${i}`, email: `k6_${runId}_${i}@example.com`, password: 'k6-password-123' }),
      json,
    );
    check(res, { 'registered': (r) => r.status === 201 });
    tokens.push(res.json('token'));
  }
  return { tokens };
}

export default function (data) {
  const token = data.tokens[(__VU - 1) % data.tokens.length];
  const params = {
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
  };

  const body = JSON.stringify({
    type: 'CSV_PROCESSING',
    priority: PRIORITIES[__ITER % PRIORITIES.length],
    payload: { synthetic: { rows: ROWS } },
  });
  const submit = http.post(`${BASE_URL}/api/jobs`, body, { ...params, tags: { name: 'POST /api/jobs' } });
  submitLatency.add(submit.timings.duration);
  const accepted = check(submit, { 'job accepted (202)': (r) => r.status === 202 });
  if (!accepted) return;
  jobsAccepted.add(1);

  const jobId = submit.json('job.id');
  const read = http.get(`${BASE_URL}/api/jobs/${jobId}`, { ...params, tags: { name: 'GET /api/jobs/:id' } });
  readLatency.add(read.timings.duration);
  check(read, { 'job readable (200)': (r) => r.status === 200 });
}
