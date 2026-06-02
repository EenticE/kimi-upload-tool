# Kimi 文件上传下载工具 — 测试报告

**测试日期**: 2026-06-02
**版本**: kimi_file.js v1.0
**测试人**: Claude Agent

---

## 测试环境

| 项目 | 值 |
|------|-----|
| 系统 | Windows 10 Pro 10.0.19045 |
| Node.js | v22.21.1 |
| 浏览器 | Chromium 146 (cloakbrowser) |
| 测试文件 | `CC-Switch-v3.14.0-Windows-Portable.zip` (11,381,625 bytes / 10.9 MB) |
| 分片大小 | 2MB |
| 并发数 | 1～3 |
| 目标 | Kimi.ai |

---

## 测试用例

### TC-01: 登录认证

**前置条件**: 无（首次使用）

**步骤:**
1. 执行 `node kimi_file.js login`
2. 浏览器自动弹出，打开 Kimi 首页
3. 手动输入账号密码登录

**预期结果:**
- 检测到 `/api/user` 返回 200 + 用户数据
- 自动获取 JWT Bearer token
- token 保存到 `.kimi_cache/token.json`
- 输出 `✅ 登录成功`

**实际结果:** ✅ 通过
- 已有 `kimi_session` 目录，检测到已有 session，直接使用
- token 有效期至 2026-07-01（约 30 天）

---

### TC-02: 完整上传链路

**前置条件**: 有效的 JWT token

**步骤:**
1. `rm -rf .kimi_cache/uploads/CC-Switch*`
2. `node kimi_file.js upload <file> -c 2m --concurrency 3`

**预期结果:**
- 🔑 认证: 使用已保存的 token（不开浏览器）
- 📦 分片: 6 个 × 2MB（纯 Node.js 流式分片）
- ☁️ 上传: 生产者-消费者队列，始终跑满 3 并发
- ✅ 上传完成，生成 `.dl.json` signUrl 文件

**实际结果:** ✅ 通过
```
分片: 6 / 6
耗时: 4 秒
signUrl 文件: .../xxx.dl.json
```

---

### TC-03: 完整下载链路

**前置条件**: TC-02 生成的 signUrl 文件

**步骤:**
1. `rm -rf .kimi_cache/downloads`
2. `node kimi_file.js download <signUrl.json> -o restored.zip --concurrency 3`

**预期结果:**
- 🔍 验证链接: 6/6 有效（GET 跟随 307 重定向到云存储）
- 📥 下载: 6 个分片，并发下载
- 🔗 合并: 按分片序号排序后合并
- ✅ 完整性校验: SHA256 一致

**实际结果:** ✅ 通过
```
分片: 6 个
耗时: 2 秒
完整性: ✅ 一致
SHA256: 一致
```

---

### TC-04: 上传断点续传

**前置条件**: 上传到一半中断

**步骤:**
1. `rm -rf .kimi_cache/uploads/CC-Switch*`
2. 启动上传 `node kimi_file.js upload <file> -c 2m --concurrency 1 &`
3. 等待 5 秒后 `kill $PID`
4. 检查 `progress.json`
5. 重跑上传 `node kimi_file.js upload <file> -c 2m --concurrency 3`

**预期结果:**
- 中断时 progress.json 记录已完成的分片
- 重跑后检测到断点，跳过已完成的分片
- 只上传剩余分片

**实际结果:** ✅ 通过
```
中断状态: 3/6 已完成
重跑:
📋 发现断点: 3/6 已完成，跳过
📋 从 CC-Switch-v3.14.0-Windows-Portable.4.txt 开始续传
分片: 6 / 6
```

---

### TC-05: 下载断点续传

**前置条件**: 下载到一半中断

**步骤:**
1. 启动下载 `node kimi_file.js download <signUrl.json> --concurrency 1`
2. 5 秒后 timeout
3. 检查 `progress.json`
4. 重跑下载

