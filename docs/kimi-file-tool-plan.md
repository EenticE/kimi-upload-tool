# kimi_file.js Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a CLI tool (`kimi_file.js`) for uploading large files to Kimi.ai via chunked upload and downloading them back.

**Architecture:** Multi-file Node.js CLI with commands (login/upload/download). Uses cloakbrowser for session management, pure Node.js streams for file splitting/merging, and a custom TTY progress bar.

**Tech Stack:** Node.js 22, cloakbrowser, native `http`/`https` modules, `readline` for progress UI.

**Design Doc:** `docs/kimi-file-tool-design.md`

---

## File Structure

```
E:\desktop\workspace\tool\idea\
├── kimi_file.js            ← CLI entry, command dispatch
├── commands/
│   ├── login.js            ← login command
│   ├── upload.js           ← upload command
│   └── download.js         ← download command
├── lib/
│   ├── config.js           ← paths, defaults, timestamp helper
│   ├── progress.js         ← TTY progress bar + summary
│   ├── session.js          ← session check, login poll, token extract
│   ├── splitter.js         ← fs stream chunk + merge
│   └── api.js              ← HTTP upload/download/head
├── docs/
│   ├── kimi-file-tool-design.md
│   └── kimi-file-tool-plan.md
```

### Task 1: `lib/config.js` — Configuration and defaults

**Files:**
- Create: `E:\desktop\workspace\tool\idea\lib\config.js`

**Responsibility:** Central config: project root, cache dirs, default CLI options, timestamp generation.

```javascript
// lib/config.js
const path = require('path');

const PROJECT_ROOT = path.resolve(__dirname, '..');
const CACHE_DIR = path.join(PROJECT_ROOT, '.kimi_cache');
const DEFAULT_SESSION_DIR = path.join(PROJECT_ROOT, 'kimi_session');

function timestamp() {
  const d = new Date();
  return `${d.getFullYear()}${String(d.getMonth()+1).padStart(2,'0')}${String(d.getDate()).padStart(2,'0')}_${String(d.getHours()).padStart(2,'0')}${String(d.getMinutes()).padStart(2,'0')}${String(d.getSeconds()).padStart(2,'0')}`;
}

function uploadCacheDir(sourceFilename) {
  const base = path.basename(sourceFilename);
  return path.join(CACHE_DIR, 'uploads', `${base}_${timestamp()}`);
}

function downloadCacheDir(sourceName) {
  return path.join(CACHE_DIR, 'downloads', `${sourceName}_${timestamp()}`);
}

function signUrlFilename(sourceFilename) {
  const base = path.basename(sourceFilename);
  return `${base}.${timestamp()}.dl.json`;
}

module.exports = {
  KIMI_URL: 'https://www.kimi.com/?chat_enter_method=new_chat',
  UPLOAD_API: 'https://www.kimi.com/apiv2-files/file/upload',
  USER_API: 'https://www.kimi.com/api/user',
  DEFAULT_CHUNK_SIZE: 45 * 1024 * 1024, // 45MB in bytes
  DEFAULT_CONCURRENCY: 3,
  DEFAULT_RETRY: 3,
  LOGIN_TIMEOUT: 5 * 60 * 1000, // 5 min
  PROJECT_ROOT,
  CACHE_DIR,
  DEFAULT_SESSION_DIR,
  timestamp,
  uploadCacheDir,
  downloadCacheDir,
  signUrlFilename,
};
```

- [ ] **Step 1: Create `lib/config.js`** with the code above

- [ ] **Step 2: Create directory structure**

```bash
mkdir -p "E:\desktop\workspace\tool\idea\lib"
mkdir -p "E:\desktop\workspace\tool\idea\commands"
```

---

### Task 2: `lib/progress.js` — Progress bar UI

**Files:**
- Create: `E:\desktop\workspace\tool\idea\lib\progress.js`

**Responsibility:** Real-time npm-style progress display. Must handle:
- Multi-line fixed layout (stage header, progress bar, sub-line for current file, ETA)
- Non-TTY fallback to plain log
- 0.5s refresh throttle
- Summary display at end

