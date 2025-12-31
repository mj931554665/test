const levels = {
  error: { label: 'ERROR', weight: 0 },
  warn: { label: 'WARN', weight: 1 },
  step: { label: 'STEP', weight: 1 },
  info: { label: 'INFO', weight: 2 },
};

function timestamp() {
  return new Date().toISOString();
}

function resolveLevel() {
  const val = (process.env.LOG_LEVEL || '').toLowerCase();
  if (val === 'error') return 0;
  if (val === 'warn') return 1;
  if (val === 'step') return 1; // 仅保留 step/warn/error
  return 2; // 默认 info 全部输出
}

function createLogger(scope = 'app') {
  const threshold = resolveLevel();

  const format = (level, args) => {
    const prefix = `[${timestamp()}][${scope}][${levels[level].label}]`;
    return [prefix, ...args];
  };

  const shouldLog = (level) => levels[level].weight <= threshold;

  const info = (...args) => { if (shouldLog('info')) console.log(...format('info', args)); };
  const warn = (...args) => { if (shouldLog('warn')) console.warn(...format('warn', args)); };
  const error = (...args) => { if (shouldLog('error')) console.error(...format('error', args)); };
  const step = (label, extra) => {
    if (!shouldLog('step')) return;
    const parts = [label];
    if (extra) {
      parts.push(typeof extra === 'string' ? extra : JSON.stringify(extra));
    }
    console.log(...format('step', parts));
  };

  return { info, warn, error, step };
}

module.exports = { createLogger };
