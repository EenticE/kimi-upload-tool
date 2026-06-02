const fs = require('fs');
const path = require('path');
const config = require('../lib/config');
const ProgressUI = require('../lib/progress');
const { mergeChunks } = require('../lib/splitter');
const { checkUrl, downloadFile } = require('../lib/api');

async function download(signUrlPath, options) {
  if (!signUrlPath) {
    console.error('❌ 请指定 signUrl JSON 文件路径\n用法: node kimi_file.js download <signUrl.json> [选项]');
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
    if (valid) validChunks.push(c);
    else progress.log(`⚠️ 链接失效: ${c.name}`);
  }
  if (validChunks.length === 0) {
    progress.summary('下载失败', ['所有下载链接均无效，请重新 login 后重试']);
    process.exit(1);
  }
  if (validChunks.length < total) {
    progress.log(`⚠️ ${total - validChunks.length} 个链接无效，将下载 ${validChunks.length} 个`);
  }
  progress.done();

  // 2. Setup dirs + resume check
  let outputDir, downloadDir, progressFile;

  // Search for existing download dirs (resume)
  const dlBase = path.join(config.CACHE_DIR, 'downloads');
  let existingDlDir = null;
  if (fs.existsSync(dlBase)) {
    const candidates = fs.readdirSync(dlBase)
      .filter(d => d.startsWith(sourceFile || 'download'))
      .map(d => path.join(dlBase, d))
      .sort().reverse();
    for (const dir of candidates) {
      if (fs.existsSync(path.join(dir, 'progress.json'))) { existingDlDir = dir; break; }
    }
  }

  if (existingDlDir) {
    outputDir = existingDlDir;
    downloadDir = path.join(outputDir, 'temp');
    progressFile = path.join(outputDir, 'progress.json');
    fs.mkdirSync(downloadDir, { recursive: true });
  } else {
    outputDir = config.downloadCacheDir(sourceFile || 'download');
    downloadDir = path.join(outputDir, 'temp');
    progressFile = path.join(outputDir, 'progress.json');
    fs.mkdirSync(downloadDir, { recursive: true });
  }

  let chunkState = {};
  if (existingDlDir && fs.existsSync(progressFile)) {
    const saved = JSON.parse(fs.readFileSync(progressFile, 'utf-8'));
    const doneCount = Object.values(saved.chunks).filter(c => c.status === 'done').length;
    const firstPending = Object.entries(saved.chunks).find(([, s]) => s.status !== 'done');
    progress.log(`📋 发现下载断点: ${doneCount}/${total} 已完成，跳过`);
    if (firstPending) progress.log(`📋 从 ${firstPending[0]} 开始续传`);
    chunkState = saved.chunks;
  } else {
    for (const c of validChunks) chunkState[c.name] = { status: 'pending', size: c.size };
  }
  fs.writeFileSync(progressFile, JSON.stringify(
    { sourceFile, totalChunks: total, chunks: chunkState, createdAt: new Date().toISOString() }, null, 2
  ));

  // 3. Producer-consumer download
  progress.setStage('下载中', '📥');
  const concurrency = options.concurrency || config.DEFAULT_CONCURRENCY;
  let allDone = Object.values(chunkState).filter(c => c.status === 'done').length;
  let startTime = Date.now();
  let lastProgressUpdate = 0;
  const results = [];

  // Collect already-done chunks from local files
  for (const c of validChunks) {
    if (chunkState[c.name]?.status === 'done') {
      const localName = c.name.replace(/\.txt$/, '');
      const localPath = path.join(downloadDir, localName);
      if (fs.existsSync(localPath)) {
        const bytes = fs.statSync(localPath).size;
        results.push({ ...c, localPath, bytes });
      }
    }
  }

  const pending = validChunks.filter(c => chunkState[c.name]?.status !== 'done');

  async function downloadOne(chunk) {
    const localName = chunk.name.replace(/\.txt$/, '');
    const localPath = path.join(downloadDir, localName);

    if (fs.existsSync(localPath) && chunk.size > 0) {
      const existingSize = fs.statSync(localPath).size;
      if (Math.abs(existingSize - chunk.size) < 1024) {
        // Already downloaded locally, count as done
        const saved = JSON.parse(fs.readFileSync(progressFile, 'utf-8'));
        saved.chunks[chunk.name] = { status: 'done', size: chunk.size };
        fs.writeFileSync(progressFile, JSON.stringify(saved, null, 2));
        return { ...chunk, localPath, bytes: existingSize };
      }
    }

    try {
      const bytes = await downloadFile(chunk.signUrl, localPath);
      const saved = JSON.parse(fs.readFileSync(progressFile, 'utf-8'));
      saved.chunks[chunk.name] = { status: 'done', size: chunk.size };
      fs.writeFileSync(progressFile, JSON.stringify(saved, null, 2));
      return { ...chunk, localPath, bytes };
    } catch (e) {
      progress.log(`❌ 下载失败: ${chunk.name} - ${e.message}`);
      return null;
    }
  }

  const queue = [...pending];
  let active = 0;
  await new Promise(resolve => {
    function next() {
      while (active < concurrency && queue.length > 0) {
        const chunk = queue.shift();
        active++;
        downloadOne(chunk).then(r => {
          active--;
          if (r) { results.push(r); allDone++; }
          const now = Date.now();
          if (now - lastProgressUpdate > 200 || allDone === total || queue.length + active === 0) {
            lastProgressUpdate = now;
            const pct = (allDone / total) * 100;
            const elapsed = (now - startTime) / 1000;
            const totalBytes = validChunks.reduce((s, c) => s + (c.size || 0), 0);
            const bytesDone = results.reduce((s, r) => s + r.bytes, 0);
            const speed = elapsed > 0 ? (bytesDone / 1024 / 1024 / elapsed) : 0;
            const remaining = totalBytes - bytesDone;
            const eta = speed > 0 ? Math.round(remaining / 1024 / 1024 / speed) : '?';
            progress.update(pct, `${allDone} / ${total}  (${Math.round(pct)}%)`, `速度: ${speed.toFixed(1)} MB/s  预计剩余: ${eta}s`);
          }
          next();
        });
      }
      if (active === 0 && queue.length === 0) resolve();
    }
    next();
  });

  progress.done();
  if (results.length === 0 && allDone === 0) {
    progress.summary('下载失败', ['所有分片下载失败']);
    process.exit(1);
  }

  // Sort results by chunk index to maintain file order
  results.sort((a, b) => {
    const aIdx = parseInt(a.name.match(/\.(\d+)\.txt$/)?.[1] || '0');
    const bIdx = parseInt(b.name.match(/\.(\d+)\.txt$/)?.[1] || '0');
    return aIdx - bIdx;
  });

  // 4. Merge
  progress.setStage('合并中', '🔗');
  const outputPath = options.output || path.join(process.cwd(), sourceFile || 'restored_file');
  await mergeChunks(results, outputPath, progress);

  // 5. Verify
  const outputSize = fs.statSync(outputPath).size;
  const expectedSize = sourceSize || chunks.reduce((s, c) => s + (c.size || 0), 0);
  const match = Math.abs(outputSize - expectedSize) < 1024;

  // 6. Cleanup
  try { fs.rmSync(downloadDir, { recursive: true, force: true }); } catch (_) {}
  try { fs.unlinkSync(progressFile); } catch (_) {}

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