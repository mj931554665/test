const fs = require('fs');
const path = require('path');
const { initBrowser, getPage, closeBrowser, getProfileDir } = require('./browser');
const { debugSnapshot, smartFindElement, DESC_SELECTORS, moveCursorToEnd, clearContentEditable } = require('./utils');
const { createLogger } = require('./logger');
const { readEnvValue } = require('./config');
const { inputText, addTags, waitUploadDone, clickPublish } = require('./platform-runner');
const { checkForbidden } = require('./forbidden');
const douyinConfig = require('../platforms/douyin.config');

const logger = createLogger('douyin');
const log = logger.info;
const warn = logger.warn;
const error = logger.error;
const stepLog = logger.step;

// 通过环境变量控制是否无头。HEADLESS=false|0|off 视为有头，其余默认为无头
function resolveHeadless() {
  const val = process.env.HEADLESS || readEnvValue('HEADLESS');
  if (!val) return true;
  const lowered = val.toLowerCase();
  return !['false', '0', 'off', 'no'].includes(lowered);
}
const DEFAULT_HEADLESS = resolveHeadless();

// 在 page.goto 报错页面崩溃时，自动重启浏览器并重试一次
async function gotoWithRecovery(page, url, options, headless = true) {
  try {
    await page.goto(url, options);
    return page;
  } catch (err) {
    if (err?.message && err.message.includes('Page crashed')) {
      warn('检测到页面崩溃，正在重启浏览器后重试', { url });
      try {
        await closeBrowser();
      } catch (e) {
        // 忽略关闭异常
      }
      const { page: newPage } = await initBrowser(headless);
      await newPage.goto(url, options);
      return newPage;
    }
    throw err;
  }
}

// 检查登录状态
async function checkLoginStatus() {
  stepLog('检查登录状态');
  const { page } = await initBrowser(DEFAULT_HEADLESS);

  try {
    await page.goto('https://creator.douyin.com/creator-micro/content/upload', {
      waitUntil: 'domcontentloaded',
      timeout: 30000
    });

    await page.waitForTimeout(3000);

    // 检查是否有上传按钮（已登录的明确标志）
    const uploadButton = await page.$('button:has-text("上传视频"), button:has-text("点击上传")');

    if (uploadButton) {
      return { loggedIn: true };
    }

    return { loggedIn: false };
  } catch (error) {
    return { loggedIn: false, error: error.message };
  }
}

// 手动登录
async function manualLogin() {
  stepLog('手动登录（有头模式）');
  // 使用较小的分辨率（1470x956），方便在小屏幕上操作
  const { page } = await initBrowser(false, { width: 1470, height: 756 });

  await page.goto('https://creator.douyin.com/creator-micro/content/upload', {
    waitUntil: 'domcontentloaded',
    timeout: 30000
  });

  return {
    success: true,
    message: '页面已打开（有头模式），请手动登录并发布一个作品，完成后 Cookie 会自动保存',
    url: page.url()
  };
}

