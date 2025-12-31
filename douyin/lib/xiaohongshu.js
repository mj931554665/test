const fs = require('fs');
const path = require('path');
const { initBrowser, closeBrowser } = require('./browser');
const { createLogger } = require('./logger');
const { readEnvValue } = require('./config');

const logger = createLogger('xiaohongshu');
const XHS_MAX_TAGS = 10;

// HEADLESS 环境控制：false/0/off/no 为有头，其余默认无头
function resolveHeadless() {
  const val = process.env.HEADLESS || readEnvValue('HEADLESS');
  if (!val) return true;
  const lowered = val.toLowerCase();
  return !['false', '0', 'off', 'no'].includes(lowered);
}
const DEFAULT_HEADLESS = resolveHeadless();

// 检查登录状态
async function checkLoginStatus() {
  const { page } = await initBrowser(DEFAULT_HEADLESS);

  try {
    await page.goto('https://creator.xiaohongshu.com/', {
      waitUntil: 'domcontentloaded',
      timeout: 30000,
    });
    await page.waitForTimeout(3000);

    const publishEntry = await page.$('text=发布笔记') || await page.$('text=发布');
    return {
      success: true,
      loggedIn: !!publishEntry,
      message: publishEntry ? '已登录' : '未登录'
    };
  } catch (error) {
    return { success: false, loggedIn: false, error: error.message };
  }
}

// 手动登录
async function manualLogin(remote = false) {
  const headless = remote;
  const { page } = await initBrowser(headless, { width: 1470, height: 756 });

  const loginUrl = 'https://creator.xiaohongshu.com/creator/home';
  await page.goto(loginUrl, {
    waitUntil: 'domcontentloaded',
    timeout: 30000,
  });

  if (remote) {
    // 等待二维码出现并截图
    await page.waitForTimeout(3000);
    const screenshotName = `xhs-login-qr-${Date.now()}.png`;
    const screenshotPath = path.join(__dirname, '..', 'debug-screenshots', screenshotName);

    // 确保目录存在
    const screenshotDir = path.dirname(screenshotPath);
    if (!fs.existsSync(screenshotDir)) {
      fs.mkdirSync(screenshotDir, { recursive: true });
    }

    await page.screenshot({ path: screenshotPath });

    return {
      success: true,
      message: '远程登录已启动，请访问最新截图查看二维码并扫码',
      qrScreenshot: screenshotName,
      screenshotUrl: `/debug-screenshots/${screenshotName}`,
      latestScreenshot: '/api/latest-screenshot',
      tips: '扫码成功后，您可以调用 check-status 接口确认登录状态'
    };
  }

  return {
    success: true,
    message: '页面已打开（有头模式），请扫码登录小红书，完成后可关闭窗口，登录态会保留',
    url: page.url(),
  };
}

function viewportFor(headless) {
  return headless ? { width: 1920, height: 1080 } : { width: 1470, height: 840 };
}

