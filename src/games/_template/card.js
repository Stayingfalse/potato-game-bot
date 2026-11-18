'use strict';

/**
 * The game's status card in the channel it was started from: the reply to
 * `/highroll start`, kept up to date with the lobby, "in progress" and the
 * result (see src/games/_core/channelCard.js). Its Join button has the
 * customId `hr_card_join`, handled in handlers.js.
 */
const { createChannelCard } = require('../_core/channelCard');

module.exports = createChannelCard({
  name: 'High Roll',
  emoji: '🎲',
  prefix: 'hr_',
  clientKey: 'highRollManager',
  repository: require('./repository'),
});
