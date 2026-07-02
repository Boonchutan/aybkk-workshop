'use strict';

const { ResearchAgent } = require('../agents/research-agent');
const { ContentAgent } = require('../agents/content-agent');
const { FrontendAgent } = require('../agents/frontend-agent');
const { BackendAgent } = require('../agents/backend-agent');

/**
 * Agent registry — instantiates the specialized agents once and exposes lookup
 * by name. Add a new agent here and the planner can route to it.
 */
function buildRegistry() {
  const agents = [new ResearchAgent(), new ContentAgent(), new FrontendAgent(), new BackendAgent()];
  const byName = new Map(agents.map((a) => [a.name, a]));
  return {
    all: () => agents,
    get: (name) => byName.get(name),
    has: (name) => byName.has(name),
  };
}

module.exports = { buildRegistry };