async function publishVideo({ title, content, tags, videoPath }) {
  if (!title) throw new Error('标题不能为空');
  if (!videoPath) throw new Error('视频路径不能为空');
  if (!fs.existsSync(videoPath)) throw new Error(`视频文件不存在: ${videoPath}`);

  const headless = DEFAULT_HEADLESS;
  const { page } = await initBrowser(headless, viewportFor(headless));
  const wait = (ms) => page.waitForTimeout(ms);

  const moveCursorToEnd = async (el) => {
    await el.evaluate((node) => {
      node.focus();
      const range = document.createRange();
      range.selectNodeContents(node);
      range.collapse(false);
      const sel = window.getSelection();
      sel?.removeAllRanges();
      sel?.addRange(range);
    });
  };

  await page.goto('https://creator.xiaohongshu.com/publish/publish?from=menu&target=video', {
    waitUntil: 'domcontentloaded',
    timeout: 30000,
  });
  await wait(3000);

  const fileInput = await page.$('#web > div > div > div > div.upload-content > div.upload-wrapper > div > input');
  if (!fileInput) throw new Error('未找到上传输入框（可能未登录）');
  await fileInput.setInputFiles(videoPath);
  await wait(5000);

  const waitUploadComplete = async () => {
    let uploadComplete = false;
    const maxWait = 300000;
    const start = Date.now();
    let lastState = null;

    while (!uploadComplete && Date.now() - start < maxWait) {
      const state = await page.evaluate(() => {
        const successText = Array.from(document.querySelectorAll('*')).some((el) => {
          const t = el.textContent || '';
          return t.includes('上传成功') || t.includes('解析完成');
        });
        const titleInput = document.querySelector(
          '#publish-container > div > div.body > div.content > div.plugin.title-container > div > div > div.input > div.d-input-wrapper.d-inline-block.c-input_inner > div > input'
        );
        const contentEditable = document.querySelector(
          '#publish-container > div > div.body > div.content > div.plugin.editor-container > div > div > div.editor-container > div.editor-content > div > div'
        );
        const uploading = Array.from(document.querySelectorAll('*')).some((el) => {
          const t = el.textContent || '';
          return t.includes('上传中') || t.includes('处理中') || t.includes('%') || t.includes('解析');
        });
        const fail = Array.from(document.querySelectorAll('*')).some((el) => {
          const t = el.textContent || '';
          return t.includes('失败') || t.includes('错误');
        });
        return { hasTitle: !!titleInput, hasContentEditable: !!contentEditable, uploading, fail, successText };
      });

      const stateStr = JSON.stringify(state);
      if (stateStr !== lastState) {
        logger.info(`📊 上传状态: ${stateStr}`);
        lastState = stateStr;
      }

      if (state.fail) throw new Error('视频上传失败，请重试');
      if (state.successText || (state.hasTitle && state.hasContentEditable && !state.uploading)) {
        uploadComplete = true;
        break;
      }
      await wait(2000);
    }

    if (!uploadComplete) {
      logger.warn('⚠️ 上传等待超时，继续后续流程');
    }
  };

  await waitUploadComplete();

  const titleInput = await page.$(
    '#publish-container > div > div.body > div.content > div.plugin.title-container > div > div > div.input > div.d-input-wrapper.d-inline-block.c-input_inner > div > input'
  );
  if (!titleInput) throw new Error('未找到标题输入框');
  await titleInput.click();
  await titleInput.fill(title);
  await wait(500);

  const contentEditable = await page.$(
    '#publish-container > div > div.body > div.content > div.plugin.editor-container > div > div > div.editor-container > div.editor-content > div > div'
  );

  if (contentEditable) {
    if (content) {
      await contentEditable.click();
      await page.keyboard.type(content, { delay: 30 });
      await wait(800);
    }

    if (tags && tags.length > 0) {
      for (const rawTag of tags.slice(0, XHS_MAX_TAGS)) {
        const tag = rawTag.startsWith('#') ? rawTag : `#${rawTag}`;
        await moveCursorToEnd(contentEditable);
        await wait(200);
        await page.keyboard.type(` ${tag}`, { delay: 30 });
        await wait(500);
        const clicked = await page.evaluate(() => {
          const popup = document.querySelector('.tippy-box');
          if (!popup) return false;
          const candidate =
            popup.querySelector('[role=\"option\"]') ||
            popup.querySelector('li') ||
            popup.querySelector('button') ||
            popup.querySelector('[class*=\"tag\"]');
          if (candidate && candidate instanceof HTMLElement) {
            candidate.click();
            return true;
          }
          return false;
        });
        if (!clicked) {
          await page.keyboard.press('Enter');
          await wait(300);
        }
        await wait(500);
      }
    }
  } else {
    logger.warn('未找到内容输入框，跳过内容/标签填写');
  }

  const publishBtn = await page.$(
    '#publish-container > div.post-page > div.submit > div > button.d-button.d-button-large.--size-icon-large.--size-text-h6.d-button-with-content.--color-static.bold.--color-bg-fill.--color-text-paragraph.custom-button.red.publishBtn'
  );
  if (!publishBtn) throw new Error('未找到发布按钮');
  await publishBtn.click();
  await wait(2000);

  try {
    await page.waitForFunction(
      () =>
        document.body.textContent?.includes('发布成功') ||
        document.body.textContent?.includes('已提交') ||
        document.body.textContent?.includes('发送成功'),
      { timeout: 30000 }
    );
    return { success: true, message: '发布成功（检测到成功提示）', url: page.url() };
  } catch {
    return { success: true, message: '已点击发布，未检测到成功提示，请手动确认', url: page.url() };
  }
}

