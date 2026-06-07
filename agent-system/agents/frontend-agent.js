'use strict';

const { BaseAgent } = require('./base-agent');
const gen = require('../templates/generators');

/**
 * Frontend agent — generates the user-facing HTML/CSS (and inline JS that talks
 * to the backend API). Owns files under public/, so it can run concurrently
 * with the backend agent without collisions.
 */
class FrontendAgent extends BaseAgent {
  constructor() {
    super({ name: 'frontend-agent', role: 'Generate mobile-first HTML/CSS and client-side JS.' });
  }

  templateFiles(ctx) {
    return gen.frontend(ctx.blueprint);
  }

  prompt(ctx) {
    return [
      'You are the frontend agent for Ashtanga Yoga Bangkok.',
      `Build public/index.html and public/styles.css for: "${ctx.blueprint.description}".`,
      ctx.blueprint.projectType === 'booking-system'
        ? 'The page fetches GET /api/classes to render a schedule and POSTs to /api/bookings { name, email, classId, date }.'
        : 'The page posts a contact form to /api/contact.',
      'Mobile-first, no build step, vanilla JS only.',
    ].join('\n');
  }
}

module.exports = { FrontendAgent };
