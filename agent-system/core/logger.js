'use strict';

/**
 * Tiny timestamped logger. Keeps orchestration output readable in the CLI,
 * the web server logs, and the Telegram process alike.
 */

const COLORS = {
  reset: '\x1b[0m',
  dim: '\x1b[2m',
  cyan: '\x1b[36m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
};

function stamp() {
  return new Date().toISOString().replace('T', ' ').replace('Z', '');
}

function line(color, scope, msg) {
  const c = process.stdout.isTTY ? color : '';
  const r = process.stdout.isTTY ? COLORS.reset : '';
  const d = process.stdout.isTTY ? COLORS.dim : '';
  return `${d}${stamp()}${r} ${c}[${scope}]${r} ${msg}`;
}

function make(scope) {
  return {
    info: (msg) => console.log(line(COLORS.cyan, scope, msg)),
    ok: (msg) => console.log(line(COLORS.green, scope, msg)),
    warn: (msg) => console.warn(line(COLORS.yellow, scope, msg)),
    error: (msg) => console.error(line(COLORS.red, scope, msg)),
    child: (sub) => make(`${scope}:${sub}`),
  };
}

module.exports = { logger: make('hermes'), make };
