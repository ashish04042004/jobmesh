#!/usr/bin/env node
/**
 * Horizontal-scaling benchmark: for each worker count, scale the worker
 * service, submit an identical batch of jobs, wait for the queue to drain and
 * record throughput, latency percentiles and worker CPU.
 *
 *   docker compose -f docker-compose.yml -f docker-compose.bench.yml up -d --build
 *   node load-tests/benchmark-workers.js --workers 1,2,4,8 --jobs 2000 --rows 20000
 *
 * Options:
 *   --workers 1,2,4,8      worker counts to test
 *   --jobs 2000            jobs per run
 *   --type CSV_PROCESSING  CSV_PROCESSING | REPORT_GENERATION | IMAGE_PROCESSING
 *   --rows 20000           CSV rows / report records per job (image: --size 1600)
 *   --base-url URL         API URL (default http://localhost:4000)
 *   --no-scale             don't call docker compose (workers managed manually)
 *   --no-docker-stats      skip CPU/memory sampling
 */
const { execFile, execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const { promisify } = require('node:util');

const execFileAsync = promisify(execFile);
const ROOT = path.resolve(__dirname, '..');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg.startsWith('--')) continue;
    const [key, inline] = arg.slice(2).split('=');
    if (inline !== undefined) out[key] = inline;
    else if (argv[i + 1] && !argv[i + 1].startsWith('--')) out[key] = argv[++i];
    else out[key] = true;
  }
  return out;
}

const args = parseArgs(process.argv.slice(2));
const opts = {
  baseUrl: args['base-url'] || 'http://localhost:4000',
  workers: String(args.workers || '1,2,4,8').split(',').map(Number),
  jobs: Number(args.jobs || 2000),
  type: args.type || 'CSV_PROCESSING',
  rows: Number(args.rows || 20000),
  size: Number(args.size || 1600),
  composeFiles: String(args['compose-files'] || 'docker-compose.yml,docker-compose.bench.yml').split(','),
  scale: !args['no-scale'],
  dockerStats: !args['no-docker-stats'],
};

