// Batch processing utility
module.exports = {
  batchSize: 5,
  concurrency: 3,
  processItems: (items) => items.map(i => i * 2)
};
