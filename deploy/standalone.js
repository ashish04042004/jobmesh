// Runs the API and an embedded worker pool in a single container, for hosts
// that only offer one free service (e.g. Render's free web service).
const { spawn } = require('node:child_process');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const workerCount = Math.max(1, Number.parseInt(process.env.EMBEDDED_WORKERS ?? '1', 10) || 1);
const children = new Set();
let exitCode = 0;
let stopping = false;

function start(name, script) {
  const child = spawn(process.execPath, [path.join(root, script)], { stdio: 'inherit', env: process.env });
  children.add(child);
  child.on('exit', (code, signal) => {
    children.delete(child);
    if (!stopping) {
      console.error(`${name} exited unexpectedly (code=${code}, signal=${signal}); stopping container`);
      exitCode = code || 1;
      stop();
    }
    if (children.size === 0) process.exit(exitCode);
  });
}

function stop() {
  if (stopping) return;
  stopping = true;
  for (const child of children) child.kill('SIGTERM');
}

process.on('SIGTERM', stop);
process.on('SIGINT', stop);

start('api', 'backend/src/server.js');
for (let i = 1; i <= workerCount; i += 1) start(`worker-${i}`, 'worker/src/worker.js');