// 发布视频
async function publishVideo({ title, description, tags, videoPath }) {
  stepLog('发布视频', { title, videoPath, tags: tags?.length || 0 });
  // 使用无头模式（生产环境）
  const { page } = await initBrowser(DEFAULT_HEADLESS);
  const DEBUG = false; // 关闭调试模式（生产环境）

  // 验证参数
  if (!title) {
    throw new Error('标题不能为空');
  }

  if (!videoPath) {
    throw new Error('视频路径不能为空');
  }

  if (!fs.existsSync(videoPath)) {
    throw new Error('视频文件不存在: ' + videoPath);
  }

  // 违禁词校验
  const fullText = [title, description, ...(tags || [])].filter(Boolean).join(' ');
  const hits = checkForbidden(fullText);
  if (hits.length > 0) {
    throw new Error(`内容包含违禁词: ${hits.join(', ')}`);
  }

  // 1. 打开上传页面
  log('\n📄 步骤 1: 打开上传页面...');
  await page.goto('https://creator.douyin.com/creator-micro/content/upload', {
    waitUntil: 'domcontentloaded',
    timeout: 30000
  });

  await page.waitForTimeout(3000);
  if (DEBUG) await debugSnapshot('video-step1-open-page', page);

  // 2. 检查登录状态
  log('\n🔍 步骤 2: 检查登录状态...');
  // 检查是否有上传按钮（已登录标志）
  const uploadButtonCheck = await page.$('button:has-text("上传视频"), button:has-text("点击上传")');

  if (!uploadButtonCheck) {
    if (DEBUG) await debugSnapshot('video-step2-not-logged-in', page);
    throw new Error('未登录，请先调用 douyin_login 进行登录');
  }
  log('   ✅ 已登录');

  // 3. 上传视频
  log('\n🎥 步骤 3: 上传视频...');
  log(`   视频文件: ${videoPath}`);

  let uploadButton = await page.$('text=上传视频');
  if (!uploadButton) {
    uploadButton = await page.$('button:has-text("上传视频")');
  }
  if (!uploadButton) {
    const fileInput = await page.$('input[type="file"]');
    if (fileInput) {
      log('   通过文件输入框上传...');
      await fileInput.setInputFiles(videoPath);
      await page.waitForTimeout(3000);
    } else {
      if (DEBUG) await debugSnapshot('video-step3-no-upload-button', page);
      throw new Error('未找到上传视频按钮或文件输入框');
    }
  } else {
    log('   通过上传按钮上传...');
    const [fileChooser] = await Promise.all([
      page.waitForEvent('filechooser'),
      uploadButton.click()
    ]);
    await fileChooser.setFiles([videoPath]);
    await page.waitForTimeout(3000);
  }

  log('   ✅ 视频已选择，等待上传...');
  if (DEBUG) await debugSnapshot('video-step3-video-selected', page);

  // 4. 等待跳转到发布页面
  log('\n⏳ 步骤 4: 等待页面跳转到发布页面...');
  try {
    await page.waitForURL('**/content/post/video**', { timeout: 30000 });
    log('   ✅ 已跳转到发布页面');
    log(`   📍 当前URL: ${page.url()}`);
  } catch (error) {
    log('   ⚠️  等待页面跳转超时，继续执行...');
    log(`   📍 当前URL: ${page.url()}`);
  }
  await page.waitForTimeout(3000);
  if (DEBUG) await debugSnapshot('video-step4-page-loaded', page);

  // 5. 等待视频上传完成（直接轮询发布按钮是否可用）
  log('\n⏳ 步骤 5: 等待视频上传完成...');
  let uploadComplete = false;
  const maxWaitTime = 600000; // 10 分钟
  const startTime = Date.now();
  let lastStatus = null;

  while (!uploadComplete && (Date.now() - startTime) < maxWaitTime) {
    const uploadStatus = await page.evaluate(() => {
      const titleInput = document.querySelector('textbox[placeholder*="标题"], input[placeholder*="标题"]');
      const hasVideoPreview = !!document.querySelector('video, [class*="video"], [class*="preview"]');
      const uploadProgress = Array.from(document.querySelectorAll('*')).find(el => {
        const text = el.textContent || '';
        return (text.includes('%') && (text.includes('上传') || text.includes('解析'))) ||
          text.includes('上传中') || text.includes('解析中') || text.includes('文件解析中');
      });
      const completeText = Array.from(document.querySelectorAll('*')).find(el => {
        const text = el.textContent || '';
        return text.includes('上传完成') || text.includes('解析完成');
      });
      const failText = Array.from(document.querySelectorAll('*')).find(el => {
        const text = el.textContent || '';
        return text.includes('上传失败') || text.includes('解析失败');
      });

      // 直接寻找发布按钮
      const publishBtn = document.querySelector('#popover-tip-container > button') ||
        Array.from(document.querySelectorAll('button')).find(btn => (btn.innerText || '').includes('发布'));
      const publishReady = !!(publishBtn &&
        publishBtn.offsetParent !== null &&
        !publishBtn.disabled &&
        publishBtn.getAttribute('aria-disabled') !== 'true' &&
        !(publishBtn.className || '').toLowerCase().includes('disabled'));

      return {
        hasTitleInput: !!titleInput,
        hasVideoPreview: hasVideoPreview,
        hasUploadProgress: !!uploadProgress,
        hasCompleteText: !!completeText,
        hasFailText: !!failText,
        publishVisible: !!publishBtn,
        publishReady,
        currentUrl: window.location.href
      };
    });

    const statusStr = JSON.stringify(uploadStatus);
    if (statusStr !== lastStatus) {
      log(`📊 上传状态: ${statusStr}`);
      lastStatus = statusStr;
    }

    if (uploadStatus.publishReady) {
      uploadComplete = true;
      log('✅ 视频上传完成（发布按钮已可点击）');
      break;
    }

    if (uploadStatus.hasFailText) {
      throw new Error('视频上传失败');
    }

    await page.waitForTimeout(2000);
  }

  if (!uploadComplete) {
    warn('   ⚠️  上传等待超时，但继续执行...');
  }
  await page.waitForTimeout(2000);
  if (DEBUG) await debugSnapshot('video-step5-upload-complete', page);

  // 5.5. 关闭新手引导（如果有）
  log('\n⏳ 步骤 5.5: 关闭新手引导（如果有）...');
  try {
    // 尝试多种方式关闭新手引导
    const guideButtons = [
      'button:has-text("跳过")',
      'button:has-text("知道了")',
      'button:has-text("下一步")',
      'button:has-text("Skip")',
      '[class*="skip"]',
      '[class*="close"]'
    ];

    for (const selector of guideButtons) {
      const button = await page.$(selector);
      if (button) {
        await button.click();
        await page.waitForTimeout(500);
        log('   ✅ 已关闭新手引导（通过按钮）');
        break;
      }
    }

    // 如果还有遮罩层，按 ESC 键或直接移除
    const overlay = await page.$('[class*="joyride"]');
    if (overlay) {
      await page.keyboard.press('Escape');
      await page.waitForTimeout(500);

      // 如果还在，直接移除 DOM
      await page.evaluate(() => {
        const overlays = document.querySelectorAll('[class*="joyride"]');
        overlays.forEach(el => el.remove());
      });
      log('   ✅ 已强制移除新手引导');
    }
  } catch (error) {
    // 忽略，可能没有引导
  }

  // 6. 填写标题
  log('\n📝 步骤 6: 填写标题...');
  if (DEBUG) await debugSnapshot('video-step6-before-title', page);

  const titleSelectors = [
    'textbox[placeholder*="填写作品标题"]',
    'input[placeholder*="标题"]',
    'textarea[placeholder*="标题"]',
    'input[type="text"]',
    'textarea'
  ];

  const titleInput = await smartFindElement(page, titleSelectors, '标题输入框');

  if (titleInput) {
    await titleInput.click();
    await page.waitForTimeout(200);
    await titleInput.fill(title);
    await page.waitForTimeout(500);
    log(`   ✅ 标题已填写: ${title}`);
  } else {
    warn('   ⚠️  未找到标题输入框，尝试使用键盘输入');
    await page.keyboard.type(title, { delay: 100 });
    await page.waitForTimeout(500);
  }

  if (DEBUG) await debugSnapshot('video-step6-after-title', page);

  // 7. 填写简介和标签（按照正确流程：先简介，后逐个添加tag）
  log('\n📝 步骤 7: 填写简介和标签...');
  if (DEBUG) await debugSnapshot('video-step7-before-description', page);

  let descInput = await smartFindElement(page, DESC_SELECTORS, '简介输入框');

  if (descInput) {
    log('✅ 找到简介输入框，开始填写...');

    // 步骤1: 清空输入框
    await clearContentEditable(descInput);
    await page.waitForTimeout(300);

    // 步骤2: 如果有简介，先输入简介
    if (description) {
      // 确保光标在开头（没有换行）
      await descInput.evaluate((el) => {
        el.focus();
        const range = document.createRange();
        const selection = window.getSelection();
        range.selectNodeContents(el);
        range.collapse(true); // 移动到开头
        selection.removeAllRanges();
        selection.addRange(range);
      });
      await page.waitForTimeout(200);

      // 获取元素的 selector，使用 locator 进行输入（ElementHandle 没有 pressSequentially 方法）
      const selector = await descInput.evaluate((el) => {
        // 尝试生成唯一的选择器
        if (el.id) return `#${el.id}`;
        if (el.className) {
          const classes = el.className.split(' ').filter(c => c).join('.');
          if (classes) return `.${classes}`;
        }
        return null;
      });

      // 使用 locator 或直接使用 keyboard.type
      if (selector) {
        try {
          await page.locator(selector).pressSequentially(description, { delay: 50 });
        } catch (error) {
          // 如果 locator 失败，使用 keyboard.type
          await descInput.focus();
          await page.keyboard.type(description, { delay: 50 });
        }
      } else {
        // 直接使用 keyboard.type
        await descInput.focus();
        await page.keyboard.type(description, { delay: 50 });
      }
      await page.waitForTimeout(800);

      log(`✅ 简介已输入: ${description.substring(0, 50)}...`);
    }

    // 步骤3: 如果有标签，逐个添加（每个tag输入后按空格）
    if (tags && Array.isArray(tags) && tags.length > 0) {
      log(`📝 开始添加 ${tags.length} 个标签...`);

      // 获取 selector 用于后续输入
      const selector = await descInput.evaluate((el) => {
        if (el.id) return `#${el.id}`;
        if (el.className) {
          const classes = el.className.split(' ').filter(c => c).join('.');
          if (classes) return `.${classes}`;
        }
        return null;
      });

      for (let i = 0; i < tags.length; i++) {
        try {
          const tag = tags[i].startsWith('#') ? tags[i] : `#${tags[i]}`;

          // 确保光标在末尾
          await moveCursorToEnd(descInput);
          await page.waitForTimeout(200);

          // 输入 tag（前面加空格）
          if (selector) {
            try {
              await page.locator(selector).pressSequentially(` ${tag}`, { delay: 50 });
            } catch (error) {
              await descInput.focus();
              await page.keyboard.type(` ${tag}`, { delay: 50 });
            }
          } else {
            await descInput.focus();
            await page.keyboard.type(` ${tag}`, { delay: 50 });
          }
          await page.waitForTimeout(1200);

          // 按空格而不是回车，防止页面跳转
          await page.keyboard.press('Space');
          await page.waitForTimeout(800);

          log(`   ✅ 标签 ${i + 1}/${tags.length} 已添加: ${tag}`);
        } catch (error) {
          warn(`   ⚠️  标签 ${i + 1}/${tags.length} 添加失败: ${tags[i]}, 错误: ${error.message}`);
          // 继续处理下一个标签
        }
      }

      log(`   ✅ 所有标签已添加完成`);
    }

    if (DEBUG) await debugSnapshot('video-step7-after-description', page);
  } else {
    warn('⚠️  未找到简介输入框，尝试使用 JavaScript 直接设置');
    const result = await page.evaluate(({ desc, tagList, selectors }) => {
      for (const selector of selectors) {
        const editor = document.querySelector(selector);
        if (editor) {
          // 清空
          editor.innerHTML = '';
          editor.textContent = '';

          // 设置简介
          if (desc) {
            editor.textContent = desc;
          }

          editor.dispatchEvent(new Event('input', { bubbles: true }));

          // 返回找到的元素信息，用于后续处理标签
          return { success: true, selector };
        }
      }
      return { success: false };
    }, { desc: description || '', tagList: tags || [], selectors: DESC_SELECTORS });

    if (result.success) {
      log('✅ 通过备用方案设置简介成功');

      // 备用方案：尝试添加标签（如果可能）
      if (tags && Array.isArray(tags) && tags.length > 0) {
        warn('⚠️  备用方案无法自动添加标签，标签需要手动添加');
      }
    } else {
      error('❌ 所有方式都失败，无法设置简介');
    }
    await page.waitForTimeout(300);
  }

  // 8. 等待内容检测完成
  log('\n⏳ 步骤 8: 等待内容检测完成...');
  try {
    await page.waitForFunction(() => {
      const checkText = Array.from(document.querySelectorAll('*')).find(el => {
        const text = el.textContent || '';
        return text.includes('作品未见异常') || text.includes('检测完成') ||
          text.includes('检测中') === false;
      });
      return !!checkText;
    }, { timeout: 30000 });
    log('   ✅ 内容检测完成');
  } catch (error) {
    warn('   ⚠️  等待检测超时，继续执行...');
  }
  await page.waitForTimeout(2000);
  if (DEBUG) await debugSnapshot('video-step8-check-complete', page);

  // 9. 发布前验证内容
  log('\n🔍 步骤 9: 发布前验证内容...');
  const beforePublishCheck = await page.evaluate(({ expectedTitle, expectedDesc, selectors }) => {
    const titleInput = document.querySelector('textbox[placeholder*="标题"], input[placeholder*="标题"]');
    // 使用第一个匹配的选择器查找简介编辑器
    let descEditor = null;
    for (const selector of selectors) {
      descEditor = document.querySelector(selector);
      if (descEditor) break;
    }

    const titleOk = titleInput && titleInput.value && titleInput.value.includes(expectedTitle.substring(0, 5));
    const descOk = !expectedDesc || (descEditor && descEditor.textContent && descEditor.textContent.includes(expectedDesc.substring(0, 10)));

    return {
      titleOk: titleOk,
      descOk: descOk,
      titleValue: titleInput ? titleInput.value : null,
      descValue: descEditor ? descEditor.textContent.substring(0, 50) : null
    };
  }, {
    expectedTitle: title,
    expectedDesc: description || '',
    selectors: DESC_SELECTORS
  });

  log('   📊 发布前内容验证:', JSON.stringify(beforePublishCheck, null, 2));

  if (!beforePublishCheck.titleOk) {
    warn('   ⚠️  标题内容丢失，重新填写...');
    const titleInput = await page.$('textbox[placeholder*="标题"], input[placeholder*="标题"]');
    if (titleInput) {
      await titleInput.fill(title);
      await page.waitForTimeout(500);
    }
  }

  if (!beforePublishCheck.descOk && description) {
    warn('   ⚠️  简介内容丢失，重新填写...');
    const descInput = await smartFindElement(page, DESC_SELECTORS, '简介输入框');
    if (descInput) {
      await descInput.click();
      await page.waitForTimeout(300);
      await descInput.evaluate((el, text) => {
        el.textContent = text;
        el.dispatchEvent(new InputEvent('input', { bubbles: true }));
      }, description);
      await page.waitForTimeout(1000);
    }
  }

  // 10. 点击发布按钮
  log('\n📤 步骤 10: 点击发布按钮...');
  log('   ⏳ 等待页面完全稳定...');
  await page.waitForTimeout(2000);

  const currentUrlBeforePublish = page.url();
  log(`   📍 当前URL: ${currentUrlBeforePublish}`);

  if (!currentUrlBeforePublish.includes('/content/post/video')) {
    if (DEBUG) await debugSnapshot('video-step10-wrong-page', page);
    throw new Error('页面已跳转，不在发布页面: ' + currentUrlBeforePublish);
  }

  if (DEBUG) await debugSnapshot('video-step10-before-click', page);
  log('   🖱️  尝试点击发布按钮...');

  // 尝试点击发布按钮
  const buttonClicked = await page.evaluate(() => {
    try {
      const btn = document.querySelector('#popover-tip-container > button');
      if (btn) {
        btn.click();
        return true;
      }
      return false;
    } catch (e) {
      return false;
    }
  });

  if (!buttonClicked) {
    log('   通过 Playwright API 查找发布按钮...');
    let publishButton = await page.$('#popover-tip-container > button');
    if (!publishButton) {
      publishButton = await page.$('text=发布');
    }
    if (!publishButton) {
      publishButton = await page.$('button:has-text("发布")');
    }
    if (!publishButton) {
      const buttons = await page.$$('button');
      for (const btn of buttons) {
        const text = await btn.textContent();
        if (text && text.includes('发布')) {
          publishButton = btn;
          break;
        }
      }
    }

    if (!publishButton) {
      if (DEBUG) await debugSnapshot('video-step10-no-button', page);
      throw new Error('未找到发布按钮');
    }

    const isVisible = await publishButton.isVisible().catch(() => true);
    const isEnabled = await publishButton.isEnabled().catch(() => true);

    log(`   📊 发布按钮状态: 可见=${isVisible}, 可用=${isEnabled}`);

    if (!isVisible) {
      await publishButton.scrollIntoViewIfNeeded();
      await page.waitForTimeout(500);
    }

    if (!isEnabled) {
      if (DEBUG) await debugSnapshot('video-step10-button-disabled', page);
      throw new Error('发布按钮不可用');
    }

    log('   ✅ 点击发布按钮');
    await publishButton.click();
  } else {
    log('   ✅ 已通过 evaluate 点击发布按钮');
  }

  await page.waitForTimeout(2000);
  if (DEBUG) await debugSnapshot('video-step10-after-click', page);

  // 11. 等待发布结果
  log('\n⏳ 步骤 11: 等待发布结果...');

  // 等待一段时间让页面响应
  await page.waitForTimeout(3000);

  // 检查当前页面状态
  const afterClickUrl = page.url();
  log(`   📍 点击后URL: ${afterClickUrl}`);

  if (DEBUG) await debugSnapshot('video-step11-after-wait', page);

  try {
    await Promise.race([
      page.waitForURL('**/content/manage**', { timeout: 30000 }),
      page.waitForSelector('text=发布成功', { timeout: 30000 })
    ]);
    log('   ✅ 发布成功！');
    if (DEBUG) await debugSnapshot('video-step11-success', page);
  } catch (error) {
    const finalUrl = page.url();
    log(`   📍 最终URL: ${finalUrl}`);
    if (DEBUG) await debugSnapshot('video-step11-timeout', page);

    if (!finalUrl.includes('/content/manage')) {
      warn('   ⚠️  等待发布结果超时');
    } else {
      log('   ✅ 已跳转到管理页面，发布成功！');
    }
  }

  // 12. 检查是否需要验证码
  log('\n🔍 步骤 12: 检查验证状态...');
  const verifyContainer = await page.$('#uc-second-verify');
  const verifyTitle = await page.$('text=身份验证');

  if (verifyContainer || verifyTitle) {
    log('   ⚠️  需要验证码');
    if (DEBUG) await debugSnapshot('video-step12-need-verify', page);
    return {
      success: false,
      needVerify: true,
      message: '需要验证码，请手动完成验证'
    };
  }

  const currentUrl = page.url();
  const isManagePage = currentUrl.includes('/content/manage');
  const hasSuccessMsg = await page.$('text=发布成功').catch(() => null);

  log(`   📊 最终状态: 管理页面=${isManagePage}, 成功提示=${!!hasSuccessMsg}`);

  if (isManagePage || hasSuccessMsg) {
    log('   ✅ 视频发布成功！');
    return {
      success: true,
      message: '发布成功',
      url: currentUrl
    };
  } else {
    log('   ⚠️  无法确认发布状态');
    return {
      success: true,
      message: '视频已提交，正在处理中',
      url: currentUrl
    };
  }
}

