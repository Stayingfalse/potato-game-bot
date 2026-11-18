'use strict';

/** Werewords' status card in the channel the game was started from (see _core/channelCard.js). */
const { createChannelCard } = require('../_core/channelCard');

module.exports = createChannelCard({
  name: 'Werewords',
  emoji: '🔮',
  prefix: 'ww_',
  clientKey: 'werewordsManager',
  repository: require('./repository'),
});
