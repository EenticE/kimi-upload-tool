const fs = require('fs');
const path = require('path');
const config = require('../lib/config');
const ProgressUI = require('../lib/progress');
const SessionManager = require('../lib/session');
const { splitFile } = require('../lib/splitter');
const { uploadFile } = require('../lib/api');

async function upload(sourcePath, options) {
  if (!sourcePath) {
    console.error('❌ 请指定源文件路径');
    console.error('用法: node kimi_file.js upload <文件路径> [选项]');
    process.exit(1);
  }
  if (!fs.existsSync(sourcePath)) {
    console.error(`❌ 文件不存在: ${sourcePath}`);
    process.exit(1);
  }

  const progress = new ProgressUI();
  const sourceSize = fs.statSync(sourcePath).size;
  const sourceName = path.basename(sourcePath);

  // 1. Get token
  let token = SessionManager.loadSavedToken();
  if (token) {
    progress.setStage('认证', '🔑');
    progress.update(100, '使用已保存的 token');
    progress.done();
  } else {
    const session = new SessionManager(options.sessionDir);
    await session.ensureLoggedIn(progress);
    token = session.getToken();
    await session.close();
  }
  if (!token) { progress.summary('上传失败', ['无法获取认证 token']); process.exit(1); }

  // 2. Check for existing upload dirs (resume)
  let uploadDir;
  let chunksDir;
  let progressFile;
  let signUrlFile;
  const chunkSize = options.chunkSize || config.DEFAULT_CHUNK_SIZE;

  const uploadsBase = path.join(config.CACHE_DIR, 'uploads');
  let existingDir = null;
  if (fs.existsSync(uploadsBase)) {
    const candidates = fs.readdirSync(uploadsBase)
      .filter(d => d.startsWith(sourceName))
      .map(d => path.join(uploadsBase, d))
      .sort()
      .reverse();
    for (const dir of candidates) {
      if (fs.existsSync(path.join(dir, 'progress.json'))) {
        existingDir = dir;
        break;
      }
    }
  }

  // 3. Setup paths and split/resume
  progress.setStage('分片中', '📦');
  let chunkNames = [];
  let chunkStatus = {};

  if (existingDir) {
    // Resume: reuse existing dir
    uploadDir = existingDir;
    chunksDir = path.join(uploadDir, 'chunks');
    progressFile = path.join(uploadDir, 'progress.json');
    signUrlFile = path.join(uploadDir, config.signUrlFilename(sourceName));

    const saved = JSON.parse(fs.readFileSync(progressFile, 'utf-8'));
    const doneCount = Object.values(saved.chunks).filter(c => c.status === 'done').length;
    progress.log(`📋 发现断点，${doneCount}/${saved.totalChunks} 已上传`);
    chunkStatus = saved.chunks;
    chunkNames = Object.keys(chunkStatus);

    // Ensure chunks dir exists
    fs.mkdirSync(chunksDir, { recursive: true });
    await new Promise(r => setTimeout(r, 1000));
  } else {
    // Fresh upload: create new dir
    uploadDir = config.uploadCacheDir(sourceName);
    chunksDir = path.join(uploadDir, 'chunks');
    progressFile = path.join(uploadDir, 'progress.json');
    signUrlFile = path.join(uploadDir, config.signUrlFilename(sourceName));
    fs.mkdirSync(chunksDir, { recursive: true });

    const splitResult = await splitFile(sourcePath, chunkSize, chunksDir, progress);
    chunkNames = splitResult.map(c => c.name);
    for (const c of splitResult) chunkStatus[c.name] = { status: 'pending', size: c.size };
    fs.writeFileSync(
      progressFile,
      JSON.stringify({ sourceFile: sourceName, totalChunks: chunkNames.length, chunks: chunkStatus, createdAt: new Date().toISOString() }, null, 2)
    );
  }

  // 4. Upload
  progress.setStage('上传中', '☁️');
  const total = chunkNames.length;
  const concurrency = options.concurrency || config.DEFAULT_CONCURRENCY;
  const retry = options.retry || config.DEFAULT_RETRY;
  let allDone = Object.values(chunkStatus).filter(c => c.status === 'done').length;
  let startTime = Date.now();
  const uploadedUrls = chunkNames.filter(n => chunkStatus[n].status === 'done' && chunkStatus[n].signUrl).map(n => chunkStatus[n].signUrl);

  const pending = chunkNames.filter(n => chunkStatus[n].status !== 'done');

  async function uploadOne(name) {
    const chunkPath = path.join(chunksDir, name);
    if (!fs.existsSync(chunkPath)) { progress.log(`⚠️ 分片不存在: ${name}`); return null; }
    for (let attempt = 1; attempt <= retry; attempt++) {
      try {
        const result = await uploadFile(chunkPath, token);
        if (result.file?.blob?.signUrl && result.file?.id) {
          const saved = JSON.parse(fs.readFileSync(progressFile, 'utf-8'));
          saved.chunks[name] = { status: 'done', size: saved.chunks[name]?.size || 0, fileId: result.file.id, signUrl: result.file.blob.signUrl };
          fs.writeFileSync(progressFile, JSON.stringify(saved, null, 2));
          return { name, signUrl: result.file.blob.signUrl };
        }
      } catch (e) {
        if (attempt < retry) await new Promise(r => setTimeout(r, 2000 * attempt));
      }
    }
    try {
      const saved = JSON.parse(fs.readFileSync(progressFile, 'utf-8'));
      if (saved.chunks[name]) saved.chunks[name].status = 'failed';
      fs.writeFileSync(progressFile, JSON.stringify(saved, null, 2));
    } catch (_) {}
    return null;
  }

  // Batch upload
  for (let i = 0; i < pending.length; i += concurrency) {
    const batch = pending.slice(i, i + concurrency);
    const batchResults = await Promise.all(batch.map(name => uploadOne(name)));
    for (const r of batchResults) {
      if (r) {
        allDone++;
        uploadedUrls.push(r.signUrl);
        const pct = (allDone / total) * 100;
        const elapsed = (Date.now() - startTime) / 1000;
        const speed = elapsed > 0 ? (allDone * chunkSize / 1024 / 1024 / elapsed) : 0;
        const eta = speed > 0 ? Math.round((total - allDone) * chunkSize / 1024 / 1024 / speed) : '?';
        progress.update(pct, `${allDone} / ${total}  (${Math.round(pct)}%)`, `速度: ${speed.toFixed(1)} MB/s  预计剩余: ${eta}s`);
      }
    }
    const ok = batchResults.filter(Boolean).length;
    if (batchResults.length - ok > 0) progress.log(`  ⚡ 批次: ${ok} 成功, ${batchResults.length - ok} 失败`);
  }

  progress.done();

  if (allDone === 0) { progress.summary('上传失败', ['所有分片上传失败']); process.exit(1); }

  // 5. Save signUrl JSON
  const fp = JSON.parse(fs.readFileSync(progressFile, 'utf-8'));
  const allChunks = chunkNames.map(n => ({ name: n, size: fp.chunks[n]?.size || 0, signUrl: fp.chunks[n]?.signUrl || '' }));
  fs.writeFileSync(signUrlFile, JSON.stringify({ sourceFile: sourceName, sourceSize, createdAt: new Date().toISOString(), chunks: allChunks }, null, 2));

  // 6. Cleanup
  try { fs.rmSync(chunksDir, { recursive: true, force: true }); } catch (_) {}
  try { fs.unlinkSync(progressFile); } catch (_) {}

  const finalDone = allChunks.filter(c => c.signUrl).length;
  progress.summary('上传完成', [
    `源文件: ${sourceName} (${(sourceSize / 1024 / 1024).toFixed(1)} MB)`,
    `分片: ${finalDone} / ${total}`,
    `耗时: ${((Date.now() - startTime) / 1000).toFixed(0)} 秒`,
    `signUrl 文件: ${signUrlFile}`,
  ]);
}

module.exports = upload;