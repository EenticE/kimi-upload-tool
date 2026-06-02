# Kimi 文件上传下载工具

CLI 工具，支持文件分片上传到 Kimi.ai 并下载还原。

## 用法

```bash
# 登录（首次使用）
node kimi_file.js login

# 上传（自动分片 → 上传 → 生成下载链接）
node kimi_file.js upload <文件路径> [选项]

# 下载（自动验证 → 下载 → 合并还原）
node kimi_file.js download <signUrl.json> [选项]
```

## 目录说明

| 目录 | 用途 | 生成方式 |
|------|------|----------|
| `kimi_session/` | 浏览器登录 session | `login` 命令自动生成 |
| `.kimi_cache/token.json` | JWT 认证 token | `login` 命令保存，有效期 ~1 个月 |
| `.kimi_cache/uploads/` | 上传分片 + 进度 + signUrl | `upload` 命令自动生成 |
| `.kimi_cache/downloads/` | 下载临时分片 | `download` 命令自动生成 |

## 完整流程（首次使用）

```bash
# ① 登录（弹浏览器，手动登录一次）
node kimi_file.js login

# ② 上传（纯 API，不开浏览器）
node kimi_file.js upload myfile.7z -c 45m

# ③ 下载（验证链接 → 下载 → 合并）
node kimi_file.js download .kimi_cache/uploads/xxx.dl.json
```

## 选项

```
-c, --chunk-size   分片大小，如 45m (默认 45m)
--concurrency     并发数 (默认 3)
--retry           上传失败重试次数 (默认 3)
-o, --output      下载输出路径
--session-dir     session 目录 (默认 ./kimi_session)
```