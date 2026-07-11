'use strict';

const { BaseAgent } = require('./base-agent');
const gen = require('../templates/generators');

/**
 * Content agent — produces the data and copy the app runs on (the class
 * schedule for a booking system, or hero/intro copy for a page).
 */
class ContentAgent extends BaseAgent {
  constructor() {
    super({ name: 'content-agent', role: 'Produce seed data and copy (class schedule, descriptions, marketing text).' });
  }

  templateFiles(ctx) {
    return gen.content(ctx.blueprint);
  }

  prompt(ctx) {
    if (ctx.blueprint.projectType === 'booking-system') {
      return [
        'You are the content agent for Ashtanga Yoga Bangkok.',
        'Produce classes.json: an array of bookable classes with fields',
        'id, name, description, days (array), time, level, capacity, priceTHB.',
        'Use authentic Ashtanga offerings: Mysore self-practice, Led Primary Series, Beginner Orientation.',
      ].join('\n');
    }
    return [
      'You are the content agent for Ashtanga Yoga Bangkok.',
      `Produce content.json with hero and intro copy for: "${ctx.blueprint.description}".`,
    ].join('\n');
  }
}

module.exports = { ContentAgent };