**预期结果:**
- 中断时 progress.json + 本地临时文件记录已完成的分片
- 重跑后检测到断点，跳过已下载的分片
- 已下载的分片加入合并列表

**实际结果:** ✅ 通过
```
中断状态: 1/6 已完成
重跑:
📋 发现下载断点: 1/6 已完成，跳过
📋 从 CC-Switch-v3.14.0-Windows-Portable.2.txt 开始续传
分片: 6 个 (1 复用 + 5 下载)
完整性: ✅ 一致
SHA256: 一致
```

---

### TC-06: 分片文件缺失恢复

**前置条件**: 上传完成后 cleanup 删除了 pending 分片

**步骤:**
1. 上传 4/6 时被 SIGKILL
2. cleanup 删除了所有分片（包括 pending 的）
3. 重跑上传

**预期结果:**
- 检测到分片文件缺失
- 自动触发重新分片
- 上传全部完成

**实际结果:** ✅ 通过
```
📋 发现断点: 4/6 已完成，跳过
📋 分片文件缺失，自动重新分片...
分片: 6 / 6
```

---

## 发现的 Bug

| # | Bug | 文件 | 影响 | 修复 |
|---|-----|------|------|------|
| 1 | ESM 模块 `require()` 失败 | 全局 | ❌ 脚本无法启动 | 改为 `await import()` |
| 2 | `cloakbrowser` 函数签名与 Playwright 不同 | `session.js` | ❌ 浏览器无法启动 | 参数改为 `{userDataDir}` |
| 3 | Windows 路径 `\` 被 JS 转义 | 全局 | ❌ 路径错误 | 使用 `/` 或双反斜杠 |
| 4 | SVG 元素 `className` 不是字符串 | 调试脚本 | ⚠️ page.evaluate 崩溃 | 使用 `String(el.className)` |
| 5 | `uploadOne` 中 `chunk.name` → `chunk` | `upload.js:127` | ❌ 上传崩溃 | 直接传字符串变量 |
| 6 | 并发分片乱序导致 SHA256 不匹配 | `download.js` | ❌ 校验失败 | 合并前按序号排序 |
| 7 | 下载 resume 创建新目录 | `download.js` | ❌ 断点不生效 | 搜索已有目录 |
| 8 | 下载 resume 已完成的未加入合并 | `download.js` | ❌ 只合成了新分片 | 队列前先收集 done chunks |
| 9 | signUrl HEAD 被云存储拒绝 (403) | `api.js` | ⚠️ 验证总返回 false | 改为 GET |
| 10 | 下载不跟随跨域重定向 (307) | `api.js` | ❌ 下载全部失败 | 递归跟进 location |
| 11 | 上传 resume 读 progress.json 文件竞争 | `upload.js` | ⚠️ signUrl 保存失败 | 改为内存 Map |
| 12 | `cmd //c` 杀掉所有 node 进程 | 命令行 | ⚠️ 当前会话被 kill | 精确 PID kill |

---

## 性能数据

| 操作 | 文件大小 | 分片数 | 并发 | 耗时 | 速度 |
|------|----------|--------|------|------|------|
| 上传 | 10.9 MB (zip) | 6 × 2MB | 3 | 4s | ~18 Mbps |
| 下载 | 10.9 MB (zip) | 6 × 2MB | 3 | 2s | ~44 Mbps |
| 上传 | 1093.6 MB (7z) | 25 × 45MB | 3 | 442s | ~20 Mbps |
| 分片 | 1093.6 MB (7z) | 25 × 45MB | — | ~5s | ~220 MB/s |

---

## 遗留问题

| 问题 | 说明 |
|------|------|
| `.txt` 后缀被 Kimi 文本处理 | 本次测试未触发（二进制内容通过 .txt 上传后无损坏），但严格来说非安全 |
| SIGKILL 中断后的分片状态 | 硬杀进程可能导致分片处于中间状态，重跑可自动恢复 |
| signUrl 有效期 | 依赖 Kimi 云存储策略，建议上传后尽快下载 |