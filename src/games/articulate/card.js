'use strict';

/** Articulate's status card in the channel the game was started from (see _core/channelCard.js). */
const { createChannelCard } = require('../_core/channelCard');

module.exports = createChannelCard({
  name: 'Articulate',
  emoji: '🗣️',
  prefix: 'ar_',
  clientKey: 'articulateManager',
  repository: require('./repository'),
});
