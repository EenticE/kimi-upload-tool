# Kimi 文件上传下载工具设计文档

## 概述

一键式 CLI 工具，支持登录 Kimi → 自动分片上传 → 下载合并，全程自动管理 Session 和 Token。

## CLI 命令

```bash
# 手动登录
node kimi_file.js login

# 上传（自动分片 → 上传 → 收集 signUrl）
node kimi_file.js upload <源文件路径> [选项]

# 下载（下载分片 → 合并还原）
node kimi_file.js download <signUrl文件.json> [选项]
```

### 选项参数

| 参数 | 适用范围 | 说明 | 默认值 |
|------|----------|------|--------|
| `-c, --chunk-size` | upload | 分片大小 | `45m` |
| `-o, --output` | download | 合并后文件路径 | 源文件名 |
| `--session-dir` | 通用 | session 目录 | `./kimi_session` |
| `--retry` | upload | 上传失败重试次数 | `3` |
| `--concurrency` | upload/download | 并发数 | `3` |

## 目录规划

```
E:\desktop\workspace\tool\idea\
├── kimi_file.js                ← ◀ CLI 入口
│
├── commands\                   ← 命令处理
│   ├── login.js
│   ├── upload.js
│   └── download.js
│
├── lib\                        ← 核心模块
│   ├── config.js
│   ├── progress.js
│   ├── session.js
│   ├── splitter.js
│   └── api.js
│
├── docs\                       ← 设计文档
│   └── kimi-file-tool-design.md
│
├── .gitignore
├── package.json
│
├── kimi_session\               ← ← 浏览器 session（自动生成）
│
├── .kimi_cache\                ← ← 任务中间文件（自动生成）
│   ├── token.json              ← JWT token（login 时保存）
│   ├── uploads\                ← 上传任务目录
│   │   └── {源文件}_{时间戳}\
│   │       ├── chunks\         ← 分片文件
│   │       ├── progress.json   ← 断点续传记录
│   │       └── {源}.{时间戳}.dl.json  ← signUrl 下载链
│   │
│   └── downloads\              ← 下载临时目录
│       └── {源文件}_{时间戳}\
│           └── temp\           ← 下载中的分片
```

**上传目录：** 每次都带时间戳 `{源文件名}_{YYYYMMDD}_{HHmmss}\`，保证每次上传独立隔离。

**signUrl 文件名：** `{源文件名}.{YYYYMMDD}.{HHmmss}.dl.json`

## 工作流

### login 命令

```
启动 Playwright 浏览器 (kimi_session 持久上下文)
  → 打开 Kimi 首页
  → 拦截 /api/user 响应（轮询间隔 1s）
     ├─ 200 + 有用户数据 → 已登录，保存 session，退出
     └─ 超时（5min）→ 打印提示，退出
  → 关闭浏览器
```

### upload 命令

```
1. 检测 session：尝试从 kimi_session 读取 kimi-auth cookie
   ├─ 有效 → 开浏览器获取 JWT token，拿到后关闭浏览器
   └─ 无效/过期 → 走 login 流程
2. 用 Node.js fs 将源文件分片（纯 JS，不依赖系统 split）
3. 分片重命名加 .txt 后缀
4. 并发 POST → apiv2-files/file/upload（Bearer token）
5. 收集返回的 signUrl → 保存 {src}.{ts}.dl.json
6. 自动清理 chunks 目录
7. 汇报：分片数、上传进度、耗时、目标 signUrl 文件路径
```

### download 命令

```
1. 读 signUrl JSON 文件
2. 逐条 GET 下载（并发 3）
3. 去掉 .txt 后缀
4. cat 合并成原始文件
5. 验证文件大小
6. 自动清理临时分片
7. 汇报：下载进度、合并完成、目标文件路径
```

## 核心 API

| 用途 | 方法 | URL |
|------|------|-----|
| 上传文件 | POST | `https://www.kimi.com/apiv2-files/file/upload` |
| 下载文件 | GET | `signUrl` |
| 检测登录 | POST | `https://www.kimi.com/api/user` |

