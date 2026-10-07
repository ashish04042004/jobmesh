const { z } = require('zod');
const { JOB_TYPES, JOB_STATUS, PRIORITY } = require('@jobmesh/shared');

const objectId = z.string().regex(/^[a-f\d]{24}$/i, 'Must be a 24-character hex id');
const int = (min, max) => z.number().int().min(min).max(max);

// Fault-injection knobs used to exercise retries, backoff and cancellation.
const simulate = z
  .object({
    failAttempts: int(0, 10).optional(),
    delayMs: int(0, 120_000).optional(),
  })
  .strict()
  .optional();

const exactlyOneInput = (p) => Boolean(p.fileId) !== Boolean(p.synthetic);
const exactlyOneInputMessage = { message: 'Provide exactly one of fileId or synthetic', path: ['fileId'] };

const csvPayload = z
  .object({
    fileId: objectId.optional(),
    synthetic: z
      .object({
        rows: int(1, 1_000_000),
        invalidRate: z.number().min(0).max(1).default(0.01),
      })
      .strict()
      .optional(),
    simulate,
  })
  .strict()
  .refine(exactlyOneInput, exactlyOneInputMessage);

const imagePayload = z
  .object({
    fileId: objectId.optional(),
    synthetic: z.object({ width: int(16, 4096), height: int(16, 4096) }).strict().optional(),
    resize: z
      .object({ width: int(1, 4096), height: int(1, 4096).optional() })
      .strict()
      .default({ width: 1024 }),
    thumbnailSize: int(16, 512).default(200),
    quality: int(1, 100).default(80),
    format: z.enum(['webp', 'jpeg', 'png']).default('webp'),
    simulate,
  })
  .strict()
  .refine(exactlyOneInput, exactlyOneInputMessage);

const reportPayload = z
  .object({
    reportType: z.enum(['MONTHLY_SALES']).default('MONTHLY_SALES'),
    month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Must be YYYY-MM'),
    records: int(1, 2_000_000).default(100_000),
    simulate,
  })
  .strict();

const priority = z.enum(Object.keys(PRIORITY)).default('MEDIUM');
const batchId = z.string().regex(/^[\w-]{1,64}$/, 'Use 1-64 letters, digits, "_" or "-"');

const createJobSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal(JOB_TYPES.CSV_PROCESSING), priority, batchId: batchId.optional(), payload: csvPayload }),
  z.object({ type: z.literal(JOB_TYPES.IMAGE_PROCESSING), priority, batchId: batchId.optional(), payload: imagePayload }),
  z.object({ type: z.literal(JOB_TYPES.REPORT_GENERATION), priority, batchId: batchId.optional(), payload: reportPayload }),
]);

const bulkCreateSchema = z.object({
  batchId: batchId.optional(),
  jobs: z.array(createJobSchema).min(1).max(100),
});

const listJobsQuery = z.object({
  status: z.enum(Object.values(JOB_STATUS)).optional(),
  type: z.enum(Object.values(JOB_TYPES)).optional(),
  batchId: batchId.optional(),
  cursor: objectId.optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

const statsQuery = z.object({ batchId: batchId.optional() });

const idParams = z.object({ id: objectId });

const idempotencyHeaders = z
  .object({ 'idempotency-key': z.string().regex(/^[\w.:-]{1,128}$/, 'Invalid Idempotency-Key').optional() })
  .passthrough();

const registerSchema = z.object({
  name: z.string().trim().min(1).max(100),
  email: z.string().trim().toLowerCase().email().max(254),
  password: z.string().min(8).max(128),
});

const loginSchema = z.object({
  email: z.string().trim().toLowerCase().email(),
  password: z.string().min(1).max(128),
});

module.exports = {
  createJobSchema,
  bulkCreateSchema,
  listJobsQuery,
  statsQuery,
  idParams,
  idempotencyHeaders,
  registerSchema,
  loginSchema,
};
