'use strict';

const HerdMentalityManager = require('../../game/HerdMentalityManager');
const { handleInteraction } = require('./handlers');

/** Herd Mentality game manifest — see src/games/_core/registry.js for the fields. */
module.exports = {
  id: 'herdmentality',
  name: 'Herd Mentality',
  order: 4,
  prefix: 'hm_',
  clientKey: 'herdMentalityManager',
  createManager: () => new HerdMentalityManager(),
  command: require('./command'),
  handleInteraction,
  restore: require('./restore'),
};
