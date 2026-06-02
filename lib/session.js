const fs = require('fs');
const path = require('path');
const config = require('./config');

const TOKEN_FILE = path.join(config.CACHE_DIR, 'token.json');

/**
 * Decode JWT payload (no signature verification, just decode).
 */
function decodeJwt(token) {
  try {
    const parts = token.replace('Bearer ', '').split('.');
    if (parts.length !== 3) return null;
    const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString());
    return payload;
  } catch (_) {
    return null;
  }
}

class SessionManager {
  constructor(sessionDir) {
    this.sessionDir = sessionDir || config.DEFAULT_SESSION_DIR;
    this.token = null;
    this.browser = null;
    this.page = null;
  }

  /**
   * Try to load a previously saved token from disk.
   * Returns true if a valid (non-expired) token was loaded.
   */
  static loadSavedToken() {
    try {
      if (!fs.existsSync(TOKEN_FILE)) return null;
      const data = JSON.parse(fs.readFileSync(TOKEN_FILE, 'utf-8'));
      const token = data.token;
      if (!token) return null;

      // Check expiry
      const payload = decodeJwt(token);
      if (!payload || !payload.exp) return null;

      const expMs = payload.exp * 1000;
      if (Date.now() >= expMs) {
        fs.unlinkSync(TOKEN_FILE); // expired, clean up
        return null;
      }
      return token;
    } catch (_) {
      return null;
    }
  }

  /**
   * Save token to disk for reuse.
   */
  static saveToken(token) {
    try {
      fs.mkdirSync(config.CACHE_DIR, { recursive: true });
      const payload = decodeJwt(token);
      fs.writeFileSync(TOKEN_FILE, JSON.stringify({
        token,
        exp: payload?.exp || 0,
        savedAt: new Date().toISOString(),
      }, null, 2));
    } catch (_) {}
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

    // Capture Bearer token from any API request
    this.page.on('request', req => {
      if (!this.token) {
        const auth = req.headers()['authorization'];
        if (auth && auth.startsWith('Bearer ')) {
          this.token = auth;
        }
      }
    });

    // Detect login via /api/user response
    let loggedIn = false;
    const loginPromise = new Promise(resolve => {
      this.page.on('response', async resp => {
        if (resp.url().includes('/api/user') && resp.status() === 200) {
          try {
            const body = JSON.parse(await resp.text());
            if (body && body.user) {
              loggedIn = true;
              resolve(true);
            }
          } catch (_) {}
        }
      });
    });

    progressUI.update(0, '正在打开 Kimi.ai...');
    await this.page.goto(config.KIMI_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await this.page.waitForTimeout(3000);

    // Check if already logged in by looking at page text
    const hasLoginBtn = await this.page.evaluate(() => {
      return document.body.innerText.includes('登录');
    });

    if (!hasLoginBtn) {
      progressUI.update(50, '检测到已有登录 session');
      await this.page.waitForTimeout(2000);
      if (this.token) {
        progressUI.update(100, 'token 已获取');
        SessionManager.saveToken(this.token);
        progressUI.done();
        return;
      }
    }

    progressUI.update(30, '等待手动登录...');
    const timeout = setTimeout(() => {
      if (!loggedIn) progressUI.log('⚠️ 登录超时，请检查浏览器窗口');
    }, config.LOGIN_TIMEOUT);

    await loginPromise;
    clearTimeout(timeout);

    if (!loggedIn) {
      progressUI.log('❌ 登录失败');
      await this.close();
      throw new Error('Login failed or timeout');
    }

    // Wait for token capture
    let waited = 0;
    while (!this.token && waited < 30) {
      await new Promise(r => setTimeout(r, 500));
      waited++;
    }

    if (this.token) SessionManager.saveToken(this.token);

    progressUI.update(100, '登录成功!');
    progressUI.done();
  }

  getToken() {
    return this.token;
  }

  async close() {
    if (this.browser) {
      try { await this.browser.close(); } catch (_) {}
      this.browser = null;
      this.page = null;
    }
  }
}

module.exports = SessionManager;