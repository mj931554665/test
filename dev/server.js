const express = require('express');
const cors = require('cors');
const path = require('path');
const net = require('net');
const fs = require('fs');
const { exec } = require('child_process');
const { promisify } = require('util');
const { closeBrowser } = require('../lib/browser');
const { resolveProfileDir } = require('../lib/profile');
const { createLogger } = require('../lib/logger');
const { setDebugMode } = require('../lib/utils');

const execAsync = promisify(exec);
const { profileName } = resolveProfileDir();
const logger = createLogger('dev');
const app = express();
const BASE_PORT = 11415;
const PID_DIR = path.join(__dirname, '..', 'data', 'pids');
const PID_FILE = path.join(PID_DIR, `.dev-server.${profileName}.pid`);

const platformModules = {
  douyin: require('../lib/douyin'),
  dy: require('../lib/douyin'),
  kuaishou: require('../lib/kuaishou'),
  ks: require('../lib/kuaishou'),
  xiaohongshu: require('../lib/xiaohongshu'),
  xhs: require('../lib/xiaohongshu')
};

// 中间件
app.use(cors());
app.use(express.json());

// 启用调试模式（开发环境）
const DEBUG_SCREENSHOT_DIR = path.join(__dirname, '..', 'debug-screenshots');
setDebugMode(true, DEBUG_SCREENSHOT_DIR);

// 清理旧的服务器进程
async function killOldServers() {
  try {
    // 获取当前项目的完整路径（用于精确匹配进程）
    const currentProjectPath = path.resolve(__dirname, '..');
    const projectName = path.basename(currentProjectPath); // 'kuaishou' 或 'douyin'
    
    logger.info(`📦 当前项目: ${projectName}，profile=${profileName}`);
    
    const pidFiles = [
      PID_FILE,
      path.join(__dirname, '..', `.dev-server.${profileName}.pid`), // 兼容旧位置
      path.join(__dirname, '..', `.dev-server.douyin.${profileName}.pid`),
      path.join(__dirname, '..', `.dev-server.${profileName}.douyin.pid`),
    ];

    // 1. 检查 PID 文件（只清理当前项目的旧进程）
    for (const pidFile of pidFiles) {
      if (!fs.existsSync(pidFile)) continue;
      const oldPid = parseInt(fs.readFileSync(pidFile, 'utf8').trim());
      try {
        process.kill(oldPid, 0); // 检查进程是否存在
        logger.info(`🔄 发现当前 profile 的旧进程 (PID: ${oldPid})，正在清理...`);
        process.kill(oldPid, 'SIGTERM');
        await new Promise(resolve => setTimeout(resolve, 1000));
      } catch (e) {
        // 进程不存在，忽略
      }
      try {
        fs.unlinkSync(pidFile);
      } catch (e) {
        // 文件可能已被删除，忽略
      }
    }

    // 2. 端口占用仅记录，不做强杀，避免误杀多开的其他 profile
    try {
      const { stdout } = await execAsync(`lsof -ti :${BASE_PORT}`);
      const pids = stdout.trim().split('\n').filter(p => p);
      if (pids.length > 0) {
        logger.info(`🔧 端口 ${BASE_PORT} 被 ${pids.length} 个进程占用，跳过清理，稍后自动寻找下一个端口`);
      }
    } catch (error) {
      // 没有进程占用端口，继续
    }

    // 3. 清理当前项目路径下的僵尸进程（精确匹配，不影响其他项目）
    try {
      const { stdout } = await execAsync(`ps aux | grep "${projectName}/dev/server.js" | grep -v grep`);
      const lines = stdout.trim().split('\n').filter(line => line.trim());
      
      if (lines.length > 0) {
        for (const line of lines) {
          const parts = line.trim().split(/\s+/);
          const pid = parseInt(parts[1]);
          
          // 跳过当前进程
          if (pid && pid !== process.pid) {
            try {
        logger.info(`🧹 清理当前项目的僵尸进程: ${pid}`);
              process.kill(pid, 'SIGKILL');
            } catch (e) {
              // 忽略错误
            }
          }
        }
      }
    } catch (error) {
      // 没有找到僵尸进程，继续
    }
    
    console.log('✅ 当前项目的旧进程清理完成');
  } catch (error) {
    console.warn('清理旧进程时出错:', error.message);
  }
}

// API 路由
// 健康检查
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', message: '服务运行正常' });
});