let token;
async function api(method, url, body) {
  const res = await fetch(`${opts.baseUrl}${url}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token && { Authorization: `Bearer ${token}` }) },
    body: body && JSON.stringify(body),
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error(`${method} ${url} -> ${res.status} ${JSON.stringify(data)}`);
  return data;
}

function jobSpec() {
  switch (opts.type) {
    case 'REPORT_GENERATION':
      return { type: opts.type, payload: { month: '2026-09', records: opts.rows } };
    case 'IMAGE_PROCESSING':
      return { type: opts.type, payload: { synthetic: { width: opts.size, height: Math.round(opts.size * 0.75) } } };
    default:
      return { type: 'CSV_PROCESSING', payload: { synthetic: { rows: opts.rows } } };
  }
}

function compose(...cmd) {
  const files = opts.composeFiles.flatMap((f) => ['-f', f]);
  execFileSync('docker', ['compose', ...files, ...cmd], { cwd: ROOT, stdio: 'inherit' });
}

async function waitUntil(label, predicate, timeoutMs = 180_000, intervalMs = 2000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await sleep(intervalMs);
  }
  throw new Error(`Timed out waiting for ${label}`);
}

async function submitBatch(batchId) {
  const spec = jobSpec();
  const chunks = [];
  for (let i = 0; i < opts.jobs; i += 100) chunks.push(Math.min(100, opts.jobs - i));
  const queue = [...chunks];
  const sender = async () => {
    while (queue.length) {
      const n = queue.shift();
      await api('POST', '/api/jobs/bulk', { batchId, jobs: Array.from({ length: n }, () => spec) });
    }
  };
  await Promise.all(Array.from({ length: 8 }, sender));
}

function startDockerStatsSampler() {
  const samples = [];
  let running = true;
  const parsePercent = (s) => Number.parseFloat(String(s).replace('%', '')) || 0;
  const parseMiB = (s) => {
    const [value, unit] = String(s).split('/')[0].trim().match(/([\d.]+)\s*([KMG]i?B)/i)?.slice(1) ?? [0, 'MiB'];
    const factor = { kib: 1 / 1024, kb: 1 / 1024, mib: 1, mb: 1, gib: 1024, gb: 1024 }[unit.toLowerCase()] ?? 1;
    return Number(value) * factor;
  };
  const loop = (async () => {
    while (running) {
      try {
        const { stdout } = await execFileAsync('docker', ['stats', '--no-stream', '--format', '{{json .}}']);
        const workers = stdout
          .trim()
          .split('\n')
          .filter(Boolean)
          .map((line) => JSON.parse(line))
          .filter((s) => /worker/i.test(s.Name));
        if (workers.length) {
          samples.push({
            cpu: workers.reduce((sum, s) => sum + parsePercent(s.CPUPerc), 0),
            memMiB: workers.reduce((sum, s) => sum + parseMiB(s.MemUsage), 0) / workers.length,
          });
        }
      } catch {
        // docker stats unavailable; metrics will be omitted
      }
    }
  })();
  return async function stop() {
    running = false;
    await loop;
    if (!samples.length) return null;
    const avg = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length;
    return {
      avgTotalCpuPercent: Math.round(avg(samples.map((s) => s.cpu))),
      peakTotalCpuPercent: Math.round(Math.max(...samples.map((s) => s.cpu))),
      avgMemPerWorkerMiB: Math.round(avg(samples.map((s) => s.memMiB))),
    };
  };
}

async function runOnce(workerCount) {
  console.log(`\n=== ${workerCount} worker(s): ${opts.jobs} x ${opts.type} ===`);
  if (opts.scale) compose('up', '-d', '--no-recreate', '--scale', `worker=${workerCount}`, 'worker');

  await waitUntil(`${workerCount} worker heartbeats and an idle queue`, async () => {
    const stats = await api('GET', '/api/stats');
    const live = stats.workers?.length ?? 0;
    const busy = (stats.queue?.depth ?? 0) + (stats.queue?.active ?? 0);
    process.stdout.write(`  workers online: ${live}/${workerCount}, queue busy: ${busy}      \r`);
    return live === workerCount && busy === 0;
  });
  console.log();

  const batchId = `bench-w${workerCount}-${Date.now()}`;
  const stopSampler = opts.dockerStats ? startDockerStatsSampler() : async () => null;
  const submitStarted = Date.now();
  await submitBatch(batchId);
  const submitMs = Date.now() - submitStarted;
  console.log(`  submitted in ${submitMs} ms (${Math.round(opts.jobs / (submitMs / 1000))} jobs/s accepted)`);

  let batch;
  await waitUntil(
    'batch to drain',
    async () => {
      batch = await api('GET', `/api/stats?batchId=${batchId}`);
      process.stdout.write(`  finished ${batch.finished}/${batch.total}      \r`);
      return batch.done;
    },
    60 * 60_000,
    1000,
  );
  console.log();
  const resources = await stopSampler();

  return {
    workers: workerCount,
    jobs: batch.total,
    completed: batch.COMPLETED,
    failed: batch.FAILED,
    submitMs,
    makespanSec: batch.makespanMs / 1000,
    throughputJobsPerSec: batch.throughputJobsPerSec,
    processingMs: batch.processingMs,
    queueWaitMs: batch.queueWaitMs,
    resources,
  };
}

function toMarkdown(results) {
  const base = results[0]?.throughputJobsPerSec;
  const lines = [
    `Job type: ${opts.type}, ${opts.jobs} jobs per run, payload size ${opts.type === 'IMAGE_PROCESSING' ? opts.size + 'px' : opts.rows + ' rows'}`,
    '',
    '| Workers | Jobs | Makespan (s) | Throughput (jobs/s) | Speedup | Processing p50 / p95 (ms) | Queue wait p50 / p95 (ms) | Worker CPU avg (%) | Failed |',
    '|---:|---:|---:|---:|---:|---:|---:|---:|---:|',
  ];
  for (const r of results) {
    const speedup = base ? `${(r.throughputJobsPerSec / base).toFixed(2)}x` : '-';
    lines.push(
      `| ${r.workers} | ${r.jobs} | ${r.makespanSec.toFixed(1)} | ${r.throughputJobsPerSec} | ${speedup} | ` +
        `${r.processingMs?.p50 ?? '-'} / ${r.processingMs?.p95 ?? '-'} | ${r.queueWaitMs?.p50 ?? '-'} / ${r.queueWaitMs?.p95 ?? '-'} | ` +
        `${r.resources?.avgTotalCpuPercent ?? '-'} | ${r.failed} |`,
    );
  }
  return lines.join('\n');
}

async function main() {
  console.log('JobMesh worker-scaling benchmark', opts);
  const email = `bench_${Date.now()}@example.com`;
  ({ token } = await api('POST', '/api/auth/register', { name: 'Benchmark', email, password: 'benchmark-123' }));

  const results = [];
  for (const n of opts.workers) results.push(await runOnce(n));

  const markdown = toMarkdown(results);
  console.log(`\n${markdown}\n`);

  const outDir = path.join(__dirname, 'results');
  fs.mkdirSync(outDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  fs.writeFileSync(path.join(outDir, `benchmark-${stamp}.json`), JSON.stringify({ opts, results }, null, 2));
  fs.writeFileSync(path.join(outDir, `benchmark-${stamp}.md`), `${markdown}\n`);
  console.log(`Saved results to load-tests/results/benchmark-${stamp}.{json,md}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