// 退出登录（清除 Cookie 和浏览器数据）
async function logout() {
  try {
    stepLog('退出登录并清理数据');
    const { context } = await initBrowser(true); // 无头模式

    // 清除所有 Cookie
    await context.clearCookies();

    // 清除浏览器数据目录中的敏感文件
    const userDataDir = getProfileDir();
    const sensitiveFiles = [
      path.join(userDataDir, 'Default', 'Cookies'),
      path.join(userDataDir, 'Default', 'Cookies-journal'),
      path.join(userDataDir, 'Default', 'Login Data'),
      path.join(userDataDir, 'Default', 'Login Data-journal'),
      path.join(userDataDir, 'Default', 'Login Data For Account'),
      path.join(userDataDir, 'Default', 'Login Data For Account-journal'),
      path.join(userDataDir, 'Default', 'Local Storage'),
      path.join(userDataDir, 'Default', 'Session Storage'),
      path.join(userDataDir, 'Default', 'IndexedDB'),
    ];

    for (const file of sensitiveFiles) {
      try {
        if (fs.existsSync(file)) {
          if (fs.statSync(file).isDirectory()) {
            // 删除目录
            fs.rmSync(file, { recursive: true, force: true });
          } else {
            // 删除文件
            fs.unlinkSync(file);
          }
        }
      } catch (error) {
        // 静默处理，文件可能不存在或正在使用
      }
    }

    // 关闭浏览器
    await closeBrowser();

    return {
      success: true,
      message: '已退出登录，Cookie 和登录数据已清除'
    };
  } catch (error) {
    return {
      success: false,
      error: error.message
    };
  }
}

