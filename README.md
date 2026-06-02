# Kimi 文件上传下载工具

CLI 工具，支持大文件分片上传到 Kimi.ai 并完整下载还原。全程自动管理 Session 认证。

## 安装

```bash
npm install
```

依赖: `cloakbrowser`（用于首次登录获取 token）

## 命令

```bash
node kimi_file.js <命令> [参数] [选项]
```

### 命令一览

| 命令 | 用途 |
|------|------|
| `login` | 浏览器登录 Kimi，保存 session + token |
| `upload <文件>` | 分片上传到 Kimi，生成下载链接 |
| `download <signUrl.json>` | 下载分片并合并还原 |
| `help` | 显示帮助 |

### 选项

| 参数 | 适用 | 说明 | 默认 |
|------|------|------|------|
| `-c, --chunk-size` | upload | 分片大小 | `45m` |
| `--concurrency` | upload, download | 并发数 | `3` |
| `--retry` | upload | 失败重试次数 | `3` |
| `-o, --output` | download | 合并后文件路径 | 源文件名 |
| `--session-dir` | 通用 | session 目录 | `./kimi_session` |

## 完整流程

### 首次使用

```bash
# ① 登录（弹出浏览器，手动登录一次）
node kimi_file.js login

# ② 上传（纯 API，不开浏览器）
node kimi_file.js upload large_file.7z -c 45m

# ③ 下载（验证链接 → 并发下载 → 合并还原）
node kimi_file.js download .kimi_cache/uploads/xxx.dl.json
```

**流程说明：**
1. `login` 弹出浏览器，登录后自动保存 JWT token（有效期约 1 个月）
2. `upload` 使用保存的 token 直接 API 上传，无需浏览器
3. `download` 从 signUrl 文件下载所有分片，自动合并并校验

### 断点续传

```bash
# 上传中断后，重跑同一命令自动续传
node kimi_file.js upload large_file.7z -c 45m
# 📋 发现断点: 12/25 已完成，跳过
# 📋 从 large_file.13.txt 开始续传

# 下载中断同理
node kimi_file.js download xxx.dl.json
# 📋 发现下载断点: 3/6 已完成，跳过
# 📋 从 file.4.txt 开始续传
```

### 仅登录

```bash
# 单独登录（已登录则检测 session 后直接退出）
node kimi_file.js login
```

## 架构

```
kimi_file.js          CLI 入口
├── commands/
│   ├── login.js      登录命令
│   ├── upload.js     上传命令（生产者-消费者并发）
│   └── download.js   下载命令（排序合并）
├── lib/
│   ├── config.js     配置、路径
│   ├── progress.js   进度条 UI
│   ├── session.js    Session + token 管理
│   ├── splitter.js   纯 Node.js 流式分片/合并
│   └── api.js        HTTP 上传/下载/验证
```

## 目录

| 目录 | 用途 | 生成方式 |
|------|------|----------|
| `kimi_session/` | 浏览器登录 session（含 cookie） | `login` |
| `.kimi_cache/token.json` | JWT token | `login`，有效期 ~30 天 |
| `.kimi_cache/uploads/` | 上传分片、进度、signUrl | `upload` |
| `.kimi_cache/downloads/` | 下载临时分片 | `download` |

## 原理

- **分片**: `fs.createReadStream` 流式分片，不依赖系统命令
- **上传**: `multipart/form-data` POST 到 Kimi API，Bearer token 认证
- **下载**: 跟随跨域重定向到云存储（Volces TOS），GET 下载
- **并发**: 生产者-消费者队列，始终跑满并发数
- **断点**: `progress.json` 记录每个分片状态，双重校验（状态标记 + 文件大小）
- **验证**: 下载前 GET 验证 signUrl 有效性

## 限制

- 单文件 > 50MB 时自动分片（Kimi 上传限制）
- JWT token 有效期约 30 天，过期需重新 `login`
- signUrl 有效期不确定（与 Kimi 云存储策略相关），建议上传后尽快下载