// 按平台前缀挂载接口，兼容 /api/* 为抖音别名
function mountPlatformRoutes(prefix, apis) {
  const base = prefix ? `/${prefix}` : '';

  app.post(`${base}/manual-login`, async (req, res) => {
    try {
      const result = await apis.manualLogin();
      res.json(result);
    } catch (error) {
      res.status(500).json({ success: false, error: error.message });
    }
  });

  app.get(`${base}/check-status`, async (req, res) => {
    try {
      const status = await apis.checkLoginStatus();
      res.json({
        success: true,
        loggedIn: status.loggedIn,
        message: status.loggedIn ? '已登录' : '未登录',
        error: status.error
      });
    } catch (error) {
      res.status(500).json({ success: false, error: error.message });
    }
  });

  app.post(`${base}/publish`, async (req, res) => {
    try {
      const { title, description, tags } = req.body;
      const videoPath = req.body.videoPath || req.body.path;
      const result = await apis.publishVideo({ title, description, tags, videoPath });
      res.json(result);
    } catch (error) {
      res.status(500).json({ success: false, error: error.message });
    }
  });

  app.post(`${base}/publish-images`, async (req, res) => {
    try {
      const { title, description, tags, music } = req.body;
      let imagePaths = req.body.imagePaths || req.body.paths || req.body.path;
      if (typeof imagePaths === 'string') {
        imagePaths = [imagePaths];
      }
      const result = await apis.publishImages({ title, description, tags, imagePaths, music });
      res.json(result);
    } catch (error) {
      res.status(500).json({ success: false, error: error.message });
    }
  });

  app.post(`${base}/logout`, async (req, res) => {
    try {
      const result = await apis.logout();
      res.json(result);
    } catch (error) {
      res.status(500).json({ success: false, error: error.message });
    }
  });

  // 可选：获取页面 HTML（仅部分平台实现）
  if (typeof apis.fetchProfileHtml === 'function') {
    app.get(`${base}/fetch-profile-html`, async (req, res) => {
      try {
        const { userId } = req.query;
        const result = await apis.fetchProfileHtml(userId);
        res.json(result);
      } catch (error) {
        res.status(500).json({ success: false, error: error.message });
      }
    });
  }
}

mountPlatformRoutes('api', platformModules.douyin); // 兼容旧路径，默认抖音
mountPlatformRoutes('douyin', platformModules.douyin);
mountPlatformRoutes('ks', platformModules.kuaishou);
mountPlatformRoutes('kuaishou', platformModules.kuaishou);
mountPlatformRoutes('xhs', platformModules.xiaohongshu);
mountPlatformRoutes('xiaohongshu', platformModules.xiaohongshu);

// 检查端口是否可用
function isPortAvailable(port) {
  return new Promise((resolve) => {
    const server = net.createServer();
    
    server.listen(port, () => {
      server.once('close', () => resolve(true));
      server.close();
    });
    
    server.on('error', () => resolve(false));
  });
}

// 启动服务
async function startServer() {
  try {
    // 首先清理旧进程
    console.log('🔍 检查并清理旧进程...');
    await killOldServers();
    await new Promise(resolve => setTimeout(resolve, 500));
    
    let port = BASE_PORT;
    let attempts = 0;
    const maxAttempts = 10;
    
    // 尝试找到可用端口
    while (attempts < maxAttempts) {
      const available = await isPortAvailable(port);
      if (available) {
        break;
      }
      port++;
      attempts++;
    }
    
    if (attempts >= maxAttempts) {
      throw new Error(`无法找到可用端口，已尝试 ${maxAttempts} 次`);
    }
    
    if (port !== BASE_PORT) {
      console.log(`⚠️  端口 ${BASE_PORT} 被占用，使用端口 ${port}`);
    }
    
    app.listen(port, () => {
      // 写入 PID 文件
      fs.mkdirSync(PID_DIR, { recursive: true });
      fs.writeFileSync(PID_FILE, process.pid.toString());
      
      console.log(`🚀 开发服务器已启动: http://localhost:${port}`);
      console.log(`📝 进程 PID: ${process.pid}`);
      console.log(`🧭 Profile: ${profileName}, PID 文件: ${PID_FILE}`);
      console.log(`📝 API 文档:`);
      console.log(`   GET  /api/health - 健康检查`);
      console.log(`   POST /api/manual-login - 手动登录（抖音，兼容路径）`);
      console.log(`   GET  /api/check-status - 检测登录状态（抖音，兼容路径）`);
      console.log(`   POST /api/publish - 自动发布视频（抖音，兼容路径）`);
      console.log(`   POST /api/publish-images - 发布图文（抖音，兼容路径）`);
      console.log(`   POST /api/logout - 退出登录（抖音，兼容路径）`);
      console.log(`   --- 多平台前缀 ---`);
      console.log(`   抖音:       /douyin/*`);
      console.log(`   快手:       /ks/* 或 /kuaishou/*`);
      console.log(`   小红书:     /xhs/* 或 /xiaohongshu/*`);
      console.log(`\n📋 使用流程:`);
      console.log(`   1. 首次使用：调用 POST /douyin/manual-login，手动登录并发布一个作品`);
      console.log(`   2. 检测状态：调用 GET /douyin/check-status 检查是否已登录`);
      console.log(`   3. 发布视频：调用 POST /douyin/publish 自动发布视频`);
      console.log(`   4. 发布图文：调用 POST /douyin/publish-images 发布图文`);
    });
  } catch (error) {
    console.error('服务启动失败:', error);
    await closeBrowser();
    process.exit(1);
  }
}

// 优雅关闭
async function gracefulShutdown(signal) {
  console.log(`\n收到 ${signal} 信号，正在关闭服务...`);
  
  // 删除 PID 文件
  try {
    if (fs.existsSync(PID_FILE)) {
      fs.unlinkSync(PID_FILE);
      console.log('✅ 已清理 PID 文件');
    }
  } catch (e) {
    // 忽略错误
  }
  
  // 关闭浏览器
  await closeBrowser();
  console.log('✅ 服务已关闭');
  process.exit(0);
}

process.on('SIGINT', () => gracefulShutdown('SIGINT'));
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));

// 处理未捕获的异常
process.on('uncaughtException', async (error) => {
  console.error('未捕获的异常:', error);
  await closeBrowser();
  process.exit(1);
});

process.on('unhandledRejection', async (reason, promise) => {
  console.error('未处理的 Promise 拒绝:', reason);
  await closeBrowser();
  process.exit(1);
});

// 启动
startServer();
