'use strict';

const { HuesCluesManager } = require('./manager');
const { handleInteraction } = require('./handlers');

/** Hues & Clues game manifest — see src/games/_core/registry.js for the fields. */
module.exports = {
  id: 'huesclues',
  name: 'Hues & Clues',
  order: 6,
  prefix: 'hc_',
  clientKey: 'huesCluesManager',
  createManager: () => new HuesCluesManager(),
  command: require('./command'),
  handleInteraction,
  restore: require('./restore'),
  stats: require('./stats'),
};
