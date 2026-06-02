const path = require('path');

const PROJECT_ROOT = path.resolve(__dirname, '..');
const CACHE_DIR = path.join(PROJECT_ROOT, '.kimi_cache');
const DEFAULT_SESSION_DIR = path.join(PROJECT_ROOT, 'kimi_session');

function timestamp() {
  const d = new Date();
  const y = d.getFullYear();
  const M = String(d.getMonth() + 1).padStart(2, '0');
  const D = String(d.getDate()).padStart(2, '0');
  const h = String(d.getHours()).padStart(2, '0');
  const m = String(d.getMinutes()).padStart(2, '0');
  const s = String(d.getSeconds()).padStart(2, '0');
  return `${y}${M}${D}_${h}${m}${s}`;
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
  DEFAULT_CHUNK_SIZE: 45 * 1024 * 1024,
  DEFAULT_CONCURRENCY: 3,
  DEFAULT_RETRY: 3,
  LOGIN_TIMEOUT: 5 * 60 * 1000,
  PROJECT_ROOT,
  CACHE_DIR,
  DEFAULT_SESSION_DIR,
  timestamp,
  uploadCacheDir,
  downloadCacheDir,
  signUrlFilename,
};