认证方式：`Authorization: Bearer <JWT>`，从 Playwright 拦截请求头获取。

## signUrl JSON 格式

```json
{
  "sourceFile": "intellij-idea-ultimate-portable-win64-2024.3.1.1-43.7z",
  "sourceSize": 1146718965,
  "createdAt": "2026-06-01T21:30:00+08:00",
  "chunks": [
    {
      "name": "idea.x64.7z.aa.txt",
      "size": 47185920,
      "signUrl": "https://www.kimi.com/apiv2-files/sign-obj/..."
    },
    {
      "name": "idea.x64.7z.ab.txt",
      "size": 47185920,
      "signUrl": "https://www.kimi.com/apiv2-files/sign-obj/..."
    }
  ]
}
```

## 进度显示

采用 **npm install 风格** 的实时终端 UI，所有阶段共享同一块显示区域，每行固定内容动态刷新。

### 各阶段显示布局

```
登录等待:
  ⏳ 等待登录...                                           [无进度条]

分片中:
  📦 分片:  ████████████████████░░░░░░░░░░░░░  235 MB / 1094 MB  (21%)
  预计剩余: 约 2 秒                                        [分片阶段]

上传中:
  ☁️ 上传:  ████████████████░░░░░░░░░░░░░░░░░  12 / 25  (48%)
  └─ idea.x64.7z.al.txt  45.0 MB  ████████████  100%
  预计剩余: 约 38 秒  |  速度: 3.2 MB/s                   [上传阶段]

下载中:
  📥 下载:  ██████████████░░░░░░░░░░░░░░░░░░░  8 / 25  (32%)
  └─ idea.x64.7z.af.txt  45.0 MB  ██████████░░  82%
  预计剩余: 约 52 秒  |  速度: 2.8 MB/s                   [下载阶段]

合并中:
  🔗 合并:  ████████████████████████████████  100%
  输出: intellij-idea-ultimate-portable-win64-2024.3.1.1-43.7z
                                                           [合并阶段]
```

### 实现方式

- 使用 `readline.cursorTo` / `moveCursor` 实现行覆盖刷新
- 单行固定位置更新，不产生大量滚动日志
- 每 0.5 秒刷新一次
- 每个阶段结束时：显示 ✅ 标志并自动进入下一阶段
- 全部完成后：汇总显示耗时、文件大小、路径

```
✅ 全部完成！
   源文件: intellij-idea-xxx.7z (1093.6 MB)
   分片: 25 个 × 45 MB
   上传耗时: 42 秒
   下载耗时: 36 秒
   输出路径: ./intellij-idea-xxx.7z
```

### 速度评估算法

根据已完成的 N 个文件的平均耗时 × 剩余文件数，每秒更新一次估算。
上传/下载速度 = 已传输字节数 / 已用时间

## 断点续传

上传过程中在 `progress.json` 实时记录每个分片的状态：

```json
{
  "sourceFile": "intellij-idea-xxx.7z",
  "totalChunks": 25,
  "chunks": {
    "idea.x64.7z.aa.txt": { "status": "done", "fileId": "xxx", "signUrl": "https://..." },
    "idea.x64.7z.ab.txt": { "status": "uploading", "size": 47185920 },
    "idea.x64.7z.ac.txt": { "status": "pending" }
  },
  "createdAt": "2026-06-01T21:30:00+08:00"
}
```

- 每次开始上传时，检查 `progress.json`，跳过 `status: "done"` 的分片
- 上传中断重跑时，自动跳过已完成的，从未完成的继续
- 所有分片全部 `done` 后，自动删除上传临时目录

下载同理，记录每个分片的下载状态。

## signUrl 有效性验证

下载前先 HEAD 请求验证 signUrl：

```
HEAD {signUrl} → 200  → 有效，开始下载
              → 403/404 → 无效，打印提示并退出
```

如果 signUrl 失效，提示用户重新 login 获取新 token，然后重跑 download。

## 后续优化（二期）

- 支持多平台配置（ChatGPT、DeepSeek 等）
- 做成 Claude Code skill