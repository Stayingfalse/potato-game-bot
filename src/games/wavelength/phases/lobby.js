'use strict';

const { MIN_PLAYERS } = require('../manager');
const { buildLobbyRow, formatPlayerList } = require('../../_core/lobby');

function renderLobbyText(game) {
  const playerList = formatPlayerList(game.players.keys());

  return [
    '## 〰️ Wavelength — Lobby Open',
    `**Host:** <@${game.hostId}>`,
    '',
    `**Players (${game.players.size}/20):**`,
    playerList,
    '',
    'A random **Clue Giver** will be chosen when the game starts.',
    'The Clue Giver picks a spectrum and gives a clue. Everyone else nudges a marker to guess where they think the target sits!',
    '',
    `*Minimum ${MIN_PLAYERS} players to start. New here? Press **How to play**.*`,
  ].join('\n');
}

/** Start is disabled until the lobby has enough players. */
function buildLobbyComponents(game) {
  return [buildLobbyRow({ prefix: 'wl_', playerCount: game.players.size, minPlayers: MIN_PLAYERS })];
}

module.exports = {
  renderLobbyText,
  buildLobbyComponents,
};
