const fs = require('fs');
const path = require('path');
const { createLogger } = require('./logger');

const logger = createLogger('profile');
const DEFAULT_PROFILE = 'default';
const BASE_DIR = path.join(__dirname, '..', 'data', 'browser-data');

function parseProfileInput(override) {
  if (!override) return {};
  if (typeof override === 'string') return { profile: override };
  if (typeof override === 'object') {
    return {
      profile: override.profile || override.name,
      profileDir: override.profileDir || override.userDataDir || override.path
    };
  }
  return {};
}

function readArg(keys) {
  for (const arg of process.argv.slice(2)) {
    for (const key of keys) {
      if (arg.startsWith(`${key}=`)) {
        return arg.split('=')[1];
      }
      if (arg === key) {
        const next = process.argv[process.argv.indexOf(arg) + 1];
        if (next && !next.startsWith('-')) return next;
      }
    }
  }
  return null;
}

function readPositionalProfile() {
  const args = process.argv.slice(2).filter(arg => !arg.startsWith('-'));
  return args[0] || null;
}

function ensureDir(dir) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function migrateLegacyDefault(targetDir) {
  // 若 legacy 根目录下有旧的 Chrome 数据，且目标目录不存在，则迁移过去
  const legacyLocalState = path.join(BASE_DIR, 'Local State');
  if (!fs.existsSync(legacyLocalState)) return;
  if (fs.existsSync(targetDir)) return;

  logger.step('迁移默认浏览器数据', targetDir);
  ensureDir(targetDir);
  for (const entry of fs.readdirSync(BASE_DIR)) {
    const from = path.join(BASE_DIR, entry);
    const to = path.join(targetDir, entry);
    if (from === targetDir) continue;
    fs.renameSync(from, to);
  }
}

function resolveProfileDir(override) {
  const overrideInput = parseProfileInput(override);
  const envDir = process.env.DOUYIN_PROFILE_DIR || process.env.PROFILE_DIR || process.env.BROWSER_PROFILE_DIR;
  const envName = process.env.DOUYIN_PROFILE || process.env.PROFILE_NAME || process.env.PROFILE;
  const argDir = readArg(['--profile-dir', '--data-dir', '--user-data-dir']);
  const argName = readArg(['--profile', '--pf', '-p']);
  const positionalName = readPositionalProfile();

  const baseDir = BASE_DIR;
  ensureDir(baseDir);

  const chosen = overrideInput.profileDir
    || envDir
    || argDir
    || overrideInput.profile
    || envName
    || argName
    || positionalName
    || DEFAULT_PROFILE;

  const profileDir = path.isAbsolute(chosen) ? chosen : path.join(baseDir, chosen);
  const profileName = path.basename(profileDir);

  if (profileName === DEFAULT_PROFILE) {
    migrateLegacyDefault(profileDir);
  }

  ensureDir(profileDir);
  logger.info('使用浏览器数据目录', profileDir);
  return { profileDir, profileName };
}

module.exports = { resolveProfileDir, DEFAULT_PROFILE };
