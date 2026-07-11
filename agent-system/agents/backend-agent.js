'use strict';

const { BaseAgent } = require('./base-agent');
const gen = require('../templates/generators');

/**
 * Backend agent — generates the Express server, the app's package.json, and the
 * file-backed persistence. Owns server.js / package.json / data files, so it
 * runs concurrently with the frontend agent.
 */
class BackendAgent extends BaseAgent {
  constructor() {
    super({ name: 'backend-agent', role: 'Generate the Express server, API routes and file-backed storage.' });
  }

  templateFiles(ctx) {
    return gen.backend(ctx.blueprint);
  }

  prompt(ctx) {
    return [
      'You are the backend agent for Ashtanga Yoga Bangkok.',
      `Build server.js (Express), package.json and any data files for: "${ctx.blueprint.description}".`,
      ctx.blueprint.projectType === 'booking-system'
        ? 'Routes: GET /api/classes (from classes.json), GET /api/bookings, POST /api/bookings with per-class-per-date capacity checks, persisting to bookings.json. Serve public/ statically.'
        : 'Route: POST /api/contact persisting to messages.json. Serve public/ statically.',
      'No external database. Runnable with `npm install && node server.js` on PORT (default 5000).',
    ].join('\n');
  }
}

module.exports = { BackendAgent };