```javascript
// lib/progress.js
const readline = require('readline');

class ProgressUI {
  constructor() {
    this.isTTY = process.stdout.isTTY;
    this.stage = '';
    this.progress = 0; // 0-100
    this.subLine = '';
    this.eta = '';
    this.startedAt = Date.now();
    this.lastRender = 0;
    this.finalLines = [];
    this.renderedCount = 0;
  }

  _render() {
    if (!this.isTTY) return;
    const now = Date.now();
    if (now - this.lastRender < 300) return;
    this.lastRender = now;

    // Build stage display: icon + stage name + bar
    const barWidth = 30;
    const filled = Math.round(this.progress / 100 * barWidth);
    const bar = '█'.repeat(filled) + '░'.repeat(barWidth - filled);
    const pct = this.progress.toFixed(0);

    const lines = [
      `${this.stageIcon} ${this.stage}:`,
      `  ${bar}  ${this.subLine}`,
      this.eta ? `  ${this.eta}` : '',
    ].filter(Boolean);

    if (this.renderedCount === 0) {
      console.log(lines.join('\n'));
      this.renderedCount = lines.length;
    } else {
      // Move cursor up and overwrite
      readline.moveCursor(process.stdout, 0, -this.renderedCount);
      readline.clearScreenDown(process.stdout);
      process.stdout.write(lines.join('\n') + '\n');
    }
  }

  setStage(stage, icon = '●') {
    this.stage = stage;
    this.stageIcon = icon;
    this.progress = 0;
    this.subLine = '';
    this.eta = '';
    this._render();
  }

  update(progress, subLine, eta) {
    this.progress = Math.min(progress, 100);
    if (subLine !== undefined) this.subLine = subLine;
    if (eta !== undefined) this.eta = eta;
    this._render();
  }

  done() {
    this.progress = 100;
    this._render();
  }

  log(msg) {
    if (this.isTTY) {
      // Clear progress area, log line, re-render
      readline.moveCursor(process.stdout, 0, -this.renderedCount);
      readline.clearScreenDown(process.stdout);
      console.log(msg);
      this.renderedCount = 1; // will re-add on next render
    } else {
      console.log(msg);
    }
  }

  summary(title, details) {
    if (this.isTTY) {
      readline.moveCursor(process.stdout, 0, -this.renderedCount);
      readline.clearScreenDown(process.stdout);
    }
    console.log(`\n✅ ${title}`);
    details.forEach(d => console.log(`   ${d}`));
    console.log();
  }
}

module.exports = ProgressUI;
```

- [ ] **Step 1: Create `lib/progress.js`** with the code above

- [ ] **Step 2: Quick manual test** — verify rendering doesn't crash

```bash
cd "E:\desktop\workspace\tool\idea" && node -e "
const P = require('./lib/progress');
const p = new P();
p.setStage('上传', '☁️');
p.update(30, '3 / 10  30%', '预计 20 秒');
setTimeout(() => { p.update(80, '8 / 10  80%', '预计 5 秒'); }, 1000);
setTimeout(() => { p.done(); p.summary('完成', ['test ok']); }, 2000);
"
```

---

### Task 3: `lib/session.js` — Session management and token extraction

**Files:**
- Create: `E:\desktop\workspace\tool\idea\lib\session.js`

**Responsibility:**
- Check existing session by attempting login detection
- Launch Playwright browser with persistent context
- Intercept `/api/user` response to detect login state
- Extract Bearer JWT token from captured API request headers
- Close browser after token capture

