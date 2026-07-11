'use strict';

const { BaseAgent } = require('./base-agent');
const gen = require('../templates/generators');

/**
 * Research agent — turns the request into structured requirements that the
 * downstream agents build against. Runs first; everything else depends on it.
 */
class ResearchAgent extends BaseAgent {
  constructor() {
    super({ name: 'research-agent', role: 'Clarify requirements, entities and constraints for the project.' });
  }

  templateFiles(ctx) {
    return gen.research(ctx.blueprint);
  }

  prompt(ctx) {
    return [
      'You are the research agent for Ashtanga Yoga Bangkok.',
      `Turn this request into a requirements.json file: "${ctx.blueprint.description}".`,
      'Capture: project name, type, entities, constraints (file-backed, runnable with npm install && node server.js), and a short scope note.',
      ctx.clientContext ? `Client context:\n${ctx.clientContext}` : '',
    ].filter(Boolean).join('\n');
  }
}

module.exports = { ResearchAgent };
