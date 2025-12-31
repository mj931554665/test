const { chromium } = require('playwright-extra');
const stealth = require('puppeteer-extra-plugin-stealth')();
chromium.use(stealth);

const path = require('path');
const fs = require('fs');
const { resolveProfileDir } = require('./profile');
const { createLogger } = require('./logger');

// 多 profile 浏览器实例缓存
const contexts = new Map(); // key: profileDir, value: { context, page, headless, profileName }
const logger = createLogger('browser');

// 清理浏览器锁文件
function cleanupBrowserLocks(userDataDir) {
  try {
    const singletonLock = path.join(userDataDir, 'SingletonLock');
    const singletonSocket = path.join(userDataDir, 'SingletonSocket');

    if (fs.existsSync(singletonLock)) {
      fs.unlinkSync(singletonLock);
    }
    if (fs.existsSync(singletonSocket)) {
      fs.unlinkSync(singletonSocket);
    }
  } catch (error) {
    // 静默处理，锁文件可能不存在或已被删除
  }
}

// 初始化浏览器
async function initBrowser(headlessInput = null, viewport = null, profileInput = null) {
  // 生产环境或 Linux 环境强制默认无头
  const isLinux = process.platform === 'linux';
  const isProd = process.env.NODE_ENV === 'production';

  let headless = headlessInput;
  if (headless === null) {
    headless = isLinux || isProd;
  } else if (isLinux && headless === false) {
    // Linux 下如果不显示指定，且尝试开启有头模式，则记录警告并强制无头（除非有 XServer，但目前我们假设没有）
    logger.warn('Linux 环境下无法开启有头模式，已强制切换为无头模式');
    headless = true;
  }

  // 默认分辨率：如果不指定则使用 1920x1080
  const defaultViewport = viewport || { width: 1920, height: 1080 };

  const { profileDir, profileName } = resolveProfileDir(profileInput);
  let state = contexts.get(profileDir);

  // 若已有上下文但已被关闭（例如手动关掉窗口），则重建
  if (state && state.context && state.context.isClosed && state.context.isClosed()) {
    contexts.delete(profileDir);
    state = null;
  }
  if (state && state.page && state.page.isClosed && state.page.isClosed()) {
    state.page = null;
  }

  if (state && state.context && state.headless === headless) {
    logger.info('复用已有浏览器上下文', { headless, profile: profileName });
    if (!state.page) {
      state.page = state.context.pages()[0] || await state.context.newPage();
    }
    return { context: state.context, page: state.page };
  }

  // 先关闭旧的（同 profile）浏览器实例
  if (state && state.context) {
    try {
      await state.context.close();
    } catch (error) {
      // 静默处理
    }
    contexts.delete(profileDir);
  }

  try {
    const userDataDir = profileDir;

    // 清理锁文件，避免浏览器实例冲突
    cleanupBrowserLocks(userDataDir);

    // 等待一小段时间，确保锁文件被释放
    await new Promise(resolve => setTimeout(resolve, 500));

    // 统一使用内置的 chromium 确保本地与线上表现完全一致
    const channel = undefined;

    // 使用 Windows Chrome User-Agent 减少被识别为数据中心实例的概率
    const userAgent = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

    const context = await chromium.launchPersistentContext(userDataDir, {
      headless: headless,
      viewport: defaultViewport,
      channel: channel,
      userAgent: userAgent,
      ignoreHTTPSErrors: true,
      args: [
        '--disable-blink-features=AutomationControlled',
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--hide-scrollbars',
        '--mute-audio',
        '--disable-infobars',
        '--window-size=1920,1080',
        '--disable-dev-shm-usage',
      ]
    });

    // launchPersistentContext 会自动创建一个页面，使用现有的而不是新建
    const page = context.pages()[0] || await context.newPage();
    contexts.set(profileDir, { context, page, headless, profileName });

    logger.info('浏览器启动成功', { pages: context.pages().length });
    return { context, page };
  } catch (error) {
    // 如果还是失败，再次清理锁文件并重试一次
    const userDataDir = profileDir;
    cleanupBrowserLocks(userDataDir);
    await new Promise(resolve => setTimeout(resolve, 1000));

    try {
      logger.warn('初始化失败，重试一次', error.message);
      const channel = undefined;
      const userAgent = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

      const context = await chromium.launchPersistentContext(userDataDir, {
        headless: headless,
        viewport: defaultViewport,
        channel: channel,
        userAgent: userAgent,
        ignoreHTTPSErrors: true,
        args: [
          '--disable-blink-features=AutomationControlled',
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--hide-scrollbars',
          '--mute-audio',
          '--disable-infobars',
          '--window-size=1920,1080',
          '--disable-dev-shm-usage',
        ]
      });
      // launchPersistentContext 会自动创建一个页面，使用现有的而不是新建
      const page = context.pages()[0] || await context.newPage();
      contexts.set(profileDir, { context, page, headless, profileName });
      logger.info('浏览器重试成功');
      return { context, page };
    } catch (retryError) {
      logger.error('浏览器初始化失败', retryError.message);
      throw new Error(`浏览器初始化失败: ${retryError.message}`);
    }
  }
}

// 关闭浏览器
async function closeBrowser(profileInput = null) {
  const closeAll = typeof profileInput === 'object' && profileInput && profileInput.all;
  if (closeAll) {
    for (const [dir, state] of contexts.entries()) {
      if (state.context) {
        try {
          await state.context.close();
          logger.info('浏览器已关闭', { profileDir: dir, profile: state.profileName });
        } catch (error) {
          // 静默处理
        }
      }
      contexts.delete(dir);
    }
    return;
  }

  const { profileDir, profileName } = resolveProfileDir(profileInput);
  const state = contexts.get(profileDir);
  if (state && state.context) {
    try {
      await state.context.close();
      logger.info('浏览器已关闭', { profile: profileName });
    } catch (error) {
      // 静默处理
    }
    contexts.delete(profileDir);
  }
}

// 获取当前页面实例
function getPage(profileInput = null) {
  const { profileDir } = resolveProfileDir(profileInput);
  const state = contexts.get(profileDir);
  if (!state || !state.page || (state.page.isClosed && state.page.isClosed())) {
    throw new Error('浏览器未初始化，请先调用 initBrowser()');
  }
  return state.page;
}

function getProfileDir(profileInput = null) {
  return resolveProfileDir(profileInput).profileDir;
}

module.exports = {
  initBrowser,
  closeBrowser,
  getPage,
  getProfileDir,
};
