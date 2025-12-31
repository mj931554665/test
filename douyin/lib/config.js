const fs = require('fs');
const path = require('path');

// 简单读取配置值，优先 .env.local，再读 .env；仅支持 KEY=VALUE 形式
function readEnvValue(key) {
  const files = ['.env.local', '.env'];
  for (const file of files) {
    const fullPath = path.join(__dirname, '..', file);
    if (!fs.existsSync(fullPath)) continue;
    const lines = fs.readFileSync(fullPath, 'utf8').split('\n');
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const match = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
      if (match && match[1] === key) {
        return match[2].trim();
      }
    }
  }
  return null;
}

module.exports = { readEnvValue };
