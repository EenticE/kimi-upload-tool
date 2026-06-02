const fs = require('fs');
const path = require('path');
const config = require('../lib/config');
const ProgressUI = require('../lib/progress');
const SessionManager = require('../lib/session');
const { splitFile } = require('../lib/splitter');
const { uploadFile } = require('../lib/api');

async function upload(sourcePath, options) {
  if (!sourcePath) {
    console.error('❌ 请指定源文件路径\n用法: node kimi_file.js upload <文件路径> [选项]');
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

  // 2. Check for resume
  let uploadDir, chunksDir, progressFile, signUrlFile;
  const chunkSize = options.chunkSize || config.DEFAULT_CHUNK_SIZE;
  const uploadsBase = path.join(config.CACHE_DIR, 'uploads');
  let existingDir = null;
  if (fs.existsSync(uploadsBase)) {
    const candidates = fs.readdirSync(uploadsBase)
      .filter(d => d.startsWith(sourceName))
      .map(d => path.join(uploadsBase, d))
      .sort().reverse();
    for (const dir of candidates) {
      if (fs.existsSync(path.join(dir, 'progress.json'))) { existingDir = dir; break; }
    }
  }

  // 3. Split / resume
  progress.setStage('分片中', '📦');
  let chunkNames = [], chunkStatus = {};

  if (existingDir) {
    uploadDir = existingDir;
    chunksDir = path.join(uploadDir, 'chunks');
    progressFile = path.join(uploadDir, 'progress.json');
    signUrlFile = path.join(uploadDir, config.signUrlFilename(sourceName));
    const saved = JSON.parse(fs.readFileSync(progressFile, 'utf-8'));
    const doneCount = Object.values(saved.chunks).filter(c => c.status === 'done').length;
    const firstPending = Object.entries(saved.chunks).find(([, s]) => s.status !== 'done');
    progress.log(`📋 发现断点: ${doneCount}/${saved.totalChunks} 已完成，跳过`);
    if (firstPending) progress.log(`📋 从 ${firstPending[0]} 开始续传`);
    chunkStatus = saved.chunks;
    chunkNames = Object.keys(chunkStatus);
    fs.mkdirSync(chunksDir, { recursive: true });

    // Check if missing chunks need to be re-created
    const missingChunks = Object.entries(saved.chunks)
      .filter(([, s]) => s.status !== 'done')
      .some(([name]) => !fs.existsSync(path.join(chunksDir, name)));
    if (missingChunks) {
      progress.log(`📋 分片文件缺失，自动重新分片...`);
      await splitFile(sourcePath, chunkSize, chunksDir, progress);
    }
    await new Promise(r => setTimeout(r, 1000));
  } else {
    uploadDir = config.uploadCacheDir(sourceName);
    chunksDir = path.join(uploadDir, 'chunks');
    progressFile = path.join(uploadDir, 'progress.json');
    signUrlFile = path.join(uploadDir, config.signUrlFilename(sourceName));
    fs.mkdirSync(chunksDir, { recursive: true });
    const splitResult = await splitFile(sourcePath, chunkSize, chunksDir, progress);
    chunkNames = splitResult.map(c => c.name);
    for (const c of splitResult) chunkStatus[c.name] = { status: 'pending', size: c.size };
    fs.writeFileSync(progressFile, JSON.stringify(
      { sourceFile: sourceName, totalChunks: chunkNames.length, chunks: chunkStatus, createdAt: new Date().toISOString() }, null, 2
    ));
  }

  // 4. Producer-consumer upload
  progress.setStage('上传中', '☁️');
  const total = chunkNames.length;
  const concurrency = options.concurrency || config.DEFAULT_CONCURRENCY;
  const retry = options.retry || config.DEFAULT_RETRY;
  let allDone = Object.values(chunkStatus).filter(c => c.status === 'done').length;
  let startTime = Date.now();
  let lastProgressUpdate = 0;
  const signUrlMap = {}; // name -> signUrl
  for (const n of chunkNames) {
    if (chunkStatus[n].status === 'done' && chunkStatus[n].signUrl) signUrlMap[n] = chunkStatus[n].signUrl;
  }
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

  // Producer-consumer queue
  const queue = [...pending];
  let active = 0;
  await new Promise(resolve => {
    function next() {
      while (active < concurrency && queue.length > 0) {
        const chunk = queue.shift();
        active++;
        uploadOne(chunk).then(r => {
          active--;
          if (r) {
            allDone++;
            signUrlMap[r.name] = r.signUrl;
            const now = Date.now();
            if (now - lastProgressUpdate > 200 || allDone === total) {
              lastProgressUpdate = now;
              const pct = (allDone / total) * 100;
              const elapsed = (now - startTime) / 1000;
              const speed = elapsed > 0 ? (allDone * chunkSize / 1024 / 1024 / elapsed) : 0;
              const eta = speed > 0 ? Math.round((total - allDone) * chunkSize / 1024 / 1024 / speed) : '?';
              progress.update(pct, `${allDone} / ${total}  (${Math.round(pct)}%)`, `速度: ${speed.toFixed(1)} MB/s  预计剩余: ${eta}s`);
            }
          }
          next();
        });
      }
      if (active === 0 && queue.length === 0) resolve();
    }
    next();
  });

  progress.done();
  if (allDone === 0) { progress.summary('上传失败', ['所有分片上传失败']); process.exit(1); }

  // 5. Save signUrl JSON
  const allChunks = chunkNames.map(n => ({
    name: n,
    size: chunkStatus[n]?.size || 0,
    signUrl: signUrlMap[n] || '',
  }));
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