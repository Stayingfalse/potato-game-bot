'use strict';

const { findGameByCustomId } = require('./registry');
const { withErrorReply } = require('./errors');

/**
 * Hands a button or modal interaction to the game that owns its customId prefix.
 * Errors thrown by the game are logged and reported to the user.
 *
 * @returns {Promise<boolean>} whether a game claimed the interaction
 */
async function routeGameInteraction(interaction, client) {
  const game = findGameByCustomId(interaction.customId);
  if (!game) return false;
  await withErrorReply(`${game.name} interaction error`, interaction, () => game.handleInteraction(interaction, client));
  return true;
}

module.exports = { routeGameInteraction };
