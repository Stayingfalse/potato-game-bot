'use strict';

const { ArticulateManager } = require('./manager');
const { handleInteraction } = require('./handlers');

/** Articulate game manifest — see src/games/_core/registry.js for the fields. */
module.exports = {
  id: 'articulate',
  name: 'Articulate',
  order: 7,
  prefix: 'ar_',
  clientKey: 'articulateManager',
  createManager: () => new ArticulateManager(),
  command: require('./command'),
  handleInteraction,
  restore: require('./restore'),
  stats: require('./stats'),
};
