const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const sharp = require('sharp');
const { UnrecoverableError } = require('bullmq');
const { processCsv } = require('../src/processors/csvProcessor');
const { processReport } = require('../src/processors/reportProcessor');
const { processImage } = require('../src/processors/imageProcessor');
const { fakeContext } = require('./helpers');

const withoutTiming = ({ processingTimeMs, ...rest }) => rest;

function tempFile(name, content) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jobmesh-proc-'));
  const file = path.join(dir, name);
  fs.writeFileSync(file, content);
  return { absolutePath: file, size: fs.statSync(file).size, originalName: name };
}

describe('CSV processor', () => {
  it('analyses synthetic rows deterministically per job id', async () => {
    const job = { payload: { synthetic: { rows: 12_000, invalidRate: 0.05 } } };
    const a = await processCsv(job, fakeContext({ jobId: 'job-a' }));
    const b = await processCsv(job, fakeContext({ jobId: 'job-a' }));

    expect(withoutTiming(a)).toEqual(withoutTiming(b));
    expect(a.rowsProcessed).toBe(12_000);
    expect(a.validRows + a.invalidRows).toBe(12_000);
    expect(a.invalidRows / a.rowsProcessed).toBeGreaterThan(0.03);
    expect(a.invalidRows / a.rowsProcessed).toBeLessThan(0.07);
    expect(a.columns).toEqual(['id', 'name', 'email', 'age', 'country', 'amount']);
  });

  it('reports progress and yields between chunks', async () => {
    const ctx = fakeContext();
    await processCsv({ payload: { synthetic: { rows: 20_000, invalidRate: 0 } } }, ctx);
    expect(ctx.reportProgress).toHaveBeenCalledTimes(4);
    expect(ctx.throwIfCancelled).toHaveBeenCalledTimes(4);
  });

  it('streams an uploaded file and validates each row', async () => {
    const file = tempFile(
      'customers.csv',
      [
        'id,name,email,amount',
        '1,Asha,asha@example.com,10.50',
        '2,,ben@example.com,20',
        '3,Chen,not-an-email,30',
        '4,Diya,diya@example.com,-5',
        '5,Elena,elena@example.com,40',
      ].join('\n'),
    );
    const ctx = fakeContext({ loadInputFile: jest.fn(async () => file) });
    const result = await processCsv({ payload: { fileId: 'f1' } }, ctx);

    expect(result).toMatchObject({
      rowsProcessed: 5,
      validRows: 2,
      invalidRows: 3,
      invalidReasons: { missingField: 1, invalidEmail: 1, invalidNumber: 1 },
      numericColumns: { amount: { count: 4, min: 10.5, max: 40 } },
      source: { kind: 'file', name: 'customers.csv' },
    });
  });

  it('treats malformed CSV as unrecoverable (retrying cannot help)', async () => {
    const file = tempFile('broken.csv', 'id,name\n1,"unterminated\n');
    const ctx = fakeContext({ loadInputFile: jest.fn(async () => file) });
    await expect(processCsv({ payload: { fileId: 'f1' } }, ctx)).rejects.toBeInstanceOf(UnrecoverableError);
  });
});

describe('Report processor', () => {
  const job = { userId: 'user-1', payload: { month: '2026-02', records: 30_000 } };

  it('aggregates a month of sales consistently and writes two artifacts', async () => {
    const ctx = fakeContext();
    const report = await processReport(job, ctx);

    const regionTotal = report.revenueByRegion.reduce((sum, r) => sum + r.revenue, 0);
    expect(regionTotal).toBeCloseTo(report.totalRevenue, 1);
    expect(report).toMatchObject({ month: '2026-02', orders: 30_000 });
    expect(report.topProducts).toHaveLength(5);
    expect(report.artifacts.map((a) => a.name)).toEqual(['sales-report-2026-02.json', 'daily-revenue-2026-02.csv']);

    const csv = ctx.writeArtifact.mock.calls[1][1].toString();
    expect(csv.split('\n')).toHaveLength(1 + 28);
  });

  it('is deterministic for the same user and month', async () => {
    const a = await processReport(job, fakeContext());
    const b = await processReport(job, fakeContext());
    expect(withoutTiming(a)).toEqual(withoutTiming(b));
  });
});

describe('Image processor', () => {
  it('resizes, compresses and thumbnails a synthetic image', async () => {
    const ctx = fakeContext();
    const result = await processImage(
      {
        payload: {
          synthetic: { width: 800, height: 600 },
          resize: { width: 400 },
          thumbnailSize: 128,
          quality: 70,
          format: 'webp',
        },
      },
      ctx,
    );

    expect(result.original).toMatchObject({ width: 800, height: 600, format: 'png' });
    expect(result.outputs.resized).toMatchObject({ width: 400, height: 300, name: 'resized.webp' });
    expect(result.outputs.thumbnail).toMatchObject({ width: 128, height: 128, name: 'thumbnail.webp' });
    expect(result.compressionRatio).toBeGreaterThan(1);

    const [, resizedBuffer] = ctx.writeArtifact.mock.calls[0];
    expect((await sharp(resizedBuffer).metadata()).format).toBe('webp');
  });

  it('rejects files that are not images as unrecoverable', async () => {
    const file = tempFile('fake.png', 'definitely not a png');
    const ctx = fakeContext({ loadInputFile: jest.fn(async () => file) });
    await expect(processImage({ payload: { fileId: 'f1' } }, ctx)).rejects.toBeInstanceOf(UnrecoverableError);
  });
});