// 发布图文
// 音乐选择辅助函数
async function selectMusicFromList(page, music, DEBUG = false) {
  if (!music) {
    return null;
  }

  try {
    // 第一步：点击"选择音乐"按钮
    const selectMusicButton = await page.locator('div').filter({ hasText: /^选择音乐$/ }).last();
    if (!selectMusicButton) {
      throw new Error('未找到"选择音乐"按钮');
    }

    await selectMusicButton.click();
    await page.waitForTimeout(3000);
    if (DEBUG) await debugSnapshot('music1-opened', page);

    // 第二步：如果提供了音乐名称，进行搜索
    if (music.name) {
      // 等待搜索框出现
      await page.waitForSelector('input[placeholder*="搜索音乐"]', { timeout: 5000 });
      const searchBox = await page.$('input[placeholder*="搜索音乐"]');
      if (!searchBox) {
        throw new Error('未找到音乐搜索框');
      }

      await searchBox.click();
      await page.waitForTimeout(500);
      await searchBox.fill(music.name);
      await page.waitForTimeout(3000);
      if (DEBUG) await debugSnapshot('music2-searched', page);
    }

    // 第三步：等待音乐列表加载
    // 等待搜索框出现（表示弹窗已完全加载）
    await page.waitForSelector('input[placeholder*="搜索音乐"]', { timeout: 5000 }).catch(() => { });
    await page.waitForTimeout(1500);

    // 验证索引范围（支持 0-19）
    const musicIndex = music.index || 0;
    if (musicIndex < 0 || musicIndex >= 20) {
      throw new Error(`音乐序号必须在 0-19 之间，当前值: ${musicIndex}`);
    }

    // 第四步：直接点击指定索引的音乐项的"使用"按钮
    // 使用你提供的精确选择器路径（使用 nth-child 定位）
    const useButtonClicked = await page.evaluate((idx) => {
      // 尝试多个可能的选择器路径（适应不同的 DOM 结构）
      const selectors = [
        // 你提供的精确选择器（使用 nth-child）
        `body > div:nth-child(17) > div > div.semi-sidesheet-inner.semi-sidesheet-inner-wrap > div > div.semi-sidesheet-body > div.show-fRSVmd.music-selector-container-Bvb7uP > div.music-collection-tab-container-NfiQ6q > div > div.semi-tabs-content.semi-tabs-content-top > div > div > div.music-collection-container-cTsB7J > div > div:nth-child(${idx + 1}) > div > div.card-container-right-E291Fw > button`,
        // 备选方案：使用相对选择器
        `div[class*="music-collection-container"] > div > div:nth-child(${idx + 1}) > div > div.card-container-right-E291Fw > button`,
        // 最后的备选方案：根据内容查找
        (() => {
          const containers = Array.from(document.querySelectorAll('[class*="music-collection-container"] > div > div'));
          if (idx < containers.length) {
            const targetContainer = containers[idx];
            const button = targetContainer.querySelector('button');
            return button;
          }
          return null;
        })()
      ];

      for (const selector of selectors) {
        if (typeof selector === 'string') {
          const btn = document.querySelector(selector);
          if (btn && btn.offsetHeight > 0) {
            btn.click();
            return true;
          }
        } else if (selector) {
          // selector 是已经获取的元素
          selector.click();
          return true;
        }
      }

      return false;
    }, musicIndex);

    if (!useButtonClicked) {
      throw new Error(`无法点击第 ${musicIndex + 1} 个音乐的"使用"按钮`);
    }

    await page.waitForTimeout(1000);
    if (DEBUG) await debugSnapshot('music3-selected', page);

    // 等待音乐弹窗关闭和音乐信息显示
    await page.waitForTimeout(3000);
    if (DEBUG) await debugSnapshot('music4-used', page);

    // 第七步：验证音乐是否成功添加
    const musicAdded = await page.evaluate(() => {
      const text = document.body.textContent;
      return text.includes('修改音乐');
    });

    if (!musicAdded) {
      throw new Error('音乐添加失败：未检测到音乐信息');
    }

    return { success: true, message: '音乐添加成功' };
  } catch (error) {
    throw new Error(`音乐添加失败: ${error.message}`);
  }
}