async function publishImages({ title, content, tags, imagePaths }) {
  if (!title) throw new Error('标题不能为空');
  if (!imagePaths || !Array.isArray(imagePaths) || imagePaths.length === 0) {
    throw new Error('至少需要提供一张图片');
  }
  for (const p of imagePaths) {
    if (!fs.existsSync(p)) throw new Error(`图片文件不存在: ${p}`);
  }

  const headless = DEFAULT_HEADLESS;
  const { page } = await initBrowser(headless, viewportFor(headless));
  const wait = (ms) => page.waitForTimeout(ms);

  const moveCursorToEnd = async (el) => {
    await el.evaluate((node) => {
      node.focus();
      const range = document.createRange();
      range.selectNodeContents(node);
      range.collapse(false);
      const sel = window.getSelection();
      sel?.removeAllRanges();
      sel?.addRange(range);
    });
  };

  await page.goto('https://creator.xiaohongshu.com/publish/publish?from=menu&target=image', {
    waitUntil: 'domcontentloaded',
    timeout: 30000,
  });
  await wait(3000);

  const fileInput = await page.$('#web > div > div > div > div.upload-content > div.upload-wrapper > div > input');
  if (!fileInput) throw new Error('未找到上传输入框（可能未登录）');
  await fileInput.setInputFiles(imagePaths);
  await wait(5000);

  const waitUploadComplete = async () => {
    let uploadComplete = false;
    const maxWait = 300000;
    const start = Date.now();
    let lastState = null;

    while (!uploadComplete && Date.now() - start < maxWait) {
      const state = await page.evaluate(() => {
        const successText = Array.from(document.querySelectorAll('*')).some((el) => {
          const t = el.textContent || '';
          return t.includes('上传成功') || t.includes('解析完成');
        });
        const titleInput = document.querySelector(
          '#publish-container > div > div.body > div.content > div.plugin.title-container > div > div > div.input > div.d-input-wrapper.d-inline-block.c-input_inner > div > input'
        );
        const contentEditable = document.querySelector(
          '#publish-container > div > div.body > div.content > div.plugin.editor-container > div > div > div.editor-container > div.editor-content > div > div'
        );
        const uploading = Array.from(document.querySelectorAll('*')).some((el) => {
          const t = el.textContent || '';
          return t.includes('上传中') || t.includes('处理中') || t.includes('%') || t.includes('解析');
        });
        const fail = Array.from(document.querySelectorAll('*')).some((el) => {
          const t = el.textContent || '';
          return t.includes('失败') || t.includes('错误');
        });
        return { hasTitle: !!titleInput, hasContentEditable: !!contentEditable, uploading, fail, successText };
      });

      const stateStr = JSON.stringify(state);
      if (stateStr !== lastState) {
        logger.info(`📊 上传状态: ${stateStr}`);
        lastState = stateStr;
      }

      if (state.fail) throw new Error('图片上传失败，请重试');
      if (state.successText || (state.hasTitle && state.hasContentEditable && !state.uploading)) {
        uploadComplete = true;
        break;
      }
      await wait(2000);
    }

    if (!uploadComplete) {
      logger.warn('⚠️ 上传等待超时，继续后续流程');
    }
  };

  await waitUploadComplete();

  const findFirst = async (selectors) => {
    for (const sel of selectors) {
      try {
        await page.waitForSelector(sel, { timeout: 8000 });
        const el = await page.$(sel);
        if (el) return el;
      } catch {
        // try next
      }
    }
    return null;
  };

  const titleSelectors = [
    '#web > div > div > div > div > div.body > div.content > div.plugin.title-container > div > div > div.input > div.d-input-wrapper.d-inline-block.c-input_inner > div > input',
  ];
  const contentSelectors = [
    '#web > div > div > div > div > div.body > div.content > div.plugin.editor-container > div > div > div.editor-container > div.editor-content > div > div',
  ];
  const publishSelectors = [
    '#web > div > div > div > div > div.submit > div > button.d-button.d-button-large.--size-icon-large.--size-text-h6.d-button-with-content.--color-static.bold.--color-bg-fill.--color-text-paragraph.custom-button.red.publishBtn',
  ];

  const titleInput = await findFirst(titleSelectors);
  if (!titleInput) throw new Error('未找到标题输入框');
  await titleInput.click();
  await titleInput.fill(title);
  await wait(500);

  const contentEditable = await findFirst(contentSelectors);

  if (contentEditable) {
    if (content) {
      await contentEditable.click();
      await page.keyboard.type(content, { delay: 30 });
      await wait(800);
    }

    if (tags && tags.length > 0) {
      for (const rawTag of tags.slice(0, XHS_MAX_TAGS)) {
        const tag = rawTag.startsWith('#') ? rawTag : `#${rawTag}`;
        await moveCursorToEnd(contentEditable);
        await wait(200);
        await page.keyboard.type(` ${tag}`, { delay: 30 });
        await wait(500);
        const clicked = await page.evaluate(() => {
          const popup = document.querySelector('.tippy-box');
          if (!popup) return false;
          const candidate =
            popup.querySelector('[role=\"option\"]') ||
            popup.querySelector('li') ||
            popup.querySelector('button') ||
            popup.querySelector('[class*=\"tag\"]');
          if (candidate && candidate instanceof HTMLElement) {
            candidate.click();
            return true;
          }
          return false;
        });

        if (!clicked) {
          await page.keyboard.press('Enter');
          await wait(300);
        }
        await wait(500);
      }
    }
  } else {
    logger.warn('未找到内容输入框，跳过内容/标签填写');
  }

  const publishBtn = await findFirst(publishSelectors);
  if (!publishBtn) throw new Error('未找到发布按钮');

  await publishBtn.click();
  await wait(2000);

  try {
    await page.waitForFunction(
      () =>
        document.body.textContent?.includes('发布成功') ||
        document.body.textContent?.includes('已提交') ||
        document.body.textContent?.includes('发送成功'),
      { timeout: 30000 }
    );
    return { success: true, message: '发布成功（检测到成功提示）', url: page.url() };
  } catch {
    return { success: true, message: '已点击发布，未检测到成功提示，请手动确认', url: page.url() };
  }
}

