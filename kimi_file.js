#!/usr/bin/env node
const commands = {
  login: require('./commands/login'),
  upload: require('./commands/upload'),
  download: require('./commands/download'),
  zzzz111
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
  --force                    跳过 signUrl 验证，直接下载
  --curl                     使用系统 curl.exe 下载 (解决内网 TLS 指纹拦截)
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
        const unit = (match[2] || '').toLowerCase();
        if (unit === 'm' || unit === 'mb') options.chunkSize = num * 1024 * 1024;
        else if (unit === 'k' || unit === 'kb') options.chunkSize = num * 1024;
        else options.chunkSize = num * 1024 * 1024; // default to MB
      } else {
        options.chunkSize = parseInt(val) || 45 * 1024 * 1024;
      }
    } else if (arg === '--concurrency') {
      options.concurrency = parseInt(args[++i]) || 3;
    } else if (arg === '--retry') {
      options.retry = parseInt(args[++i]) || 3;
    } else if (arg === '-o' || arg === '--output') {
      options.output = args[++i];
    } else if (arg === '--force') {
      options.force = true;
    } else if (arg === '--curl') {
      options.curl = true;
    } else if (!arg.startsWith('-')) {
      positional.push(arg);
    }
  }

  return { cmd, handler, options, positional };
}

const parsed = parseArgs();
parsed.handler(parsed.positional[0], parsed.options).catch(e => {
  console.error(`\n❌ 错误: ${e.message}`);
  process.exit(1);
});
