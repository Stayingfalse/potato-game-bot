'use strict';

const GameManager = require('../../game/GameManager');
const { handleInteraction } = require('./handlers');

/** Werewords game manifest — see src/games/_core/registry.js for the fields. */
module.exports = {
  id: 'werewords',
  name: 'Werewords',
  order: 1,
  prefix: 'ww_',
  clientKey: 'gameManager',
  createManager: () => new GameManager(),
  command: require('./command'),
  handleInteraction,
  restore: require('./restore'),
};
