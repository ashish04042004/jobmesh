const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const NUMERIC_WORDS = new Set(['amount', 'price', 'total', 'age', 'qty', 'quantity', 'count', 'score', 'salary', 'revenue', 'cost']);
const MAX_SAMPLE_ERRORS = 10;

// Whole words only ("unit_price", "totalAmount"), so "country" is not mistaken for "count".
const isNumericColumn = (column) =>
  column
    .split(/[^a-zA-Z]+|(?<=[a-z])(?=[A-Z])/)
    .some((word) => NUMERIC_WORDS.has(word.toLowerCase()));

const round2 = (n) => Math.round(n * 100) / 100;

/**
 * Streaming validator/aggregator: rows are analysed one at a time, so memory
 * stays constant regardless of file size.
 */
class RowAnalyzer {
  constructor() {
    this.columns = null;
    this.rows = 0;
    this.validRows = 0;
    this.invalidRows = 0;
    this.invalidReasons = { missingField: 0, invalidEmail: 0, invalidNumber: 0 };
    this.numericStats = new Map();
    this.sampleErrors = [];
  }

  setColumns(columns) {
    this.columns = columns;
    for (const column of columns) {
      if (isNumericColumn(column)) {
        this.numericStats.set(column, { count: 0, sum: 0, min: Infinity, max: -Infinity });
      }
    }
  }

  add(row) {
    if (!this.columns) this.setColumns(Object.keys(row));
    this.rows += 1;
    const problems = new Set();

    for (const column of this.columns) {
      const value = row[column] == null ? '' : String(row[column]).trim();
      if (value === '') {
        problems.add('missingField');
        continue;
      }
      if (/email/i.test(column) && !EMAIL_RE.test(value)) problems.add('invalidEmail');

      const stats = this.numericStats.get(column);
      if (stats) {
        const n = Number(value);
        if (!Number.isFinite(n) || n < 0) {
          problems.add('invalidNumber');
        } else {
          stats.count += 1;
          stats.sum += n;
          stats.min = Math.min(stats.min, n);
          stats.max = Math.max(stats.max, n);
        }
      }
    }

    if (problems.size === 0) {
      this.validRows += 1;
      return;
    }
    this.invalidRows += 1;
    for (const reason of problems) this.invalidReasons[reason] += 1;
    if (this.sampleErrors.length < MAX_SAMPLE_ERRORS) {
      this.sampleErrors.push({ row: this.rows, problems: [...problems] });
    }
  }

  summary() {
    const numericColumns = {};
    for (const [column, s] of this.numericStats) {
      numericColumns[column] = s.count
        ? { count: s.count, sum: round2(s.sum), min: s.min, max: s.max, mean: round2(s.sum / s.count) }
        : { count: 0 };
    }
    return {
      rowsProcessed: this.rows,
      validRows: this.validRows,
      invalidRows: this.invalidRows,
      invalidReasons: this.invalidReasons,
      columns: this.columns ?? [],
      numericColumns,
      sampleErrors: this.sampleErrors,
    };
  }
}

module.exports = { RowAnalyzer };
