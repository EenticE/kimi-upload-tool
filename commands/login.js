const SessionManager = require('../lib/session');
const ProgressUI = require('../lib/progress');

async function login(_unused, options) {
  const progress = new ProgressUI();
  const session = new SessionManager(options.sessionDir);
  try {
    await session.ensureLoggedIn(progress);
    progress.summary('登录成功', [
      `Session 已保存`,
      `  目录: ${session.sessionDir}`,
    ]);
  } catch (e) {
    progress.summary('登录失败', [e.message]);
    process.exit(1);
  } finally {
    await session.close();
  }
}

module.exports = login;