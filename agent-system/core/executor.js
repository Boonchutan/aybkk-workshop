'use strict';

/**
 * Pluggable generation backend for agents — the "brains" layer.
 *
 *   TemplateExecutor : deterministic, offline. Each agent supplies its own
 *                      template output. Always available.
 *   ClaudeCodeExecutor : delegates to the local `claude` CLI in headless mode
 *                      (`claude -p ... --output-format json`). This is the
 *                      "Hermes runs Claude Code" path. Enabled when
 *                      HERMES_USE_CLAUDE=1 and `claude` is on PATH; any failure
 *                      falls back, per-agent, to the template output so a run
 *                      never hard-fails because of the network or auth.
 *
 * Each agent exposes two methods that this module consumes:
 *   agent.templateFiles(ctx)  -> [{ path, content }]
 *   agent.prompt(ctx)         -> string  (instructions for Claude)
 */

const { execFileSync } = require('child_process');
const { logger } = require('./logger');

const log = logger.child('executor');

function claudeOnPath() {
  try {
    execFileSync('claude', ['--version'], { stdio: 'pipe', timeout: 8000 });
    return true;
  } catch {
    return false;
  }
}

class Executor {
  constructor(opts = {}) {
    this.useClaude = (opts.useClaude ?? process.env.HERMES_USE_CLAUDE === '1');
    this.claudeAvailable = this.useClaude ? claudeOnPath() : false;
    this.mode = this.claudeAvailable ? 'claude' : 'template';
    if (this.useClaude && !this.claudeAvailable) {
      log.warn('HERMES_USE_CLAUDE=1 but `claude` not runnable on PATH — using templates.');
    }
    log.info(`generation backend: ${this.mode}`);
  }

  /**
   * Produce files for one agent. Returns { files, executor }.
   */
  runAgent(agent, ctx) {
    if (this.mode === 'claude') {
      try {
        const files = this._viaClaude(agent, ctx);
        if (Array.isArray(files) && files.length) {
          return { files, executor: 'claude' };
        }
        log.warn(`${agent.name}: Claude returned no files — falling back to template.`);
      } catch (err) {
        log.warn(`${agent.name}: Claude generation failed (${err.message}) — falling back to template.`);
      }
    }
    return { files: agent.templateFiles(ctx), executor: 'template' };
  }

  _viaClaude(agent, ctx) {
    const instructions = agent.prompt(ctx);
    const prompt = [
      instructions,
      '',
      'Respond with ONLY a JSON array, no prose, no markdown fences. Each element:',
      '{ "path": "relative/path.ext", "content": "full file contents" }',
      'Paths are relative to the project root. Include every file you create.',
    ].join('\n');

    const raw = execFileSync(
      'claude',
      ['-p', prompt, '--output-format', 'json'],
      { encoding: 'utf8', timeout: 120000, maxBuffer: 32 * 1024 * 1024 }
    );

    // `--output-format json` wraps the reply; the model text is in `.result`.
    let resultText = raw;
    try {
      const wrapped = JSON.parse(raw);
      if (wrapped && typeof wrapped.result === 'string') resultText = wrapped.result;
    } catch {
      /* not wrapped — treat raw as the text */
    }
    return parseFileArray(resultText);
  }
}

function parseFileArray(text) {
  const start = text.indexOf('[');
  const end = text.lastIndexOf(']');
  if (start === -1 || end === -1 || end < start) {
    throw new Error('no JSON array found in Claude output');
  }
  const arr = JSON.parse(text.slice(start, end + 1));
  return arr
    .filter((f) => f && typeof f.path === 'string' && typeof f.content === 'string')
    .map((f) => ({ path: f.path, content: f.content }));
}

module.exports = { Executor, claudeOnPath };
