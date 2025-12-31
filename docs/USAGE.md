# Docker 使用指南 - n8n + XHS-Downloader

## 📁 目录结构
```
docker/
├── Dockerfile              # Docker 配置文件
├── .dockerignore          # 忽略文件列表
├── start.sh               # 启动脚本（同时启动两个应用）
├── XHS-Downloader/        # 小红书下载器代码
└── USAGE.md               # 本文件
```

## 🏗️ 构建镜像

```bash
cd /Users/mojun/Downloads/docker
docker build -t n8n-xhs:latest .
```

**这做了什么：**
- 从 `python:3.12-slim` 基础镜像开始
- 安装 Node.js（用于 n8n）
- 安装 n8n v1.122.4
- 安装 XHS-Downloader 的 Python 依赖
- 复制代码和启动脚本

## 🚀 运行容器

```bash
docker run -p 5678:5678 -p 5556:5556 n8n-xhs:latest
```

**或者用不同的端口（如果 5678 被占用）：**
```bash
docker run -p 8678:5678 -p 8556:5556 n8n-xhs:latest
```

**参数解释：**
- `-p 5678:5678` = 映射 n8n 端口
  - 左边 = 你电脑上的端口
  - 右边 = 容器内的端口
- `-p 5556:5556` = 映射 XHS-Downloader 端口

## 🌐 访问应用

- **n8n**: http://localhost:5678
- **XHS-Downloader**: http://localhost:5556

## 📋 常用命令

```bash
# 查看正在运行的容器
docker ps

# 查看所有镜像
docker images

# 停止容器
docker stop <container_id>

# 删除镜像
docker rmi n8n-xhs:latest

# 查看容器日志
docker logs <container_id>

# 查看实时日志
docker logs -f <container_id>
```

## ❓ 常见问题

**Q: 端口被占用了怎么办？**
A: 用不同的端口运行：
```bash
docker run -p 8678:5678 -p 8556:5556 n8n-xhs:latest
```

**Q: 怎么停止容器？**
A: 按 `Ctrl+C` 或运行：
```bash
docker stop <container_id>
```

**Q: 怎么查看错误日志？**
A: 运行：
```bash
docker logs <container_id>
```

