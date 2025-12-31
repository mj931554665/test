# Douyin Publisher Service

多平台发布/检查服务，当前主要支持抖音（快手/小红书部分功能占位）。

## 启动

- 默认无头：`npm run dev <profile>`，例如 `npm run dev zf`
- 有头：`HEADLESS=false npm run dev zf`
- 端口：默认 11415

## 路由

- 抖音：`/douyin/manual-login` (加 `?remote=true` 可远程扫码), `check-status`, `publish`, `publish-images`, `logout`
- 快手：`/ks/*`
- 小红书：`/xhs/manual-login` (支持 `?remote=true`), `check-status`, `fetch-profile-html`
- **实时看图接口 (最简方案)**：`GET http://<IP>:11415/api/screenshot`
    - 直接在浏览器打开，调用即截图并显示实时画面内容。
- **获取最新二维码地址**：`GET /api/latest-screenshot`
- 兼容旧前缀：`/api/*` 等同抖音

## 配置

- `HEADLESS`: `false/0/off/no` 为有头
- 违禁词：默认使用 `data/sensitive-lexicon/Vocabulary`，可用 `FORBIDDEN_PATH` 指定自定义目录/文件
- 浏览器数据：`data/browser-data/<profile>`

## 开发

- 启用调试截图：`debug-screenshots/`
- 多平台接口统一命名：`manual-login` `check-status` `publish` `publish-images` `logout`
