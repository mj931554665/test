module.exports = {
  openPage: {
    url: 'https://cp.kuaishou.com/article/publish/video',
    waitUntil: 'domcontentloaded'
  },
  upload: {
    tabText: '上传图文',
    buttonText: '上传图片',
    progressSelector: null, // 暂无稳定进度选择器，可后续补充
    waitDoneTimeoutMs: 180000,
    waitDoneIntervalMs: 2000
  },
  videoUpload: {
    buttonText: '上传视频',
    progressSelector: null,
    waitDoneTimeoutMs: 300000,
    waitDoneIntervalMs: 2000
  },
  title: {
    selectors: [],
    type: 'input'
  },
  desc: {
    selectors: [
      '#work-description-edit',
      'div#work-description-edit[contenteditable="true"]',
      'div[contenteditable="true"]._description_eho7l_59',
      'div[contenteditable="true"]'
    ],
    type: 'contenteditable'
  },
  tags: {
    useDescInput: true,
    format: 'hash',
    separator: 'space',
    max: 4,
    delayMs: 800
  },
  music: {
    enabled: true
  },
  publish: {
    buttonText: '发布',
    buttonSelectors: [],
    resultTimeoutMs: 30000
  }
};
