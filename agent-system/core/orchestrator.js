'use strict';

const path = require('path');
const fs = require('fs');

const planner = require('./planner');
const generators = require('../templates/generators');
const { buildRegistry } = require('./registry');
const { Executor } = require('./executor');
const { logger } = require('./logger');

const log = logger.child('orchestrator');
const PROJECTS_DIR = path.join(__dirname, '..', 'projects');

function stamp() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

/**
 * Hermes — the orchestration engine.
 *
 *   runTask(description)
 *     1. plan      : decompose into agent subtasks (planner)
 *     2. blueprint : resolve the data the agents build against (generators)
 *     3. delegate  : run agents layer-by-layer, parallel within a layer
 *     4. assemble  : write all produced files into a project directory
 *     5. remember  : persist the project + per-agent runs to SQLite memory
 */
class Orchestrator {
  constructor({ memory, executor, projectsDir } = {}) {
    this.memory = memory || null;
    this.executor = executor || new Executor();
    this.registry = buildRegistry();
    this.projectsDir = projectsDir || PROJECTS_DIR;
  }

  async runTask(description, { clientId } = {}) {
    const startedAt = Date.now();
    log.info(`task: "${description}"`);

    // 1. plan
    const p = planner.plan(description);
    log.info(`type=${p.projectType} agents=${p.subtasks.map((t) => t.agent).join(', ')}`);

    // 2. blueprint + context
    const clientContext = clientId && this.memory ? this.memory.getClientContext(clientId) : '';
    const blueprint = generators.buildBlueprint(p);
    const ctx = { blueprint, clientContext, plan: p };

    // 3. delegate, layer by layer (parallel within each layer)
    const layers = planner.toLayers(p.subtasks);
    const files = [];
    const runs = [];
    const agentsUsed = [];
    let executorUsed = 'template';

    for (const layer of layers) {
      const results = await Promise.all(
        layer.map(async (task) => {
          const agent = this.registry.get(task.agent);
          if (!agent) {
            log.warn(`no agent named ${task.agent} — skipping`);
            return null;
          }
          const out = this.executor.runAgent(agent, ctx);
          log.ok(`${agent.name} → ${out.files.length} file(s) [${out.executor}]`);
          return { task, agent, out };
        })
      );

      for (const r of results) {
        if (!r) continue;
        agentsUsed.push(r.agent.name);
        if (r.out.executor === 'claude') executorUsed = 'claude';
        for (const f of r.out.files) files.push(f);
        runs.push({
          agent: r.agent.name,
          subtask: r.task.subtask,
          executor: r.out.executor,
          summary: `${r.out.files.length} file(s): ${r.out.files.map((f) => f.path).join(', ')}`,
        });
      }
    }

    // 4. assemble — write files to disk
    const dirName = `run-${stamp()}-${p.slug}`;
    const projectDir = path.join(this.projectsDir, dirName);
    this._writeFiles(projectDir, files);
    this._writeManifest(projectDir, { description, plan: p, files, agentsUsed, executorUsed });

    // 5. remember
    let projectId = null;
    if (this.memory) {
      projectId = this.memory.recordProject({
        slug: p.slug,
        clientId,
        description,
        projectType: p.projectType,
        agentsUsed,
        executor: executorUsed,
        files: files.map((f) => f.path),
        dir: projectDir,
      });
      runs.forEach((run) => this.memory.recordAgentRun(projectId, run));
    }

    const summary = {
      ok: true,
      projectId,
      slug: p.slug,
      projectType: p.projectType,
      dir: projectDir,
      relDir: path.relative(path.join(__dirname, '..'), projectDir),
      files: files.map((f) => f.path),
      agentsUsed,
      executor: executorUsed,
      tookMs: Date.now() - startedAt,
    };
    log.ok(`done in ${summary.tookMs}ms → ${summary.relDir} (${files.length} files)`);
    return summary;
  }

  _writeFiles(projectDir, files) {
    for (const f of files) {
      const dest = path.join(projectDir, f.path);
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.writeFileSync(dest, f.content);
    }
  }

  _writeManifest(projectDir, { description, plan, files, agentsUsed, executorUsed }) {
    const manifest = {
      generatedBy: 'Hermes (AYBKK multi-agent system)',
      request: description,
      projectType: plan.projectType,
      slug: plan.slug,
      agentsUsed,
      executor: executorUsed,
      subtasks: plan.subtasks,
      files: files.map((f) => f.path),
      generatedAt: new Date().toISOString(),
    };
    fs.writeFileSync(path.join(projectDir, 'MANIFEST.json'), JSON.stringify(manifest, null, 2) + '\n');
  }
}

module.exports = { Orchestrator, PROJECTS_DIR };
