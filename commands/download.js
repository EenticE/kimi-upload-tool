const fs = require('fs');
const path = require('path');
const config = require('../lib/config');
const ProgressUI = require('../lib/progress');
const { mergeChunks } = require('../lib/splitter');
const { checkUrl, downloadFile } = require('../lib/api');

async function download(signUrlPath, options) {
  if (!signUrlPath) {
    console.error('❌ 请指定 signUrl JSON 文件路径');
    console.error('用法: node kimi_file.js download <signUrl.json> [选项]');
    process.exit(1);
  }
  if (!fs.existsSync(signUrlPath)) {
    console.error(`❌ 文件不存在: ${signUrlPath}`);
    process.exit(1);
  }

  const progress = new ProgressUI();
  const manifest = JSON.parse(fs.readFileSync(signUrlPath, 'utf-8'));
  const { sourceFile, sourceSize, chunks } = manifest;
  const total = chunks.length;

  // 1. Verify signUrls
  progress.setStage('验证链接', '🔍');
  const validChunks = [];
  for (let i = 0; i < chunks.length; i++) {
    const c = chunks[i];
    progress.update(((i + 1) / total) * 100, `${i + 1} / ${total}`);
    const valid = await checkUrl(c.signUrl);
    if (valid) {
      validChunks.push(c);
    } else {
      progress.log(`⚠️ 链接失效: ${c.name}`);
    }
  }

  if (validChunks.length === 0) {
    progress.summary('下载失败', ['所有下载链接均无效，请重新 login 后重试']);
    process.exit(1);
  }
  if (validChunks.length < total) {
    progress.log(`⚠️ ${total - validChunks.length} 个链接无效，将下载 ${validChunks.length} 个`);
  }
  progress.done();

  // 2. Prepare download directories
  const outputDir = config.downloadCacheDir(sourceFile || 'download');
  const downloadDir = path.join(outputDir, 'temp');
  fs.mkdirSync(downloadDir, { recursive: true });

  // 3. Download chunks with concurrency
  progress.setStage('下载中', '📥');
  const concurrency = options.concurrency || config.DEFAULT_CONCURRENCY;
  let done = 0;
  let startTime = Date.now();
  const results = [];

  async function downloadOne(chunk) {
    // Strip .txt suffix for local storage
    const localName = chunk.name.replace(/\.txt$/, '');
    const localPath = path.join(downloadDir, localName);
    try {
      const bytes = await downloadFile(chunk.signUrl, localPath);
      done++;
      const pct = (done / total) * 100;
      const elapsed = (Date.now() - startTime) / 1000;
      const totalBytes = validChunks.reduce((s, c) => s + (c.size || 0), 0);
      const bytesDone = results.reduce((s, r) => s + r.bytes, 0) + bytes;
      const speed = elapsed > 0 ? (bytesDone / 1024 / 1024 / elapsed) : 0;
      const remainingBytes = totalBytes - bytesDone;
      const eta = speed > 0 ? Math.round(remainingBytes / 1024 / 1024 / speed) : '?';
      progress.update(
        pct,
        `${done} / ${total}  (${Math.round(pct)}%)  |  ${localName}`,
        `速度: ${speed.toFixed(1)} MB/s  预计剩余: ${eta}s`
      );
      return { ...chunk, localPath, bytes };
    } catch (e) {
      progress.log(`❌ 下载失败: ${chunk.name} - ${e.message}`);
      return null;
    }
  }

  // Concurrency queue
  const dlQueue = [...validChunks];
  let dlActive = 0;

  await new Promise(resolve => {
    function next() {
      while (dlActive < concurrency && dlQueue.length > 0) {
        const chunk = dlQueue.shift();
        dlActive++;
        downloadOne(chunk).then(r => {
          dlActive--;
          if (r) results.push(r);
          next();
        });
      }
      if (dlActive === 0 && dlQueue.length === 0) resolve();
    }
    next();
  });

  progress.done();

  if (results.length === 0) {
    progress.summary('下载失败', ['所有分片下载失败']);
    process.exit(1);
  }

  // 4. Merge chunks
  progress.setStage('合并中', '🔗');
  const outputPath = options.output || path.join(process.cwd(), sourceFile || 'restored_file');
  await mergeChunks(results, outputPath, progress);

  // 5. Verify file size
  const outputSize = fs.statSync(outputPath).size;
  const expectedSize = sourceSize || chunks.reduce((s, c) => s + (c.size || 0), 0);
  const match = Math.abs(outputSize - expectedSize) < 1024;

  // 6. Cleanup temp files
  try {
    fs.rmSync(downloadDir, { recursive: true, force: true });
  } catch (_) {}

  progress.summary('下载完成', [
    `源文件: ${sourceFile}`,
    `大小: ${(outputSize / 1024 / 1024).toFixed(1)} MB`,
    `分片: ${results.length} 个`,
    `耗时: ${((Date.now() - startTime) / 1000).toFixed(0)} 秒`,
    `完整性: ${match ? '✅ 一致' : '⚠️ 不一致 (期望 ' + (expectedSize / 1024 / 1024).toFixed(1) + ' MB, 实际 ' + (outputSize / 1024 / 1024).toFixed(1) + ' MB)'}`,
    `输出: ${outputPath}`,
  ]);
}

module.exports = download;