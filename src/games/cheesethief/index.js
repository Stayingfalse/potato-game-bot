'use strict';

const { CheeseThiefManager } = require('../../game/CheeseThiefManager');
const { handleInteraction } = require('./handlers');

/** Cheese Thief game manifest — see src/games/_core/registry.js for the fields. */
module.exports = {
  id: 'cheesethief',
  name: 'Cheese Thief',
  order: 3,
  prefix: 'ct_',
  clientKey: 'cheeseThiefManager',
  createManager: () => new CheeseThiefManager(),
  command: require('./command'),
  handleInteraction,
  restore: require('./restore'),
};
