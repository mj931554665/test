# 🎬 Douyin Publisher Service (Node.js)

本服务是矩阵系统的核心，负责浏览器自动化操作、账号登录管理以及全平台（抖音、小红书、快手）的作品发布。

## 🚀 快速启动
```bash
cd douyin
npm install
npx playwright install chromium    # 必须安装内置 Chromium
npm run dev                        # 默认启动，端口 11415
```

## 🌐 核心接口 (API Routes)

所有接口支持前缀自适应：`/douyin/*`, `/xhs/*`, `/ks/*` 或 `/api/*` (默认抖音)。

### 1. 账号与登录
- **`POST /manual-login`**
  - 功能: 启动有头浏览器进行手动登录。
  - 参数: `{ "remote": true }` (开启远程控制模式)。
- **`GET /check-status`**
  - 功能: 检查当前账号是否处于登录状态。
- **`POST /logout`**
  - 功能: 退出登录并清理本地缓存数据。

### 2. 作品发布
- **`POST /publish`**
  - 功能: 发布视频作品。
  - 参数: `{ "title": "标题", "description": "简介", "tags": ["标签"], "videoPath": "绝对路径" }`
- **`POST /publish-images`**
  - 功能: 发布图文/图集作品。
  - 参数: `{ "title": "标题", "description": "简介", "tags": ["标签"], "imagePaths": ["路径1", "路径2"], "music": { "index": 0 } }`

### 3. 远程可视化控制 (Remote Control)
- **`GET /control-panel.html`**
  - 功能: 访问 Web 交互控制台。
- **`GET /remote-screenshot`**
  - 功能: 获取当前浏览器实时截图。
- **`POST /remote-click`**
  - 功能: 模拟鼠标点击。参数: `{ "x": 100, "y": 200 }`
- **`POST /remote-goto`**
  - 功能: 强制地址栏跳转。参数: `{ "url": "https://..." }`
- **`POST /remote-type`**
  - 功能: 模拟键盘输入（解决验证码、搜索等）。参数: `{ "text": "内容" }`
- **`POST /remote-logout`**
  - 功能: 强制清除所有浏览器状态并注销。

### 4. 工具接口
- **`GET /api/latest-screenshot`**: 获取最后一张产生的截图文件。
- **`GET /api/screenshot`**: 触发即时截图并直接返回图片二进制流。
- **`GET /xhs/fetch-profile-html?userId=xxx`**: 抓取特定小红书博主的主页数据。

## 📂 关键目录
- `data/browser-data`: 存储浏览器 Profile 和 Cookies。
- `debug-screenshots`: 存储实时截图，系统每 10 分钟自动清理一次过期文件。
- `lib/`: 核心逻辑库。
