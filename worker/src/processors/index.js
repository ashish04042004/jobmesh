const { JOB_TYPES } = require('@jobmesh/shared');
const { processCsv } = require('./csvProcessor');
const { processImage } = require('./imageProcessor');
const { processReport } = require('./reportProcessor');

module.exports = {
  [JOB_TYPES.CSV_PROCESSING]: processCsv,
  [JOB_TYPES.IMAGE_PROCESSING]: processImage,
  [JOB_TYPES.REPORT_GENERATION]: processReport,
};