```javascript
// lib/session.js
const config = require('./config');

class SessionManager {
  constructor(sessionDir) {
    this.sessionDir = sessionDir || config.DEFAULT_SESSION_DIR;
    this.token = null;
    this.browser = null;
    this.page = null;
  }

  async ensureLoggedIn(progressUI) {
    progressUI.setStage('登录', '🔑');

    const { launchPersistentContext } = await import('cloakbrowser');
    this.browser = await launchPersistentContext({
      userDataDir: this.sessionDir,
      headless: false,
      args: ['--disable-blink-features=AutomationControlled'],
      viewport: { width: 1280, height: 800 },
      locale: 'zh-CN',
    });
    this.page = await this.browser.newPage();

    // Set up token capture — intercept Bearer from any API request
    this.page.on('request', req => {
      if (!this.token) {
        const auth = req.headers()['authorization'];
        if (auth && auth.startsWith('Bearer ')) {
          this.token = auth;
        }
      }
    });

    // Set up login detection — wait for /api/user 200
    let loggedIn = false;
    const loginPromise = new Promise((resolve) => {
      this.page.on('response', async resp => {
        if (resp.url().includes('/api/user') && resp.status() === 200) {
          try {
            const body = JSON.parse(await resp.text());
            if (body && body.user) {
              loggedIn = true;
              resolve(true);
            }
          } catch (e) { /* ignore parse failures */ }
        }
      });
    });

    progressUI.update(0, '正在打开 Kimi.ai...');
    await this.page.goto(config.KIMI_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await this.page.waitForTimeout(3000);

    // Check if already logged in by examining page
    const loginCheck = await this.page.evaluate(() => {
      return !document.body.innerText.includes('登录');
    });

    if (loginCheck) {
      progressUI.update(50, '检测到已有登录 session');
      // Already logged in, just wait for token
      await this.page.waitForTimeout(2000);
      if (this.token) {
        progressUI.update(100, 'token 已获取');
        progressUI.done();
        return;
      }
    }

    // Wait for login (manual or auto)
    progressUI.update(30, '等待登录...');
    const timeout = setTimeout(() => {
      if (!loggedIn) {
        progressUI.log('⚠️ 登录超时，请检查浏览器窗口');
        resolve(false);
      }
    }, config.LOGIN_TIMEOUT);

    await loginPromise;
    clearTimeout(timeout);

    if (!loggedIn) {
      progressUI.log('❌ 登录失败');
      await this.close();
      throw new Error('Login failed or timeout');
    }

    progressUI.update(100, '登录成功!');
    progressUI.done();
  }

  getToken() {
    return this.token;
  }

  async close() {
    if (this.browser) {
      try { await this.browser.close(); } catch (e) { /* ignore */ }
      this.browser = null;
      this.page = null;
    }
  }
}

module.exports = SessionManager;
```

- [ ] **Step 1: Create `lib/session.js`** with the code above

---

### Task 4: `lib/splitter.js` — Pure Node.js file splitting and merging

**Files:**
- Create: `E:\desktop\workspace\tool\idea\lib\splitter.js`

**Responsibility:** Split a file into equal-sized chunks using `fs.createReadStream` and `fs.createWriteStream`. Merge chunks back. Add/remove `.txt` suffix.

```javascript
// lib/splitter.js
const fs = require('fs');
const path = require('path');
const { pipeline } = require('stream/promises');

/**
 * Split a file into chunks of max chunkSize bytes.
 * Each chunk gets .txt suffix.
 * Returns chunk info array: [{name, size}]
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
          chunks.push({ name: chunkName, size: 0 });
        }

        const remaining = chunkSize - currentSize;
        const toWrite = Math.min(remaining, chunk.length - offset);
        currentWriteStream.write(chunk.slice(offset, offset + toWrite));
        currentSize += toWrite;
        offset += toWrite;
        resolvedBytes += toWrite;

        // Update progress
        const pct = (resolvedBytes / sourceSize) * 100;
        const mbDone = (resolvedBytes / 1024 / 1024).toFixed(1);
        const mbTotal = (sourceSize / 1024 / 1024).toFixed(1);
        progressUI.update(pct, `${mbDone} MB / ${mbTotal} MB  (${Math.round(pct)}%)`);

        // Close stream if chunk is full
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
 * Merge chunks back to original file, stripping .txt suffix.
 */
async function mergeChunks(chunks, outputPath, progressUI) {
  const writeStream = fs.createWriteStream(outputPath);
  let totalBytes = 0;
  const totalSize = chunks.reduce((sum, c) => sum + c.size, 0);

  for (let i = 0; i < chunks.length; i++) {
    const chunkPath = chunks[i].path;
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
```

- [ ] **Step 1: Create `lib/splitter.js`** with the code above

---

### Task 5: `lib/api.js` — HTTP API client

**Files:**
- Create: `E:\desktop\workspace\tool\idea\lib\api.js`

**Responsibility:** 
- Upload file via `POST multipart/form-data` to Kimi upload API
- Download file via `GET signUrl`
- HEAD check for signUrl validity
- Progress reporting per-file

