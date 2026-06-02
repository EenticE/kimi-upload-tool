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
      mod.get(url, res => {
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
      }).on('error', e => {
        try { fs.unlinkSync(outputPath); } catch (_) {}
        reject(e);
      });
    }

    doGet(signUrl, maxRedirects);
  });
}

module.exports = { uploadFile, checkUrl, downloadFile };