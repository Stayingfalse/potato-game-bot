'use strict';

/**
 * Werewords interaction entry points. Buttons are matched against each topic
 * file's route table; the game is looked up from the thread the click came from.
 */

const lobby = require('./lobby');
const setup = require('./setup');
const responses = require('./responses');
const endgame = require('./endgame');
const { buildLobbyEmbed, buildModeSelectEmbed, buildActiveEmbed } = require('../phases/lobby');
const { updateLobbyMessage } = require('./shared');
const { trackHostActivity, handleTakeHost } = require('../../_core/host');

/** A player takes over from a host who has gone quiet. The lobby message names the host, so it is redrawn. */
function handleTakeHostButton(interaction, client, game) {
  return handleTakeHost(interaction, client, game, {
    manager: client.werewordsManager,
    rerender: () => {
      const embed = game.phase === 'lobby' ? buildLobbyEmbed(game)
        : game.phase === 'mode_select' ? buildModeSelectEmbed(game)
          : buildActiveEmbed(game);
      return updateLobbyMessage(game, client, { embeds: [embed] });
    },
  });
}

const BUTTONS = [
  { match: id => id === 'ww_take_host', handle: handleTakeHostButton },
  ...lobby.buttons, ...setup.buttons, ...responses.buttons, ...endgame.buttons,
];

/** Lobby buttons posted before the lobby moved into the thread carry its ID: `ww_join_<threadId>`. */
const OLD_LOBBY_BUTTON = /^ww_(?:join|leave|start|cancel)_(\d+)$/;

async function handleButton(interaction, client) {
  const route = BUTTONS.find(r => r.match(interaction.customId));
  if (!route) return;
  const oldLobby = OLD_LOBBY_BUTTON.exec(interaction.customId);
  const game = client.werewordsManager.getGame(oldLobby ? oldLobby[1] : interaction.channelId);
  if (game) trackHostActivity(interaction, game);
  return route.handle(interaction, client, game);
}

/** Entry point for every interaction whose customId starts with `ww_`. */
async function handleInteraction(interaction, client) {
  if (interaction.isModalSubmit()) {
    const game = client.werewordsManager.getGame(interaction.channelId);
    if (game) trackHostActivity(interaction, game);
    if (interaction.customId === 'ww_word_modal') return setup.handleWordModal(interaction, client);
    return;
  }
  if (interaction.isButton()) return handleButton(interaction, client);
}

module.exports = {
  handleInteraction,
  handleMessage: responses.handleGuessMessage,
  closeSession: endgame.closeSession,
};
