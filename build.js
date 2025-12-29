#!/usr/bin/env node

/**
 * 打包脚本 - 混淆代码并创建发布包
 * 
 * 功能：
 * 1. 混淆所有 .js 文件（lib/, dev/）
 * 2. 保留 README.md 和 package.json
 * 3. 排除敏感数据（data/browser-data/, debug-screenshots/）
 * 4. 创建 dist/ 目录用于分发
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const OUTPUT_DIR = 'dist';
const SOURCE_DIRS = ['lib', 'dev'];
const COPY_FILES = ['README.md', 'package.json', '.gitignore'];

console.log('🚀 开始打包混淆...\n');

// 1. 检查是否安装了 javascript-obfuscator
console.log('📦 检查依赖...');
try {
  require.resolve('javascript-obfuscator');
  console.log('✅ javascript-obfuscator 已安装\n');
} catch (e) {
  console.log('⏳ 正在安装 javascript-obfuscator...');
  execSync('npm install --save-dev javascript-obfuscator', { stdio: 'inherit' });
  console.log('✅ 安装完成\n');
}

const JavaScriptObfuscator = require('javascript-obfuscator');

// 2. 清理并创建输出目录
console.log('🧹 清理输出目录...');
if (fs.existsSync(OUTPUT_DIR)) {
  fs.rmSync(OUTPUT_DIR, { recursive: true, force: true });
}
fs.mkdirSync(OUTPUT_DIR, { recursive: true });
console.log('✅ 输出目录已创建\n');

// 3. 混淆配置
const obfuscationOptions = {
  compact: true,
  controlFlowFlattening: true,
  controlFlowFlatteningThreshold: 0.75,
  deadCodeInjection: true,
  deadCodeInjectionThreshold: 0.4,
  debugProtection: false,
  debugProtectionInterval: 0,
  disableConsoleOutput: false,
  identifierNamesGenerator: 'hexadecimal',
  log: false,
  numbersToExpressions: true,
  renameGlobals: false,
  selfDefending: true,
  simplify: true,
  splitStrings: true,
  splitStringsChunkLength: 10,
  stringArray: true,
  stringArrayCallsTransform: true,
  stringArrayEncoding: ['base64'],
  stringArrayIndexShift: true,
  stringArrayRotate: true,
  stringArrayShuffle: true,
  stringArrayWrappersCount: 2,
  stringArrayWrappersChainedCalls: true,
  stringArrayWrappersParametersMaxCount: 4,
  stringArrayWrappersType: 'function',
  stringArrayThreshold: 0.75,
  transformObjectKeys: true,
  unicodeEscapeSequence: false
};

// 4. 混淆 JS 文件
function obfuscateFile(inputPath, outputPath) {
  const code = fs.readFileSync(inputPath, 'utf8');
  
  // 保留 shebang
  let shebang = '';
  let codeToObfuscate = code;
  if (code.startsWith('#!')) {
    const firstNewline = code.indexOf('\n');
    shebang = code.substring(0, firstNewline + 1);
    codeToObfuscate = code.substring(firstNewline + 1);
  }
  
  const obfuscated = JavaScriptObfuscator.obfuscate(codeToObfuscate, obfuscationOptions);
  const outputCode = shebang + obfuscated.getObfuscatedCode();
  
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, outputCode, 'utf8');
  
  // 如果原文件有执行权限，保留它
  try {
    const stats = fs.statSync(inputPath);
    if (stats.mode & 0o111) {
      fs.chmodSync(outputPath, stats.mode);
    }
  } catch (e) {
    // 忽略权限错误
  }
}

function processDirectory(sourceDir) {
  const files = fs.readdirSync(sourceDir, { withFileTypes: true });
  
  for (const file of files) {
    const sourcePath = path.join(sourceDir, file.name);
    const outputPath = path.join(OUTPUT_DIR, sourceDir, file.name);
    
    if (file.isDirectory()) {
      processDirectory(sourcePath);
    } else if (file.name.endsWith('.js')) {
      console.log(`   🔒 混淆: ${sourcePath}`);
      obfuscateFile(sourcePath, outputPath);
    }
  }
}

console.log('🔒 混淆 JavaScript 文件...');
for (const dir of SOURCE_DIRS) {
  if (fs.existsSync(dir)) {
    processDirectory(dir);
  }
}
console.log('✅ 混淆完成\n');

// 5. 复制不需要混淆的文件
console.log('📄 复制配置文件...');
for (const file of COPY_FILES) {
  if (fs.existsSync(file)) {
    fs.copyFileSync(file, path.join(OUTPUT_DIR, file));
    console.log(`   ✅ ${file}`);
  }
}
console.log('');

// 6. 创建 .gitignore（如果不存在）
const gitignorePath = path.join(OUTPUT_DIR, '.gitignore');
if (!fs.existsSync(gitignorePath)) {
  fs.writeFileSync(gitignorePath, `node_modules/
data/browser-data/
debug-screenshots/
*.log
`);
  console.log('✅ 创建 .gitignore\n');
}

console.log('🎉 打包完成！');
console.log(`\n📦 输出目录: ${OUTPUT_DIR}/`);
console.log('\n📋 下一步:');
console.log('   1. cd dist');
console.log('   2. npm install');
console.log('   3. npm run dev');
