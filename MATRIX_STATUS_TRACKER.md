# 📄 矩阵项目核心文档汇总 (Project Master Doc)

本文档汇总了项目迁移、部署、运维及架构的核心信息。

---

## 1. 服务器拓扑 (Server Topology)
- **主节点 (Aliyun)**: `8.134.127.174` (内网: `172.18.253.78`)
- **功能**: 
  - `douyin-publisher`: 执行自动化发帖任务 (Port 11415)
  - `xhs-api`: 小红书抓取辅助 (Port 5556)
  - `n8n`: 自动化流程引擎 (Port 5678)

## 2. 部署与环境 (Environment)
- **系统**: Ubuntu 22.04 LTS
- **浏览器方案**: 必须使用 Playwright 内置 **Chromium**。
- **反爬策略**: 启用了 `stealth` 插件，并将 User-Agent 伪装为 Windows Chrome。
- **自动清理**: 截图目录自动定期清理（30 分钟过期，10 分钟检测一次）。

## 3. 常见问题记录 (Troubleshooting)

### 3.1 小红书反爬拦截
- **现象**: 报错 `Security Limit 300012`。
- **避坑**: User-Agent 严禁携带 "Linux" 字样，代码中已强制覆盖。必须使用 `playwright-extra` 的 `stealth` 插件。

### 3.2 远程交互
- **工具**: 访问 `http://IP:11415/control-panel.html` 进行远程控制。
- **功能**: 支持强制跳转、远程打字输入（解决手机验证码）、一键注销。

### 3.3 存储与权限
- **n8n 写入**: 必须使用绝对路径 `/root/douyin/downloads/`。
- **目录权限**: 建议对 `downloads/` 目录执行 `chmod 777`。

## 4. 账号扩展建议
- **多开**: 不同账号建议分配独立端口和 `userDataDir`。
- **备份**: 建议定期对阿里云实例创建快照，实现一键水平扩展。

---
*最后更新: 2026-01-01*
