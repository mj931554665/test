const path = require('path');
const fs = require('fs');

// 调试模式配置
let DEBUG_MODE = false;
let DEBUG_SCREENSHOT_DIR = null;

// 设置调试模式
function setDebugMode(enabled, screenshotDir = null) {
  DEBUG_MODE = enabled;
  if (screenshotDir) {
    DEBUG_SCREENSHOT_DIR = screenshotDir;
    if (DEBUG_MODE && !fs.existsSync(DEBUG_SCREENSHOT_DIR)) {
      fs.mkdirSync(DEBUG_SCREENSHOT_DIR, { recursive: true });
    }
  }
}

// 调试函数：截图并记录状态
async function debugSnapshot(step, page) {
  if (!DEBUG_MODE || !DEBUG_SCREENSHOT_DIR) return;
  
  try {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filename = `${step}-${timestamp}.png`;
    const filepath = path.join(DEBUG_SCREENSHOT_DIR, filename);
    await page.screenshot({ path: filepath, fullPage: false });
    console.log(`📸 调试截图: ${step} -> ${filepath}`);
  } catch (error) {
    console.warn(`截图失败: ${error.message}`);
  }
}

// 智能查找元素
async function smartFindElement(page, selectors, description) {
  if (description) {
    console.log(`🔍 查找元素: ${description}`);
  }
  
  for (const selector of selectors) {
    try {
      const element = await page.$(selector);
      if (element) {
        const isVisible = await element.isVisible().catch(() => false);
        if (isVisible) {
          if (description) {
            console.log(`✅ 找到元素: ${selector}`);
          }
          return element;
        }
      }
    } catch (error) {
      // 继续尝试下一个选择器
    }
  }
  
  if (description) {
    console.log(`⚠️  所有选择器都失败: ${description}`);
  }
  return null;
}

// 获取页面状态信息
async function getPageState(page) {
  try {
    return await page.evaluate(() => {
      const state = {
        url: window.location.href,
        title: document.title,
        elements: {
          titleInput: !!document.querySelector('input[placeholder*="标题"], textarea[placeholder*="标题"]'),
          descEditor: !!document.querySelector('.zone-container[contenteditable="true"], div[contenteditable="true"][data-placeholder*="简介"]'),
          publishButton: Array.from(document.querySelectorAll('button')).some(btn => btn.textContent && btn.textContent.includes('发布'))
        }
      };
      return state;
    });
  } catch (error) {
    return { error: error.message };
  }
}

// 简介输入框选择器（公共常量）
const DESC_SELECTORS = [
  '.zone-container[contenteditable="true"]',
  'div.editor-kit-editor-container[contenteditable="true"]',
  'div[contenteditable="true"][data-placeholder*="简介"]',
  'div[contenteditable="true"].editor',
  'div[contenteditable="true"][data-slate-editor="true"]',
  'div[contenteditable="true"]'
];

// 将光标移动到元素末尾
async function moveCursorToEnd(element) {
  await element.evaluate((el) => {
    el.focus();
    const range = document.createRange();
    const selection = window.getSelection();
    range.selectNodeContents(el);
    range.collapse(false);
    selection.removeAllRanges();
    selection.addRange(range);
  });
}

// 清空内容可编辑元素
async function clearContentEditable(element) {
  await element.evaluate((el) => {
    el.innerHTML = '';
    el.textContent = '';
    // 确保没有换行符和空白字符
    const range = document.createRange();
    const selection = window.getSelection();
    range.selectNodeContents(el);
    range.deleteContents();
    selection.removeAllRanges();
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

module.exports = {
  setDebugMode,
  debugSnapshot,
  smartFindElement,
  getPageState,
  DESC_SELECTORS,
  moveCursorToEnd,
  clearContentEditable,
};

