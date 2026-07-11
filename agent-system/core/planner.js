'use strict';

/**
 * Planner — decomposes a natural-language request into a project type and an
 * ordered set of subtasks routed to specialized agents, with dependencies.
 *
 * Rule-based and deterministic. (A future variant can ask Claude for the plan;
 * the orchestrator consumes the same { projectType, slug, subtasks } shape.)
 */

function slugify(s) {
  return (
    String(s)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 48) || 'project'
  );
}

function classify(description) {
  const d = description.toLowerCase();
  if (/\b(book|booking|reserv|schedule|class(es)?|appointment|sign[\s-]?up)\b/.test(d)) {
    return 'booking-system';
  }
  // forms, landing pages, websites all map to the generic webpage builder
  return 'webpage';
}

/**
 * @returns {{ projectType:string, slug:string, description:string,
 *             subtasks: Array<{agent:string, subtask:string, dependsOn:string[]}> }}
 */
function plan(description) {
  const projectType = classify(description);
  const base = projectType === 'booking-system' ? 'yoga-booking-system' : slugify(description);
  const slug = `${base}`;

  const subtasks = [
    { agent: 'research-agent', subtask: 'Define requirements and entities', dependsOn: [] },
    { agent: 'content-agent', subtask: 'Produce seed data and copy', dependsOn: ['research-agent'] },
    { agent: 'frontend-agent', subtask: 'Generate the UI', dependsOn: ['content-agent'] },
    { agent: 'backend-agent', subtask: 'Generate the API and storage', dependsOn: ['content-agent'] },
  ];

  return { projectType, slug, description, subtasks };
}

/**
 * Group subtasks into layers that can each run in parallel, respecting
 * dependencies. Returns an array of arrays of subtasks.
 */
function toLayers(subtasks) {
  const done = new Set();
  const remaining = [...subtasks];
  const layers = [];
  let guard = 0;
  while (remaining.length && guard++ < 100) {
    const ready = remaining.filter((t) => t.dependsOn.every((d) => done.has(d)));
    if (!ready.length) {
      // Dependency cycle or unknown dep — flush the rest as one layer.
      layers.push(remaining.splice(0));
      break;
    }
    layers.push(ready);
    ready.forEach((t) => {
      done.add(t.agent);
      remaining.splice(remaining.indexOf(t), 1);
    });
  }
  return layers;
}

module.exports = { plan, toLayers, classify, slugify };
