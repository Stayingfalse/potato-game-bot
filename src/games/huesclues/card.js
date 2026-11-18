'use strict';

/** Hues & Clues' status card in the channel the game was started from (see _core/channelCard.js). */
const { createChannelCard } = require('../_core/channelCard');

module.exports = createChannelCard({
  name: 'Hues & Clues',
  emoji: '🎨',
  prefix: 'hc_',
  clientKey: 'huesCluesManager',
  repository: require('./repository'),
});
