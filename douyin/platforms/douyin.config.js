module.exports = {
  openPage: {
    url: 'https://creator.douyin.com/creator-micro/content/upload?default-tab=3',
    waitUntil: 'domcontentloaded'
  },
  upload: {
    fileInputSelectors: ['input[type="file"]'],
    progressSelector: '#DCPF > div > div.content-right-ik9gts > div:nth-child(1) > div > div > div > div > div > div.container-info-YDPo3D > div.progress-container-gYPT3G',
    waitDoneTimeoutMs: 120000,
    waitDoneIntervalMs: 2000
  },
  title: {
    selectors: [
      'textbox[placeholder*="填写作品标题"]',
      'input[placeholder*="标题"]',
      'textarea[placeholder*="标题"]',
      'input[type="text"]'
    ],
    type: 'input'
  },
  desc: {
    selectors: [], // 留空则使用默认 DESC_SELECTORS
    type: 'contenteditable'
  },
  tags: {
    useDescInput: true,
    format: 'hash',
    separator: 'enter',
    delayMs: 800
  },
  music: {
    enabled: true
  },
  publish: {
    buttonText: '发布',
    buttonSelectors: ['button.primary-cECiOJ'],
    resultTimeoutMs: 30000
  }
};