async function publishImages({ title, description, tags, imagePaths, music }) {
  stepLog('发布图文', { title, images: imagePaths?.length || 0, tags: tags?.length || 0 });
  // 使用无头模式（生产环境）
  let { page } = await initBrowser(DEFAULT_HEADLESS);
  const DEBUG = false; // 关闭调试模式（生产环境）
  const cfg = douyinConfig;

  try {
    // ========== 参数校验 ==========
    // 1. 标题校验
    if (!title) {
      throw new Error('标题不能为空');
    }
    if (title.length > 20) {
      throw new Error(`标题过长（${title.length}字），最多20字`);
    }

    // 2. 图片校验
    if (!imagePaths || !Array.isArray(imagePaths) || imagePaths.length === 0) {
      throw new Error('至少需要提供一张图片');
    }

    // 验证所有图片文件是否存在
    for (const imagePath of imagePaths) {
      if (!fs.existsSync(imagePath)) {
        throw new Error(`图片文件不存在: ${imagePath}`);
      }
    }

    // 3. 标签处理和校验
    let finalTags = tags || [];

    // 如果没有提供标签，自动生成
    if (!finalTags || finalTags.length === 0) {
      // 从标题中提取关键词作为标签
      const titleWords = title.split(/[\s,，、]+/).filter(w => w.length >= 2);
      finalTags = titleWords.slice(0, 3); // 最多取3个
      if (finalTags.length === 0) {
        finalTags = ['生活', '分享']; // 默认标签
      }
    }

    // 标签数量限制
    if (finalTags.length > 5) {
      finalTags = finalTags.slice(0, 5);
    }

    // 4. 描述校验
    let finalDescription = description || '';
    stepLog('参数校验通过', {
      titleLength: title.length,
      images: imagePaths.length,
      tags: finalTags,
      hasDescription: !!finalDescription,
      music: music ? { ...music, name: music.name } : null
    });

    // 计算描述+标签的总长度
    const tagsText = finalTags.map(t => t.startsWith('#') ? t : `#${t}`).join(' ');
    const fullContent = finalDescription ? `${finalDescription} ${tagsText}` : tagsText;

    if (fullContent.length > 1000) {
      throw new Error(`内容过长（${fullContent.length}字，包含标签），最多1000字`);
    }

    // 违禁词校验
    const fullText = [title, finalDescription, ...(finalTags || [])].filter(Boolean).join(' ');
    const hits = checkForbidden(fullText);
    if (hits.length > 0) {
      throw new Error(`内容包含违禁词: ${hits.join(', ')}`);
    }

    // 1. 打开图文发布页面
    page = await gotoWithRecovery(page, cfg.openPage.url, {
      waitUntil: cfg.openPage.waitUntil || 'domcontentloaded',
      timeout: 30000
    }, DEFAULT_HEADLESS);
    await page.waitForTimeout(3000);
    stepLog('页面加载完成', { url: page.url() });
    if (DEBUG) await debugSnapshot('step1-open-page', page);

    // 1.5. 检查登录状态
    const uploadButtonCheck = await page.$('button:has-text("上传视频"), button:has-text("点击上传"), input[type="file"]');
    stepLog('登录检测', { hasUploadControl: !!uploadButtonCheck });
    if (!uploadButtonCheck) {
      throw new Error('未登录，请先调用 douyin_login 进行登录');
    }

    // 2. 上传图片
    const allInputs = [];
    for (const sel of cfg.upload.fileInputSelectors || []) {
      const found = await page.$$(sel);
      allInputs.push(...found);
    }
    stepLog('上传控件探测', { inputs: allInputs.length });
    if (allInputs.length === 0) {
      throw new Error('未找到图片上传按钮');
    }

    let uploadInput = null;
    for (const input of allInputs) {
      const isMultiple = await input.evaluate(el => el.multiple);
      if (isMultiple) {
        uploadInput = input;
        break;
      }
    }

    if (!uploadInput) {
      uploadInput = allInputs[0];
    }

    try {
      const isMultiple = await uploadInput.evaluate(el => el.multiple);
      const imageFiles = imagePaths.map(p => path.basename(p));
      stepLog('准备上传图片', { isMultiple, files: imageFiles });
      if (isMultiple) {
        await uploadInput.setInputFiles(imagePaths);
      } else {
        for (let i = 0; i < imagePaths.length; i++) {
          try {
            await uploadInput.setInputFiles(imagePaths[i]);
            stepLog('逐张上传图片', { index: i + 1, file: imageFiles[i] });
            await page.waitForTimeout(1500);
          } catch (error) {
            // 继续上传下一张
          }
        }
      }
    } catch (error) {
      // 上传出错继续
    }

    await page.waitForTimeout(3000);
    stepLog('图片上传指令完成', { count: imagePaths.length });
    if (DEBUG) await debugSnapshot('step2-images-uploaded', page);

    // 2.1 等待图片上传完成（进度条消失）
    try {
      if (cfg.upload.progressSelector) {
        stepLog('等待图片上传完成', { timeoutMs: cfg.upload.waitDoneTimeoutMs || 120000 });
        await waitUploadDone(page, cfg.upload.progressSelector, cfg.upload.waitDoneTimeoutMs || 120000, cfg.upload.waitDoneIntervalMs || 2000);
      }
    } catch (e) {
      // 上传等待失败不阻塞后续，但记录一下
      warn('等待图片上传完成时发生异常，继续后续流程', { error: e.message });
    }

    // 3. 填写标题
    const titleInput = await inputText(page, cfg.title.selectors, cfg.title.type, title, DEBUG, 'title');
    stepLog('标题已填写', { value: title });

    // 4. 填写描述和标签
    const descSelectors = (cfg.desc.selectors && cfg.desc.selectors.length > 0) ? cfg.desc.selectors : DESC_SELECTORS;
    const descInput = await inputText(page, descSelectors, cfg.desc.type, finalDescription, DEBUG, 'desc');
    stepLog('简介输入完成', { hasDescription: !!finalDescription, length: finalDescription.length });

    // 添加标签（可选独立输入框或复用 desc）
    if (cfg.tags) {
      let tagTarget = descInput;
      if (!cfg.tags.useDescInput && cfg.tags.selectors && cfg.tags.selectors.length > 0) {
        tagTarget = await smartFindElement(page, cfg.tags.selectors, null);
      }
      if (tagTarget && finalTags && Array.isArray(finalTags) && finalTags.length > 0) {
        await addTags(page, tagTarget, cfg.tags, finalTags, DEBUG);
      }
    }

    // 5. 添加音乐（如果提供了 music 参数）- 在标签输入完成后立即执行
    if (music && cfg.music && cfg.music.enabled) {
      stepLog('开始添加音乐', { music });
      try {
        await selectMusicFromList(page, music, DEBUG);
        await page.waitForTimeout(2000);
        if (DEBUG) await debugSnapshot('step5-music-added', page);
        stepLog('音乐添加完成', { music });
      } catch (musicError) {
        // 音乐添加失败时，记录警告但继续发布（不加 BGM）
        log(`⚠️  音乐添加失败: ${musicError.message}，将继续发布（不加BGM）`);
        stepLog('音乐添加失败', { error: musicError.message });
        if (DEBUG) await debugSnapshot('step5-music-failed', page);
      }
    }

    // 5.5 等待内容检测完成
    try {
      let checkComplete = false;
      const checkStartTime = Date.now();
      const urlBeforeCheck = page.url();

      stepLog('开始等待内容检测', { timeoutMs: 30000, url: urlBeforeCheck });
      while (!checkComplete && (Date.now() - checkStartTime) < 30000) {
        const currentUrl = page.url();
        if (currentUrl !== urlBeforeCheck) {
          break;
        }

        const checkText = await page.evaluate(() => {
          const text = Array.from(document.querySelectorAll('*')).find(el => {
            const t = el.textContent || '';
            return t.includes('作品未见异常') || t.includes('检测完成');
          });
          return !!text;
        });

        if (checkText) {
          checkComplete = true;
        } else {
          await page.waitForTimeout(1000);
        }
      }
      stepLog('内容检测完成', { success: checkComplete, elapsedMs: Date.now() - checkStartTime });
    } catch (error) {
      // 检测出错继续
      stepLog('内容检测异常', { error: error.message });
    }
    await page.waitForTimeout(2000);
    if (DEBUG) await debugSnapshot('step5.5-check-complete', page);

    // 6. 点击发布按钮
    await page.waitForTimeout(3000);
    if (DEBUG) await debugSnapshot('step6-before-click', page);
    await clickPublish(page, cfg.publish, DEBUG);

    // 7. 等待发布结果（兜底返回）
    return {
      success: true,
      message: '图文发布流程已完成，若无提示请手动确认',
      details: {
        title,
        description: finalDescription,
        tags: finalTags,
        imageCount: imagePaths.length,
        music: music || null,
        url: page.url()
      }
    };

  } catch (error) {
    if (DEBUG) await debugSnapshot('error', page);
    return {
      success: false,
      error: error.message
    };
  }
}

module.exports = {
  checkLoginStatus,
  manualLogin,
  publishVideo,
  publishImages,
  logout,
  initBrowser,
  getPage,
  closeBrowser
};