```javascript
// lib/api.js
const https = require('https');
const http = require('http');
const fs = require('fs');
const path = require('path');
const config = require('./config');

/**
 * POST multipart/form-data upload to Kimi API.
 * Returns parsed JSON response body.
 */
function uploadFile(filePath, token) {
  return new Promise((resolve, reject) => {
    const boundary = '----' + Date.now() + Math.random().toString(36).slice(2);
    const fileName = path.basename(filePath);
    const fileSize = fs.statSync(filePath).size;
    const headers = {
      'authorization': token,
      'content-type': `multipart/form-data; boundary=${boundary}`,
      'accept': 'application/json, text/plain, */*',
      'referer': config.KIMI_URL,
    };

    // Build multipart body
    const headerPart = Buffer.from(
      `--${boundary}\r\n` +
      `Content-Disposition: form-data; name="file"; filename="${fileName}"\r\n` +
      `Content-Type: application/octet-stream\r\n\r\n`
    );
    const footerPart = Buffer.from(`\r\n--${boundary}--\r\n`);
    const contentLength = headerPart.length + fileSize + footerPart.length;
    headers['content-length'] = contentLength;

    const options = {
      hostname: 'www.kimi.com',
      path: '/apiv2-files/file/upload',
      method: 'POST',
      headers,
    };

    const req = https.request(options, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk.toString());
      res.on('end', () => {
        if (res.statusCode === 200) {
          try { resolve(JSON.parse(body)); }
          catch (e) { reject(new Error(`Parse error: ${body.slice(0, 100)}`)); }
        } else {
          reject(new Error(`HTTP ${res.statusCode}: ${body.slice(0, 200)}`));
        }
      });
    });

    req.on('error', reject);
    req.write(headerPart);
    const readStream = fs.createReadStream(filePath);
    readStream.pipe(req, { end: false });
    readStream.on('end', () => {
      req.end(footerPart);
    });
  });
}

/**
 * HEAD check for signUrl validity.
 */
function checkUrl(signUrl) {
  return new Promise((resolve) => {
    const isHttps = signUrl.startsWith('https');
    const mod = isHttps ? https : http;
    const req = mod.request(signUrl, { method: 'HEAD' }, (res) => {
      resolve(res.statusCode === 200);
    });
    req.on('error', () => resolve(false));
    req.end();
  });
}

/**
 * Download from signUrl to local path.
 * Returns bytes downloaded.
 */
function downloadFile(signUrl, outputPath) {
  return new Promise((resolve, reject) => {
    const isHttps = signUrl.startsWith('https');
    const mod = isHttps ? https : http;
    const file = fs.createWriteStream(outputPath);

    mod.get(signUrl, (res) => {
      if (res.statusCode !== 200) {
        reject(new Error(`Download HTTP ${res.statusCode}`));
        return;
      }
      res.pipe(file);
      let bytes = 0;
      res.on('data', chunk => bytes += chunk.length);
      file.on('finish', () => resolve(bytes));
    }).on('error', (e) => {
      fs.unlinkSync(outputPath);
      reject(e);
    });
  });
}

module.exports = { uploadFile, checkUrl, downloadFile };
```

- [ ] **Step 1: Create `lib/api.js`** with the code above

- [ ] **Step 2: Test HEAD check with a known valid signUrl**

```bash
cd "E:\desktop\workspace\tool\idea" && node -e "
const api = require('./lib/api');
// Grab signUrl from the captured JSON
const data = require('./upload_api_info.json');
const url = data.uploadEndpoint.find(r => r.type==='response' && r.url.includes('upload'))?.body;
if (url) {
  const parsed = JSON.parse(url);
  api.checkUrl(parsed.file.blob.signUrl).then(ok => console.log('HEAD check:', ok ? '✅ valid' : '❌ invalid'));
}
"
```

---

### Task 6: `commands/login.js` — Login command

**Files:**
- Create: `E:\desktop\workspace\tool\idea\commands\login.js`

**Responsibility:** 
- Launch browser
- Wait for manual login (detect via /api/user)
- Show progress
- On success, close browser with saved session

```javascript
// commands/login.js
const SessionManager = require('../lib/session');
const ProgressUI = require('../lib/progress');

async function login(options) {
  const progress = new ProgressUI();
  const session = new SessionManager(options.sessionDir);

  try {
    await session.ensureLoggedIn(progress);
    progress.summary('登录成功', [
      'Session 已保存',
      `目录: ${session.sessionDir}`,
    ]);
  } catch (e) {
    progress.summary('登录失败', [e.message]);
    process.exit(1);
  } finally {
    await session.close();
  }
}

module.exports = login;
```

