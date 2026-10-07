const { setImmediate: yieldToEventLoop } = require('node:timers/promises');
const { FILE_CATEGORY } = require('@jobmesh/shared');
const { createRandom } = require('../utils/random');

const CHUNK_SIZE = 20_000;
const REGIONS = ['North America', 'Europe', 'Asia Pacific', 'Latin America', 'Middle East & Africa'];
// Prices in cents so revenue sums stay exact.
const PRODUCTS = [
  { name: 'Laptop Pro 14', category: 'Electronics', priceCents: 129_900 },
  { name: 'Noise-Cancelling Headphones', category: 'Electronics', priceCents: 24_900 },
  { name: '4K Monitor', category: 'Electronics', priceCents: 39_900 },
  { name: 'Mechanical Keyboard', category: 'Accessories', priceCents: 8_900 },
  { name: 'Wireless Mouse', category: 'Accessories', priceCents: 2_900 },
  { name: 'USB-C Dock', category: 'Accessories', priceCents: 14_900 },
  { name: 'Standing Desk', category: 'Furniture', priceCents: 49_900 },
  { name: 'Ergonomic Chair', category: 'Furniture', priceCents: 34_900 },
  { name: 'Cloud Storage (1 yr)', category: 'Services', priceCents: 9_900 },
  { name: 'Extended Warranty', category: 'Services', priceCents: 4_900 },
];

const dollars = (cents) => Math.round(cents) / 100;
const addTo = (map, key, cents) => map.set(key, (map.get(key) ?? 0) + cents);
const ranked = (map) =>
  [...map.entries()].sort((a, b) => b[1] - a[1]).map(([name, cents]) => ({ name, revenue: dollars(cents) }));

async function processReport(job, ctx) {
  const startedAt = Date.now();
  const { month, records = 100_000, reportType = 'MONTHLY_SALES' } = job.payload;
  const [year, monthIndex] = month.split('-').map(Number);
  const daysInMonth = new Date(Date.UTC(year, monthIndex, 0)).getUTCDate();

  // Seeded by owner + month: the "warehouse data" for a month is stable.
  const rng = createRandom(`${job.userId}:${month}`);
  const daily = new Array(daysInMonth).fill(0);
  const byRegion = new Map();
  const byCategory = new Map();
  const byProduct = new Map();
  let revenueCents = 0;
  let unitsSold = 0;

  for (let i = 0; i < records; i += 1) {
    const product = rng.pick(PRODUCTS);
    const quantity = rng.int(1, 5);
    const discount = rng.next() < 0.2 ? 0.1 : 0;
    const cents = Math.round(product.priceCents * quantity * (1 - discount));

    revenueCents += cents;
    unitsSold += quantity;
    daily[rng.int(0, daysInMonth - 1)] += cents;
    addTo(byRegion, rng.pick(REGIONS), cents);
    addTo(byCategory, product.category, cents);
    addTo(byProduct, product.name, cents);

    if ((i + 1) % CHUNK_SIZE === 0) {
      await yieldToEventLoop();
      await ctx.throwIfCancelled();
      await ctx.reportProgress(((i + 1) / records) * 90);
    }
  }

  const dailyRevenue = daily.map((cents, d) => ({
    date: `${month}-${String(d + 1).padStart(2, '0')}`,
    revenue: dollars(cents),
  }));
  const byRevenue = [...dailyRevenue].sort((a, b) => b.revenue - a.revenue);

  const summary = {
    reportType,
    month,
    orders: records,
    unitsSold,
    totalRevenue: dollars(revenueCents),
    averageOrderValue: dollars(revenueCents / records),
    revenueByRegion: ranked(byRegion),
    revenueByCategory: ranked(byCategory),
    topProducts: ranked(byProduct).slice(0, 5),
    bestDay: byRevenue[0],
    worstDay: byRevenue.at(-1),
  };

  const csv = ['date,revenue', ...dailyRevenue.map((d) => `${d.date},${d.revenue.toFixed(2)}`)].join('\n');
  const [reportFile, csvFile] = await Promise.all([
    ctx.writeArtifact(
      `sales-report-${month}.json`,
      Buffer.from(JSON.stringify({ ...summary, dailyRevenue }, null, 2)),
      'application/json',
      FILE_CATEGORY.JSON,
    ),
    ctx.writeArtifact(`daily-revenue-${month}.csv`, Buffer.from(csv), 'text/csv', FILE_CATEGORY.CSV),
  ]);

  return {
    ...summary,
    artifacts: [reportFile, csvFile].map((f) => ({ fileId: f.id, name: f.originalName, downloadUrl: f.downloadUrl })),
    processingTimeMs: Date.now() - startedAt,
  };
}

module.exports = { processReport };
