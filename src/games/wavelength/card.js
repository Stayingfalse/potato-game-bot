'use strict';

/** Wavelength's status card in the channel the game was started from (see _core/channelCard.js). */
const { createChannelCard } = require('../_core/channelCard');

module.exports = createChannelCard({
  name: 'Wavelength',
  emoji: '〰️',
  prefix: 'wl_',
  clientKey: 'wavelengthManager',
  repository: require('./repository'),
});
