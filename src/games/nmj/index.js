'use strict';

const { NoMoreJockeysManager } = require('../../game/NoMoreJockeysManager');
const { handleInteraction } = require('./handlers');

/** No More Jockeys game manifest — see src/games/_core/registry.js for the fields. */
module.exports = {
  id: 'nmj',
  name: 'No More Jockeys',
  order: 5,
  prefix: 'nmj_',
  clientKey: 'nmjManager',
  createManager: () => new NoMoreJockeysManager(),
  command: require('./command'),
  handleInteraction,
  restore: require('./restore'),
};
