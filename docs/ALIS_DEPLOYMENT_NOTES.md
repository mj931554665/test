# 阿里云部署与排坑指南 (Aliyun Deployment & Troubleshooting)

本仓库在从本地迁移至阿里云 (Ubuntu 22.04) 过程中遇到了若干关键问题，现记录如下，以备后续多账号矩阵扩展时参考。

## 1. 小红书 (XHS) 反爬与“安全限制 (300012)”
*   **现象**：在阿里云环境下，访问小红书首页或博主页直接拦截，报错 300012。
*   **原因**：小红书对数据中心 IP 敏感，且能识别 Playwright 默认的自动化特征。
*   **解决方案**：
    *   **Stealth 插件**：安装 `playwright-extra` 和 `puppeteer-extra-plugin-stealth`。
    *   **UA 伪装**：必须使用标准的 Windows Chrome User-Agent，不要使用 Linux 默认 UA。
    *   **参数优化**：添加 `--disable-blink-features=AutomationControlled` 等参数。
    *   **代码参考**：[lib/browser.js](file:///root/douyin/lib/browser.js)

## 2. 浏览器环境兼容性 (Channel)
*   **现象**：Playwright 启动报错，找不到 `chrome` 可执行文件。
*   **原因**：本地 Mac 常用 `channel: 'chrome'` 调用系统 Chrome，但服务器端通常只安装了 `chromium`。
*   **解决方案**：
    *   在 Linux 环境下将 `channel` 设为 `undefined`，默认使用 Playwright 自带的 Chromium。
    *   确保运行 `npx playwright install-deps` 安装所有系统底层依赖（如 X11, Gtk 等）。

## 3. 远程交互能力增强
*   **现象**：无头模式 (Headless) 下无法输入验证码、无法手动跳转指定 URL。
*   **解决方案**：
    *   **地址栏**：在 `/control-panel.html` 实现了 `remote-goto` 接口。
    *   **远程输入**：实现了 `remote-type` 接口，支持通过 `page.keyboard.type` 将验证码同步到服务器。
    *   **实时截图**：通过 `/api/screenshot` 实现点击后的即时画面反馈。

## 4. XHS-Downloader (Python) 报错
*   **现象**：调用 `xhs/detail` 报错 `TypeError: __deal_extract() takes from 5 to 8 positional arguments but 9 were given`。
*   **原因**：代码版本不一致，API 调用处多传了参数。
*   **解决方案**：修正 `source/application/app.py` 中的 `handle` 和 `deal_detail_mcp` 函数调用，移除多余的参数。

## 5. n8n 路径与权限问题
*   **现象**：n8n 在执行“写入文件”节点时报错 `File or directory does not exist`。
*   **原因**：使用了相对路径（如 `/douyin/...`），而在 Linux 中 `/` 代表根目录。
*   **解决方案**：
    *   使用绝对路径：`/root/douyin/downloads/`。
    *   **权限**：必须手动创建目录并执行 `chmod 777`，否则 n8n 进程无权写入。

## 6. PM2 环境持久化
*   **注意**：所有服务建议通过 PM2 启动。
    *   `douyin-publisher`: `npm run dev`
    *   `xhs-api`: `python main.py` (API 模式)
    *   `n8n`: `n8n start`
*   修改配置后需执行 `pm2 save` 确保服务器重启后自动拉起。
