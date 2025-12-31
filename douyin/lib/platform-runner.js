const { debugSnapshot, smartFindElement, DESC_SELECTORS, moveCursorToEnd, clearContentEditable } = require('./utils');
const { createLogger } = require('./logger');

const logger = createLogger('runner');

async function inputText(page, selectors, type, text, DEBUG, label) {
  if (!text) return null;
  const el = await smartFindElement(page, selectors, null);
  if (!el) throw new Error(`未找到 ${label || '输入框'}`);

  await el.click();
  await page.waitForTimeout(200);

  if (type === 'contenteditable') {
    await clearContentEditable(el);
    await page.waitForTimeout(200);
    await el.focus();
    await page.keyboard.type(text, { delay: 30 });
  } else {
    await el.fill('');
    await el.type(text, { delay: 30 });
  }

  if (DEBUG) await debugSnapshot(`${label || 'input'}-filled`, page);
  return el;
}

async function addTags(page, targetEl, tagsCfg, tags, DEBUG) {
  if (!tagsCfg || !tags || tags.length === 0) return;
  const { format = 'hash', separator = 'enter', delayMs = 800 } = tagsCfg;
  const sepKey = separator === 'space' ? 'Space' : separator === 'comma' ? 'Comma' : 'Enter';

  for (let i = 0; i < tags.length; i++) {
    const t = tags[i];
    const text = format === 'hash' ? (t.startsWith('#') ? t : `#${t}`) : t;
    await moveCursorToEnd(targetEl);
    await page.waitForTimeout(100);
    await targetEl.focus();
    await page.keyboard.type(` ${text}`, { delay: 30 });
    await page.waitForTimeout(200);
    await page.keyboard.press(sepKey);
    await page.waitForTimeout(delayMs);
    logger.step('标签添加', { index: i + 1, tag: text });
  }
  if (DEBUG) await debugSnapshot('tags-filled', page);
}

async function waitUploadDone(page, progressSelector, timeoutMs = 120000, intervalMs = 2000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const exists = await page.$(progressSelector);
    if (!exists) {
      logger.step('图片上传完成', { elapsedMs: Date.now() - start });
      return true;
    }
    await page.waitForTimeout(intervalMs);
  }
  logger.warn('等待上传完成超时，继续后续流程', { timeoutMs });
  return false;
}

async function clickPublish(page, publishCfg, DEBUG) {
  const { buttonText = '发布', buttonSelectors = [], resultTimeoutMs = 30000 } = publishCfg;
  let publishButton = null;
  const buttons = await page.$$('button');
  for (const btn of buttons) {
    const text = await btn.textContent();
    if (text && text.trim() === buttonText) {
      const isEnabled = await btn.isEnabled().catch(() => true);
      const isVisible = await btn.isVisible().catch(() => true);
      if (isEnabled && isVisible) {
        publishButton = btn;
        break;
      }
    }
  }
  if (!publishButton) {
    for (const sel of buttonSelectors) {
      const btn = await page.$(sel);
      if (btn) { publishButton = btn; break; }
    }
  }
  if (!publishButton) throw new Error('未找到发布按钮');

  const isVisible = await publishButton.isVisible().catch(() => true);
  const isEnabled = await publishButton.isEnabled().catch(() => true);
  logger.step('发布按钮状态', { isVisible, isEnabled });
  if (!isVisible) await publishButton.scrollIntoViewIfNeeded();
  if (!isEnabled) throw new Error('发布按钮不可用');

  await publishButton.click();
  logger.step('点击发布按钮', { url: page.url() });
  await page.waitForTimeout(1500);
  if (DEBUG) await debugSnapshot('after-click-publish', page);

  await Promise.race([
    page.waitForURL('**/content/manage**', { timeout: resultTimeoutMs }).catch(() => null),
    page.waitForFunction(() => {
      return document.body.textContent.includes('发布成功') ||
             document.body.textContent.includes('已发布') ||
             document.body.textContent.includes('发送成功');
    }, { timeout: resultTimeoutMs }).catch(() => null)
  ]);
  logger.step('发布等待结束', { timeoutMs: resultTimeoutMs, url: page.url() });
}

module.exports = {
  inputText,
  addTags,
  waitUploadDone,
  clickPublish,
};
