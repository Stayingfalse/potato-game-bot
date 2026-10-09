'use strict';

const WavelengthManager = require('../../game/WavelengthManager');
const { handleWavelengthInteraction: handleInteraction } = require('../../game/wavelength/interactionHandler');

/** Wavelength game manifest — see src/games/_core/registry.js for the fields. */
module.exports = {
  id: 'wavelength',
  name: 'Wavelength',
  order: 2,
  prefix: 'wl_',
  clientKey: 'wavelengthManager',
  createManager: () => new WavelengthManager(),
  command: require('./command'),
  handleInteraction,
  restore: require('./restore'),
};
