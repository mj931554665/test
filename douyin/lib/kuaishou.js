const fs = require('fs');
const path = require('path');
const { initBrowser, getPage, closeBrowser } = require('./browser');
const { debugSnapshot, smartFindElement, moveCursorToEnd, clearContentEditable } = require('./utils');
const { readEnvValue } = require('./config');
const { checkForbidden } = require('./forbidden');
const { inputText, addTags, waitUploadDone, clickPublish } = require('./platform-runner');
const ksConfig = require('../platforms/kuaishou.config');

// HEADLESS 环境控制：false/0/off/no 为有头，其余默认无头
function resolveHeadless() {
  const val = process.env.HEADLESS || readEnvValue('HEADLESS');
  if (!val) return true;
  const lowered = val.toLowerCase();
  return !['false', '0', 'off', 'no'].includes(lowered);
}
const DEFAULT_HEADLESS = resolveHeadless();

// 快手专用选择器
const DESC_SELECTORS = ksConfig.desc.selectors && ksConfig.desc.selectors.length > 0
  ? ksConfig.desc.selectors
  : [
    '#work-description-edit',
    'div#work-description-edit[contenteditable="true"]',
    'div[contenteditable="true"]._description_eho7l_59',
    'div[contenteditable="true"]'
  ];

// 检查登录状态
async function checkLoginStatus() {
  const { page } = await initBrowser(DEFAULT_HEADLESS); // 可配置无头/有头
  
  try {
    await page.goto('https://cp.kuaishou.com/article/publish/video', {
      waitUntil: 'domcontentloaded',
      timeout: 30000
    });

    await page.waitForTimeout(3000);

    // 检查是否有上传按钮（已登录的明确标志）
    const uploadButton = await page.$('button:has-text("上传视频")');
    
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
  // 使用较小的分辨率（1470x756），方便在小屏幕上操作
  const { page } = await initBrowser(false, { width: 1470, height: 756 });

  await page.goto('https://passport.kuaishou.com/pc/account/login/', {
    waitUntil: 'domcontentloaded',
    timeout: 30000
  });

  return {
    success: true,
    message: '页面已打开（有头模式），请手动扫码登录，完成后 Cookie 会自动保存',
    url: page.url()
  };
}

// 发布视频（快手不需要标题）
async function publishVideo({ description, tags, videoPath }) {
  // 使用无头模式（生产环境）
  const { page } = await initBrowser(DEFAULT_HEADLESS);
  const DEBUG = false; // 关闭调试模式（生产环境）
  const cfg = ksConfig;

  // 验证参数
  if (!videoPath) {
    throw new Error('视频路径不能为空');
  }

  if (!fs.existsSync(videoPath)) {
    throw new Error('视频文件不存在: ' + videoPath);
  }

  // 违禁词校验
  const maxTags = (ksConfig.tags && ksConfig.tags.max) || 5;
  const limitedTags = (tags || []).slice(0, maxTags);

  const fullText = [description, ...limitedTags].filter(Boolean).join(' ');
  const hits = checkForbidden(fullText);
  if (hits.length > 0) {
    throw new Error(`内容包含违禁词: ${hits.join(', ')}`);
  }

  // 1. 打开上传页面
  console.log('\n📄 步骤 1: 打开上传页面...');
  await page.goto('https://cp.kuaishou.com/article/publish/video', {
    waitUntil: 'domcontentloaded',
    timeout: 30000
  });

  await page.waitForTimeout(3000);
  if (DEBUG) await debugSnapshot('video-step1-open-page', page);

  // 2. 检查登录状态
  console.log('\n🔍 步骤 2: 检查登录状态...');
  // 检查是否有上传按钮（已登录标志）
  const uploadButtonCheck = await page.$('button:has-text("上传视频")');
  
  if (!uploadButtonCheck) {
    if (DEBUG) await debugSnapshot('video-step2-not-logged-in', page);
    throw new Error('未登录，请先调用 kuaishou_login 进行登录');
  }
  console.log('   ✅ 已登录');

  // 3. 上传视频
  console.log('\n🎥 步骤 3: 上传视频...');
  console.log(`   视频文件: ${videoPath}`);

  // 通过上传按钮 + filechooser
  const uploadBtn = await page.$(`button:has-text("${cfg.videoUpload.buttonText}")`) || await page.$('button:has-text("上传视频")');
  if (!uploadBtn) {
    if (DEBUG) await debugSnapshot('video-step3-no-upload-button', page);
    throw new Error('未找到上传视频按钮');
  }
  const [fileChooser] = await Promise.all([
    page.waitForEvent('filechooser'),
    uploadBtn.click()
  ]);
  await fileChooser.setFiles([videoPath]);
  await page.waitForTimeout(3000);

  console.log('   ✅ 视频已选择，等待上传...');
  if (DEBUG) await debugSnapshot('video-step3-video-selected', page);

  // 4. 等待上传完成
  console.log('\n⏳ 步骤 4: 等待视频上传完成...');
  if (cfg.videoUpload.progressSelector) {
    await waitUploadDone(page, cfg.videoUpload.progressSelector, cfg.videoUpload.waitDoneTimeoutMs, cfg.videoUpload.waitDoneIntervalMs);
  } else {
    await page.waitForTimeout(5000); // 无配置时简单等待
  }

  // 5. 关闭新手引导（如果有）
  console.log('\n⏳ 步骤 5: 关闭新手引导（如果有）...');
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
        console.log('   ✅ 已关闭新手引导（通过按钮）');
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
      console.log('   ✅ 已强制移除新手引导');
    }
  } catch (error) {
    // 忽略，可能没有引导
  }

  // 6. 填写描述和标签
  console.log('\n📝 步骤 6: 填写描述和标签...');
  if (DEBUG) await debugSnapshot('video-step6-before-description', page);
  
  const descInput = await inputText(page, DESC_SELECTORS, ksConfig.desc.type, description || '', DEBUG, 'desc');
  if (descInput && limitedTags && Array.isArray(limitedTags) && limitedTags.length > 0) {
    console.log(`📝 开始添加 ${limitedTags.length} 个标签...`);
    await addTags(page, descInput, ksConfig.tags, limitedTags, DEBUG);
  }
  if (DEBUG) await debugSnapshot('video-step6-after-description', page);

  // 7. 滚动到发布按钮
  console.log('\n📤 步骤 7: 准备发布...');
  await page.evaluate(() => {
    const mainContent = document.querySelector('main');
    if (mainContent) {
      mainContent.scrollTo({ top: mainContent.scrollHeight, behavior: 'smooth' });
    }
  });
  await page.waitForTimeout(2000);

  if (DEBUG) await debugSnapshot('video-step7-before-publish', page);

  // 8. 点击发布按钮
  console.log('\n📤 步骤 8: 点击发布按钮...');
  
  // 尝试点击发布按钮
  const buttonClicked = await page.evaluate(() => {
    // 查找文本为"发布"的按钮
    const buttons = Array.from(document.querySelectorAll('button, div[role="button"], generic'));
    const publishBtn = buttons.find(btn => btn.textContent && btn.textContent.trim() === '发布');
    if (publishBtn) {
      console.log('通过 evaluate 点击发布按钮');
      publishBtn.click();
      return true;
    }
    return false;
  });

  if (!buttonClicked) {
    console.log('   通过 Playwright API 查找发布按钮...');
    let publishButton = await page.$('button:has-text("发布")');
    if (!publishButton) {
      publishButton = await page.getByText('发布', { exact: true });
    }

    if (!publishButton) {
      if (DEBUG) await debugSnapshot('video-step8-no-button', page);
      throw new Error('未找到发布按钮');
    }

    const isVisible = await publishButton.isVisible().catch(() => true);
    const isEnabled = await publishButton.isEnabled().catch(() => true);

    console.log(`   📊 发布按钮状态: 可见=${isVisible}, 可用=${isEnabled}`);

    if (!isVisible) {
      await publishButton.scrollIntoViewIfNeeded();
      await page.waitForTimeout(500);
    }

    if (!isEnabled) {
      if (DEBUG) await debugSnapshot('video-step8-button-disabled', page);
      throw new Error('发布按钮不可用');
    }

    console.log('   ✅ 点击发布按钮');
    await publishButton.click();
  } else {
    console.log('   ✅ 已通过 evaluate 点击发布按钮');
  }

  await page.waitForTimeout(2000);
  if (DEBUG) await debugSnapshot('video-step8-after-click', page);

  // 9. 等待发布结果
  console.log('\n⏳ 步骤 9: 等待发布结果...');

  // 等待成功提示或页面跳转
  await page.waitForTimeout(3000);

  const afterClickUrl = page.url();
  console.log(`   📍 点击后URL: ${afterClickUrl}`);

  if (DEBUG) await debugSnapshot('video-step9-after-wait', page);

  // 检查是否有成功提示
  const successText = await page.evaluate(() => {
    return document.body.textContent.includes('内容发布成功') ||
           document.body.textContent.includes('发布成功');
  });

  // 检查URL是否跳转到管理页面
  const isManagePage = afterClickUrl.includes('/article/manage');

  if (successText || isManagePage) {
    console.log('   ✅ 视频发布成功！');
    return {
      success: true,
      message: '发布成功',
      url: afterClickUrl
    };
  } else {
    console.log('   ⚠️  无法确认发布状态');
    return {
      success: true,
      message: '视频已提交，正在处理中',
      url: afterClickUrl
    };
  }
}

