'use strict';

/**
 * High Roll — the template game. Copy this folder to src/games/<your-id>/ to
 * start a new game (see docs/adding-a-game.md). Folders starting with "_" are
 * skipped by the registry, so this one is never loaded into the bot.
 *
 * Every field is described in src/games/_core/registry.js.
 */

const { HighRollManager } = require('./manager');
const { handleInteraction } = require('./handlers');

module.exports = {
  id: 'highroll',                 // also the slash command name and the dashboard feature id
  name: 'High Roll',
  order: 99,                      // position in lists such as the dashboard
  prefix: 'hr_',                  // every button/modal customId starts with this
  clientKey: 'highRollManager',   // the manager is also available as client.highRollManager
  createManager: () => new HighRollManager(),
  command: require('./command'),
  handleInteraction,
  restore: require('./restore'),
  stats: require('./stats'),
};
