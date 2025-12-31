# 🚀 多账号矩阵：新服务器部署与避坑指南 (Worker Setup Guide)

如果您新开了一台阿里云服务器，或者对话丢失需要重新部署，请直接查阅本指南。

## 1. 硬件最低配置要求
- **CPU**: 2核 (通用型/算力型)
- **内存**: 2GB (推荐开启 4GB Swap) 或 4GB (最稳妥)
- **系统**: Ubuntu 22.04 LTS (x86_64)

## 2. 核心服务列表
- **douyin-publisher** (Port: 11415): 浏览器核心，负责扫码登录、发帖、评论。
- **xhs-api** (Port: 5556): 小红书接口，负责作品数据抓取。
- **n8n** (Port: 5678): 自动化脚本引擎。

## 3. 部署步骤 (从零开始)

### Step 1: 环境依赖安装
```bash
# 安装 Node.js v20 & PM2
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs
sudo npm install -g pm2

# 安装 Python 3.12 & Venv
sudo apt-get install -y python3.12 python3.12-venv

# 安装 Playwright 浏览器底层依赖
npx playwright install-deps chromium
```

### Step 2: 关键“避坑”配置 (必做)
已经在代码中修复，但新机器需注意：
1. **浏览器 Stealth**: 必须使用 `playwright-extra`，User-Agent 必须设为 Windows Chrome。
2. **绝对路径**: n8n 写入路径必须为 `/root/douyin/downloads/`，目录需 `chmod 777`。
3. **Swap 分区**: 2G 内存机器必须配置 Swap，否则浏览器必崩溃。

---

## 4. 矩阵运营命令 (掌控感清单)

| 操作 | 命令 | 说明 |
| :--- | :--- | :--- |
| **启动所有服务** | `pm2 start all` | 启动抖音、小红书、n8n |
| **查看运行状态** | `pm2 list` | 检查服务是否都在 Online |
| **查看实时日志** | `pm2 logs` | 报错时第一时间看这里 |
| **代码增量更新** | `git pull && pm2 restart all` | 同步 GitHub 最新逻辑 |
| **清理缓存** | `rm -rf /root/douyin/debug-screenshots/*` | 定期清理截图，防止磁盘满 |

## 5. 常见问题处理
- **扫码不出图**：检查 11415 端口是否在阿里云安全组开放。
- **反爬拦截 (300012)**：检查 `lib/browser.js` 中的 User-Agent 是否被改回了 Linux。
- **n8n 无法访问**：检查 `.npmrc` 或环境变量中的 `N8N_SECURE_COOKIE` 是否设为 `false`。