// 退出登录（清除 Cookie 和浏览器数据）
async function logout() {
  try {
    const { context } = await initBrowser(DEFAULT_HEADLESS); // 可配置无头/有头
    
    // 清除所有 Cookie
    await context.clearCookies();
    
    // 清除浏览器数据目录中的敏感文件
    const userDataDir = path.join(__dirname, '..', 'data', 'browser-data');
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
            fs.rmSync(file, { recursive: true, force: true });
          } else {
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

// 音乐选择辅助函数（快手版）
// 支持两种模式：
// 1. 随机热门歌曲：music = true 或 music = {}
// 2. 搜索指定歌曲：music = { name: "歌名" }
async function selectMusicFromList(page, music, DEBUG = false) {
  if (!music) {
    return null;
  }

  try {
    const isSearchMode = typeof music === 'object' && music.name;
    console.log(`   🎵 音乐模式: ${isSearchMode ? `搜索"${music.name}"` : '随机热门歌曲'}`);
    
    // 第一步：点击"添加音乐"按钮
    // 使用更精确的选择器，结合父容器路径和文本判断避免误点"添加封面"
    const addMusicButton = await page.evaluate(() => {
      // 方案1：在 _section-main_y5j5i_15 容器中查找包含"添加音乐"文本的按钮
      const sectionMain = document.querySelector('div._section-main_y5j5i_15');
      if (sectionMain) {
        const buttons = Array.from(sectionMain.querySelectorAll('div._button_3a3lq_1._button-default_3a3lq_35'));
        for (const btn of buttons) {
          if (btn.textContent && btn.textContent.includes('添加音乐')) {
            btn.setAttribute('data-music-btn', 'true');
            return true;
          }
        }
      }
      
      // 方案2：直接查找所有相同 class 的按钮，通过文本判断
      const allButtons = document.querySelectorAll('div._button_3a3lq_1._button-default_3a3lq_35');
      for (const btn of allButtons) {
        if (btn.textContent && btn.textContent.includes('添加音乐')) {
          btn.setAttribute('data-music-btn', 'true');
          return true;
        }
      }
      
      return false;
    });
    
    if (!addMusicButton) {
      throw new Error('未找到"添加音乐"按钮');
    }
    
    // 点击标记的按钮
    const musicBtn = await page.$('div[data-music-btn="true"]');
    if (!musicBtn) {
      throw new Error('未找到标记的"添加音乐"按钮');
    }

    console.log('   ✅ 找到添加音乐按钮，正在点击...');
    await musicBtn.click();
    await page.waitForTimeout(3000);
    if (DEBUG) await debugSnapshot('music1-opened', page);

    // 第二步：根据模式选择操作
    if (isSearchMode) {
      // 搜索模式：搜索指定歌曲
      console.log(`   🔍 搜索音乐: ${music.name}`);
      
      const searchBoxSelector = 'div._search_19mmt_6 > input';
      const searchBox = await page.$(searchBoxSelector);
      
      if (!searchBox) {
        throw new Error('未找到搜索框');
      }
      
      await searchBox.click();
      await page.waitForTimeout(500);
      await searchBox.fill(music.name);
      console.log('   ⏳ 等待搜索结果加载...');
      await page.waitForTimeout(3000);
      if (DEBUG) await debugSnapshot('music2-searched', page);
    } else {
      // 随机模式：从热门列表随机选择
      console.log('   🎲 从热门列表随机选择一首音乐...');
    }

    // 第三步：等待音乐列表加载
    await page.waitForTimeout(1500);

    // 第四步：选择音乐
    // 搜索模式：选择第一首搜索结果
    // 随机模式：随机选择一首热门歌曲
    const musicItemClicked = await page.evaluate((searchMode) => {
      // 查找音乐列表容器
      const drawerMain = document.querySelector('div._drawer-main_19mmt_33');
      if (!drawerMain) {
        return { success: false, error: '未找到音乐列表容器' };
      }
      
      // 获取所有音乐项（直接子元素 div）
      const musicItems = Array.from(drawerMain.children).filter(el => el.tagName === 'DIV');
      
      if (musicItems.length === 0) {
        return { success: false, error: '音乐列表为空' };
      }
      
      // 选择音乐
      let targetIndex;
      if (searchMode) {
        // 搜索模式：选择第一首
        targetIndex = 0;
      } else {
        // 随机模式：随机选择一首（0到列表长度-1之间）
        targetIndex = Math.floor(Math.random() * musicItems.length);
      }
      
      const targetItem = musicItems[targetIndex];
      const addButton = targetItem.querySelector('span > div');
      
      if (!addButton) {
        return { success: false, error: `第 ${targetIndex + 1} 首音乐没有找到添加按钮` };
      }
      
      // 点击添加按钮
      addButton.click();
      return { 
        success: true, 
        musicTitle: targetItem.textContent.trim().substring(0, 30),
        index: targetIndex,
        total: musicItems.length
      };
    }, isSearchMode);

    if (!musicItemClicked.success) {
      throw new Error(musicItemClicked.error);
    }
    
    if (isSearchMode) {
      console.log(`   ✅ 已添加搜索结果: ${musicItemClicked.musicTitle}...`);
    } else {
      console.log(`   ✅ 已随机选择: ${musicItemClicked.musicTitle}... (第${musicItemClicked.index + 1}/${musicItemClicked.total}首)`);
    }
    
    await page.waitForTimeout(2000);
    if (DEBUG) await debugSnapshot('music3-selected', page);

    // 验证音乐是否成功添加
    const musicAdded = await page.evaluate(() => {
      const text = document.body.textContent;
      return text.includes('修改音乐') || text.includes('更换音乐') || text.includes('已添加');
    });

    if (musicAdded) {
      console.log('   ✅ 音乐添加成功验证通过');
    } else {
      console.warn('   ⚠️  无法验证音乐是否添加成功，但已完成操作');
    }

    return { 
      success: true, 
      message: '音乐添加成功', 
      mode: isSearchMode ? 'search' : 'random',
      musicTitle: musicItemClicked.musicTitle
    };
  } catch (error) {
    throw new Error(`音乐添加失败: ${error.message}`);
  }
}

// 发布图文（快手不需要标题）
async function publishImages({ description, tags, imagePaths, music }) {
  // 使用无头模式（生产环境）
  const { page } = await initBrowser(DEFAULT_HEADLESS);
  const DEBUG = false; // 关闭调试模式
  const cfg = ksConfig;

  try {
    // 验证参数
    if (!imagePaths || !Array.isArray(imagePaths) || imagePaths.length === 0) {
      throw new Error('至少需要提供一张图片');
    }

    // 验证所有图片文件是否存在
    for (const imagePath of imagePaths) {
      if (!fs.existsSync(imagePath)) {
        throw new Error(`图片文件不存在: ${imagePath}`);
      }
    }

    const maxTags = (ksConfig.tags && ksConfig.tags.max) || 5;
    const limitedTags = (tags || []).slice(0, maxTags);

    // 违禁词校验
    const fullText = [description, ...limitedTags].filter(Boolean).join(' ');
    const hits = checkForbidden(fullText);
    if (hits.length > 0) {
      throw new Error(`内容包含违禁词: ${hits.join(', ')}`);
    }

    // 1. 打开上传页面
    console.log('\n📄 步骤 1: 打开图文上传页面...');
    await page.goto(cfg.openPage.url, {
      waitUntil: cfg.openPage.waitUntil || 'domcontentloaded',
      timeout: 30000
    });

    await page.waitForTimeout(3000);
    if (DEBUG) await debugSnapshot('photo-step1-open-page', page);

    // 2. 检查登录状态
    console.log('\n🔍 步骤 2: 检查登录状态...');
    // 检查是否有上传按钮（已登录标志）
    const uploadButtonCheck = await page.$('button:has-text("上传视频")');
    
    if (!uploadButtonCheck) {
      if (DEBUG) await debugSnapshot('photo-step2-not-logged-in', page);
      throw new Error('未登录，请先调用 kuaishou_login 进行登录');
    }
    console.log('   ✅ 已登录');

    // 3. 点击"上传图文"标签
    console.log('\n📸 步骤 3: 切换到图文上传...');
    if (cfg.upload.tabText) {
      const photoTab = await page.getByRole('tab', { name: cfg.upload.tabText }).catch(() => null);
      if (photoTab) {
        await photoTab.click();
        await page.waitForTimeout(2000);
      }
    }
    if (DEBUG) await debugSnapshot('photo-step3-tab-clicked', page);

    // 3.5 放弃草稿（如果有）
    try {
      const abandonButton = await page.$('button:has-text("放弃")');
      if (abandonButton) {
        await abandonButton.click();
        await page.waitForTimeout(1000);
        console.log('   ✅ 已放弃草稿');
      }
    } catch (error) {
      // 没有草稿，继续
    }

    // 4. 上传图片
    console.log('\n📸 步骤 4: 上传图片...');
    console.log(`   图片文件: ${imagePaths.length} 张`);

    const uploadButton = await page.$(`button:has-text("${cfg.upload.buttonText || '上传图片'}")`) || await page.$('button:has-text("上传图片")');
    if (!uploadButton) {
      if (DEBUG) await debugSnapshot('photo-step4-no-upload-button', page);
      throw new Error('未找到上传图片按钮');
    }

    console.log('   通过上传按钮上传...');
    const [fileChooser] = await Promise.all([
      page.waitForEvent('filechooser'),
      uploadButton.click()
    ]);
    await fileChooser.setFiles(imagePaths);
    await page.waitForTimeout(3000);

    console.log('   ✅ 图片已选择，等待上传...');
    if (DEBUG) await debugSnapshot('photo-step4-images-selected', page);

    // 5. 等待图片上传完成
    console.log('\n⏳ 步骤 5: 等待图片上传完成...');
    if (cfg.upload.progressSelector) {
      await waitUploadDone(page, cfg.upload.progressSelector, cfg.upload.waitDoneTimeoutMs, cfg.upload.waitDoneIntervalMs);
    } else {
      await page.waitForTimeout(5000);
    }
    if (DEBUG) await debugSnapshot('photo-step5-upload-complete', page);

    // 6. 填写描述和标签
    console.log('\n📝 步骤 6: 填写描述和标签...');
    if (DEBUG) await debugSnapshot('photo-step6-before-description', page);
    
    const descInput = await inputText(page, DESC_SELECTORS, ksConfig.desc.type, description || '', DEBUG, 'desc');
    if (descInput && limitedTags && Array.isArray(limitedTags) && limitedTags.length > 0) {
      console.log(`📝 开始添加 ${limitedTags.length} 个标签...`);
      await addTags(page, descInput, ksConfig.tags, limitedTags, DEBUG);
    }
    if (DEBUG) await debugSnapshot('photo-step6-after-description', page);

    // 6.5. 添加音乐（如果提供了 music 参数）
    if (music) {
      console.log('\n🎵 步骤 6.5: 添加音乐...');
      try {
        await selectMusicFromList(page, music, DEBUG);
        await page.waitForTimeout(2000);
        console.log('   ✅ 音乐添加成功');
        if (DEBUG) await debugSnapshot('photo-step6.5-music-added', page);
      } catch (musicError) {
        // 音乐添加失败时，记录警告但继续发布（不加BGM）
        console.log(`   ⚠️  音乐添加失败: ${musicError.message}`);
        if (DEBUG) {
          await debugSnapshot('photo-step6.5-music-failed', page);
          
          // 尝试打开音乐面板，让用户手动查看 DOM
          console.log('   🔍 尝试打开音乐面板，方便你查看 DOM...');
          try {
            const addMusicButton = await page.$('generic:has-text("添加音乐")');
            if (addMusicButton) {
              await addMusicButton.click();
              await page.waitForTimeout(2000);
              console.log('   ✅ 音乐面板已打开，请在浏览器中查看 DOM 结构');
            }
          } catch (e) {
            console.log('   ⚠️  无法自动打开音乐面板，请手动点击"添加音乐"按钮');
          }
        }
      }
    }

    // 7. 滚动到发布按钮
    console.log('\n📤 步骤 7: 准备发布...');
    await page.evaluate(() => {
      const mainContent = document.querySelector('main');
      if (mainContent) {
        mainContent.scrollTo({ top: mainContent.scrollHeight, behavior: 'smooth' });
      }
    });
    await page.waitForTimeout(2000);

    if (DEBUG) await debugSnapshot('photo-step7-before-publish', page);

    // 8. 点击发布按钮
    console.log('\n📤 步骤 8: 点击发布按钮...');
    
    const buttonClicked = await page.evaluate(() => {
      const buttons = Array.from(document.querySelectorAll('button, div[role="button"], generic'));
      const publishBtn = buttons.find(btn => btn.textContent && btn.textContent.trim() === '发布');
      if (publishBtn) {
        console.log('通过 evaluate 点击发布按钮');
        publishBtn.click();
        return true;
      }
      return false;
    });

    if (!buttonClicked) {
      console.log('   通过 Playwright API 查找发布按钮...');
      let publishButton = await page.$('button:has-text("发布")');
      if (!publishButton) {
        publishButton = await page.getByText('发布', { exact: true });
      }

      if (!publishButton) {
        if (DEBUG) await debugSnapshot('photo-step8-no-button', page);
        throw new Error('未找到发布按钮');
      }

      const isVisible = await publishButton.isVisible().catch(() => true);
      const isEnabled = await publishButton.isEnabled().catch(() => true);

      console.log(`   📊 发布按钮状态: 可见=${isVisible}, 可用=${isEnabled}`);

      if (!isVisible) {
        await publishButton.scrollIntoViewIfNeeded();
        await page.waitForTimeout(500);
      }

      if (!isEnabled) {
        if (DEBUG) await debugSnapshot('photo-step8-button-disabled', page);
        throw new Error('发布按钮不可用');
      }

      console.log('   ✅ 点击发布按钮');
      await publishButton.click();
    } else {
      console.log('   ✅ 已通过 evaluate 点击发布按钮');
    }

    await page.waitForTimeout(2000);
    if (DEBUG) await debugSnapshot('photo-step8-after-click', page);

    // 9. 发布并等待结果（配置化）
    await clickPublish(page, ksConfig.publish, DEBUG);
    return {
      success: true,
      message: '图文发布流程已完成，若无提示请手动确认',
      details: {
        description: description || '',
        tags: tags || [],
        imageCount: imagePaths.length,
        music: music || null,
        url: page.url()
      }
    };

  } catch (error) {
    if (DEBUG) await debugSnapshot('photo-error', page);
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
};
