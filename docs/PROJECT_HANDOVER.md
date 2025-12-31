# 📋 项目移交与架构文档 (Project Handover & Architecture)

这个文档记录了 2025-12-30 迁移至 **阿里云 (Aliyun ECS)** 后的最终状态、修复的关键问题以及未来的矩阵扩展方案。

---

## 🚀 1. 核心架构状态
*   **服务器**: 阿里云通用算力型 u1 (4核 8GB)，Ubuntu 22.04 LTS。
*   **公网 IP**: `8.166.130.28`
*   **运行服务**:
    *   **douyin-publisher** (Port: 11415): Node.js + Playwright 强化版。
    *   **xhs-api** (Port: 5556): Python XHS-Downloader API 模式。
    *   **n8n** (Port: 5678): 自动化流程控制台。

---

## ✅ 2. 已解决的关键“坑” (Troubleshooting)

1.  **小红书 (XHS) 反爬突破**:
    *   **问题**: 报错 `Security Limit 300012`。
    *   **修复**: 引入 `playwright-extra` & `stealth` 插件，并将 User-Agent 伪装为 Windows Chrome。
2.  **远程交互能力**:
    *   **问题**: Headless 模式下无法处理验证码、无法跳转。
    *   **修复**: 增强了远程可视化控制面板 ([/control-panel.html](file:///root/douyin/dev/control_panel.html))，新增了 **地址栏跳转** 和 **远程文字输入** (解决手机验证码录入)。
3.  **Python API 崩溃**:
    *   **问题**: `TypeError: __deal_extract()` 参数不匹配。
    *   **修复**: 修正了 `XHS-Downloader` 源码中的参数传递逻辑。
4.  **n8n 写入报错**:
    *   **问题**: 无法在根目录写入。
    *   **修复**: 统一使用绝对路径 `/root/douyin/downloads/` 并预设 777 权限。

---

## 📊 3. 性能表现与扩展建议

*   **当前负载**: 单账号在线时，内存占用约 1.5GB / 8GB，CPU 负载极低。
*   **承载能力**: 预估当前 8GB 实例可稳定承载 **6-10 个并发账号** 运行。

### 账号矩阵 (Account Matrix) 扩展策略：
1.  **环境镜像**: 建议在阿里云后台对当前实例“创建自定义镜像”。后续需要新机器时，勾选该镜像即可 3 分钟完成全环境装机。
2.  **多账号管理**: 每一个账号在启动 `douyin-publisher` 时分配独立的端口和 `userDataDir` 即可实现隔离。
3.  **异地矩阵**: 使用不同地域的 ECS（如北京、上海、深圳）可以分散 IP 权重，降低封号风险。

---

## 🛠️ 4. 给下一个 AI 的指令 (Quick Start)
> "请读取根目录下的 `PROJECT_HANDOVER.md` 和 `ALIS_DEPLOYMENT_NOTES.md`。目前系统已在阿里云 `8.166.130.28` 完美运行，解决了 XHS 反爬和远程输入问题。请在此基础上继续协助用户配置 n8n 自动化流程和扩展账号矩阵。"

---
*文档更新于: 2025-12-30 (Antigravity AI)*