- [ ] **Step 1: Create `commands/login.js`** with the code above

---

### Task 7: `commands/upload.js` — Upload command

**Files:**
- Create: `E:\desktop\workspace\tool\idea\commands\upload.js`

**Responsibility:**
1. Check session → login if needed → get token → close browser
2. Split source file into chunks (with progress)
3. Check progress.json for resume
4. Upload chunks with concurrency (with progress), collect signUrls
5. Save signUrl JSON
6. Cleanup chunks
7. Report summary

```javascript
// commands/upload.js
const fs = require('fs');
const path = require('path');
const config = require('../lib/config');
const ProgressUI = require('../lib/progress');
const SessionManager = require('../lib/session');
const { splitFile } = require('../lib/splitter');
const { uploadFile } = require('../lib/api');

async function upload(sourcePath, options) {
  const progress = new ProgressUI();

  // Validate source
  if (!fs.existsSync(sourcePath)) {
    console.error(`❌ 文件不存在: ${sourcePath}`);
    process.exit(1);
  }
  const sourceSize = fs.statSync(sourcePath).size;
  const sourceName = path.basename(sourcePath);

  // 1. Session + token
  const session = new SessionManager(options.sessionDir);
  await session.ensureLoggedIn(progress);
  const token = session.getToken();
  await session.close();

  // 2. Create upload dir
  const uploadDir = config.uploadCacheDir(sourceName);
  const chunksDir = path.join(uploadDir, 'chunks');
  const progressFile = path.join(uploadDir, 'progress.json');
  const signUrlFile = path.join(uploadDir, config.signUrlFilename(sourceName));
  fs.mkdirSync(chunksDir, { recursive: true });

  // 3. Split file
  progress.setStage('分片中', '📦');
  let chunks;
  const chunkSize = options.chunkSize || config.DEFAULT_CHUNK_SIZE;

  // Check for resume — if progress.json exists, use existing chunks
  if (fs.existsSync(progressFile)) {
    const saved = JSON.parse(fs.readFileSync(progressFile, 'utf-8'));
    chunks = saved.chunks;
    const doneCount = Object.values(chunks).filter(c => c.status === 'done').length;
    progress.log(`📋 发现断点，${doneCount}/${Object.keys(chunks).length} 已上传，跳过分片`);
    await new Promise(r => setTimeout(r, 1000));
  } else {
    chunks = await splitFile(sourcePath, chunkSize, chunksDir, progress);
    // Initialize progress.json
    const progMap = {};
    chunks.forEach(c => { progMap[c.name] = { status: 'pending', size: c.size }; });
    fs.writeFileSync(progressFile, JSON.stringify({ sourceFile: sourceName, totalChunks: chunks.length, chunks: progMap, createdAt: new Date().toISOString() }, null, 2));
  }

  // 4. Upload chunks
  progress.setStage('上传中', '☁️');
  const chunkNames = Object.keys(chunks);
  const total = chunkNames.length;
  let done = Object.values(chunks).filter(c => c.status === 'done').length;
  const uploadedUrls = Object.values(chunks).filter(c => c.status === 'done').map(c => c.signUrl).filter(Boolean);
  const chunkSizes = chunkNames.map(n => chunks[n].size || 0);

  // Concurrency control
  const concurrency = options.concurrency || config.DEFAULT_CONCURRENCY;
  const retry = options.retry || config.DEFAULT_RETRY;

  async function uploadOne(name, retriesLeft) {
    const chunkPath = path.join(chunksDir, name);
    if (!fs.existsSync(chunkPath)) return null;
    for (let attempt = 1; attempt <= retriesLeft; attempt++) {
      try {
        const result = await uploadFile(chunkPath, token);
        const signUrl = result.file?.blob?.signUrl;
        const fileId = result.file?.id;
        if (signUrl && fileId) {
          // Update progress.json
          const saved = JSON.parse(fs.readFileSync(progressFile, 'utf-8'));
          saved.chunks[name] = { status: 'done', size: chunks[name].size, fileId, signUrl };
          fs.writeFileSync(progressFile, JSON.stringify(saved, null, 2));
          return signUrl;
        }
      } catch (e) {
        if (attempt < retriesLeft) {
          await new Promise(r => setTimeout(r, 2000 * attempt));
        }
      }
    }
    return null;
  }

  // Upload with concurrency
  const pending = [...chunkNames].reverse(); // reverse so we pop from end
  let uploading = 0;
  let startTime = Date.now();

  while (pending.length > 0 && uploading < concurrency) {
    uploading++;
    processNext();
  }

  function processNext() {
    if (pending.length === 0) { uploading--; if (uploading <= 0) finish(); return; }
    const name = pending.pop();
    chunks[name].status === 'done' ? processNext() : _do(name);
  }

  async function _do(name) {
    const signUrl = await uploadOne(name, retry);
    if (signUrl) {
      done++;
      uploadedUrls.push(signUrl);
      const pct = (done / total) * 100;
      const elapsed = (Date.now() - startTime) / 1000;
      const speed = done / elapsed;
      const eta = speed > 0 ? ((total - done) / speed).toFixed(0) : '?';
      const size = (chunks[name]?.size || 0) / 1024 / 1024;
      progress.update(pct, `${done} / ${total}  (${Math.round(pct)}%)  |  ${name}  ${size.toFixed(1)} MB`, `速度: ${(chunkSizes.reduce((a,i) => a+(i||0),0)/1024/1024/elapsed).toFixed(1)} MB/s  预计剩余: ${eta}s`);
    } else {
      progress.log(`❌ 上传失败: ${name}`);
    }
    processNext();
  }

  function finish() {
    progress.done();

    // Save signUrl JSON
    const result = {
      sourceFile: sourceName,
      sourceSize,
      createdAt: new Date().toISOString(),
      chunks: uploadedUrls.map((url, i) => ({
        name: chunkNames[i],
        size: chunkSizes[i] || 0,
        signUrl: url,
      })),
    };
    fs.writeFileSync(signUrlFile, JSON.stringify(result, null, 2));

    // Cleanup chunks
    fs.rmSync(chunksDir, { recursive: true, force: true });
    fs.unlinkSync(progressFile);

    progress.summary('上传完成', [
      `源文件: ${sourceName} (${(sourceSize / 1024 / 1024).toFixed(1)} MB)`,
      `分片: ${done} 个`,
      `耗时: ${((Date.now() - startTime) / 1000).toFixed(0)} 秒`,
      `signUrl 文件: ${signUrlFile}`,
    ]);
  }
}

module.exports = upload;
```

