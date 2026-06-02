const https = require('https');
const http = require('http');
const fs = require('fs');
const path = require('path');

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
      authorization: token,
      'content-type': `multipart/form-data; boundary=${boundary}`,
      accept: 'application/json, text/plain, */*',
      referer: 'https://www.kimi.com/?chat_enter_method=new_chat',
    };

    const headerPart = Buffer.from(
      `--${boundary}\r\n` +
      `Content-Disposition: form-data; name="file"; filename="${fileName}"\r\n` +
      `Content-Type: application/octet-stream\r\n\r\n`
    );
    const footerPart = Buffer.from(`\r\n--${boundary}--\r\n`);
    headers['content-length'] = headerPart.length + fileSize + footerPart.length;

    const options = {
      hostname: 'www.kimi.com',
      path: '/apiv2-files/file/upload',
      method: 'POST',
      headers,
    };

    const req = https.request(options, res => {
      let body = '';
      res.on('data', chunk => (body += chunk.toString()));
      res.on('end', () => {
        if (res.statusCode === 200) {
          try {
            resolve(JSON.parse(body));
          } catch (e) {
            reject(new Error(`Parse error: ${body.slice(0, 100)}`));
          }
        } else {
          reject(new Error(`HTTP ${res.statusCode}: ${body.slice(0, 200)}`));
        }
      });
    });

    req.on('error', reject);
    req.write(headerPart);
    const readStream = fs.createReadStream(filePath);
    readStream.pipe(req, { end: false });
    readStream.on('end', () => req.end(footerPart));
  });
}

/**
 * Check if signUrl is valid by doing a GET and reading just the headers.
 * (Cloud storage often rejects HEAD but accepts ranged GET.)
 * Follows cross-origin redirects.
 */
function checkUrl(signUrl) {
  return new Promise(resolve => {
    function doGet(url) {
      const isHttps = url.startsWith('https');
      const mod = isHttps ? https : http;
      mod.get(url, res => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          res.resume();
          doGet(res.headers.location);
        } else {
          resolve(res.statusCode >= 200 && res.statusCode < 400);
          res.resume();
        }
      }).on('error', () => resolve(false));
    }
    doGet(signUrl);
  });
}

/**
 * Default browser-like headers to avoid being blocked by proxies / CDNs.
 */
const BROWSER_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7',
  'Accept-Language': 'zh-CN,zh;q=0.9',
  'Accept-Encoding': 'gzip, deflate',
  'Connection': 'close',
  'Sec-Fetch-Dest': 'document',
  'Sec-Fetch-Mode': 'navigate',
  'Sec-Fetch-Site': 'none',
  'Sec-Fetch-User': '?1',
  'Upgrade-Insecure-Requests': '1',
};

/**
 * Download from signUrl to local path.
 * Follows cross-origin redirects.
 * Returns bytes downloaded.
 */
function downloadFile(signUrl, outputPath, maxRedirects) {
  if (maxRedirects === undefined) maxRedirects = 5;

  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(outputPath);

    function doGet(url, redirectsLeft) {
      if (redirectsLeft <= 0) {
        try { fs.unlinkSync(outputPath); } catch (_) {}
        reject(new Error('Too many redirects'));
        return;
      }
      const isHttps = url.startsWith('https');
      const mod = isHttps ? https : http;
      const parsedUrl = new URL(url);
      const options = {
        hostname: parsedUrl.hostname,
        port: parsedUrl.port || 443,
        path: parsedUrl.pathname + parsedUrl.search,
        method: 'GET',
        headers: { ...BROWSER_HEADERS },
      };
      const req = mod.request(options, res => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          res.resume();
          doGet(res.headers.location, redirectsLeft - 1);
          return;
        }
        if (res.statusCode !== 200) {
          try { fs.unlinkSync(outputPath); } catch (_) {}
          reject(new Error(`Download HTTP ${res.statusCode}`));
          return;
        }
        res.pipe(file);
        let bytes = 0;
        res.on('data', chunk => (bytes += chunk.length));
        file.on('finish', () => resolve(bytes));
      });
      req.on('error', e => {
        try { fs.unlinkSync(outputPath); } catch (_) {}
        reject(e);
      });
      req.end();
    }

    doGet(signUrl, maxRedirects);
  });
}

/**
 * Download a file using system curl.exe (bypasses Node.js TLS fingerprint issues
 * on enterprise networks with deep packet inspection).
 * Returns bytes downloaded.
 */
function downloadWithCurl(signUrl, outputPath) {
  return new Promise((resolve, reject) => {
    const cp = require('child_process');

    const args = [
      '-o', outputPath,
      '-L', // follow redirects
      '--max-time', '120',
      '--ssl-revoke-best-effort', // corporate TLS: don't fail on CRL unreachable
      '-H', 'User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36',
      '-H', 'Accept: text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7',
      '-H', 'Accept-Language: zh-CN,zh;q=0.9',
      '-H', 'Accept-Encoding: gzip, deflate',
      '-H', 'Connection: close',
      '-s', // silent (no progress bar, we handle UI)
      signUrl,
    ];

    const child = cp.spawn('curl.exe', args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env }, // inherit full parent env (HTTPS_PROXY etc.)
    });
    let stderr = '';
    child.stderr.on('data', chunk => { stderr += chunk.toString(); });

    child.on('close', code => {
      if (code === 0) {
        try {
          const bytes = fs.statSync(outputPath).size;
          if (bytes > 0) {
            resolve(bytes);
          } else {
            try { fs.unlinkSync(outputPath); } catch (_) {}
            reject(new Error('Downloaded file is empty'));
          }
        } catch (e) {
          reject(new Error(`Cannot stat output: ${e.message}`));
        }
      } else {
        try { fs.unlinkSync(outputPath); } catch (_) {}
        reject(new Error(`curl exited ${code}: ${stderr.trim() || 'unknown error'}`));
      }
    });

    child.on('error', e => {
      try { fs.unlinkSync(outputPath); } catch (_) {}
      reject(new Error(`curl spawn failed: ${e.message}. Is curl.exe installed?`));
    });
  });
}

module.exports = { uploadFile, checkUrl, downloadFile, downloadWithCurl };