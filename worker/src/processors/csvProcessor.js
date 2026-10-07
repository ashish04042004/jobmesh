const fs = require('node:fs');
const { setImmediate: yieldToEventLoop } = require('node:timers/promises');
const { parse } = require('csv-parse');
const { UnrecoverableError } = require('bullmq');
const { RowAnalyzer } = require('./csv/rowAnalyzer');
const { createRandom } = require('../utils/random');

const CHUNK_SIZE = 5_000;
const FIRST_NAMES = ['Asha', 'Ben', 'Chen', 'Diya', 'Elena', 'Farhan', 'Grace', 'Hiro', 'Isla', 'Jonas'];
const COUNTRIES = ['IN', 'US', 'DE', 'JP', 'BR', 'GB', 'SG', 'CA'];

function syntheticRow(i, rng, invalidRate) {
  const name = rng.pick(FIRST_NAMES);
  const row = {
    id: String(i + 1),
    name,
    email: `${name.toLowerCase()}.${i}@example.com`,
    age: String(rng.int(18, 80)),
    country: rng.pick(COUNTRIES),
    amount: (rng.next() * 1000).toFixed(2),
  };
  if (rng.next() < invalidRate) {
    const corruption = rng.int(0, 2);
    if (corruption === 0) row.name = '';
    else if (corruption === 1) row.email = 'not-an-email';
    else row.amount = '-42';
  }
  return row;
}

async function analyzeSynthetic({ rows, invalidRate = 0.01 }, analyzer, ctx) {
  const rng = createRandom(ctx.jobId);
  for (let i = 0; i < rows; i += 1) {
    analyzer.add(syntheticRow(i, rng, invalidRate));
    if ((i + 1) % CHUNK_SIZE === 0) {
      // Yield so BullMQ can renew the job lock while CPU-bound work runs.
      await yieldToEventLoop();
      await ctx.throwIfCancelled();
      await ctx.reportProgress(((i + 1) / rows) * 100);
    }
  }
}

async function analyzeFile(file, analyzer, ctx) {
  const input = fs.createReadStream(file.absolutePath);
  const parser = input.pipe(
    parse({ columns: true, bom: true, trim: true, skip_empty_lines: true, relax_column_count: true }),
  );
  let count = 0;
  try {
    for await (const record of parser) {
      analyzer.add(record);
      count += 1;
      if (count % CHUNK_SIZE === 0) {
        await ctx.throwIfCancelled();
        await ctx.reportProgress((input.bytesRead / Math.max(file.size, 1)) * 100);
      }
    }
  } catch (err) {
    if (typeof err?.code === 'string' && err.code.startsWith('CSV_')) {
      throw new UnrecoverableError(`Malformed CSV: ${err.message}`);
    }
    throw err;
  } finally {
    input.destroy();
  }
}

async function processCsv(job, ctx) {
  const startedAt = Date.now();
  const analyzer = new RowAnalyzer();
  const { synthetic, fileId } = job.payload;

  let source;
  if (synthetic) {
    await analyzeSynthetic(synthetic, analyzer, ctx);
    source = { kind: 'synthetic', rows: synthetic.rows };
  } else {
    const file = await ctx.loadInputFile(fileId);
    await analyzeFile(file, analyzer, ctx);
    source = { kind: 'file', fileId, name: file.originalName, bytes: file.size };
  }

  return { source, ...analyzer.summary(), processingTimeMs: Date.now() - startedAt };
}

module.exports = { processCsv };
