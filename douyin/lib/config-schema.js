// 平台配置示例结构（供参考）
// openPage: { url, waitUntil }
// upload: { fileInputSelectors: [], progressSelector?, waitDoneTimeoutMs?, waitDoneIntervalMs? }
// title: { selectors: [], type: 'input'|'textarea'|'contenteditable' }
// desc: { selectors: [], type: 'input'|'textarea'|'contenteditable' }
// tags: { useDescInput: true|false, selectors?: [], format: 'hash'|'raw', separator: 'enter'|'space'|'comma', delayMs?: number }
// music: { enabled: boolean, handler?: (page, music, DEBUG) => Promise }
// publish: { buttonText?: string, buttonSelectors?: [], resultTimeoutMs?: number }
module.exports = {};
