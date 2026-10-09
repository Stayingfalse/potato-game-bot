'use strict';

const { buildGameThreadEmbed, buildPlayingComponents } = require('./phases/lobby');
const { buildBoardEmbed } = require('./phases/playing');
const { buildRevealEmbed, buildRevealComponents } = require('./phases/reveal');
const { buildWordRevealEmbed, buildVoteEmbed, buildVoteComponents } = require('./phases/voting');
const { buildPlayerStatsEmbed, buildWinnerEmbed } = require('./phases/sessionEnd');

/**
 * Builds the live game message for the game's current phase:
 *   playing  → the ready-up list until everyone is ready, then the board
 *   reveal   → the "word was guessed" prompt for the Werewolf
 *   voting   → the word, each player's response cards, and the vote
 *   ended    → the result banner (pass `outcome`)
 *
 * @param {import('./state')} game
 * @param {{ outcome?: string }} [options]
 * @returns {{ embeds: import('discord.js').EmbedBuilder[], components: import('discord.js').ActionRowBuilder[] }}
 */
function renderGameMessage(game, { outcome } = {}) {
  if (game.phase === 'reveal') {
    return { embeds: [buildRevealEmbed(game)], components: buildRevealComponents(game) };
  }
  if (game.phase === 'voting') {
    return {
      embeds: [buildWordRevealEmbed(game), buildPlayerStatsEmbed(game), buildVoteEmbed(game)],
      components: buildVoteComponents(game.players),
    };
  }
  if (game.phase === 'ended') {
    const result = outcome ?? game.sessionHistory.at(-1)?.outcome ?? 'host_cancelled';
    return { embeds: [buildWinnerEmbed(game, result)], components: [] };
  }

  const everyoneReady = game.readyPlayers.size >= game.players.size;
  return {
    embeds: [everyoneReady ? buildBoardEmbed(game) : buildGameThreadEmbed(game)],
    components: buildPlayingComponents(),
  };
}

module.exports = { renderGameMessage };
