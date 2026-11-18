'use strict';

/** No More Jockeys' status card in the channel the game was started from (see _core/channelCard.js). */
const { createChannelCard } = require('../_core/channelCard');

module.exports = createChannelCard({
  name: 'No More Jockeys',
  emoji: '🎬',
  prefix: 'nmj_',
  clientKey: 'nmjManager',
  repository: require('./repository'),
});