async function logout() {
  try {
    const { context } = await initBrowser(DEFAULT_HEADLESS);
    await context.clearCookies();
    return { success: true, message: 'Cookies 已清理（小红书）' };
  } catch (e) {
    return { success: false, error: e.message };
  } finally {
    await closeBrowser().catch(() => { });
  }
}

// 获取用户主页 HTML
async function fetchProfileHtml(userId) {
  if (!userId || typeof userId !== 'string') {
    return { success: false, error: 'userId 不能为空' };
  }
  const url = `https://www.xiaohongshu.com/user/profile/${userId}`;
  try {
    let { page } = await initBrowser(DEFAULT_HEADLESS);
    const gotoOptions = { waitUntil: 'domcontentloaded', timeout: 30000 };

    try {
      await page.goto(url, gotoOptions);
    } catch (err) {
      if (err?.message && err.message.includes('Page crashed')) {
        logger.warn('检测到页面崩溃，尝试重启浏览器后重试', { url });
        await closeBrowser().catch(() => { });
        const restarted = await initBrowser(false); // 崩溃后改为有头重试
        page = restarted.page;
        await page.goto(url, gotoOptions);
      } else {
        throw err;
      }
    }

    await page.waitForTimeout(3000);

    // 检测验证码
    const isCaptcha = await page.evaluate(() => {
      const captchaSelectors = [
        '#selector-captcha',
        '.sh-captcha-modal',
        '[class*="captcha"]',
        'text=身份验证',
        'text=滑动滑块'
      ];
      return captchaSelectors.some(s => {
        if (s.startsWith('text=')) {
          return document.body.textContent.includes(s.replace('text=', ''));
        }
        return !!document.querySelector(s);
      });
    });

    if (isCaptcha) {
      const screenshotName = `xhs-profile-captcha-${Date.now()}.png`;
      const screenshotPath = path.join(__dirname, '..', 'debug-screenshots', screenshotName);
      await page.screenshot({ path: screenshotPath });
      return {
        success: false,
        needVerify: true,
        message: '检测到滑块验证码，请通过控制面板处理',
        screenshotUrl: `/debug-screenshots/${screenshotName}`,
        controlPanel: '/control_panel.html'
      };
    }

    const currentUrl = page.url();
    const links = await page.$$eval('#userPostedFeeds > section > div > a.cover.mask.ld', (as) =>
      as
        .filter(a => !!a.getAttribute('href'))
        .map((a) => {
          const href = (a.getAttribute('href') || '').trim();
          const titleSpan = a.parentElement?.querySelector('div > a > span');
          const title = titleSpan ? (titleSpan.textContent || '').trim() : '';
          return { href, title };
        })
    );
    const absoluteLinks = links.map(l => {
      const abs = l.href.startsWith('http') ? l.href : new URL(l.href, currentUrl).toString();
      let id = '';
      let query = '';
      try {
        const u = new URL(abs);
        query = u.search || '';
        const parts = u.pathname.split('/').filter(Boolean);
        // 形如 /user/profile/<userId>/<noteId>
        if (parts.length >= 4) {
          id = parts[3];
        } else if (parts.length >= 1) {
          id = parts[parts.length - 1];
        }
      } catch (e) {
        id = '';
      }
      const finalUrl = id
        ? `https://www.xiaohongshu.com/discovery/item/${id}${query}`
        : abs;
      return { href: l.href, title: l.title, absolute: abs, id, finalUrl };
    });
    return { success: true, url, links: absoluteLinks };
  } catch (e) {
    return { success: false, error: e.message, url };
  }
}

module.exports = {
  checkLoginStatus,
  manualLogin,
  publishVideo,
  publishImages,
  logout,
  fetchProfileHtml,
  getPage: () => {
    try {
      const { getPage } = require('./browser');
      return getPage({ name: '19520804431' }); // 默认使用当前 profile
    } catch (e) {
      return null;
    }
  }
};
