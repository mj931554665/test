const fs = require('fs');
const path = require('path');

let cached = null;

function collectFiles(basePath) {
  const files = [];
  const stat = fs.statSync(basePath);
  if (stat.isFile()) return [basePath];
  if (stat.isDirectory()) {
    for (const entry of fs.readdirSync(basePath)) {
      const p = path.join(basePath, entry);
      const st = fs.statSync(p);
      if (st.isDirectory()) {
        files.push(...collectFiles(p));
      } else if (st.isFile() && p.toLowerCase().endsWith('.txt')) {
        files.push(p);
      }
    }
  }
  return files;
}

function loadForbidden() {
  if (cached) return cached;
  const envPath = process.env.FORBIDDEN_PATH;
  const defaultDir = path.join(__dirname, '..', 'data', 'sensitive-lexicon', 'Vocabulary');
  const filePath = envPath || defaultDir;
  if (!fs.existsSync(filePath)) {
    cached = new Set();
    return cached;
  }

  const files = collectFiles(filePath);
  const words = [];
  for (const f of files) {
    const content = fs.readFileSync(f, 'utf8');
    const list = content
      .split(/\r?\n/)
      .map(w => w.trim())
      .filter(Boolean);
    words.push(...list);
  }
  cached = new Set(words);
  return cached;
}

/**
 * 检查文本命中违禁词
 * @param {string} text 待检测文本
 * @returns {string[]} 命中的词列表（去重）
 */
function checkForbidden(text) {
  if (!text) return [];
  const set = loadForbidden();
  if (!set || set.size === 0) return [];
  const hits = [];
  const lower = text.toLowerCase();
  for (const word of set) {
    if (!word) continue;
    const w = word.toLowerCase();
    if (lower.includes(w)) {
      hits.push(word);
    }
  }
  return Array.from(new Set(hits));
}

module.exports = { checkForbidden };