- [ ] **Step 1: Create `commands/upload.js`** with the code above

---

### Task 8: `commands/download.js` — Download command

**Files:**
- Create: `E:\desktop\workspace\tool\idea\commands\download.js`

**Responsibility:**
1. Read signUrl JSON
2. HEAD verify each signUrl
3. Download chunks with concurrency (with progress)
4. Strip .txt suffix
5. Merge chunks into original file (with progress)
6. Verify file size
7. Cleanup temp files
8. Report summary

```javascript
// commands/download.js
const fs = require('fs');
const path = require('path');
const config = require('../lib/config');
const ProgressUI = require('../lib/progress');
const { mergeChunks } = require('../lib/splitter');
const { checkUrl, downloadFile } = require('../lib/api');

async function download(signUrlPath, options) {
  const progress = new ProgressUI();

  // 1. Read signUrl JSON
  if (!fs.existsSync(signUrlPath)) {
    console.error(`❌ 文件不存在: ${signUrlPath}`);
    process.exit(1);
  }
  const manifest = JSON.parse(fs.readFileSync(signUrlPath, 'utf-8'));
  const { sourceFile, sourceSize, chunks } = manifest;
  const total = chunks.length;

  // 2. Verify signUrls
  progress.setStage('验证链接', '🔍');
  progress.log(`检查 ${total} 个下载链接...`);
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

  // 3. Download chunks
  const outputDir = config.downloadCacheDir(sourceFile);
  const downloadDir = path.join(outputDir, 'temp');
  fs.mkdirSync(downloadDir, { recursive: true });
  const progressFile = path.join(outputDir, 'progress.json');

  progress.setStage('下载中', '📥');
  const concurrency = options.concurrency || config.DEFAULT_CONCURRENCY;
  let done = 0;
  let startTime = Date.now();

  async function downloadOne(chunk) {
    // Strip .txt suffix for local storage
    const localName = chunk.name.replace(/\.txt$/, '');
    const localPath = path.join(downloadDir, localName);
    try {
      const bytes = await downloadFile(chunk.signUrl, localPath);
      done++;
      const pct = (done / total) * 100;
      const elapsed = (Date.now() - startTime) / 1000;
      const speed = done / elapsed;
      const eta = speed > 0 ? ((total - done) / speed).toFixed(0) : '?';
      const totalSize = chunks.reduce((s, c) => s + (c.size || 0), 0);
      const bytesDone = validChunks.slice(0, done).reduce((s, c) => s + (c.size || 0), 0);
      const speedMbs = (bytesDone / 1024 / 1024 / elapsed).toFixed(1);
      progress.update(pct, `${done} / ${total}  (${Math.round(pct)}%)  |  ${localName}`, `速度: ${speedMbs} MB/s  预计剩余: ${eta}s`);
      return { ...chunk, localPath, bytes };
    } catch (e) {
      progress.log(`❌ 下载失败: ${chunk.name} - ${e.message}`);
      return null;
    }
  }

  // Simple concurrency queue
  const results = [];
  const queue = [...validChunks];
  async function worker() {
    while (queue.length > 0) {
      const chunk = queue.shift();
      const r = await downloadOne(chunk);
      if (r) results.push(r);
    }
  }
  const workers = Array(Math.min(concurrency, queue.length)).fill().map(() => worker());
  await Promise.all(workers);
  progress.done();

  if (results.length === 0) {
    progress.summary('下载失败', ['所有分片下载失败']);
    process.exit(1);
  }

  // 4. Merge
  progress.setStage('合并中', '🔗');
  const outputPath = options.output || path.join(process.cwd(), sourceFile);
  await mergeChunks(results, outputPath, progress);

  // 5. Verify
  const outputSize = fs.statSync(outputPath).size;
  const expectedSize = sourceSize || chunks.reduce((s, c) => s + (c.size || 0), 0);
  const match = Math.abs(outputSize - expectedSize) < 1024; // within 1KB
  if (!match) {
    progress.log(`⚠️ 文件大小不匹配: 预期 ${(expectedSize/1024/1024).toFixed(1)} MB, 实际 ${(outputSize/1024/1024).toFixed(1)} MB`);
  }

  // 6. Cleanup
  fs.rmSync(downloadDir, { recursive: true, force: true });

  progress.summary('下载完成', [
    `源文件: ${sourceFile}`,
    `大小: ${(outputSize / 1024 / 1024).toFixed(1)} MB`,
    `分片: ${results.length} 个`,
    `耗时: ${((Date.now() - startTime) / 1000).toFixed(0)} 秒`,
    `完整性: ${match ? '✅ 一致' : '⚠️ 不一致'}`,
    `输出: ${outputPath}`,
  ]);
}

module.exports = download;
```

