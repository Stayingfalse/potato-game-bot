'use strict';

/**
 * Werewords interaction entry points. Buttons are matched against each topic
 * file's route table; the game is looked up from the thread the click came from.
 */

const lobby = require('./lobby');
const setup = require('./setup');
const responses = require('./responses');
const endgame = require('./endgame');

const BUTTONS = [...lobby.buttons, ...setup.buttons, ...responses.buttons, ...endgame.buttons];

/** Lobby buttons posted before the lobby moved into the thread carry its ID: `ww_join_<threadId>`. */
const OLD_LOBBY_BUTTON = /^ww_(?:join|leave|start|cancel)_(\d+)$/;

async function handleButton(interaction, client) {
  const route = BUTTONS.find(r => r.match(interaction.customId));
  if (!route) return;
  const oldLobby = OLD_LOBBY_BUTTON.exec(interaction.customId);
  const game = client.werewordsManager.getGame(oldLobby ? oldLobby[1] : interaction.channelId);
  return route.handle(interaction, client, game);
}

/** Entry point for every interaction whose customId starts with `ww_`. */
async function handleInteraction(interaction, client) {
  if (interaction.isModalSubmit()) {
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
