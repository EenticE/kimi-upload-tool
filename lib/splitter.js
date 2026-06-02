const fs = require('fs');
const path = require('path');

/**
 * Split a file into chunks of max chunkSize bytes.
 * Each chunk gets .txt suffix.
 * Returns chunk info array: [{name, size, path}]
 */
async function splitFile(sourcePath, chunkSize, chunksDir, progressUI) {
  const sourceSize = fs.statSync(sourcePath).size;
  const totalChunks = Math.ceil(sourceSize / chunkSize);
  const padLen = String(totalChunks).length;

  fs.mkdirSync(chunksDir, { recursive: true });

  const chunks = [];
  const srcName = path.basename(sourcePath, path.extname(sourcePath));
  const readStream = fs.createReadStream(sourcePath, { highWaterMark: 1024 * 1024 });
  let chunkIndex = 0;
  let currentSize = 0;
  let currentWriteStream = null;
  let resolvedBytes = 0;

  return new Promise((resolve, reject) => {
    readStream.on('data', chunk => {
      let offset = 0;
      while (offset < chunk.length) {
        if (!currentWriteStream) {
          chunkIndex++;
          const suffix = String(chunkIndex).padStart(padLen, '0');
          const chunkName = `${srcName}.${suffix}.txt`;
          const chunkPath = path.join(chunksDir, chunkName);
          currentWriteStream = fs.createWriteStream(chunkPath);
          currentSize = 0;
          chunks.push({ name: chunkName, size: 0, path: chunkPath });
        }

        const remaining = chunkSize - currentSize;
        const toWrite = Math.min(remaining, chunk.length - offset);
        currentWriteStream.write(chunk.slice(offset, offset + toWrite));
        currentSize += toWrite;
        offset += toWrite;
        resolvedBytes += toWrite;

        const pct = (resolvedBytes / sourceSize) * 100;
        const mbDone = (resolvedBytes / 1024 / 1024).toFixed(1);
        const mbTotal = (sourceSize / 1024 / 1024).toFixed(1);
        progressUI.update(pct, `${mbDone} MB / ${mbTotal} MB  (${Math.round(pct)}%)`);

        if (currentSize >= chunkSize) {
          currentWriteStream.end();
          chunks[chunks.length - 1].size = currentSize;
          currentWriteStream = null;
        }
      }
    });

    readStream.on('end', () => {
      if (currentWriteStream) {
        currentWriteStream.end();
        chunks[chunks.length - 1].size = currentSize;
      }
      progressUI.done();
      resolve(chunks);
    });

    readStream.on('error', reject);
  });
}

/**
 * Merge chunks back to original file.
 * chunks: [{name, size, localPath}]
 */
async function mergeChunks(chunks, outputPath, progressUI) {
  const writeStream = fs.createWriteStream(outputPath);
  let totalBytes = 0;
  const totalSize = chunks.reduce((sum, c) => sum + (c.size || 0), 0);

  for (let i = 0; i < chunks.length; i++) {
    const chunkPath = chunks[i].localPath || chunks[i].path;
    const readStream = fs.createReadStream(chunkPath);
    for await (const data of readStream) {
      writeStream.write(data);
      totalBytes += data.length;
      const pct = (totalBytes / totalSize) * 100;
      const mbDone = (totalBytes / 1024 / 1024).toFixed(1);
      const mbTotal = (totalSize / 1024 / 1024).toFixed(1);
      progressUI.update(pct, `${chunks[i].name}  ${mbDone} MB / ${mbTotal} MB`);
    }
  }

  writeStream.end();
  return new Promise((resolve, reject) => {
    writeStream.on('finish', () => { progressUI.done(); resolve(); });
    writeStream.on('error', reject);
  });
}

module.exports = { splitFile, mergeChunks };