- [ ] **Step 1: Create `commands/download.js`** with the code above

---

### Task 9: `kimi_file.js` — CLI entry point

**Files:**
- Create: `E:\desktop\workspace\tool\idea\kimi_file.js`

**Responsibility:** Parse argv, dispatch to command handlers, show help.

```javascript
#!/usr/bin/env node
// kimi_file.js — Kimi.ai file upload/download tool

const fs = require('fs');
const path = require('path');

const commands = {
  login: require('./commands/login'),
  upload: require('./commands/upload'),
  download: require('./commands/download'),
};

const helpText = `
Kimi 文件上传下载工具

用法:
  node kimi_file.js login                     手动登录 Kimi
  node kimi_file.js upload <文件> [选项]       上传文件
  node kimi_file.js download <signUrl.json>    下载并合并文件
  node kimi_file.js help                      显示帮助

上传选项:
  -c, --chunk-size <大小>   分片大小，如 45m (默认 45m)
  --concurrency <数字>      上传并发数 (默认 3)
  --retry <数字>            失败重试次数 (默认 3)
  --session-dir <目录>      session 目录 (默认 ./kimi_session)

下载选项:
  -o, --output <文件>        输出文件路径 (默认自动)
  --concurrency <数字>       下载并发数 (默认 3)
  --session-dir <目录>       session 目录 (默认 ./kimi_session)
