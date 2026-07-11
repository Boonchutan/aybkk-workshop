'use strict';

/**
 * Base class for specialized agents. Each agent is a thin, focused unit:
 *  - `role`          : one-line description of its responsibility
 *  - `templateFiles` : deterministic offline output (used by the template executor)
 *  - `prompt`        : instructions handed to Claude when HERMES_USE_CLAUDE=1
 *
 * The orchestrator never calls a generation backend directly; it asks the
 * Executor to run an agent, which picks template vs. Claude transparently.
 */
class BaseAgent {
  constructor({ name, role }) {
    this.name = name;
    this.role = role;
  }

  /** Override: deterministic files for the given context. */
  templateFiles(/* ctx */) {
    return [];
  }

  /** Override: natural-language instructions for the Claude backend. */
  prompt(ctx) {
    return `You are the ${this.name}. ${this.role}\nProject request: ${ctx.blueprint.description}`;
  }
}

module.exports = { BaseAgent };
