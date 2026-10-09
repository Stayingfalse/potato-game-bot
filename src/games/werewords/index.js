'use strict';

const { WerewordsManager } = require('./manager');
const { handleInteraction, handleMessage } = require('./handlers');

/** Werewords game manifest — see src/games/_core/registry.js for the fields. */
module.exports = {
  id: 'werewords',
  name: 'Werewords',
  order: 1,
  prefix: 'ww_',
  clientKey: 'werewordsManager',
  createManager: () => new WerewordsManager(),
  command: require('./command'),
  handleInteraction,
  handleMessage,
  restore: require('./restore'),
};