`;

function parseArgs() {
  const args = process.argv.slice(2);
  const cmd = args[0];
  if (!cmd || cmd === 'help' || cmd === '--help') {
    console.log(helpText);
    process.exit(0);
  }

  const handler = commands[cmd];
  if (!handler) {
    console.error(`未知命令: ${cmd}`);
    console.log(helpText);
    process.exit(1);
  }

  // Parse options
  const options = {};
  const positional = [];

  for (let i = 1; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--session-dir' && i + 1 < args.length) {
      options.sessionDir = args[++i];
    } else if (arg === '--chunk-size' || arg === '-c') {
      const val = args[++i];
      const match = val.match(/^(\d+)([mk]?b?)$/i);
      if (match) {
        const num = parseInt(match[1]);
        const unit = match[2].toLowerCase();
        if (unit === 'm' || unit === 'mb') options.chunkSize = num * 1024 * 1024;
        else if (unit === 'k' || unit === 'kb') options.chunkSize = num * 1024;
        else options.chunkSize = num;
      } else {
        options.chunkSize = parseInt(val) || 45 * 1024 * 1024;
      }
    } else if (arg === '--concurrency') {
      options.concurrency = parseInt(args[++i]) || 3;
    } else if (arg === '--retry') {
      options.retry = parseInt(args[++i]) || 3;
    } else if (arg === '-o' || arg === '--output') {
      options.output = args[++i];
    } else if (!arg.startsWith('-')) {
      positional.push(arg);
    }
  }

  return { cmd, handler, options, positional };
}

// Run
const parsed = parseArgs();
parsed.handler(parsed.positional[0], parsed.options).catch(e => {
  console.error(`\n❌ 错误: ${e.message}`);
  process.exit(1);
});
```

- [ ] **Step 1: Create `kimi_file.js`** with the code above

---

### Task 10: Integration test

- [ ] **Step 1: Test help**

```bash
cd "E:\desktop\workspace\tool\idea" && node kimi_file.js help
```

Expected: Show help text with all commands.

- [ ] **Step 2: Test login** (opens browser, waits for login)

```bash
cd "E:\desktop\workspace\tool\idea" && node kimi_file.js login
```

Expected: Opens Chrome → Kimi loaded → detects login → "登录成功 ✓"

- [ ] **Step 3: Test upload with a small test file**

```bash
# Create a small test file (~50MB to test chunk logic)
cd "E:\desktop\workspace\tool\idea" && node -e "
const fs = require('fs');
const buf = Buffer.alloc(50 * 1024 * 1024, 'A');
fs.writeFileSync('test_upload_file.bin', buf);
console.log('Created test_upload_file.bin (50MB)');
"

# Upload with 10MB chunks
node kimi_file.js upload test_upload_file.bin -c 10m
```

Expected: Split into 5 chunks → upload all → save signUrl JSON.

- [ ] **Step 4: Test download**

```bash
# Find the signUrl file
cd "E:\desktop\workspace\tool\idea"
$signUrlFile = Get-ChildItem -Recurse -Filter "*.dl.json" | Select-Object -First 1
# or use ls then copy the path
node kimi_file.js download <path-to-dl.json> -o restored_test.bin
```

Expected: Download chunks → merge → file matches original.

```bash
# Verify
sha256sum test_upload_file.bin restored_test.bin
# or on Windows
certutil -hashfile test_upload_file.bin SHA256
certutil -hashfile restored_test.bin SHA256
```

- [ ] **Step 5: Clean up test files**

```bash
rm "E:\desktop\workspace\tool\idea\test_upload_file.bin"
rm "E:\desktop\workspace\tool\idea\restored_test.bin"
```

---

## Self-Review Checklist

- [ ] **Spec coverage:** All design doc features covered (login, upload, download, progress bars, signUrl JSON, timestamp dirs, concurrent upload/download, resume via progress.json, HEAD validation, size verification)
- [ ] **Placeholder check:** No TBD, TODO, or "implement later" found
- [ ] **Type consistency:** `config.js` exports match imports across all files. `session.getToken()` returns string. `uploadFile()` returns parsed JSON. `checkUrl()` returns bool. `downloadFile()` returns bytes.
- [ ] **File path consistency:** All `require()` paths use relative `../lib/` and `../commands/` from `kimi_file.js` root.